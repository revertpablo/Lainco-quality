import { textoDeSeveridad } from "./etiquetas";

/**
 * Cómo se muestra lo esperado y lo encontrado de un desvío (entrega 6.2, paso 6). La
 * reconciliación guarda valores de Sonar (impactos, parámetros) o textos; acá se pasan a
 * algo que se lee de un vistazo.
 */

const CALIDADES: Record<string, string> = {
  MAINTAINABILITY: "Mantenibilidad",
  RELIABILITY: "Confiabilidad",
  SECURITY: "Seguridad",
};

const SEVERIDADES_DE_IMPACTO: Record<string, string> = {
  BLOCKER: "Blocker",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFO: "Info",
};

/** Un valor del detalle de un desvío, en texto. */
export function describirValor(valor: unknown): string {
  if (valor === null || valor === undefined) {
    return "—";
  }
  if (typeof valor === "string") {
    return valor;
  }
  if (Array.isArray(valor)) {
    // Impactos: [{ calidad, severidad }].
    if (valor.every((v) => esImpacto(v))) {
      return valor.length === 0
        ? "sin impactos"
        : valor.map((i) => `${CALIDADES[i.calidad] ?? i.calidad}: ${SEVERIDADES_DE_IMPACTO[i.severidad] ?? i.severidad}`).join(", ");
    }
    return valor.map(describirValor).join(", ");
  }
  if (typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;
    // Una regla activa: { severidad?, impactos, parametros }. Con `severidad` es lo que
    // espera la app de una Incorporada: activa, con lo elegido.
    if ("impactos" in objeto || "parametros" in objeto || "severidad" in objeto) {
      return [
        "severidad" in objeto ? "activa" : "",
        "severidad" in objeto && objeto.severidad ? `severidad ${textoDeSeveridad(String(objeto.severidad))}` : "",
        "impactos" in objeto ? describirValor(objeto.impactos) : "",
        "parametros" in objeto && objeto.parametros && Object.keys(objeto.parametros).length > 0
          ? describirValor(objeto.parametros)
          : "",
      ]
        .filter(Boolean)
        .join("; ");
    }
    // Parámetros: { clave: valor }.
    return Object.entries(objeto)
      .map(([clave, v]) => `${clave} = ${v === null ? "sin valor" : describirValor(v)}`)
      .join(", ");
  }
  return String(valor);
}

function esImpacto(v: unknown): v is { calidad: string; severidad: string } {
  return typeof v === "object" && v !== null && "calidad" in v && "severidad" in v;
}
