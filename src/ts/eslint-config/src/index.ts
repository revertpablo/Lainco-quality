import { readFileSync } from "node:fs";
import type { Linter } from "eslint";
import lainco, {
  buscarRaiz,
  crearProcessor,
  esCI,
  lanzarSincronizacion,
  leerProyectoDeSonar,
} from "@lainco/eslint-plugin";
import tseslint from "typescript-eslint";

/**
 * `@lainco/eslint-config`: configuración compartida (flat config) que enciende **solo** las
 * reglas elegidas por el equipo, las de `reglas.json`. No extiende ningún `recommended`
 * (ni de ESLint ni de typescript-eslint): los plugins se registran, pero una regla que no
 * está en `reglas.json` no corre (decisión T7 de docs/FASE-5.md).
 *
 * En local, además, oculta los issues aceptados en Sonar (processor `lainco/aceptados`) y
 * lanza en segundo plano la sincronización de `sonar-accepted.json`. En CI no hace ninguna
 * de las dos cosas: los issues aceptados tienen que seguir llegando a Sonar.
 *
 * Uso, en el `eslint.config.mjs` del repositorio:
 *
 *   import lainco from "@lainco/eslint-config";
 *   export default [...lainco];
 *
 * La clave del proyecto de Sonar se toma de `sonar-project.properties`; si el repositorio
 * no lo tiene (por ejemplo, uno mixto que analiza con el scanner de .NET):
 *
 *   import { configurar } from "@lainco/eslint-config";
 *   export default [...configurar({ sonar: { proyecto: "clave", organizacion: "org" } })];
 */

export type Severidad = "warn" | "off";
type Variables = Record<string, string | undefined>;

export interface OpcionesDeSonar {
  proyecto?: string;
  organizacion?: string;
  rama?: string;
  url?: string;
  /** Horas antes de volver a consultar. Por defecto, 8. */
  vigenciaHoras?: number;
}

export interface Opciones {
  sonar?: OpcionesDeSonar;
  /** Por defecto, `process.env`. */
  entorno?: Variables;
  /** La raíz del análisis de Sonar. Por defecto, la del repositorio git del directorio actual. */
  raiz?: string;
  /** Solo para tests: reemplaza el lanzamiento del proceso de sincronización. */
  lanzar?: (argumentos: string[]) => void;
}

/** Plugins registrados, con el prefijo con el que se nombran sus reglas. */
const PLUGINS = {
  lainco,
  "@typescript-eslint": tseslint.plugin,
} as const;

const ARCHIVOS = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];

/** Las reglas de `reglas.json`, que viaja junto al paquete. */
export function leerReglas(): Record<string, string> {
  const archivo = new URL("../reglas.json", import.meta.url);
  return JSON.parse(readFileSync(archivo, "utf8")).reglas;
}

/** La configuración completa: las reglas de `reglas.json` y, en local, lo de Sonar. */
export function configurar(opciones: Opciones = {}): Linter.Config[] {
  const entorno = opciones.entorno ?? process.env;
  const local = !esCI(entorno);
  if (local) {
    const raiz = opciones.raiz ?? buscarRaiz(process.cwd());
    if (raiz !== null) {
      const deArchivo = leerProyectoDeSonar(raiz);
      const sonar = opciones.sonar ?? {};
      lanzarSincronizacion({
        raiz,
        proyecto: sonar.proyecto ?? deArchivo.proyecto,
        organizacion: sonar.organizacion ?? deArchivo.organizacion,
        rama: sonar.rama,
        url: sonar.url,
        vigenciaHoras: sonar.vigenciaHoras,
        entorno,
        lanzar: opciones.lanzar,
      });
    }
  }
  return crearConfiguracion(leerReglas(), local ? crearProcessor({ entorno }) : undefined);
}

export function crearConfiguracion(reglas: Record<string, string>, processor?: Linter.Processor): Linter.Config[] {
  for (const [id, severidad] of Object.entries(reglas)) {
    if (severidad !== "warn" && severidad !== "off") {
      throw new Error(`${id}: severidad '${severidad}' no permitida (solo 'warn' u 'off')`);
    }
    if (!existeLaRegla(id)) {
      throw new Error(`${id}: la regla no existe en los plugins de la configuración`);
    }
  }

  return [
    {
      name: "@lainco/eslint-config",
      files: ARCHIVOS,
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins: PLUGINS as unknown as Record<string, NonNullable<Linter.Config["plugins"]>[string]>,
      ...(processor ? { processor } : {}),
      rules: reglas as Linter.RulesRecord,
    },
  ];
}

function existeLaRegla(id: string): boolean {
  const separador = id.lastIndexOf("/");
  const prefijo = id.slice(0, separador);
  const nombre = id.slice(separador + 1);
  const plugin = (PLUGINS as Record<string, { rules?: Record<string, unknown> }>)[prefijo];
  return plugin?.rules?.[nombre] !== undefined;
}

const configuracion: Linter.Config[] = configurar();

export default configuracion;
