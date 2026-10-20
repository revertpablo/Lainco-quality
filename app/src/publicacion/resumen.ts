import type { ResumenDePublicacion } from "./publicar";

/** El resultado de publicar, en una frase para el usuario. */
export function describirPublicacion(resumen: ResumenDePublicacion): string {
  const { publicadas, reprogramadas, fallidas } = resumen;
  if (publicadas + reprogramadas + fallidas === 0) {
    return "No había nada pendiente de publicar en Sonar.";
  }

  const partes = [
    publicadas > 0 && `${publicadas === 1 ? "Se publicó 1 regla" : `Se publicaron ${publicadas} reglas`} en Sonar`,
    reprogramadas > 0 && `${reprogramadas === 1 ? "1 falló y se va a reintentar" : `${reprogramadas} fallaron y se van a reintentar`}`,
    fallidas > 0 && `${fallidas === 1 ? "1 falló y no se reintenta sola" : `${fallidas} fallaron y no se reintentan solas`}`,
  ].filter(Boolean) as string[];

  const texto = partes.join("; ").replace(/^./, (c) => c.toUpperCase());
  const primerError = resumen.errores[0];
  return primerError ? `${texto}. ${primerError.regla}: ${primerError.mensaje}` : `${texto}.`;
}
