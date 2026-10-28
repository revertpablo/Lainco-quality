/** El resultado de una corrida de un origen ("Sonar", "Roslyn"), en una frase para el usuario. */
export function describirResumen(resumen: {
  estado: string;
  nuevas: number;
  modificadas: number;
  deprecadas: number;
  error?: string | null;
}, origen = "Sonar"): string {
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

  return partes.length === 0 ? `Sin cambios en ${origen}.` : `${partes.join(", ")}.`.replace(/^./, (c) => c.toUpperCase());
}

function contar(cantidad: number, singular: string, plural: string): string {
  return cantidad === 0 ? "" : `${cantidad} ${cantidad === 1 ? singular : plural}`;
}

/**
 * El resultado de las corridas del botón "Sincronizar ahora", una por origen:
 * "Sonar: 3 reglas nuevas. Roslyn: sin cambios en Roslyn."
 */
export function describirResumenes(corridas: { origen: string; resumen: Parameters<typeof describirResumen>[0] }[]): string {
  return corridas
    .map(({ origen, resumen }) => {
      const texto = describirResumen(resumen, origen);
      return `${origen}: ${texto.charAt(0).toLowerCase()}${texto.slice(1)}`;
    })
    .join(" ");
}
