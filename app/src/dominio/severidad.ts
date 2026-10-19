/**
 * Severidad con la que se incorpora una regla (entrega 6.2, paso 2).
 *
 * El decisor elige la severidad clásica de Sonar (BLOCKER … INFO). SonarQube Cloud deprecó
 * esa severidad al activar reglas (21/08/2026) y pide impactos: una severidad por cada
 * calidad del software que la regla afecta (`MAINTAINABILITY=HIGH`). Al publicar, la
 * severidad elegida se traduce a cada impacto de la regla con la equivalencia de Sonar
 * (decisión del 2026-10-19, FASE-6-APP.md, sección 8 bis).
 */

/** Severidades clásicas, de más a menos grave. */
export const SEVERIDADES = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"] as const;
export type Severidad = (typeof SEVERIDADES)[number];

/** Severidades de los impactos, de más a menos grave. */
export const SEVERIDADES_DE_IMPACTO = ["BLOCKER", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export type SeveridadDeImpacto = (typeof SEVERIDADES_DE_IMPACTO)[number];

/** La equivalencia que usa Sonar entre una y otra. */
export const IMPACTO_DE_SEVERIDAD: Record<Severidad, SeveridadDeImpacto> = {
  BLOCKER: "BLOCKER",
  CRITICAL: "HIGH",
  MAJOR: "MEDIUM",
  MINOR: "LOW",
  INFO: "INFO",
};

export interface Impacto {
  /** `MAINTAINABILITY`, `RELIABILITY`, `SECURITY`. */
  calidad: string;
  severidad: string;
}

export function esSeveridad(valor: string): valor is Severidad {
  return (SEVERIDADES as readonly string[]).includes(valor);
}

/**
 * Los impactos con los que se activa una regla: los de la regla en Sonar, todos con la
 * severidad elegida traducida.
 *
 * Sin severidad elegida, o si la regla no tiene impactos (en Sonar, por ejemplo, algunos
 * security hotspots), no hay nada que pedir: Sonar usa los de la regla.
 */
export function impactosParaPublicar(severidad: string | null, impactosDeLaRegla: readonly Impacto[]): Impacto[] {
  if (severidad === null) {
    return [];
  }
  if (!esSeveridad(severidad)) {
    throw new Error(`'${severidad}' no es una severidad de Sonar.`);
  }
  const calidades = [...new Set(impactosDeLaRegla.map((i) => i.calidad))];
  return calidades.map((calidad) => ({ calidad, severidad: IMPACTO_DE_SEVERIDAD[severidad] }));
}
