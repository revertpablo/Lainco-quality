import "server-only";

import { and, asc, count, desc, eq, gt, inArray, isNull, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db } from "@/db/cliente";
import { desvio, estadoPublicacion, publicacion, reconciliacion, regla, tipoDesvio, usuario } from "@/db/esquema";
import { DESVIOS_QUE_SE_CORRIGEN_PUBLICANDO } from "@/dominio/reconciliacion";
import {
  EstadoPublicacion,
  type AccionPublicacion,
  type EstadoPublicacion as TipoEstadoPublicacion,
  type EstadoSincronizacion,
  type Lenguaje,
  type TipoDesvio,
} from "@/dominio/valores";

/**
 * Lo que muestra la app sobre la publicación en Sonar (entrega 6.2, paso 6): la pantalla
 * Sonar, el recuadro del detalle de una regla y el aviso del encabezado.
 */

/**
 * Una publicación fallida **vigente**: la última palabra sobre su regla. Si después hubo
 * otra publicación (pendiente o publicada), la fallida ya no importa.
 */
function fallidaVigente(db: Db) {
  const posterior = alias(publicacion, "posterior");
  return and(
    eq(publicacion.estado, EstadoPublicacion.Fallida),
    notExists(
      db
        .select({ uno: sql`1` })
        .from(posterior)
        .where(
          and(
            eq(posterior.reglaId, publicacion.reglaId),
            gt(posterior.creadaEn, publicacion.creadaEn),
            inArray(posterior.estado, [EstadoPublicacion.Pendiente, EstadoPublicacion.Publicada]),
          ),
        ),
    ),
  );
}

/** Para el encabezado: lo que alguien tiene que mirar. */
export async function pendientesDeAtencion(db: Db): Promise<{ desvios: number; fallidas: number }> {
  const [[{ desvios }], [{ fallidas }]] = await Promise.all([
    db.select({ desvios: count() }).from(desvio).where(isNull(desvio.resueltoEn)),
    db.select({ fallidas: count() }).from(publicacion).where(fallidaVigente(db)),
  ]);
  return { desvios, fallidas };
}

export interface PublicacionParaMostrar {
  id: string;
  reglaId: string;
  clave: string;
  nombre: string;
  estado: TipoEstadoPublicacion;
  estadoDescripcion: string;
  accion: AccionPublicacion | null;
  intentos: number;
  ultimoError: string | null;
  creadaEn: Date;
  proximoIntentoEn: Date;
  pedidaPor: string;
}

/** Las pendientes y las fallidas vigentes, las más viejas primero. */
export async function publicacionesSinPublicar(db: Db): Promise<PublicacionParaMostrar[]> {
  return db
    .select({
      id: publicacion.id,
      reglaId: publicacion.reglaId,
      clave: regla.clave,
      nombre: regla.nombre,
      estado: publicacion.estado,
      estadoDescripcion: estadoPublicacion.descripcion,
      accion: publicacion.accion,
      intentos: publicacion.intentos,
      ultimoError: publicacion.ultimoError,
      creadaEn: publicacion.creadaEn,
      proximoIntentoEn: publicacion.proximoIntentoEn,
      pedidaPor: usuario.nombre,
    })
    .from(publicacion)
    .innerJoin(regla, eq(regla.id, publicacion.reglaId))
    .innerJoin(estadoPublicacion, eq(estadoPublicacion.codigo, publicacion.estado))
    .innerJoin(usuario, eq(usuario.id, publicacion.pedidaPorId))
    .where(sql`(${eq(publicacion.estado, EstadoPublicacion.Pendiente)}) or (${fallidaVigente(db)})`)
    .orderBy(desc(sql`${publicacion.estado} = 'fallida'`), asc(publicacion.creadaEn));
}

export interface DesvioParaMostrar {
  id: string;
  tipo: TipoDesvio;
  tipoDescripcion: string;
  lenguaje: Lenguaje;
  clave: string;
  regla: { id: string; nombre: string } | null;
  detalle: { esperado?: unknown; encontrado?: unknown } | null;
  detectadoEn: Date;
  vistoEn: Date;
  /** Se corrige desde la app, publicando la regla; si no, en SonarQube. */
  seCorrigeDesdeLaApp: boolean;
  /** Ya hay una publicación pendiente de esta regla. */
  correccionEnCamino: boolean;
}

/** Los desvíos abiertos, de un lenguaje y tipo a la vez, o de una regla. */
export async function desviosAbiertos(db: Db, reglaId?: string): Promise<DesvioParaMostrar[]> {
  const pendiente = alias(publicacion, "pendiente");
  const filas = await db
    .select({
      id: desvio.id,
      tipo: desvio.tipo,
      tipoDescripcion: tipoDesvio.descripcion,
      lenguaje: desvio.lenguaje,
      clave: desvio.clave,
      reglaId: desvio.reglaId,
      reglaNombre: regla.nombre,
      detalle: desvio.detalle,
      detectadoEn: desvio.detectadoEn,
      vistoEn: desvio.vistoEn,
      correccionEnCamino: sql<boolean>`${pendiente.id} is not null`,
    })
    .from(desvio)
    .innerJoin(tipoDesvio, eq(tipoDesvio.codigo, desvio.tipo))
    .leftJoin(regla, eq(regla.id, desvio.reglaId))
    .leftJoin(pendiente, and(eq(pendiente.reglaId, desvio.reglaId), eq(pendiente.estado, EstadoPublicacion.Pendiente)))
    .where(and(isNull(desvio.resueltoEn), reglaId ? eq(desvio.reglaId, reglaId) : undefined))
    .orderBy(asc(desvio.lenguaje), asc(tipoDesvio.orden), asc(desvio.clave));

  return filas.map((f) => ({
    id: f.id,
    tipo: f.tipo,
    tipoDescripcion: f.tipoDescripcion,
    lenguaje: f.lenguaje,
    clave: f.clave,
    regla: f.reglaId && f.reglaNombre ? { id: f.reglaId, nombre: f.reglaNombre } : null,
    detalle: f.detalle,
    detectadoEn: f.detectadoEn,
    vistoEn: f.vistoEn,
    seCorrigeDesdeLaApp: DESVIOS_QUE_SE_CORRIGEN_PUBLICANDO.includes(f.tipo) && f.reglaId !== null,
    correccionEnCamino: f.correccionEnCamino,
  }));
}

export interface UltimaReconciliacion {
  iniciadaEn: Date;
  estado: EstadoSincronizacion;
  abiertos: number;
  nuevos: number;
  resueltos: number;
  advertencias: string[];
  error: string | null;
  disparadaPor: string | null;
}

export async function ultimaReconciliacion(db: Db): Promise<UltimaReconciliacion | null> {
  const [ultima] = await db
    .select({
      iniciadaEn: reconciliacion.iniciadaEn,
      estado: reconciliacion.estado,
      abiertos: reconciliacion.abiertos,
      nuevos: reconciliacion.nuevos,
      resueltos: reconciliacion.resueltos,
      advertencias: reconciliacion.advertencias,
      error: reconciliacion.error,
      disparadaPor: usuario.nombre,
    })
    .from(reconciliacion)
    .leftJoin(usuario, eq(usuario.id, reconciliacion.disparadaPorId))
    .orderBy(desc(reconciliacion.iniciadaEn))
    .limit(1);
  return ultima ?? null;
}

export interface UltimaPublicacionDeRegla {
  estado: TipoEstadoPublicacion;
  estadoDescripcion: string;
  accion: AccionPublicacion | null;
  intentos: number;
  ultimoError: string | null;
  creadaEn: Date;
  proximoIntentoEn: Date;
  publicadaEn: Date | null;
}

/** La publicación más reciente de una regla, o null si nunca se publicó. */
export async function ultimaPublicacionDeRegla(db: Db, reglaId: string): Promise<UltimaPublicacionDeRegla | null> {
  const [ultima] = await db
    .select({
      estado: publicacion.estado,
      estadoDescripcion: estadoPublicacion.descripcion,
      accion: publicacion.accion,
      intentos: publicacion.intentos,
      ultimoError: publicacion.ultimoError,
      creadaEn: publicacion.creadaEn,
      proximoIntentoEn: publicacion.proximoIntentoEn,
      publicadaEn: publicacion.publicadaEn,
    })
    .from(publicacion)
    .innerJoin(estadoPublicacion, eq(estadoPublicacion.codigo, publicacion.estado))
    .where(eq(publicacion.reglaId, reglaId))
    .orderBy(desc(publicacion.creadaEn))
    .limit(1);
  return ultima ?? null;
}
