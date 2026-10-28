import { Estado } from "@/dominio/valores";

/**
 * El `.globalconfig` del paquete Lainco.Analyzers, generado desde el estado de la app
 * (entrega 6.4, paso 5; decisión R3). Función pura: recibe las reglas Roslyn del
 * inventario y devuelve el texto del archivo. El PR automático (paso 6) lo compara con el
 * de `main` y, si difiere, lo propone.
 *
 * - Una regla por bloque, ordenadas por clave, con un comentario con su título.
 * - Incorporada: la severidad por defecto de su descriptor (la que trae el catálogo).
 * - Cualquier otro estado: `none`. Las reglas nacen apagadas (decisión R6), así que es
 *   redundante, pero deja a la vista qué reglas trae el paquete y que nadie las eligió.
 * - Las eliminadas del paquete (deprecadas en el inventario) no se configuran.
 * - Nunca `error`: si aparece, no se genera nada.
 *
 * El mismo estado da siempre el mismo archivo, sin fechas ni versiones: si nada cambió, no
 * hay nada que proponer.
 */

export interface ReglaDelPaquete {
  /** `LAIN004`. */
  clave: string;
  titulo: string;
  estado: Estado;
  /** La del descriptor, con las palabras del `.globalconfig`: `warning`. */
  severidadPorDefecto: string | null;
  /** Ya no está en el paquete (deprecada en el inventario). */
  eliminada: boolean;
}

/** El estado de la app no permite generar el archivo. El mensaje dice por qué. */
export class ErrorDeGlobalconfig extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeGlobalconfig";
  }
}

/** Severidades que puede tener una regla Incorporada. `error`, nunca. */
const SEVERIDADES_PERMITIDAS = ["warning", "suggestion", "silent"];

const ENCABEZADO = `# Severidades de las reglas LAIN.
#
# Lo genera la app de catálogo de reglas a partir de las decisiones registradas
# (entrega 6.4): no editar a mano. Para cambiar la severidad de una regla, se decide en
# la app, que abre el PR con este archivo.
#
# Este archivo viaja dentro del paquete NuGet: cambiar una severidad acá y publicar una
# versión nueva cambia lo que ven todos los repositorios, sin tocar ningún .editorconfig.
#
# Las reglas LAIN nacen apagadas (decisión R6): este archivo enciende las Incorporadas,
# con la severidad por defecto de su descriptor, y deja en 'none' las demás. Nunca
# 'error': el que bloquea es el quality gate de SonarQube, y el suppressor de la Fase 4
# necesita poder actuar sobre el diagnóstico (ver CLAUDE.md).

is_global = true
`;

export function generarGlobalconfig(reglas: readonly ReglaDelPaquete[]): string {
  const vistas = new Set<string>();
  for (const { clave } of reglas) {
    if (!/^LAIN[0-9]{3}$/.test(clave)) {
      throw new ErrorDeGlobalconfig(`'${clave}' no es una clave de regla Roslyn propia (LAIN###).`);
    }
    if (vistas.has(clave)) {
      throw new ErrorDeGlobalconfig(`${clave} está dos veces.`);
    }
    vistas.add(clave);
  }

  const bloques = reglas
    .filter((r) => !r.eliminada)
    .toSorted((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))
    .map((r) => `# ${r.clave} — ${r.titulo.replace(/\s+/g, " ").trim()}\ndotnet_diagnostic.${r.clave}.severity = ${severidadDe(r)}\n`);

  return [ENCABEZADO, ...bloques].join("\n");
}

/** Con qué severidad va una regla: la de su descriptor si está Incorporada, si no `none`. */
export function severidadDe(regla: Pick<ReglaDelPaquete, "clave" | "estado" | "severidadPorDefecto">): string {
  if (regla.estado !== Estado.Incorporada) {
    return "none";
  }
  if (regla.severidadPorDefecto === "error") {
    throw new ErrorDeGlobalconfig(`${regla.clave} tiene severidad 'error': una regla propia nunca bloquea el build (ver CLAUDE.md).`);
  }
  if (!regla.severidadPorDefecto || !SEVERIDADES_PERMITIDAS.includes(regla.severidadPorDefecto)) {
    throw new ErrorDeGlobalconfig(
      `${regla.clave} está Incorporada y no tiene una severidad válida para el .globalconfig: ${regla.severidadPorDefecto}.`,
    );
  }
  return regla.severidadPorDefecto;
}
