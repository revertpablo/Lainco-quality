import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Variables = Record<string, string | undefined>;

/** Las mismas variables que mira el `.targets` de Lainco.Analyzers para saber si es CI. */
const VARIABLES_DE_CI = ["CI", "GITHUB_ACTIONS", "TF_BUILD"];

export function esCI(entorno: Variables): boolean {
  return VARIABLES_DE_CI.some((nombre) => {
    const valor = entorno[nombre]?.trim().toLowerCase();
    return valor !== undefined && valor !== "" && valor !== "false" && valor !== "0";
  });
}

/**
 * La raíz del repositorio git, que es la raíz del análisis de Sonar: la primera carpeta
 * hacia arriba con `.git` (carpeta, o archivo en worktrees y submódulos). `null` si no hay.
 */
export function buscarRaiz(desde: string): string | null {
  let carpeta = resolve(desde);
  for (;;) {
    if (existsSync(join(carpeta, ".git"))) {
      return carpeta;
    }
    const arriba = dirname(carpeta);
    if (arriba === carpeta) {
      return null;
    }
    carpeta = arriba;
  }
}
