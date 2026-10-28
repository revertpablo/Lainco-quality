import "server-only";

import { and, count, desc, eq, isNull } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { desvio, estadoPr, prConfiguracion, publicacion, revisionPaquete, sincronizacion, usuario } from "@/db/esquema";
import { DestinoPublicacion, EstadoSincronizacion, Origen, type EstadoPr, type EstadoSincronizacion as TipoEstadoSincronizacion } from "@/dominio/valores";
import { fallidaVigente, publicacionesSinPublicar, type PublicacionParaMostrar } from "@/publicacion/consultas";

import { DESVIO_DEL_PAQUETE, type DetalleDelDesvioDelPaquete } from "./revisar";

/**
 * Lo que muestra la pantalla Paquete (entrega 6.4, paso 7) y el aviso de su sección en el
 * encabezado: la versión publicada, los PRs de configuración, lo que falta pasar al
 * paquete y el desvío, si hay.
 */

export interface PrParaMostrar {
  numero: number;
  url: string;
  version: string | null;
  estado: EstadoPr;
  estadoDescripcion: string;
  creadoEn: Date;
  actualizadoEn: Date;
  revisadoEn: Date | null;
  mergeadoEn: Date | null;
  cerradoEn: Date | null;
}

export interface EstadoDelPaquete {
  /** La versión de la última sincronización de Roslyn que terminó bien: `Lainco.Analyzers 0.1.1`. */
  publicada: { version: string; sincronizadaEn: Date } | null;
  ultimaRevision: {
    iniciadaEn: Date;
    estado: TipoEstadoSincronizacion;
    versionEnMain: string | null;
    coincide: boolean | null;
    error: string | null;
    disparadaPor: string | null;
  } | null;
  /** Los últimos PRs, el más nuevo primero. */
  prs: PrParaMostrar[];
  sinPasar: PublicacionParaMostrar[];
  desvio: { id: string; detalle: DetalleDelDesvioDelPaquete | null; detectadoEn: Date; vistoEn: Date } | null;
}

export async function estadoDelPaquete(db: Db): Promise<EstadoDelPaquete> {
  const [[publicada], [ultimaRevision], prs, sinPasar, [abierto]] = await Promise.all([
    db
      .select({ version: sincronizacion.version, sincronizadaEn: sincronizacion.iniciadaEn })
      .from(sincronizacion)
      .where(and(eq(sincronizacion.origen, Origen.Roslyn), eq(sincronizacion.estado, EstadoSincronizacion.Ok)))
      .orderBy(desc(sincronizacion.iniciadaEn))
      .limit(1),
    db
      .select({
        iniciadaEn: revisionPaquete.iniciadaEn,
        estado: revisionPaquete.estado,
        versionEnMain: revisionPaquete.versionEnMain,
        coincide: revisionPaquete.coincide,
        error: revisionPaquete.error,
        disparadaPor: usuario.nombre,
      })
      .from(revisionPaquete)
      .leftJoin(usuario, eq(usuario.id, revisionPaquete.disparadaPorId))
      .orderBy(desc(revisionPaquete.iniciadaEn))
      .limit(1),
    db
      .select({
        numero: prConfiguracion.numero,
        url: prConfiguracion.url,
        version: prConfiguracion.version,
        estado: prConfiguracion.estado,
        estadoDescripcion: estadoPr.descripcion,
        creadoEn: prConfiguracion.creadoEn,
        actualizadoEn: prConfiguracion.actualizadoEn,
        revisadoEn: prConfiguracion.revisadoEn,
        mergeadoEn: prConfiguracion.mergeadoEn,
        cerradoEn: prConfiguracion.cerradoEn,
      })
      .from(prConfiguracion)
      .innerJoin(estadoPr, eq(estadoPr.codigo, prConfiguracion.estado))
      .orderBy(desc(prConfiguracion.numero))
      .limit(5),
    publicacionesSinPublicar(db, DestinoPublicacion.PrConfiguracion),
    db
      .select({ id: desvio.id, detalle: desvio.detalle, detectadoEn: desvio.detectadoEn, vistoEn: desvio.vistoEn })
      .from(desvio)
      .where(and(isNull(desvio.resueltoEn), eq(desvio.tipo, DESVIO_DEL_PAQUETE.tipo), eq(desvio.clave, DESVIO_DEL_PAQUETE.clave))),
  ]);

  return {
    publicada: publicada?.version ? { version: publicada.version, sincronizadaEn: publicada.sincronizadaEn } : null,
    ultimaRevision: ultimaRevision ?? null,
    prs,
    sinPasar,
    desvio: abierto ? { ...abierto, detalle: abierto.detalle as DetalleDelDesvioDelPaquete | null } : null,
  };
}

/** Para el encabezado: el desvío del paquete y las publicaciones al paquete que fallaron. */
export async function atencionDelPaquete(db: Db): Promise<{ desvio: boolean; fallidas: number }> {
  const [[{ desvios }], [{ fallidas }]] = await Promise.all([
    db
      .select({ desvios: count() })
      .from(desvio)
      .where(and(isNull(desvio.resueltoEn), eq(desvio.tipo, DESVIO_DEL_PAQUETE.tipo), eq(desvio.clave, DESVIO_DEL_PAQUETE.clave))),
    db.select({ fallidas: count() }).from(publicacion).where(fallidaVigente(db, DestinoPublicacion.PrConfiguracion)),
  ]);
  return { desvio: desvios > 0, fallidas };
}
