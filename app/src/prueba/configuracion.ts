/**
 * Configuración del job de prueba (entrega 6.5) por variables de entorno:
 *
 *   PRUEBA_REPOSITORIOS   Los repositorios donde corre el job (decisión E2), como
 *                         owner/repo separados por coma: revertpablo/Lainco-quality,lainco/dico.
 *                         Se guardan en minúsculas, como los compara GitHub.
 */

export class ErrorDeConfiguracionDePrueba extends Error {}

const OWNER_REPO = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;

export function repositoriosDesdeEntorno(entorno: Record<string, string | undefined> = process.env): string[] {
  const entradas = (entorno.PRUEBA_REPOSITORIOS ?? "")
    .split(/[,\n]/)
    .map((e) => e.trim())
    .filter((e) => e !== "");
  if (entradas.length === 0) {
    throw new ErrorDeConfiguracionDePrueba("Falta PRUEBA_REPOSITORIOS: los repositorios del job de prueba, como owner/repo separados por coma (app/README.md).");
  }

  const repositorios: string[] = [];
  for (const entrada of entradas) {
    const repositorio = entrada.toLowerCase();
    if (!OWNER_REPO.test(repositorio)) {
      throw new ErrorDeConfiguracionDePrueba(`PRUEBA_REPOSITORIOS: "${entrada}" no es owner/repo.`);
    }
    if (!repositorios.includes(repositorio)) {
      repositorios.push(repositorio);
    }
  }
  return repositorios;
}
