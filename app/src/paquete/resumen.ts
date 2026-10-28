import type { ResumenDelPaquete } from "./publicar";

/** El resultado de publicar en el paquete, en una frase para el usuario. */
export function describirPublicacionDelPaquete(resumen: ResumenDelPaquete): string {
  const { publicadas, reprogramadas, fallidas, pr, version, error } = resumen;
  if (publicadas + reprogramadas + fallidas === 0) {
    return "No había nada pendiente de pasar al paquete.";
  }
  if (error) {
    return `No se pudo actualizar el PR de configuración${fallidas > 0 ? " y no se reintenta solo" : "; se va a reintentar"}: ${error}`;
  }
  const reglas = publicadas === 1 ? "1 regla" : `${publicadas} reglas`;
  return pr
    ? `PR #${pr.numero} con ${reglas} (Lainco.Analyzers ${version}).`
    : `${reglas.replace(/^./, (c) => c.toUpperCase())} sin PR: main ya tiene el .globalconfig de la app.`;
}
