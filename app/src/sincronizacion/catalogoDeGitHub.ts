import { ErrorDeCatalogo, leerCatalogo, reglasDelCatalogo, type OrigenConCatalogo } from "@/catalogo/formato";
import type { ReleaseDeGitHub } from "@/github/cliente";

import type { CatalogoDelOrigen } from "./corrida";

/**
 * Lo común a las sincronizaciones de reglas propias (entrega 6.4): bajar el catálogo de un
 * release de GitHub, validarlo y dejarlo en la forma que compara la corrida (./corrida.ts).
 * Roslyn y ESLint difieren solo en cómo se busca el release y en cómo se llama el asset.
 */

export interface CatalogoEnGitHub {
  origen: OrigenConCatalogo;
  /** El nombre del asset con el catálogo: `reglas-roslyn.json`. */
  asset: string;
  /** El tag que tiene que tener el release de una versión: `v0.1.0`, `eslint-v0.1.0`. */
  tag: (version: string) => string;
  /** Qué se dice cuando no hay ningún release: "ningún release publicado". */
  sinRelease: string;
  /** "Roslyn", "ESLint": para los mensajes. */
  nombre: string;
}

export async function traerCatalogo(
  definicion: CatalogoEnGitHub,
  release: ReleaseDeGitHub | null,
  descargar: (asset: ReleaseDeGitHub["assets"][number]) => Promise<string>,
): Promise<CatalogoDelOrigen> {
  if (!release) {
    throw new ErrorDeCatalogo(`El repositorio no tiene ${definicion.sinRelease}: todavía no hay catálogo de reglas ${definicion.nombre}.`);
  }

  const asset = release.assets.find((a) => a.nombre === definicion.asset);
  if (!asset) {
    throw new ErrorDeCatalogo(`El release ${release.tag} no tiene el catálogo ${definicion.asset}.`);
  }

  let contenido: unknown;
  try {
    contenido = JSON.parse(await descargar(asset));
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new ErrorDeCatalogo(`El catálogo ${definicion.asset} del release ${release.tag} no es JSON.`);
    }
    throw e;
  }

  const catalogo = leerCatalogo(contenido, definicion.origen);
  // El workflow crea el release de la versión del paquete: si no coinciden, algo se armó a mano.
  if (release.tag !== definicion.tag(catalogo.version)) {
    throw new ErrorDeCatalogo(`El release ${release.tag} trae el catálogo de la versión ${catalogo.version}.`);
  }

  return {
    reglas: reglasDelCatalogo(catalogo),
    lenguajes: [catalogo.lenguaje],
    version: `${catalogo.paquete} ${catalogo.version}`,
  };
}
