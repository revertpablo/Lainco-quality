import "server-only";

import { and, asc, count, eq, inArray, lt, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { decision, estado, estadoRegla, lenguaje, origen, regla, usuario } from "@/db/esquema";
import { ESTADOS_QUE_SE_ESTANCAN, type ConteoPorEstado } from "@/dominio/progreso";
import type { Estado, Lenguaje, Origen } from "@/dominio/valores";

/** Consultas del tablero de progreso (paso 11). La cuenta se hace en `dominio/progreso.ts`. */

export interface Referencias {
  estados: { codigo: Estado; descripcion: string }[];
  lenguajes: { codigo: Lenguaje; descripcion: string }[];
  origenes: { codigo: Origen; descripcion: string }[];
}

/** Estados, lenguajes y orígenes con su texto, en el orden de sus tablas de referencia. */
export async function referencias(db: Db): Promise<Referencias> {
  const [estados, lenguajes, origenes] = await Promise.all([
    db.select({ codigo: estado.codigo, descripcion: estado.descripcion }).from(estado).orderBy(asc(estado.orden)),
    db.select({ codigo: lenguaje.codigo, descripcion: lenguaje.descripcion }).from(lenguaje).orderBy(asc(lenguaje.orden)),
    db.select({ codigo: origen.codigo, descripcion: origen.descripcion }).from(origen).orderBy(asc(origen.orden)),
  ]);
  return { estados, lenguajes, origenes };
}

/** Cuántas reglas hay en cada estado, por lenguaje, tipo y origen. */
export async function conteosPorEstado(db: Db): Promise<ConteoPorEstado[]> {
  return db
    .select({
      lenguaje: regla.lenguaje,
      tipo: regla.tipo,
      origen: regla.origen,
      estado: estadoRegla.estado,
      cantidad: count(),
    })
    .from(regla)
    .innerJoin(estadoRegla, eq(estadoRegla.reglaId, regla.id))
    .groupBy(regla.lenguaje, regla.tipo, regla.origen, estadoRegla.estado);
}

export interface ReglaEstancada {
  id: string;
  clave: string;
  nombre: string;
  lenguaje: Lenguaje;
  estado: Estado;
  estadoDescripcion: string;
  /** Desde cuándo está en el estado actual. */
  desde: Date;
  /** Días completos en el estado actual. */
  dias: number;
  /** Quién la pasó al estado actual. */
  autor: string | null;
}

/**
 * Las reglas que llevan más de `dias` días en A revisar o En prueba, de la más vieja a la
 * más nueva. "Desde cuándo" es la última transición (`estadoRegla.actualizadoEn`, que solo
 * cambia `aplicarTransicion`).
 */
export async function reglasEstancadas(db: Db, dias: number): Promise<ReglaEstancada[]> {
  const autor = sql<string | null>`(
    select ${usuario.nombre} from ${decision}
    inner join ${usuario} on ${usuario.id} = ${decision.autorId}
    where ${decision.reglaId} = ${regla.id}
    order by ${decision.fecha} desc
    limit 1
  )`;

  return db
    .select({
      id: regla.id,
      clave: regla.clave,
      nombre: regla.nombre,
      lenguaje: regla.lenguaje,
      estado: estadoRegla.estado,
      estadoDescripcion: estado.descripcion,
      desde: estadoRegla.actualizadoEn,
      dias: sql<number>`floor(extract(epoch from now() - ${estadoRegla.actualizadoEn}) / 86400)::int`,
      autor,
    })
    .from(regla)
    .innerJoin(estadoRegla, eq(estadoRegla.reglaId, regla.id))
    .innerJoin(estado, eq(estado.codigo, estadoRegla.estado))
    .where(
      and(
        inArray(estadoRegla.estado, [...ESTADOS_QUE_SE_ESTANCAN]),
        lt(estadoRegla.actualizadoEn, sql`now() - make_interval(days => ${dias})`),
      ),
    )
    .orderBy(asc(estadoRegla.actualizadoEn), asc(regla.clave));
}
