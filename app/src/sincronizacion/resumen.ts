/** El resultado de una corrida, en una frase para el usuario. */
export function describirResumen(resumen: {
  estado: string;
  nuevas: number;
  modificadas: number;
  deprecadas: number;
  error?: string | null;
}): string {
  if (resumen.estado === "error") {
    return `La sincronización falló: ${resumen.error ?? "error desconocido"}`;
  }
  if (resumen.estado === "enCurso") {
    return "En curso.";
  }

  const partes = [
    contar(resumen.nuevas, "regla nueva", "reglas nuevas"),
    contar(resumen.modificadas, "modificada", "modificadas"),
    contar(resumen.deprecadas, "deprecada", "deprecadas"),
  ].filter(Boolean);

  return partes.length === 0 ? "Sin cambios en Sonar." : `${partes.join(", ")}.`.replace(/^./, (c) => c.toUpperCase());
}

function contar(cantidad: number, singular: string, plural: string): string {
  return cantidad === 0 ? "" : `${cantidad} ${cantidad === 1 ? singular : plural}`;
}
