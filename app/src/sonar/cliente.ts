/**
 * Cliente de la Web API de SonarQube Cloud para leer el catálogo de reglas
 * (`api/rules/search`). Lo usa el job `sincronizar-sonar` (paso 6).
 *
 * Verificado contra el código de la Web API (SearchAction.java y search-example.json del
 * repo SonarSource/sonarqube) y contra respuestas grabadas de SonarQube Cloud el
 * 2026-10-16 (tests/fixtures/sonar/):
 *
 * - Tamaño de página: máximo 500. La API no devuelve más allá del resultado 10.000.
 * - SonarQube Cloud pagina con `total`, `p` y `ps` en la raíz; SonarQube Server, con el
 *   objeto `paging`. Se aceptan los dos.
 * - La descripción se toma de `descriptionSections`. SonarQube Cloud manda además
 *   `htmlDesc` y `mdDesc` (la misma descripción); SonarQube Server ya no manda `htmlDesc`,
 *   que queda como respaldo.
 * - Sin token, Sonar oculta las descripciones.
 *
 * No depende de Next ni de la base: recibe `fetch` y la configuración, así se prueba sin
 * red. La configuración desde las variables de entorno está en ./configuracion.ts.
 */

/** Tamaño de página máximo que acepta la API. */
export const TAMANO_DE_PAGINA_MAXIMO = 500;

/** La API no devuelve resultados más allá de este número, pagine como se pagine. */
export const RESULTADOS_MAXIMOS = 10_000;

/** Estados de regla que se piden: todas menos las eliminadas, que Sonar ya no lista. */
const ESTADOS_PEDIDOS = ["READY", "BETA", "DEPRECATED"];

const INTENTOS = 3;
const ESPERA_INICIAL_MS = 1_000;
const TIEMPO_MAXIMO_POR_PEDIDO_MS = 30_000;

/** Una regla de Sonar, con los nombres del dominio. */
export interface ReglaDeSonar {
  /** Clave completa: `csharpsquid:S2325`. */
  clave: string;
  /** Repositorio de reglas: `csharpsquid`, `typescript`. */
  repositorio: string;
  nombre: string;
  /** Lenguaje de Sonar: `cs`, `ts`. */
  lenguaje: string;
  /** `READY`, `BETA` o `DEPRECATED`. */
  estado: string;
  /** `BUG`, `VULNERABILITY`, `CODE_SMELL`, `SECURITY_HOTSPOT`. */
  tipo: string | null;
  /** Severidad por defecto: `BLOCKER`, `CRITICAL`, `MAJOR`, `MINOR`, `INFO`. */
  severidad: string | null;
  /** Tags de sistema y de la organización, sin repetir y ordenados. */
  tags: string[];
  /** Atributo de clean code: `CLEAR`, `CONVENTIONAL`, ... */
  atributoCleanCode: string | null;
  impactos: { calidad: string; severidad: string }[];
  parametros: ParametroDeRegla[];
  /** HTML. Las secciones de Sonar unidas en orden. */
  descripcion: string;
  /** Es una plantilla para crear reglas propias en Sonar. */
  esPlantilla: boolean;
  creadaEn: string | null;
  actualizadaEn: string | null;
}

export interface ParametroDeRegla {
  clave: string;
  descripcion?: string;
  tipo?: string;
  valorDefault?: string;
}

export type TipoDeErrorDeSonar =
  | "autenticacion"
  | "permisos"
  | "noEncontrado"
  | "pedidoInvalido"
  | "servidor"
  | "red"
  | "respuestaInvalida"
  | "demasiadosResultados"
  | "inconsistente";

/** Error al consultar Sonar. El mensaje nunca incluye el token. */
export class ErrorDeSonar extends Error {
  constructor(
    readonly tipo: TipoDeErrorDeSonar,
    mensaje: string,
    readonly estadoHttp?: number,
  ) {
    super(mensaje);
    this.name = "ErrorDeSonar";
  }
}

export interface OpcionesDelCliente {
  /** URL del servidor: `https://sonarcloud.io`. */
  url: string;
  /** Clave de la organización en SonarQube Cloud. Sin ella no se manda (SonarQube Server). */
  organizacion?: string;
  token: string;
  /** Por defecto, el máximo de la API (500). Los tests usan páginas chicas. */
  tamanoDePagina?: number;
  fetch?: typeof globalThis.fetch;
  /** Espera entre reintentos. Los tests la reemplazan para no esperar de verdad. */
  esperar?: (ms: number) => Promise<void>;
}

export interface ClienteSonar {
  /**
   * Todas las reglas de Sonar de un lenguaje (no las externas), recorriendo todas las
   * páginas. Si la lista no se puede traer completa y consistente, falla: una lista
   * incompleta haría que la sincronización dé por eliminadas reglas que existen.
   */
  buscarReglas(lenguaje: string): Promise<ReglaDeSonar[]>;
}

export function crearClienteSonar(opciones: OpcionesDelCliente): ClienteSonar {
  const tamanoDePagina = opciones.tamanoDePagina ?? TAMANO_DE_PAGINA_MAXIMO;
  if (!Number.isInteger(tamanoDePagina) || tamanoDePagina < 1 || tamanoDePagina > TAMANO_DE_PAGINA_MAXIMO) {
    throw new Error(`El tamaño de página tiene que estar entre 1 y ${TAMANO_DE_PAGINA_MAXIMO}.`);
  }
  if (!opciones.token) {
    throw new Error("Falta el token de SonarQube.");
  }

  const base = opciones.url.replace(/\/+$/, "");
  const hacerFetch = opciones.fetch ?? globalThis.fetch;
  const esperar = opciones.esperar ?? ((ms: number) => new Promise<void>((listo) => setTimeout(listo, ms)));
  const sinToken = (texto: string) => texto.split(opciones.token).join("***");

  async function pedirPagina(lenguaje: string, pagina: number): Promise<unknown> {
    const url = new URL(`${base}/api/rules/search`);
    if (opciones.organizacion) {
      url.searchParams.set("organization", opciones.organizacion);
    }
    url.searchParams.set("languages", lenguaje);
    url.searchParams.set("statuses", ESTADOS_PEDIDOS.join(","));
    url.searchParams.set("include_external", "false");
    url.searchParams.set("ps", String(tamanoDePagina));
    url.searchParams.set("p", String(pagina));

    const descripcion = `la página ${pagina} de reglas de '${lenguaje}'`;
    let ultimoError: ErrorDeSonar | undefined;

    for (let intento = 1; intento <= INTENTOS; intento++) {
      if (intento > 1) {
        await esperar(ESPERA_INICIAL_MS * 2 ** (intento - 2));
      }

      let respuesta: Response;
      try {
        respuesta = await hacerFetch(url, {
          headers: { Authorization: `Bearer ${opciones.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_POR_PEDIDO_MS),
        });
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        ultimoError = new ErrorDeSonar("red", sinToken(`No se pudo conectar con SonarQube para traer ${descripcion}: ${motivo}`));
        continue;
      }

      if (respuesta.ok) {
        try {
          return await respuesta.json();
        } catch {
          throw new ErrorDeSonar("respuestaInvalida", `SonarQube devolvió ${descripcion} en un formato que no es JSON.`);
        }
      }

      const error = await errorHttp(respuesta, descripcion, sinToken);
      if (respuesta.status !== 429 && respuesta.status < 500) {
        throw error;
      }
      ultimoError = error;
    }

    throw ultimoError!;
  }

  return {
    async buscarReglas(lenguaje) {
      const reglas: ReglaDeSonar[] = [];
      const claves = new Set<string>();
      let totalEsperado: number | undefined;

      for (let pagina = 1; ; pagina++) {
        const { total, reglas: deLaPagina } = leerPagina(await pedirPagina(lenguaje, pagina));

        if (total > RESULTADOS_MAXIMOS) {
          throw new ErrorDeSonar(
            "demasiadosResultados",
            `SonarQube tiene ${total} reglas de '${lenguaje}' y la API devuelve como máximo ${RESULTADOS_MAXIMOS}.`,
          );
        }
        if (totalEsperado !== undefined && total !== totalEsperado) {
          throw inconsistente(lenguaje, `el total cambió de ${totalEsperado} a ${total} entre páginas`);
        }
        totalEsperado = total;

        for (const regla of deLaPagina) {
          if (claves.has(regla.clave)) {
            throw inconsistente(lenguaje, `la regla ${regla.clave} vino repetida`);
          }
          claves.add(regla.clave);
          reglas.push(regla);
        }

        if (reglas.length >= total) {
          if (reglas.length > total) {
            throw inconsistente(lenguaje, `vinieron ${reglas.length} reglas y el total era ${total}`);
          }
          return reglas;
        }
        if (deLaPagina.length === 0) {
          throw inconsistente(lenguaje, `la página ${pagina} vino vacía con ${reglas.length} de ${total} reglas`);
        }
      }
    },
  };
}

function inconsistente(lenguaje: string, detalle: string): ErrorDeSonar {
  return new ErrorDeSonar(
    "inconsistente",
    `La lista de reglas de '${lenguaje}' cambió mientras se consultaba (${detalle}). Hay que volver a sincronizar.`,
  );
}

async function errorHttp(
  respuesta: Response,
  descripcion: string,
  sinToken: (texto: string) => string,
): Promise<ErrorDeSonar> {
  let detalle = "";
  try {
    const cuerpo: unknown = await respuesta.json();
    if (esObjeto(cuerpo) && Array.isArray(cuerpo.errors)) {
      detalle = cuerpo.errors
        .map((e) => (esObjeto(e) && typeof e.msg === "string" ? e.msg : ""))
        .filter(Boolean)
        .join(" ");
    }
  } catch {
    // El cuerpo no era JSON: alcanza con el código HTTP.
  }

  const estado = respuesta.status;
  const [tipo, explicacion]: [TipoDeErrorDeSonar, string] =
    estado === 401
      ? ["autenticacion", "El token de SonarQube no es válido o venció."]
      : estado === 403
        ? ["permisos", "El token de SonarQube no tiene permiso para leer las reglas."]
        : estado === 404
          ? ["noEncontrado", "SonarQube no encontró lo pedido. ¿Está bien la clave de la organización?"]
          : estado === 429 || estado >= 500
            ? ["servidor", `SonarQube no respondió bien al pedir ${descripcion}.`]
            : ["pedidoInvalido", `SonarQube rechazó el pedido de ${descripcion}.`];

  const mensaje = `${explicacion} (HTTP ${estado}${detalle ? `: ${detalle}` : ""})`;
  return new ErrorDeSonar(tipo, sinToken(mensaje), estado);
}

// ------------------------------------------------------------------ lectura de la respuesta

function leerPagina(cuerpo: unknown): { total: number; reglas: ReglaDeSonar[] } {
  if (!esObjeto(cuerpo) || !Array.isArray(cuerpo.rules)) {
    throw invalida("no trae la lista de reglas");
  }

  // SonarQube Server: `paging`. SonarQube Cloud: `total` en la raíz.
  const total = esObjeto(cuerpo.paging) ? cuerpo.paging.total : cuerpo.total;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
    throw invalida("no trae el total de reglas");
  }

  return { total, reglas: cuerpo.rules.map(leerRegla) };
}

function leerRegla(dato: unknown): ReglaDeSonar {
  if (!esObjeto(dato)) {
    throw invalida("trae una regla que no es un objeto");
  }

  const clave = texto(dato.key);
  const nombre = texto(dato.name);
  const lenguaje = texto(dato.lang);
  if (!clave || !nombre || !lenguaje) {
    throw invalida(`trae una regla sin clave, nombre o lenguaje (${clave ?? "sin clave"})`);
  }

  const de = (campo: string) => `el campo '${campo}' de ${clave}`;

  return {
    clave,
    repositorio: texto(dato.repo) ?? clave.split(":")[0],
    nombre,
    lenguaje,
    estado: texto(dato.status) ?? "READY",
    tipo: texto(dato.type) ?? null,
    severidad: texto(dato.severity) ?? null,
    tags: [...new Set([...textos(dato.sysTags, de("sysTags")), ...textos(dato.tags, de("tags"))])].sort(),
    atributoCleanCode: texto(dato.cleanCodeAttribute) ?? null,
    impactos: lista(dato.impacts, de("impacts")).map((i) => {
      const calidad = texto(i.softwareQuality);
      const severidad = texto(i.severity);
      if (!calidad || !severidad) {
        throw invalida(`trae un impacto incompleto en ${clave}`);
      }
      return { calidad, severidad };
    }),
    parametros: lista(dato.params, de("params")).map((p) => {
      const claveParametro = texto(p.key);
      if (!claveParametro) {
        throw invalida(`trae un parámetro sin clave en ${clave}`);
      }
      const parametro: ParametroDeRegla = { clave: claveParametro };
      const descripcion = texto(p.htmlDesc) ?? texto(p.desc);
      if (descripcion !== undefined) parametro.descripcion = descripcion;
      const tipo = texto(p.type);
      if (tipo !== undefined) parametro.tipo = tipo;
      const valorDefault = texto(p.defaultValue);
      if (valorDefault !== undefined) parametro.valorDefault = valorDefault;
      return parametro;
    }),
    descripcion: descripcionDe(dato, clave),
    esPlantilla: dato.isTemplate === true,
    creadaEn: texto(dato.createdAt) ?? null,
    actualizadaEn: texto(dato.updatedAt) ?? null,
  };
}

/**
 * Las secciones (causa, cómo arreglarlo, recursos...) unidas en orden. Una sección con
 * contexto (por ejemplo, cómo arreglarlo en ASP.NET) lleva el nombre del contexto como
 * título, para que no se confundan dos secciones del mismo tipo.
 */
/**
 * Orden en que Sonar muestra las secciones. La API las devuelve en cualquier orden (en la
 * grabación del 2026-10-16, 152 reglas empezaban por los recursos); con un orden fijo, la
 * descripción y su huella solo cambian si cambia el contenido.
 */
const ORDEN_DE_SECCIONES = ["introduction", "root_cause", "assess_the_problem", "how_to_fix", "resources"];

function posicion(seccion: Record<string, unknown>): number {
  const i = ORDEN_DE_SECCIONES.indexOf(texto(seccion.key) ?? "");
  return i === -1 ? ORDEN_DE_SECCIONES.length : i;
}

function contextoDe(seccion: Record<string, unknown>): string {
  return esObjeto(seccion.context) ? (texto(seccion.context.key) ?? texto(seccion.context.displayName) ?? "") : "";
}

function descripcionDe(dato: Record<string, unknown>, clave: string): string {
  const secciones = lista(dato.descriptionSections, `el campo 'descriptionSections' de ${clave}`);
  if (secciones.length > 0) {
    return [...secciones]
      .sort((a, b) => posicion(a) - posicion(b) || contextoDe(a).localeCompare(contextoDe(b)))
      .flatMap((s) => {
        const contenido = texto(s.content) ?? "";
        const contexto = esObjeto(s.context) ? texto(s.context.displayName) : undefined;
        return contexto ? [`<h3>${contexto}</h3>`, contenido] : [contenido];
      })
      .join("\n");
  }
  return texto(dato.htmlDesc) ?? "";
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined;
}

function textos(valor: unknown, campo: string): string[] {
  if (valor === undefined || valor === null) {
    return [];
  }
  if (!Array.isArray(valor) || !valor.every((v) => typeof v === "string")) {
    throw invalida(`trae ${campo} con valores que no son texto`);
  }
  return valor;
}

function lista(valor: unknown, campo: string): Record<string, unknown>[] {
  if (valor === undefined || valor === null) {
    return [];
  }
  if (!Array.isArray(valor) || !valor.every(esObjeto)) {
    throw invalida(`trae ${campo} con un formato inesperado`);
  }
  return valor;
}

function invalida(detalle: string): ErrorDeSonar {
  return new ErrorDeSonar("respuestaInvalida", `La respuesta de SonarQube ${detalle}.`);
}
