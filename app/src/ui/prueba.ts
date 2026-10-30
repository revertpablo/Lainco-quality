import type { TasaDeFalsosPositivos } from "@/dominio/prueba";
import { EstadoCorrida, type EstadoRepositorioPrueba } from "@/dominio/valores";

/** Textos de las pantallas de la prueba de reglas (entrega 6.5, paso 6). Sin base ni red. */

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Cuánto le falta a una regla En prueba para poder incorporarse (decisión E3). */
export function describirMinimo({ minimo, cuentan, probableLocalmente }: { minimo: number; cuentan: number; probableLocalmente: boolean | null }): {
  texto: string;
  cumple: boolean;
} {
  if (probableLocalmente === false) {
    return {
      texto: "No está en SonarAnalyzer.CSharp: el job no la puede probar. Puede incorporarse sin prueba desde En análisis o En duda.",
      cumple: false,
    };
  }
  if (cuentan >= minimo) {
    return {
      texto: `Cumple el mínimo: ${plural(cuentan, "corrida", "corridas")} desde que entró en prueba (se pide${minimo === 1 ? "" : "n"} ${minimo}).`,
      cumple: true,
    };
  }
  const faltan = minimo - cuentan;
  const cuantasFaltan = `${faltan === 1 ? "falta" : "faltan"} ${faltan} para poder incorporarla.`;
  return {
    texto: cuentan === 0 ? `Todavía no tiene corridas: ${cuantasFaltan}` : `Lleva ${cuentan} de ${minimo} corridas: ${cuantasFaltan}`,
    cumple: false,
  };
}

export function porcentaje(fraccion: number): string {
  return `${Math.round(fraccion * 100)} %`;
}

/** La tasa de falsos positivos, sobre las muestras evaluadas. */
export function describirTasa(tasa: TasaDeFalsosPositivos): string {
  if (tasa.tasa === null) {
    return "Sin muestras evaluadas todavía.";
  }
  return `${porcentaje(tasa.tasa)} de falsos positivos: ${tasa.falsosPositivos} de ${plural(tasa.evaluadas, "muestra evaluada", "muestras evaluadas")}.`;
}

/** En qué quedó una corrida, en una frase. */
export function describirCorrida({
  estado,
  error,
  repositorios,
}: {
  estado: EstadoCorrida;
  error: string | null;
  repositorios: { repositorio: string; estado: EstadoRepositorioPrueba | null }[];
}): string {
  if (estado === EstadoCorrida.Fallida) {
    return `Fallida. ${error ?? ""}`.trim();
  }
  if (estado === EstadoCorrida.EnCurso) {
    const faltan = repositorios.filter((r) => r.estado === null).length;
    return `En curso: ${faltan === 1 ? "falta" : "faltan"} ${faltan} de ${plural(repositorios.length, "repositorio", "repositorios")}.`;
  }
  const conError = repositorios.filter((r) => r.estado === "error").length;
  return conError === 0
    ? `Terminada: ${plural(repositorios.length, "repositorio analizado", "repositorios analizados")}.`
    : `Terminada: ${plural(repositorios.length, "repositorio", "repositorios")}, ${conError} con error.`;
}
