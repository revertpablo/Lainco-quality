/**
 * Cliente de la API REST de GitHub (entrega 6.4): lo que necesitan el job
 * `sincronizar-roslyn` (paso 3: el último release y sus assets) y el PR de configuración
 * (paso 6: leer archivos de una rama, crear un commit con la API de Git, mover una rama y
 * crear o actualizar un PR).
 *
 * - El último release es `GET /repos/{repo}/releases/latest`: el más reciente que no es
 *   borrador ni versión previa. Un 404 quiere decir que no hay ninguno (o que el token no
 *   ve el repositorio).
 * - Un asset se baja de su `url` de la API con `Accept: application/octet-stream`: así
 *   funciona también en un repositorio privado. GitHub redirige al almacenamiento, y
 *   `fetch` no reenvía el token en una redirección a otro dominio.
 *
 * - Un commit se arma sin clonar: un árbol nuevo sobre el del commit base, con el
 *   contenido de los archivos que cambian (`POST git/trees`), y el commit con ese árbol
 *   (`POST git/commits`). Después se mueve la rama.
 *
 * Como el cliente de Sonar: no depende de Next ni de la base (recibe `fetch` y la
 * configuración), reintenta las fallas de red, los 429 y los 5xx (también los pedidos que
 * escriben: repetidos, dejan el mismo resultado o un error que quien llama sabe manejar), y
 * ningún mensaje de error incluye el token. Credencial: decisión R2 (`LAINCO_GITHUB_TOKEN`).
 */

import { EstadoPr } from "@/dominio/valores";

const INTENTOS = 3;
const ESPERA_INICIAL_MS = 1_000;
const TIEMPO_MAXIMO_POR_PEDIDO_MS = 30_000;
const VERSION_DE_LA_API = "2022-11-28";

export type TipoDeErrorDeGitHub =
  | "autenticacion"
  | "permisos"
  | "limite"
  | "noEncontrado"
  | "pedidoInvalido"
  | "servidor"
  | "red"
  | "respuestaInvalida";

/** Error al hablar con GitHub. El mensaje nunca incluye el token. */
export class ErrorDeGitHub extends Error {
  constructor(
    readonly tipo: TipoDeErrorDeGitHub,
    mensaje: string,
    readonly estadoHttp?: number,
  ) {
    super(mensaje);
    this.name = "ErrorDeGitHub";
  }
}

export interface OpcionesDelClienteGitHub {
  /** `https://api.github.com`. */
  url: string;
  /** `dueño/repositorio`: `revertpablo/Lainco-quality`. */
  repositorio: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  /** Espera entre reintentos. Los tests la reemplazan para no esperar de verdad. */
  esperar?: (ms: number) => Promise<void>;
}

export interface AssetDeGitHub {
  nombre: string;
  /** La URL del asset en la API (no la de descarga del navegador). */
  url: string;
}

export interface ReleaseDeGitHub {
  /** `v0.1.0`. */
  tag: string;
  nombre: string | null;
  publicadoEn: Date | null;
  /** La página del release, para mostrar. */
  url: string;
  assets: AssetDeGitHub[];
}

export interface PrDeGitHub {
  numero: number;
  /** La página del PR. */
  url: string;
}

export interface ClienteGitHub {
  /** El último release publicado, o null si el repositorio no tiene ninguno. */
  ultimoRelease(): Promise<ReleaseDeGitHub | null>;
  /** El contenido de un asset, como texto. */
  descargarAsset(asset: AssetDeGitHub): Promise<string>;

  /** El commit al que apunta una rama, o null si la rama no existe. */
  commitDeRama(rama: string): Promise<string | null>;
  /** El contenido de un archivo en un commit (o una rama), o null si no existe. */
  leerArchivo(ruta: string, ref: string): Promise<string | null>;
  /** Crea un commit sobre `base` que cambia esos archivos. Devuelve su sha. No mueve ninguna rama. */
  crearCommit(opciones: { base: string; mensaje: string; archivos: readonly { ruta: string; contenido: string }[] }): Promise<string>;
  /** Crea la rama apuntando al commit. */
  crearRama(rama: string, commit: string): Promise<void>;
  /** Mueve la rama al commit, aunque no sea descendiente del anterior (force). */
  moverRama(rama: string, commit: string): Promise<void>;
  /** El PR abierto desde esa rama, o null. */
  prAbierto(rama: string): Promise<PrDeGitHub | null>;
  crearPr(opciones: { titulo: string; cuerpo: string; rama: string; base: string }): Promise<PrDeGitHub>;
  /** Cambia el título y la descripción de un PR, o lo cierra. */
  actualizarPr(numero: number, cambios: { titulo?: string; cuerpo?: string; cerrar?: boolean }): Promise<void>;
  /** En qué está un PR, o null si no existe. */
  estadoDePr(numero: number): Promise<EstadoDePrEnGitHub | null>;
}

export interface EstadoDePrEnGitHub {
  estado: EstadoPr;
  mergeadoEn: Date | null;
  cerradoEn: Date | null;
}

interface Pedido {
  url: string;
  aceptar: string;
  /** Qué se pide, para los mensajes: "el último release". */
  descripcion: string;
  metodo?: "GET" | "POST" | "PATCH";
  /** Se manda como JSON. */
  cuerpo?: unknown;
}

export function crearClienteGitHub(opciones: OpcionesDelClienteGitHub): ClienteGitHub {
  if (!opciones.token) {
    throw new Error("Falta el token de GitHub.");
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(opciones.repositorio)) {
    throw new Error(`El repositorio de GitHub tiene que tener la forma dueño/repositorio: '${opciones.repositorio}'.`);
  }

  const base = opciones.url.replace(/\/+$/, "");
  const hacerFetch = opciones.fetch ?? globalThis.fetch;
  const esperar = opciones.esperar ?? ((ms: number) => new Promise<void>((listo) => setTimeout(listo, ms)));
  const sinToken = (texto: string) => texto.split(opciones.token).join("***");

  async function pedir(pedido: Pedido): Promise<Response> {
    let ultimoError: ErrorDeGitHub | undefined;
    for (let intento = 1; intento <= INTENTOS; intento++) {
      if (intento > 1) {
        await esperar(ESPERA_INICIAL_MS * 2 ** (intento - 2));
      }

      let respuesta: Response;
      try {
        respuesta = await hacerFetch(pedido.url, {
          method: pedido.metodo ?? "GET",
          headers: {
            Authorization: `Bearer ${opciones.token}`,
            Accept: pedido.aceptar,
            "X-GitHub-Api-Version": VERSION_DE_LA_API,
            "User-Agent": "lainco-quality",
            ...(pedido.cuerpo === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: pedido.cuerpo === undefined ? undefined : JSON.stringify(pedido.cuerpo),
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_POR_PEDIDO_MS),
        });
      } catch (e) {
        ultimoError = new ErrorDeGitHub(
          "red",
          sinToken(`No se pudo conectar con GitHub para traer ${pedido.descripcion}: ${motivoDeLaFalla(e)}`),
        );
        continue;
      }

      if (respuesta.ok) {
        return respuesta;
      }

      const error = await errorHttp(respuesta, pedido, opciones.repositorio, sinToken);
      if (error.tipo !== "servidor") {
        throw error;
      }
      ultimoError = error;
    }
    throw ultimoError!;
  }

  const repo = `${base}/repos/${opciones.repositorio}`;
  const API = "application/vnd.github+json";

  /** El pedido, o null si GitHub contesta 404. */
  async function siExiste(pedido: Pedido): Promise<Response | null> {
    try {
      return await pedir(pedido);
    } catch (e) {
      if (e instanceof ErrorDeGitHub && e.tipo === "noEncontrado") return null;
      throw e;
    }
  }

  async function objeto(pedido: Pedido): Promise<Record<string, unknown>> {
    const cuerpo = await json(await pedir(pedido), pedido.descripcion);
    if (!esObjeto(cuerpo)) {
      throw new ErrorDeGitHub("respuestaInvalida", `La respuesta de GitHub al traer ${pedido.descripcion} no tiene la forma esperada.`);
    }
    return cuerpo;
  }

  function sha(cuerpo: Record<string, unknown>, descripcion: string): string {
    if (typeof cuerpo.sha !== "string") {
      throw new ErrorDeGitHub("respuestaInvalida", `La respuesta de GitHub sobre ${descripcion} no trae el sha.`);
    }
    return cuerpo.sha;
  }

  function leerPr(cuerpo: unknown, descripcion: string): PrDeGitHub {
    if (!esObjeto(cuerpo) || typeof cuerpo.number !== "number" || typeof cuerpo.html_url !== "string") {
      throw new ErrorDeGitHub("respuestaInvalida", `La respuesta de GitHub sobre ${descripcion} no tiene la forma de un PR.`);
    }
    return { numero: cuerpo.number, url: cuerpo.html_url };
  }

  const [dueno] = opciones.repositorio.split("/");
  const rutaCodificada = (ruta: string) => ruta.split("/").map(encodeURIComponent).join("/");

  return {
    async commitDeRama(rama) {
      const descripcion = `la rama ${rama}`;
      const respuesta = await siExiste({ url: `${repo}/git/ref/heads/${rutaCodificada(rama)}`, aceptar: API, descripcion });
      if (!respuesta) return null;
      const cuerpo = await json(respuesta, descripcion);
      if (!esObjeto(cuerpo) || !esObjeto(cuerpo.object) || typeof cuerpo.object.sha !== "string") {
        throw new ErrorDeGitHub("respuestaInvalida", `La respuesta de GitHub sobre ${descripcion} no trae el commit.`);
      }
      return cuerpo.object.sha;
    },

    async leerArchivo(ruta, ref) {
      const respuesta = await siExiste({
        url: `${repo}/contents/${rutaCodificada(ruta)}?ref=${encodeURIComponent(ref)}`,
        aceptar: "application/vnd.github.raw+json",
        descripcion: `el archivo ${ruta}`,
      });
      return respuesta ? respuesta.text() : null;
    },

    async crearCommit({ base: padre, mensaje, archivos }) {
      const commitBase = await objeto({ url: `${repo}/git/commits/${padre}`, aceptar: API, descripcion: `el commit ${padre}` });
      const arbolBase = esObjeto(commitBase.tree) && typeof commitBase.tree.sha === "string" ? commitBase.tree.sha : null;
      if (!arbolBase) {
        throw new ErrorDeGitHub("respuestaInvalida", `La respuesta de GitHub sobre el commit ${padre} no trae su árbol.`);
      }
      const arbol = await objeto({
        url: `${repo}/git/trees`,
        aceptar: API,
        descripcion: "el árbol del commit",
        metodo: "POST",
        cuerpo: { base_tree: arbolBase, tree: archivos.map((a) => ({ path: a.ruta, mode: "100644", type: "blob", content: a.contenido })) },
      });
      const commit = await objeto({
        url: `${repo}/git/commits`,
        aceptar: API,
        descripcion: "el commit",
        metodo: "POST",
        cuerpo: { message: mensaje, tree: sha(arbol, "el árbol"), parents: [padre] },
      });
      return sha(commit, "el commit");
    },

    async crearRama(rama, commit) {
      await pedir({
        url: `${repo}/git/refs`,
        aceptar: API,
        descripcion: `la rama ${rama}`,
        metodo: "POST",
        cuerpo: { ref: `refs/heads/${rama}`, sha: commit },
      });
    },

    async moverRama(rama, commit) {
      await pedir({
        url: `${repo}/git/refs/heads/${rutaCodificada(rama)}`,
        aceptar: API,
        descripcion: `la rama ${rama}`,
        metodo: "PATCH",
        cuerpo: { sha: commit, force: true },
      });
    },

    async prAbierto(rama) {
      const descripcion = `el PR de la rama ${rama}`;
      const cuerpo = await json(
        await pedir({ url: `${repo}/pulls?state=open&head=${encodeURIComponent(`${dueno}:${rama}`)}`, aceptar: API, descripcion }),
        descripcion,
      );
      if (!Array.isArray(cuerpo)) {
        throw new ErrorDeGitHub("respuestaInvalida", `La respuesta de GitHub al buscar ${descripcion} no es una lista.`);
      }
      return cuerpo.length > 0 ? leerPr(cuerpo[0], descripcion) : null;
    },

    async crearPr({ titulo, cuerpo, rama, base: destino }) {
      const descripcion = `el PR de la rama ${rama}`;
      const respuesta = await pedir({
        url: `${repo}/pulls`,
        aceptar: API,
        descripcion,
        metodo: "POST",
        cuerpo: { title: titulo, body: cuerpo, head: rama, base: destino },
      });
      return leerPr(await json(respuesta, descripcion), descripcion);
    },

    async actualizarPr(numero, { titulo, cuerpo, cerrar }) {
      await pedir({
        url: `${repo}/pulls/${numero}`,
        aceptar: API,
        descripcion: `el PR #${numero}`,
        metodo: "PATCH",
        cuerpo: { ...(titulo === undefined ? {} : { title: titulo }), ...(cuerpo === undefined ? {} : { body: cuerpo }), ...(cerrar ? { state: "closed" } : {}) },
      });
    },

    async estadoDePr(numero) {
      const descripcion = `el PR #${numero}`;
      const respuesta = await siExiste({ url: `${repo}/pulls/${numero}`, aceptar: API, descripcion });
      if (!respuesta) return null;
      const cuerpo = await json(respuesta, descripcion);
      if (!esObjeto(cuerpo) || (cuerpo.state !== "open" && cuerpo.state !== "closed")) {
        throw new ErrorDeGitHub("respuestaInvalida", `La respuesta de GitHub sobre ${descripcion} no tiene la forma de un PR.`);
      }
      const fecha = (valor: unknown) => (typeof valor === "string" ? new Date(valor) : null);
      const mergeadoEn = fecha(cuerpo.merged_at);
      return {
        estado: cuerpo.state === "open" ? EstadoPr.Abierto : mergeadoEn ? EstadoPr.Mergeado : EstadoPr.Cerrado,
        mergeadoEn,
        cerradoEn: fecha(cuerpo.closed_at),
      };
    },

    async ultimoRelease() {
      const descripcion = "el último release";
      let respuesta: Response;
      try {
        respuesta = await pedir({
          url: `${base}/repos/${opciones.repositorio}/releases/latest`,
          aceptar: "application/vnd.github+json",
          descripcion,
        });
      } catch (e) {
        if (e instanceof ErrorDeGitHub && e.tipo === "noEncontrado") {
          return null;
        }
        throw e;
      }
      return leerRelease(await json(respuesta, descripcion));
    },

    async descargarAsset(asset) {
      const descripcion = `el asset ${asset.nombre}`;
      const respuesta = await pedir({ url: asset.url, aceptar: "application/octet-stream", descripcion });
      return respuesta.text();
    },
  };
}

async function errorHttp(
  respuesta: Response,
  pedido: Pedido,
  repositorio: string,
  sinToken: (texto: string) => string,
): Promise<ErrorDeGitHub> {
  let detalle = "";
  try {
    const cuerpo: unknown = await respuesta.json();
    if (esObjeto(cuerpo) && typeof cuerpo.message === "string") {
      detalle = cuerpo.message;
    }
  } catch {
    // El cuerpo no era JSON: alcanza con el código HTTP.
  }

  const estado = respuesta.status;
  // GitHub contesta 403 (o 429) cuando se agota el límite de pedidos por hora.
  const sinCupo = respuesta.headers.get("x-ratelimit-remaining") === "0";
  const [tipo, explicacion]: [TipoDeErrorDeGitHub, string] =
    estado === 401
      ? ["autenticacion", "El token de GitHub no es válido o venció."]
      : (estado === 403 || estado === 429) && sinCupo
        ? ["limite", "Se agotó el límite de pedidos a GitHub de esta hora."]
        : estado === 403
          ? ["permisos", `El token de GitHub no tiene permiso para ${pedido.metodo && pedido.metodo !== "GET" ? "escribir en" : "leer"} ${repositorio}.`]
          : estado === 404
            ? ["noEncontrado", `GitHub no encontró ${pedido.descripcion} de ${repositorio}.`]
            : estado === 429 || estado >= 500
              ? ["servidor", `GitHub no respondió bien al traer ${pedido.descripcion}.`]
              : ["pedidoInvalido", `GitHub rechazó el pedido sobre ${pedido.descripcion}.`];

  return new ErrorDeGitHub(tipo, sinToken(`${explicacion} (HTTP ${estado}${detalle ? `: ${detalle}` : ""})`), estado);
}

async function json(respuesta: Response, descripcion: string): Promise<unknown> {
  try {
    return await respuesta.json();
  } catch {
    throw new ErrorDeGitHub("respuestaInvalida", `GitHub respondió en un formato que no es JSON al traer ${descripcion}.`);
  }
}

function leerRelease(cuerpo: unknown): ReleaseDeGitHub {
  if (!esObjeto(cuerpo) || typeof cuerpo.tag_name !== "string" || typeof cuerpo.html_url !== "string" || !Array.isArray(cuerpo.assets)) {
    throw new ErrorDeGitHub("respuestaInvalida", "La respuesta de GitHub sobre el último release no tiene la forma esperada.");
  }
  const assets = cuerpo.assets.map((a): AssetDeGitHub => {
    if (!esObjeto(a) || typeof a.name !== "string" || typeof a.url !== "string") {
      throw new ErrorDeGitHub("respuestaInvalida", "La respuesta de GitHub trae un asset sin nombre o sin URL.");
    }
    return { nombre: a.name, url: a.url };
  });
  return {
    tag: cuerpo.tag_name,
    nombre: typeof cuerpo.name === "string" && cuerpo.name !== "" ? cuerpo.name : null,
    publicadoEn: typeof cuerpo.published_at === "string" ? new Date(cuerpo.published_at) : null,
    url: cuerpo.html_url,
    assets,
  };
}

/** Por qué no se pudo conectar: el motivo de verdad del "fetch failed" de Node está en `cause`. */
function motivoDeLaFalla(e: unknown): string {
  if (!(e instanceof Error)) {
    return String(e);
  }
  if (e.name === "TimeoutError") {
    return `GitHub no respondió en ${TIEMPO_MAXIMO_POR_PEDIDO_MS / 1000} segundos`;
  }
  const causa = (e as { cause?: unknown }).cause;
  const codigo = esObjeto(causa) && typeof causa.code === "string" ? causa.code : "";
  return codigo && !e.message.includes(codigo) ? `${e.message} (${codigo})` : e.message;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}
