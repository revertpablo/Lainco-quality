import { ErrorDelPr, type CambioDeRegla, type PlanDelPr } from "./pr";
import { severidadesDeReglasJson } from "./reglasJson";

/**
 * Lo que propone el PR de @lainco/eslint-config (entrega 6.4, parte ESLint, decisión L3),
 * sin red ni base. Como el de Lainco.Analyzers (./pr.ts):
 *
 * - si el `reglas.json` de `main` ya es el de la app, no hay nada que proponer;
 * - si no, el PR cambia `reglas.json` y sube el parche de la versión de la config (al
 *   mergearse, el workflow publicar-eslint.yml publica esa versión). El plugin no cambia:
 *   sus reglas son las mismas, así que la dependencia exacta de la config sigue valiendo.
 */

/** Los archivos que toca el PR, relativos a la raíz del repositorio. */
export const RUTAS_ESLINT = {
  reglas: "src/ts/eslint-config/reglas.json",
  paquete: "src/ts/eslint-config/package.json",
} as const;

const sinRetornos = (texto: string) => texto.replace(/\r\n/g, "\n");

const VERSION = /"version"\s*:\s*"([^"]*)"/;

/** La versión del package.json, o null si no tiene. */
export function versionDelPackageJson(texto: string): string | null {
  try {
    const version: unknown = JSON.parse(texto)?.version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** Sube el parche de la versión: 0.1.0 → 0.1.1. Cambia solo esa línea, para no reformatear el archivo. */
export function subirParcheDelPackageJson(texto: string): { anterior: string; nueva: string; texto: string } {
  const anterior = versionDelPackageJson(texto);
  const coincidencia = VERSION.exec(texto);
  if (anterior === null || !coincidencia) {
    throw new ErrorDelPr(`${RUTAS_ESLINT.paquete} no tiene un "version".`);
  }
  const partes = /^(\d+)\.(\d+)\.(\d+)$/.exec(anterior);
  if (!partes) {
    throw new ErrorDelPr(`La versión de @lainco/eslint-config en main es '${anterior}': para subirla sola tiene que ser X.Y.Z, sin sufijo.`);
  }
  const nueva = `${partes[1]}.${partes[2]}.${Number(partes[3]) + 1}`;
  return { anterior, nueva, texto: texto.replace(coincidencia[0], coincidencia[0].replace(anterior, nueva)) };
}

/** Si dos `reglas.json` son el mismo archivo (sin contar los finales de línea). */
export function mismoReglasJson(a: string, b: string): boolean {
  return sinRetornos(a) === sinRetornos(b);
}

/** Las reglas cuya severidad cambia de un `reglas.json` a otro, ordenadas por clave. */
export function cambiosDeReglasJson(enMainTexto: string, conElPrTexto: string): CambioDeRegla[] {
  const enMain = severidadesDeReglasJson(enMainTexto);
  const conElPr = severidadesDeReglasJson(conElPrTexto);
  return [...new Set([...enMain.keys(), ...conElPr.keys()])]
    .sort()
    .filter((clave) => enMain.get(clave) !== conElPr.get(clave))
    .map((clave) => ({ clave, enMain: enMain.get(clave) ?? null, conElPr: conElPr.get(clave) ?? null }));
}

/** Qué propone el PR, o null si `main` ya tiene el `reglas.json` de la app. */
export function planDelPrEslint({ main, generado }: { main: { reglas: string; paquete: string }; generado: string }): PlanDelPr | null {
  if (mismoReglasJson(main.reglas, generado)) {
    return null;
  }
  const version = subirParcheDelPackageJson(main.paquete);
  return {
    versionAnterior: version.anterior,
    version: version.nueva,
    archivos: [
      { ruta: RUTAS_ESLINT.reglas, contenido: generado },
      { ruta: RUTAS_ESLINT.paquete, contenido: version.texto },
    ],
    cambios: cambiosDeReglasJson(main.reglas, generado),
    releasesMovidas: false,
  };
}
