import type { Db } from "@/db/cliente";
import { Origen } from "@/dominio/valores";
import type { ClienteGitHub } from "@/github/cliente";

import { traerCatalogo, type CatalogoEnGitHub } from "./catalogoDeGitHub";
import { correrSincronizacion, type ResumenDeSincronizacion } from "./corrida";

/**
 * Job `sincronizar-eslint` (entrega 6.4, parte ESLint, paso 1): lo mismo que
 * `sincronizar-roslyn`, con el catálogo de `@lainco/eslint-plugin`.
 *
 * El release es el último `eslint-v*` (decisión L1), no el "latest" del repositorio: ese
 * lugar es de Lainco.Analyzers, y el workflow publicar-eslint.yml crea los de ESLint con
 * `--latest=false`.
 */

/** El asset del release con el catálogo (docs/catalogo-de-reglas.md). */
export const CATALOGO_ESLINT = "reglas-eslint.json";

/** El prefijo de los tags de los releases de ESLint. */
export const PREFIJO_ESLINT = "eslint-v";

const ESLINT: CatalogoEnGitHub = {
  origen: "eslint",
  asset: CATALOGO_ESLINT,
  tag: (version) => `${PREFIJO_ESLINT}${version}`,
  sinRelease: `ningún release ${PREFIJO_ESLINT}* publicado`,
  nombre: "ESLint",
};

/** Identifica el lock de la sincronización de ESLint (pg_advisory_xact_lock). */
const LOCK_SINCRONIZAR_ESLINT = 6_400_302;

export interface OpcionesDeSincronizacionEslint {
  db: Db;
  github: Pick<ClienteGitHub, "ultimoReleaseConPrefijo" | "descargarAsset">;
  /** Quién la disparó desde la app. Sin valor: el cron. */
  disparadaPorId?: string;
}

export function sincronizarEslint({ db, github, disparadaPorId }: OpcionesDeSincronizacionEslint): Promise<ResumenDeSincronizacion> {
  return correrSincronizacion({
    db,
    origen: Origen.Eslint,
    lock: LOCK_SINCRONIZAR_ESLINT,
    disparadaPorId,
    traer: async () => traerCatalogo(ESLINT, await github.ultimoReleaseConPrefijo(PREFIJO_ESLINT), (asset) => github.descargarAsset(asset)),
  });
}
