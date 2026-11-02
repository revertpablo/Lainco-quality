import { statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Linter } from "eslint";
import { buscarRaiz, esCI, type Variables } from "../entorno.js";
import { leerArchivo } from "./archivo.js";
import { SALIDA_POR_DEFECTO } from "./opciones.js";

/**
 * El Processor de la Fase 5 (tarea 3): oculta los issues que los revisores aceptaron en
 * Sonar, con `postprocess()`. Es el equivalente del suppressor de Roslyn
 * (`tools/sonar-sync/README.md`, "Cómo lo usa el suppressor"):
 *
 * - Un mensaje se oculta si coincide en **archivo + regla + mensaje** con un issue de
 *   `sonar-accepted.json`. La ruta, relativa a la raíz del repositorio, no distingue
 *   mayúsculas ni el tipo de barra; regla y mensaje sí.
 * - **Nunca en CI**: un issue aceptado que no llega a Sonar, Sonar lo da por corregido. Lo
 *   apaga también `LAINCO_SUPPRESS_ACCEPTED=false`.
 * - Si el archivo no está, no es JSON válido o tiene otra versión, no oculta nada. Nunca lanza.
 */

export interface OpcionesDelProcessor {
  /** Por defecto, `process.env`. */
  entorno?: Variables;
}

interface Cache {
  ruta: string;
  modificado: number;
  claves: Set<string>;
}

export function crearProcessor({ entorno = process.env }: OpcionesDelProcessor): Linter.Processor {
  let cache: Cache | null = null;

  function aceptados(ruta: string): Set<string> {
    let modificado: number;
    try {
      modificado = statSync(ruta).mtimeMs;
    } catch {
      return new Set();
    }
    if (cache?.ruta !== ruta || cache.modificado !== modificado) {
      const archivo = leerArchivo(ruta);
      const claves = new Set((archivo?.issues ?? []).map((issue) => clave(issue.archivo, issue.regla, issue.mensaje)));
      cache = { ruta, modificado, claves };
    }
    return cache.claves;
  }

  return {
    meta: { name: "lainco/aceptados" },
    supportsAutofix: true,
    preprocess: (texto) => [texto],
    postprocess(mensajes, nombreDeArchivo) {
      const todos = mensajes.flat();
      if (esCI(entorno) || entorno.LAINCO_SUPPRESS_ACCEPTED?.trim().toLowerCase() === "false") {
        return todos;
      }
      try {
        const raiz = buscarRaiz(dirname(nombreDeArchivo)) ?? dirname(nombreDeArchivo);
        const claves = aceptados(entorno.LAINCO_SONAR_ACEPTADOS || join(raiz, SALIDA_POR_DEFECTO));
        if (claves.size === 0) {
          return todos;
        }
        const archivo = relative(raiz, nombreDeArchivo);
        return todos.filter((m) => m.ruleId === null || !claves.has(clave(archivo, m.ruleId, m.message)));
      } catch {
        return todos;
      }
    },
  };
}

function clave(archivo: string, regla: string, mensaje: string): string {
  return JSON.stringify([archivo.replace(/\\/g, "/").toLowerCase(), regla, mensaje]);
}
