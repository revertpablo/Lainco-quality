import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

/**
 * `sonar-accepted.json`: el mismo formato que escribe la versión .NET de sonar-sync
 * (`tools/sonar-sync/README.md`, "Qué genera"). En un repositorio mixto lo escriben las dos.
 */
export const VERSION_DEL_ARCHIVO = 1;

export interface IssueAceptado {
  /** Relativo a la raíz del análisis de Sonar, con `/`. */
  archivo: string;
  /** Sin el repositorio de Sonar: `lainco/no-hardcoded-secrets`, `LAIN004`. */
  regla: string;
  mensaje: string;
  /** `ACCEPTED` o `FALSE_POSITIVE`. */
  estado: string;
}

export interface ArchivoDeAceptados {
  version: number;
  proyecto: string;
  rama: string | null;
  generado: string;
  issues: IssueAceptado[];
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Los issues van ordenados: dos corridas sin cambios en Sonar dan el mismo archivo, salvo `generado`. */
export function serializar(proyecto: string, rama: string | null, issues: readonly IssueAceptado[], generado: Date): string {
  const contenido: ArchivoDeAceptados = {
    version: VERSION_DEL_ARCHIVO,
    proyecto,
    rama,
    generado: generado.toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    issues: issues
      .toSorted((a, b) => comparar(a.archivo, b.archivo) || comparar(a.regla, b.regla) || comparar(a.mensaje, b.mensaje))
      .map(({ archivo, regla, mensaje, estado }) => ({ archivo, regla, mensaje, estado })),
  };
  return JSON.stringify(contenido, null, 2);
}

/** El archivo, o `null` si no está, no es JSON válido o tiene otra versión. Nunca lanza. */
export function leerArchivo(ruta: string): ArchivoDeAceptados | null {
  try {
    const contenido = JSON.parse(readFileSync(ruta, "utf8"));
    return contenido?.version === VERSION_DEL_ARCHIVO && Array.isArray(contenido.issues) ? contenido : null;
  } catch {
    return null;
  }
}

/** Escritura atómica: un temporal y después el reemplazo. Nunca queda un archivo a medio escribir. */
export function escribirArchivo(ruta: string, contenido: string): void {
  const completa = resolve(ruta);
  mkdirSync(dirname(completa), { recursive: true });
  const temporal = `${completa}.${randomUUID()}.tmp`;
  writeFileSync(temporal, contenido, "utf8");
  renameSync(temporal, completa);
}

/** Si el archivo existe y se escribió hace menos de `ms`. */
export function escritoHaceMenosDe(ruta: string, ms: number, ahora: Date): boolean {
  return existsSync(ruta) && ahora.getTime() - statSync(ruta).mtimeMs < ms;
}

/**
 * Un candado abandonado (un proceso que murió sin borrarlo) se toma igual después de este
 * tiempo. En .NET lo borra el sistema operativo al cerrarse el archivo; Node no tiene eso.
 */
export const CANDADO_ABANDONADO_MS = 2 * 60_000;

/**
 * Toma el candado de escritura, para que una sola corrida a la vez consulte a Sonar.
 * Devuelve la función que lo libera, o `null` si otra corrida lo tiene.
 */
export function tomarCandado(ruta: string, ahora: Date): (() => void) | null {
  const candado = `${resolve(ruta)}.lock`;
  mkdirSync(dirname(candado), { recursive: true });
  for (let intento = 0; intento < 2; intento++) {
    try {
      closeSync(openSync(candado, "wx"));
      return () => rmSync(candado, { force: true });
    } catch {
      if (escritoHaceMenosDe(candado, CANDADO_ABANDONADO_MS, ahora)) {
        return null;
      }
      rmSync(candado, { force: true });
    }
  }
  return null;
}
