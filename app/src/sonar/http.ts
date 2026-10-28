/**
 * Lo común a todos los pedidos a la Web API de SonarQube: autenticación, reintentos,
 * errores con el mensaje de Sonar y sin el token, y lectura defensiva de las respuestas.
 *
 * Lo usan el catálogo de reglas (cliente.ts) y los perfiles (perfiles.ts).
 */

const INTENTOS = 3;
const ESPERA_INICIAL_MS = 1_000;
const TIEMPO_MAXIMO_POR_PEDIDO_MS = 30_000;

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

/** Error al hablar con Sonar. El mensaje nunca incluye el token. */
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

export interface OpcionesDeConexion {
  /** URL del servidor: `https://sonarcloud.io`. */
  url: string;
  /** Clave de la organización en SonarQube Cloud. Sin ella no se manda (SonarQube Server). */
  organizacion?: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  /** Espera entre reintentos. Los tests la reemplazan para no esperar de verdad. */
  esperar?: (ms: number) => Promise<void>;
}

export interface Pedido {
  metodo?: "GET" | "POST";
  /** `api/rules/search`. */
  ruta: string;
  parametros: Record<string, string>;
  /** Qué se pide, para los mensajes: "la página 2 de reglas de 'cs'". */
  descripcion: string;
  /** Para qué hace falta permiso, para el mensaje del 403: "leer las reglas". */
  permiso: string;
  /** Mandar la organización. Algunas operaciones (las que reciben la clave de un perfil) no la aceptan. */
  conOrganizacion?: boolean;
}

export interface Conexion {
  /**
   * Hace el pedido y devuelve el cuerpo JSON, o `null` si la respuesta no tiene cuerpo
   * (los POST de Sonar devuelven 204). Reintenta las fallas de red, los 429 y los 5xx.
   *
   * Los POST también se reintentan: los que usa la app (activar y desactivar una regla en
   * un perfil) dejan el mismo resultado si se repiten.
   */
  pedir(pedido: Pedido): Promise<unknown>;
}

export function crearConexion(opciones: OpcionesDeConexion): Conexion {
  if (!opciones.token) {
    throw new Error("Falta el token de SonarQube.");
  }

  const base = opciones.url.replace(/\/+$/, "");
  const hacerFetch = opciones.fetch ?? globalThis.fetch;
  const esperar = opciones.esperar ?? ((ms: number) => new Promise<void>((listo) => setTimeout(listo, ms)));
  const sinToken = (texto: string) => texto.split(opciones.token).join("***");

  return {
    async pedir(pedido) {
      const metodo = pedido.metodo ?? "GET";
      const parametros = new URLSearchParams();
      if (opciones.organizacion && pedido.conOrganizacion !== false) {
        parametros.set("organization", opciones.organizacion);
      }
      for (const [clave, valor] of Object.entries(pedido.parametros)) {
        parametros.set(clave, valor);
      }

      const url = new URL(`${base}/${pedido.ruta}`);
      const init: RequestInit = {
        method: metodo,
        headers: { Authorization: `Bearer ${opciones.token}`, Accept: "application/json" },
      };
      if (metodo === "GET") {
        url.search = parametros.toString();
      } else {
        // La Web API de Sonar toma los parámetros de los POST como formulario.
        init.body = parametros;
      }

      let ultimoError: ErrorDeSonar | undefined;
      for (let intento = 1; intento <= INTENTOS; intento++) {
        if (intento > 1) {
          await esperar(ESPERA_INICIAL_MS * 2 ** (intento - 2));
        }

        let respuesta: Response;
        try {
          respuesta = await hacerFetch(url, { ...init, signal: AbortSignal.timeout(TIEMPO_MAXIMO_POR_PEDIDO_MS) });
        } catch (e) {
          const motivo = motivoDeLaFalla(e);
          ultimoError = new ErrorDeSonar(
            "red",
            sinToken(`No se pudo conectar con SonarQube para ${pedido.descripcion}: ${motivo}`),
          );
          continue;
        }

        if (respuesta.ok) {
          const cuerpo = await respuesta.text();
          if (cuerpo.trim() === "") {
            return null;
          }
          try {
            return JSON.parse(cuerpo);
          } catch {
            throw new ErrorDeSonar("respuestaInvalida", `SonarQube respondió en un formato que no es JSON al ${pedido.descripcion}.`);
          }
        }

        const error = await errorHttp(respuesta, pedido, sinToken);
        if (respuesta.status !== 429 && respuesta.status < 500) {
          throw error;
        }
        ultimoError = error;
      }

      throw ultimoError!;
    },
  };
}

async function errorHttp(respuesta: Response, pedido: Pedido, sinToken: (texto: string) => string): Promise<ErrorDeSonar> {
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
        ? ["permisos", `El token de SonarQube no tiene permiso para ${pedido.permiso}.`]
        : estado === 404
          ? ["noEncontrado", `SonarQube no encontró lo pedido al ${pedido.descripcion}.`]
          : estado === 429 || estado >= 500
            ? ["servidor", `SonarQube no respondió bien al ${pedido.descripcion}.`]
            : ["pedidoInvalido", `SonarQube rechazó el pedido al ${pedido.descripcion}.`];

  const mensaje = `${explicacion} (HTTP ${estado}${detalle ? `: ${detalle}` : ""})`;
  return new ErrorDeSonar(tipo, sinToken(mensaje), estado);
}

/**
 * Por qué no se pudo conectar. El `fetch` de Node falla con un "fetch failed" que no dice
 * nada: el motivo de verdad (ETIMEDOUT, ECONNRESET, ENOTFOUND...) está en `cause`. Pasó al
 * probar la 6.2 contra SonarQube Cloud el 2026-10-28.
 */
export function motivoDeLaFalla(e: unknown): string {
  if (!(e instanceof Error)) {
    return String(e);
  }
  if (e.name === "TimeoutError") {
    return `SonarQube no respondió en ${TIEMPO_MAXIMO_POR_PEDIDO_MS / 1000} segundos`;
  }
  const causa = (e as { cause?: unknown }).cause;
  const detalle =
    causa instanceof Error
      ? [(causa as { code?: string }).code, causa.message].filter(Boolean).join(": ")
      : typeof causa === "object" && causa !== null && "code" in causa
        ? String((causa as { code: unknown }).code)
        : "";
  return detalle && !e.message.includes(detalle) ? `${e.message} (${detalle})` : e.message;
}

// ------------------------------------------------------------ lectura de las respuestas

export function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

export function texto(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined;
}

export function textos(valor: unknown, campo: string): string[] {
  if (valor === undefined || valor === null) {
    return [];
  }
  if (!Array.isArray(valor) || !valor.every((v) => typeof v === "string")) {
    throw invalida(`trae ${campo} con valores que no son texto`);
  }
  return valor;
}

export function lista(valor: unknown, campo: string): Record<string, unknown>[] {
  if (valor === undefined || valor === null) {
    return [];
  }
  if (!Array.isArray(valor) || !valor.every(esObjeto)) {
    throw invalida(`trae ${campo} con un formato inesperado`);
  }
  return valor;
}

/** El total de una respuesta paginada: `paging.total` (SonarQube Server) o `total` (SonarQube Cloud). */
export function totalDe(cuerpo: Record<string, unknown>, que: string): number {
  const total = esObjeto(cuerpo.paging) ? cuerpo.paging.total : cuerpo.total;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
    throw invalida(`no trae el total de ${que}`);
  }
  return total;
}

export function invalida(detalle: string): ErrorDeSonar {
  return new ErrorDeSonar("respuestaInvalida", `La respuesta de SonarQube ${detalle}.`);
}
