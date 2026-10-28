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

/** El resultado de una revisión del paquete, en una frase (la del botón y la de la pantalla). */
export function describirRevision(revision: {
  estado: string;
  versionEnMain: string | null;
  coincide: boolean | null;
  error: string | null;
  prsCambiados?: { numero: number; estado: string }[];
  desvio?: "nuevo" | "sigue" | "resuelto" | null;
}): string {
  if (revision.estado === "error") {
    return `La revisión falló: ${revision.error ?? "error desconocido"}`;
  }
  if (revision.estado === "enCurso") {
    return "En curso.";
  }
  const version = revision.versionEnMain ? ` (versión ${revision.versionEnMain})` : "";
  const partes = [revision.coincide ? `el .globalconfig de main es el de la app${version}` : `el .globalconfig de main no es el de la app${version}`];
  for (const pr of revision.prsCambiados ?? []) {
    partes.push(`el PR #${pr.numero} quedó ${pr.estado === "mergeado" ? "mergeado" : "cerrado sin mergear"}`);
  }
  if (revision.desvio === "nuevo") partes.push("hay un desvío");
  if (revision.desvio === "resuelto") partes.push("se cerró el desvío");
  const texto = partes.join("; ");
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}.`;
}
