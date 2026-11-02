import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { esCI, type Variables } from "../entorno.js";
import { escritoHaceMenosDe } from "./archivo.js";
import { SALIDA_POR_DEFECTO, VARIABLE_DEL_TOKEN } from "./opciones.js";

/**
 * Arranca `lainco-sonar-sync` cuando ESLint carga la configuración: es el equivalente del
 * target de MSBuild que corre sonar-sync antes de cada build local. ESLint no tiene un
 * "antes del build", así que se lanza **en segundo plano y sin esperarla**: ESLint nunca se
 * demora ni falla por Sonar, y el Processor usa el archivo que haya (el nuevo, desde la
 * próxima corrida).
 *
 * No lanza nada en CI, sin proyecto, sin token, con `LAINCO_SONAR_SYNC=false` ni con el
 * archivo vigente. La herramienta misma se encarga del candado y de la pausa tras una falla.
 */

export const VIGENCIA_HORAS_POR_DEFECTO = 8;

export interface OpcionesDeSincronizacion {
  raiz: string;
  proyecto: string | null;
  organizacion?: string | null;
  rama?: string | null;
  url?: string | null;
  vigenciaHoras?: number;
  /** Por defecto, `process.env`. */
  entorno?: Variables;
  /** Por defecto, un proceso Node separado. Se reemplaza en los tests. */
  lanzar?: (argumentos: string[]) => void;
}

/** Devuelve si lanzó la sincronización. */
export function lanzarSincronizacion(opciones: OpcionesDeSincronizacion): boolean {
  const entorno = opciones.entorno ?? process.env;
  const vigenciaHoras = opciones.vigenciaHoras ?? VIGENCIA_HORAS_POR_DEFECTO;
  const salida = join(opciones.raiz, SALIDA_POR_DEFECTO);

  if (
    esCI(entorno) ||
    entorno.LAINCO_SONAR_SYNC?.trim().toLowerCase() === "false" ||
    !opciones.proyecto ||
    !entorno[VARIABLE_DEL_TOKEN]?.trim() ||
    escritoHaceMenosDe(salida, vigenciaHoras * 3_600_000, new Date())
  ) {
    return false;
  }

  const argumentos = ["--proyecto", opciones.proyecto, "--salida", salida, "--vigencia-horas", String(vigenciaHoras)];
  if (opciones.organizacion) argumentos.push("--organizacion", opciones.organizacion);
  if (opciones.rama) argumentos.push("--rama", opciones.rama);
  if (opciones.url) argumentos.push("--url", opciones.url);

  try {
    (opciones.lanzar ?? lanzarProceso)(argumentos);
    return true;
  } catch {
    return false;
  }
}

function lanzarProceso(argumentos: string[]): void {
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const proceso = spawn(process.execPath, [cli, ...argumentos], { detached: true, stdio: "ignore", windowsHide: true });
  proceso.on("error", () => {});
  proceso.unref();
}

/** `sonar.projectKey` y `sonar.organization` de `sonar-project.properties`, si está en la raíz. */
export function leerProyectoDeSonar(raiz: string): { proyecto: string | null; organizacion: string | null } {
  const archivo = join(raiz, "sonar-project.properties");
  const propiedades = new Map<string, string>();
  if (existsSync(archivo)) {
    for (const linea of readFileSync(archivo, "utf8").split(/\r?\n/)) {
      const coincidencia = /^\s*([^#!=:\s]+)\s*[=:]\s*(.*?)\s*$/.exec(linea);
      if (coincidencia) propiedades.set(coincidencia[1]!, coincidencia[2]!);
    }
  }
  return {
    proyecto: propiedades.get("sonar.projectKey") || null,
    organizacion: propiedades.get("sonar.organization") || null,
  };
}
