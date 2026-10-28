import type { Db } from "@/db/cliente";
import { Lenguaje, Origen } from "@/dominio/valores";
import type { ClienteSonar, ReglaDeSonar } from "@/sonar/cliente";

import { correrSincronizacion, type ResumenDeSincronizacion } from "./corrida";

export type { ResumenDeSincronizacion } from "./corrida";

/**
 * Job `sincronizar-sonar` (FASE-6.md, sección 3; FASE-6-APP.md, sección 4): trae de Sonar
 * todas las reglas de C# y TypeScript y las sincroniza con el inventario. Cómo es una
 * corrida, en ./corrida.ts.
 */

/** Lenguajes que se sincronizan. */
export const LENGUAJES_SINCRONIZADOS = [Lenguaje.CSharp, Lenguaje.TypeScript];

/** Identifica el lock de la sincronización con Sonar (pg_advisory_xact_lock). */
const LOCK_SINCRONIZAR_SONAR = 6_100_601;

export interface OpcionesDeSincronizacion {
  db: Db;
  /** Solo hace falta leer el catálogo. */
  sonar: Pick<ClienteSonar, "buscarReglas">;
  /** Quién la disparó desde la app. Sin valor: el cron. */
  disparadaPorId?: string;
}

export function sincronizarSonar({ db, sonar, disparadaPorId }: OpcionesDeSincronizacion): Promise<ResumenDeSincronizacion> {
  return correrSincronizacion({
    db,
    origen: Origen.Sonar,
    lock: LOCK_SINCRONIZAR_SONAR,
    disparadaPorId,
    traer: async () => {
      const reglas: ReglaDeSonar[] = [];
      for (const lenguaje of LENGUAJES_SINCRONIZADOS) {
        reglas.push(...(await sonar.buscarReglas(lenguaje)));
      }
      return { reglas, lenguajes: LENGUAJES_SINCRONIZADOS };
    },
  });
}
