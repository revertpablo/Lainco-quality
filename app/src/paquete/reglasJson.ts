import { Estado } from "@/dominio/valores";

import type { ReglaDelPaquete } from "./globalconfig";

/**
 * `reglas.json` de @lainco/eslint-config, generado desde el estado de la app (entrega 6.4,
 * parte ESLint, paso 2; decisión L2). Es el `.globalconfig` de ESLint: la config lee de acá
 * qué reglas corren y con qué severidad. Función pura.
 *
 * - Las Incorporadas, en `warn`: la severidad de la regla en el catálogo (`warning`), con la
 *   palabra de ESLint (R3).
 * - Cualquier otro estado, `off`. Las reglas de un plugin no corren si la config no las
 *   nombra (T7 de FASE-5.md), así que es redundante, pero deja a la vista qué reglas trae el
 *   plugin y que nadie las eligió.
 * - Las eliminadas del plugin (deprecadas en el inventario) no se configuran.
 * - Nunca `error`: si aparece, no se genera nada.
 *
 * El mismo estado da siempre el mismo archivo, sin fechas ni versiones.
 */

/** El estado de la app no permite generar el archivo. El mensaje dice por qué. */
export class ErrorDeReglasJson extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeReglasJson";
  }
}

const CLAVE_ESLINT = /^lainco\/[a-z0-9]+(-[a-z0-9]+)*$/;

/** Las palabras de ESLint para la severidad del catálogo. Solo `warning`: el generador del catálogo no admite otra. */
const SEVERIDAD_EN_ESLINT: Record<string, string> = { warning: "warn" };

const COMENTARIO =
  "Reglas encendidas y su severidad. Lo genera la app de catálogo de reglas a partir de las decisiones registradas " +
  "(entrega 6.4): no editar a mano. Para cambiar una regla, se decide en la app, que abre el PR con este archivo. " +
  "Las Incorporadas van en 'warn' y las demás en 'off'; una regla que no está, no corre. Nunca 'error': el que bloquea " +
  "es el quality gate de SonarQube, y el processor de aceptados necesita poder actuar (ver CLAUDE.md).";

export function generarReglasJson(reglas: readonly ReglaDelPaquete[]): string {
  const vistas = new Set<string>();
  for (const { clave } of reglas) {
    if (!CLAVE_ESLINT.test(clave)) {
      throw new ErrorDeReglasJson(`'${clave}' no es una clave de regla ESLint propia (lainco/<nombre-kebab>).`);
    }
    if (vistas.has(clave)) {
      throw new ErrorDeReglasJson(`${clave} está dos veces.`);
    }
    vistas.add(clave);
  }

  const configuradas = reglas
    .filter((r) => !r.eliminada)
    .toSorted((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))
    .map((r) => [r.clave, severidadEnEslint(r)] as const);

  return `${JSON.stringify({ comentario: COMENTARIO, reglas: Object.fromEntries(configuradas) }, null, 2)}\n`;
}

/** Con qué severidad va una regla: `warn` si está Incorporada, si no `off`. */
export function severidadEnEslint(regla: Pick<ReglaDelPaquete, "clave" | "estado" | "severidadPorDefecto">): string {
  if (regla.estado !== Estado.Incorporada) {
    return "off";
  }
  if (regla.severidadPorDefecto === "error") {
    throw new ErrorDeReglasJson(`${regla.clave} tiene severidad 'error': una regla propia nunca bloquea (ver CLAUDE.md).`);
  }
  const enEslint = regla.severidadPorDefecto ? SEVERIDAD_EN_ESLINT[regla.severidadPorDefecto] : undefined;
  if (!enEslint) {
    throw new ErrorDeReglasJson(`${regla.clave} está Incorporada y no tiene una severidad que ESLint entienda: ${regla.severidadPorDefecto}.`);
  }
  return enEslint;
}

/** La severidad de cada regla en un `reglas.json`. Un archivo que no se puede leer no tiene ninguna. */
export function severidadesDeReglasJson(texto: string): Map<string, string> {
  try {
    const reglas: unknown = JSON.parse(texto)?.reglas;
    if (typeof reglas !== "object" || reglas === null) return new Map();
    return new Map(Object.entries(reglas).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return new Map();
  }
}
