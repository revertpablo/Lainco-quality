import type { ResumenDeReconciliacion } from "./reconciliar";

/** El resultado de una reconciliación, en una frase para el usuario. */
export function describirReconciliacion(resumen: Pick<ResumenDeReconciliacion, "estado" | "abiertos" | "nuevos" | "resueltos" | "error">): string {
  if (resumen.estado === "error") {
    return `La reconciliación falló: ${resumen.error ?? "error desconocido"}`;
  }
  if (resumen.estado === "enCurso") {
    return "En curso.";
  }
  if (resumen.abiertos === 0) {
    return resumen.resueltos > 0
      ? `Sonar coincide con la app (${contar(resumen.resueltos, "desvío resuelto", "desvíos resueltos")}).`
      : "Sonar coincide con la app.";
  }
  const detalle = [contar(resumen.nuevos, "nuevo", "nuevos"), contar(resumen.resueltos, "resuelto", "resueltos")].filter(Boolean);
  return `${contar(resumen.abiertos, "desvío", "desvíos")} con Sonar${detalle.length > 0 ? ` (${detalle.join(", ")})` : ""}.`.replace(/^./, (c) => c.toUpperCase());
}

function contar(cantidad: number, singular: string, plural: string): string {
  return cantidad === 0 ? "" : `${cantidad} ${cantidad === 1 ? singular : plural}`;
}
