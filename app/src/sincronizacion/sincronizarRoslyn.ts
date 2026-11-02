import type { Db } from "@/db/cliente";
import { Origen } from "@/dominio/valores";
import type { ClienteGitHub } from "@/github/cliente";

import { traerCatalogo, type CatalogoEnGitHub } from "./catalogoDeGitHub";
import { correrSincronizacion, type ResumenDeSincronizacion } from "./corrida";

/**
 * Job `sincronizar-roslyn` (entrega 6.4, paso 3; decisión R1): trae el catálogo de reglas
 * del último release de `Lainco.Analyzers` en GitHub y lo sincroniza con el inventario,
 * con la misma comparación que Sonar (./corrida.ts):
 *
 * - una regla que llega en una versión nueva entra en Pendiente de analizar;
 * - una regla cuya documentación o severidad cambió queda modificada (y avisa si estaba
 *   Incorporada o En prueba);
 * - una regla que ya no está en el catálogo se eliminó del paquete: queda deprecada (y
 *   avisa si estaba Incorporada).
 *
 * El último release es el último publicado que no es versión previa (el workflow
 * publicar-analyzers.yml marca así las versiones con sufijo).
 */

/** El asset del release con el catálogo (docs/catalogo-de-reglas.md). */
export const CATALOGO_ROSLYN = "reglas-roslyn.json";

const ROSLYN: CatalogoEnGitHub = {
  origen: "roslyn",
  asset: CATALOGO_ROSLYN,
  tag: (version) => `v${version}`,
  sinRelease: "ningún release publicado",
  nombre: "Roslyn",
};

/** Identifica el lock de la sincronización de Roslyn (pg_advisory_xact_lock). */
const LOCK_SINCRONIZAR_ROSLYN = 6_400_301;

export interface OpcionesDeSincronizacionRoslyn {
  db: Db;
  github: Pick<ClienteGitHub, "ultimoRelease" | "descargarAsset">;
  /** Quién la disparó desde la app. Sin valor: el cron. */
  disparadaPorId?: string;
}

export function sincronizarRoslyn({ db, github, disparadaPorId }: OpcionesDeSincronizacionRoslyn): Promise<ResumenDeSincronizacion> {
  return correrSincronizacion({
    db,
    origen: Origen.Roslyn,
    lock: LOCK_SINCRONIZAR_ROSLYN,
    disparadaPorId,
    traer: async () => traerCatalogo(ROSLYN, await github.ultimoRelease(), (asset) => github.descargarAsset(asset)),
  });
}
