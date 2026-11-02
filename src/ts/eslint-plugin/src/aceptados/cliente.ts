import type { IssueAceptado } from "./archivo.js";
import { VARIABLE_DEL_TOKEN, type Opciones } from "./opciones.js";

/** Máximo de issues por página que admite la API. */
export const TAMANO_DE_PAGINA = 500;

/** Máximo de issues que la API devuelve por consulta, sumando todas las páginas. */
export const LIMITE_DE_LA_API = 10_000;

const ESPERA_MS = 30_000;

/**
 * Reglas propias importadas como issues externos: `external_roslyn:LAIN004` y
 * `external_eslint_repo:lainco/no-hardcoded-secrets`. Van las de los dos motores, igual que
 * en la versión .NET: en un repositorio mixto las dos escriben el mismo archivo (T3 de
 * docs/FASE-5.md). Las de Sonar y las de otros orígenes (`no-debugger`, `CA1822`) no.
 */
const REGLA_PROPIA = /^external_[^:]+:(LAIN\d{3}|lainco\/[a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** La API de SonarQube falló, rechazó el pedido o no respondió. */
export class ErrorDeSonar extends Error {}

interface IssueDeLaApi {
  rule?: unknown;
  component?: unknown;
  message?: unknown;
  issueStatus?: unknown;
  resolution?: unknown;
}

/**
 * Los issues de reglas propias aceptados o marcados como falso positivo, recorriendo todas
 * las páginas de `api/issues/search`. Lanza `ErrorDeSonar` si la API falla o no responde.
 */
export async function buscarAceptados(opciones: Opciones, token: string, pedir: typeof fetch): Promise<IssueAceptado[]> {
  const aceptados: IssueAceptado[] = [];
  let pagina = 1;
  let leidos = 0;
  let total: number;

  do {
    const respuesta = await pedirPagina(opciones, token, pagina, pedir);
    total = respuesta.paging.total;
    if (total > LIMITE_DE_LA_API) {
      throw new ErrorDeSonar(
        `La consulta devuelve ${total} issues y la API no entrega más de ${LIMITE_DE_LA_API}. ` +
          "El archivo quedaría incompleto, así que no se genera.",
      );
    }
    // Una página vacía corta el recorrido aunque 'total' diga otra cosa: los issues
    // pueden cambiar de estado mientras se pagina.
    if (respuesta.issues.length === 0) {
      break;
    }
    for (const issue of respuesta.issues) {
      const aceptado = convertir(issue, opciones.proyecto);
      if (aceptado !== null) {
        aceptados.push(aceptado);
      }
    }
    leidos += respuesta.issues.length;
    pagina++;
  } while (leidos < total);

  return aceptados;
}

async function pedirPagina(
  opciones: Opciones,
  token: string,
  pagina: number,
  pedir: typeof fetch,
): Promise<{ paging: { total: number }; issues: IssueDeLaApi[] }> {
  const url = new URL(`${opciones.url}/api/issues/search`);
  url.searchParams.set("componentKeys", opciones.proyecto);
  url.searchParams.set("issueStatuses", "ACCEPTED,FALSE_POSITIVE");
  url.searchParams.set("ps", String(TAMANO_DE_PAGINA));
  url.searchParams.set("p", String(pagina));
  if (opciones.rama !== null) {
    url.searchParams.set("branch", opciones.rama);
  }
  if (opciones.organizacion !== null) {
    url.searchParams.set("organization", opciones.organizacion);
  }

  let respuesta: Response;
  try {
    respuesta = await pedir(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ErrorDeSonar(`${opciones.url} no respondió a tiempo.`);
    }
    const detalle = error instanceof Error ? error.message.replace(/\.$/, "") : String(error);
    throw new ErrorDeSonar(`No se pudo conectar con ${opciones.url}: ${detalle}.`);
  }

  switch (respuesta.status) {
    case 200:
      break;
    case 401:
      throw new ErrorDeSonar(`SonarQube rechazó el token. Revisá la variable ${VARIABLE_DEL_TOKEN}.`);
    case 403:
      throw new ErrorDeSonar(`El token no tiene permiso para ver los issues del proyecto '${opciones.proyecto}'.`);
    case 404:
      throw new ErrorDeSonar(`SonarQube no encontró el proyecto '${opciones.proyecto}' (o la rama indicada).`);
    default:
      throw new ErrorDeSonar(`SonarQube respondió ${respuesta.status}.`);
  }

  let contenido: unknown;
  try {
    contenido = JSON.parse(await respuesta.text());
  } catch {
    throw new ErrorDeSonar("SonarQube devolvió una respuesta que no es JSON.");
  }
  const total = (contenido as { paging?: { total?: unknown } })?.paging?.total;
  const issues = (contenido as { issues?: unknown })?.issues;
  if (typeof total !== "number" || !Array.isArray(issues)) {
    throw new ErrorDeSonar("SonarQube devolvió una respuesta con una forma inesperada.");
  }
  return { paging: { total }, issues };
}

function convertir(issue: IssueDeLaApi, proyecto: string): IssueAceptado | null {
  const coincidencia = typeof issue.rule === "string" ? REGLA_PROPIA.exec(issue.rule) : null;
  if (!coincidencia || typeof issue.component !== "string" || typeof issue.message !== "string") {
    return null;
  }
  return {
    archivo: rutaRelativa(issue.component, proyecto),
    regla: coincidencia[1]!,
    mensaje: issue.message,
    estado: estado(issue),
  };
}

/** El componente viene como `clave-del-proyecto:ruta/al/archivo.ts`; la ruta es relativa a la raíz del análisis. */
function rutaRelativa(componente: string, proyecto: string): string {
  const prefijo = `${proyecto}:`;
  return componente.startsWith(prefijo) ? componente.slice(prefijo.length) : componente.slice(componente.indexOf(":") + 1);
}

/** `issueStatus` es el campo actual; si no viene, se deduce de `resolution`, el anterior. */
function estado(issue: IssueDeLaApi): string {
  if (typeof issue.issueStatus === "string") {
    return issue.issueStatus;
  }
  return issue.resolution === "FALSE-POSITIVE" ? "FALSE_POSITIVE" : "ACCEPTED";
}
