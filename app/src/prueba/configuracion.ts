import { ErrorDePrueba, normalizarArchivo } from "@/dominio/prueba";

/**
 * Configuración del job de prueba (entrega 6.5) por variables de entorno:
 *
 *   PRUEBA_REPOSITORIOS   Los repositorios donde corre el job (decisión E2), separados por
 *                         coma. Cada uno es owner/repo, y si el repositorio tiene más de una
 *                         solución, owner/repo:ruta/de/la.sln con la que hay que compilar:
 *                         revertpablo/Lainco-quality:samples/SampleSolution/SampleSolution.sln,lainco/dico
 *                         El repositorio se guarda en minúsculas, como lo compara GitHub.
 *
 *   PRUEBA_CORRIDAS_MINIMAS  Cuántas corridas necesita una regla En prueba, desde que entró,
 *                         para poder incorporarse (decisión E3). Por defecto, 5.
 */

export class ErrorDeConfiguracionDePrueba extends Error {}

export interface RepositorioAProbar {
  /** owner/repo en minúsculas. */
  repositorio: string;
  /** La solución a compilar, relativa a la raíz; null si el job usa la única que haya. */
  solucion: string | null;
}

const OWNER_REPO = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;
const SOLUCION = /\.slnx?$/i;

export function repositoriosDesdeEntorno(entorno: Record<string, string | undefined> = process.env): RepositorioAProbar[] {
  const entradas = (entorno.PRUEBA_REPOSITORIOS ?? "")
    .split(/[,\n]/)
    .map((e) => e.trim())
    .filter((e) => e !== "");
  if (entradas.length === 0) {
    throw new ErrorDeConfiguracionDePrueba("Falta PRUEBA_REPOSITORIOS: los repositorios del job de prueba, como owner/repo separados por coma (app/README.md).");
  }

  const repositorios: RepositorioAProbar[] = [];
  for (const entrada of entradas) {
    const separador = entrada.indexOf(":");
    const repositorio = (separador === -1 ? entrada : entrada.slice(0, separador)).trim().toLowerCase();
    const ruta = separador === -1 ? null : entrada.slice(separador + 1).trim();
    if (!OWNER_REPO.test(repositorio)) {
      throw new ErrorDeConfiguracionDePrueba(`PRUEBA_REPOSITORIOS: "${entrada}" no es owner/repo.`);
    }

    let solucion: string | null = null;
    if (ruta !== null) {
      try {
        solucion = normalizarArchivo(ruta);
      } catch (error) {
        if (!(error instanceof ErrorDePrueba)) {
          throw error;
        }
      }
      if (solucion === null || !SOLUCION.test(solucion)) {
        throw new ErrorDeConfiguracionDePrueba(`PRUEBA_REPOSITORIOS: en "${entrada}", "${ruta}" no es una solución (.sln o .slnx) dentro del repositorio.`);
      }
    }

    const repetido = repositorios.find((r) => r.repositorio === repositorio);
    if (repetido) {
      if (repetido.solucion !== solucion) {
        throw new ErrorDeConfiguracionDePrueba(`PRUEBA_REPOSITORIOS: ${repositorio} figura dos veces con distinta solución.`);
      }
      continue;
    }
    repositorios.push({ repositorio, solucion });
  }
  return repositorios;
}

/** El mínimo de corridas si PRUEBA_CORRIDAS_MINIMAS no está (decisión E3). */
export const CORRIDAS_MINIMAS_POR_DEFECTO = 5;

export function corridasMinimasDesdeEntorno(entorno: Record<string, string | undefined> = process.env): number {
  const valor = entorno.PRUEBA_CORRIDAS_MINIMAS?.trim();
  if (!valor) {
    return CORRIDAS_MINIMAS_POR_DEFECTO;
  }
  if (!/^\d+$/.test(valor) || Number(valor) < 1) {
    throw new ErrorDeConfiguracionDePrueba(`PRUEBA_CORRIDAS_MINIMAS: "${valor}" no es un número entero de corridas mayor que cero.`);
  }
  return Number(valor);
}

/**
 * El mínimo para las pantallas: si PRUEBA_CORRIDAS_MINIMAS está mal, usa el de por defecto
 * y devuelve el error para mostrarlo, en lugar de romper la página.
 */
export function minimoDeCorridas(entorno: Record<string, string | undefined> = process.env): { minimo: number; error: string | null } {
  try {
    return { minimo: corridasMinimasDesdeEntorno(entorno), error: null };
  } catch (e) {
    if (e instanceof ErrorDeConfiguracionDePrueba) {
      return { minimo: CORRIDAS_MINIMAS_POR_DEFECTO, error: `${e.message} Se usa ${CORRIDAS_MINIMAS_POR_DEFECTO}.` };
    }
    throw e;
  }
}
