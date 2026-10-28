/**
 * La rama sobre la que se abre el PR de configuración (entrega 6.4, paso 6):
 *
 *   GITHUB_RAMA_BASE   Por defecto, main.
 *
 * El repositorio y el token son los de src/github/configuracion.ts.
 */
export function baseDelPr(entorno: Record<string, string | undefined> = process.env): string {
  return entorno.GITHUB_RAMA_BASE?.trim() || "main";
}
