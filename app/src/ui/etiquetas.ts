/**
 * Textos para mostrar los códigos de Sonar que no tienen tabla de referencia. Los estados,
 * lenguajes y orígenes salen de sus tablas de referencia (`descripcion`).
 */

const TIPOS: Record<string, string> = {
  BUG: "Bug",
  VULNERABILITY: "Vulnerabilidad",
  CODE_SMELL: "Code smell",
  SECURITY_HOTSPOT: "Security hotspot",
};

const SEVERIDADES: Record<string, string> = {
  BLOCKER: "Blocker",
  CRITICAL: "Critical",
  MAJOR: "Major",
  MINOR: "Minor",
  INFO: "Info",
};

export const textoDeTipo = (tipo: string | null) => (tipo ? (TIPOS[tipo] ?? tipo) : "");
export const textoDeSeveridad = (severidad: string | null) => (severidad ? (SEVERIDADES[severidad] ?? severidad) : "");

/** Variable de color de cada estado (globals.css). */
export const COLOR_DE_ESTADO: Record<string, string> = {
  pendienteDeAnalizar: "var(--estado-pendiente)",
  aRevisar: "var(--estado-revisar)",
  enPrueba: "var(--estado-prueba)",
  incorporada: "var(--estado-incorporada)",
  descartada: "var(--estado-descartada)",
};
