import "server-only";

import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db } from "@/db/cliente";
import { aviso, decision, estado, estadoRegla, lenguaje, motivoAviso, origen, regla, usuario } from "@/db/esquema";
import type { Estado, Lenguaje, MotivoAviso, Origen } from "@/dominio/valores";

import { prepararDescripcion } from "./descripcion";

/**
 * Detalle de una regla e historial (paso 10; FASE-6.md, sección 4: "El historial de una
 * regla muestra todas sus decisiones con autor y justificación").
 */

export interface DetalleDeRegla {
  id: string;
  clave: string;
  nombre: string;
  origen: Origen;
  origenDescripcion: string;
  lenguaje: Lenguaje;
  lenguajeDescripcion: string;
  tipo: string | null;
  severidadDefault: string | null;
  tags: string[];
  atributoCleanCode: string | null;
  impactos: { calidad: string; severidad: string }[];
  parametros: { clave: string; descripcion?: string; tipo?: string; valorDefault?: string }[];
  /** HTML ya saneado (./descripcion.ts): se puede mostrar tal cual. */
  descripcion: string;
  deprecadaEn: Date | null;
  estado: Estado;
  estadoDescripcion: string;
  severidadAsignada: string | null;
  parametrosAsignados: Record<string, string> | null;
  avisosPendientes: number;
}

export async function obtenerRegla(db: Db, id: string): Promise<DetalleDeRegla | null> {
  const [fila] = await db
    .select({
      id: regla.id,
      clave: regla.clave,
      nombre: regla.nombre,
      origen: regla.origen,
      origenDescripcion: origen.descripcion,
      lenguaje: regla.lenguaje,
      lenguajeDescripcion: lenguaje.descripcion,
      tipo: regla.tipo,
      severidadDefault: regla.severidadDefault,
      tags: regla.tags,
      atributoCleanCode: regla.atributoCleanCode,
      impactos: regla.impactos,
      parametros: regla.parametros,
      descripcion: regla.descripcion,
      deprecadaEn: regla.deprecadaEn,
      estado: estadoRegla.estado,
      estadoDescripcion: estado.descripcion,
      severidadAsignada: estadoRegla.severidadAsignada,
      parametrosAsignados: estadoRegla.parametros,
    })
    .from(regla)
    .innerJoin(estadoRegla, eq(estadoRegla.reglaId, regla.id))
    .innerJoin(estado, eq(estado.codigo, estadoRegla.estado))
    .innerJoin(origen, eq(origen.codigo, regla.origen))
    .innerJoin(lenguaje, eq(lenguaje.codigo, regla.lenguaje))
    .where(eq(regla.id, id));

  if (!fila) {
    return null;
  }

  const [{ avisosPendientes }] = await db
    .select({ avisosPendientes: count() })
    .from(aviso)
    .where(and(eq(aviso.reglaId, id), isNull(aviso.resueltoEn)));

  return {
    ...fila,
    impactos: fila.impactos ?? [],
    parametros: fila.parametros ?? [],
    descripcion: prepararDescripcion(fila.descripcion, fila.lenguaje),
    avisosPendientes,
  };
}

export type EventoDelHistorial =
  | {
      tipo: "decision";
      id: string;
      fecha: Date;
      autor: string;
      desde: Estado;
      desdeDescripcion: string;
      hacia: Estado;
      haciaDescripcion: string;
      justificacion: string | null;
      severidad: string | null;
      parametros: Record<string, string> | null;
      /** Si fue parte de una operación masiva: de cuántas reglas. */
      lote: { id: string; cantidad: number } | null;
    }
  | { tipo: "alta"; id: string; fecha: Date }
  | { tipo: "deprecada"; id: string; fecha: Date }
  | {
      tipo: "aviso";
      id: string;
      fecha: Date;
      motivo: MotivoAviso;
      motivoDescripcion: string;
      resuelto: boolean;
    };

/**
 * Todo lo que le pasó a la regla, de lo más nuevo a lo más viejo: las decisiones (con
 * autor, fecha y justificación), cuándo llegó del origen, si el origen la deprecó y los
 * avisos de la sincronización.
 */
export async function historialDeRegla(db: Db, id: string): Promise<EventoDelHistorial[]> {
  const desde = alias(estado, "estadoDesde");
  const hacia = alias(estado, "estadoHacia");
  const tamanoDeLote = db
    .select({ loteId: decision.loteId, cantidad: count().as("cantidad") })
    .from(decision)
    .where(isNotNull(decision.loteId))
    .groupBy(decision.loteId)
    .as("tamanoDeLote");

  const [decisiones, [datos], avisos] = await Promise.all([
    db
      .select({
        id: decision.id,
        fecha: decision.fecha,
        autor: usuario.nombre,
        desde: decision.estadoAnterior,
        desdeDescripcion: desde.descripcion,
        hacia: decision.estadoNuevo,
        haciaDescripcion: hacia.descripcion,
        justificacion: decision.justificacion,
        severidad: decision.severidad,
        parametros: decision.parametros,
        loteId: decision.loteId,
        cantidadDelLote: tamanoDeLote.cantidad,
      })
      .from(decision)
      .innerJoin(usuario, eq(usuario.id, decision.autorId))
      .innerJoin(desde, eq(desde.codigo, decision.estadoAnterior))
      .innerJoin(hacia, eq(hacia.codigo, decision.estadoNuevo))
      .leftJoin(tamanoDeLote, eq(tamanoDeLote.loteId, decision.loteId))
      .where(eq(decision.reglaId, id))
      .orderBy(desc(decision.fecha), desc(sql`${decision.id}`)),
    db
      .select({ alta: regla.primeraSincronizacion, deprecadaEn: regla.deprecadaEn })
      .from(regla)
      .where(eq(regla.id, id)),
    db
      .select({
        id: aviso.id,
        fecha: aviso.creadoEn,
        motivo: aviso.motivo,
        motivoDescripcion: motivoAviso.descripcion,
        resueltoEn: aviso.resueltoEn,
      })
      .from(aviso)
      .innerJoin(motivoAviso, eq(motivoAviso.codigo, aviso.motivo))
      .where(eq(aviso.reglaId, id)),
  ]);

  if (!datos) {
    return [];
  }

  const eventos: EventoDelHistorial[] = [
    ...decisiones.map(
      ({ loteId, cantidadDelLote, ...d }): EventoDelHistorial => ({
        tipo: "decision",
        ...d,
        lote: loteId ? { id: loteId, cantidad: Number(cantidadDelLote ?? 1) } : null,
      }),
    ),
    ...avisos.map(
      (a): EventoDelHistorial => ({
        tipo: "aviso",
        id: a.id,
        fecha: a.fecha,
        motivo: a.motivo,
        motivoDescripcion: a.motivoDescripcion,
        resuelto: a.resueltoEn !== null,
      }),
    ),
    { tipo: "alta", id: `alta-${id}`, fecha: datos.alta },
  ];
  if (datos.deprecadaEn) {
    eventos.push({ tipo: "deprecada", id: `deprecada-${id}`, fecha: datos.deprecadaEn });
  }

  // Estable: a igual fecha queda el orden de arriba (las decisiones, de la más nueva a la
  // más vieja, antes que los eventos del origen).
  return eventos
    .map((e, i) => [e, i] as const)
    .sort(([a, i], [b, j]) => b.fecha.getTime() - a.fecha.getTime() || i - j)
    .map(([e]) => e);
}
