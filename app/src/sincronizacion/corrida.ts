import { eq, inArray, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { aviso, estadoRegla, regla, sincronizacion } from "@/db/esquema";
import { compararCatalogo, huellaDeRegla, type ReglaAlmacenada, type ReglaDelOrigen } from "@/dominio/sincronizacion";
import { EstadoSincronizacion, type Lenguaje, type Origen } from "@/dominio/valores";

/**
 * Una corrida de sincronización de un origen (FASE-6.md, sección 3), igual para todos:
 * Sonar (entrega 6.1, paso 6) y los paquetes de reglas propias (entrega 6.4, paso 3).
 *
 * 1. Registra la corrida en `sincronizacion`, en curso.
 * 2. Trae las reglas del origen. Si no puede traerlas completas, la corrida termina con
 *    error y no se toca nada.
 * 3. En una sola transacción: compara con lo guardado de ese origen
 *    (src/dominio/sincronizacion.ts), crea las nuevas en Pendiente de analizar, actualiza
 *    las modificadas, marca las deprecadas y escribe los avisos.
 * 4. Cierra la corrida con los contadores, o con el error.
 *
 * Dos corridas del mismo origen a la vez (el cron y el botón, o dos botones) no se pisan:
 * la transacción toma un lock de Postgres propio del origen, así que la segunda espera a
 * la primera y, al comparar, ya ve lo que la primera escribió.
 */

/** Las altas se insertan de a tantas filas por sentencia. */
const TAMANO_DE_LOTE = 250;

export interface ResumenDeSincronizacion {
  id: string;
  estado: typeof EstadoSincronizacion.Ok | typeof EstadoSincronizacion.Error;
  nuevas: number;
  /** Modificadas en la definición o reactivadas. */
  modificadas: number;
  deprecadas: number;
  /** Cambios solo de metadata: no cuentan como modificación. */
  actualizadas: number;
  avisos: number;
  /** Qué se sincronizó, en los orígenes con paquete propio: `Lainco.Analyzers 0.1.0`. */
  version?: string;
  error?: string;
}

/** Lo que trae un origen. */
export interface CatalogoDelOrigen {
  reglas: ReglaDelOrigen[];
  /** Los lenguajes consultados: solo las reglas guardadas de esos lenguajes pueden darse por eliminadas. */
  lenguajes: readonly Lenguaje[];
  version?: string;
}

export interface OpcionesDeLaCorrida {
  db: Db;
  origen: Origen;
  /** Identifica el lock del origen (pg_advisory_xact_lock). */
  lock: number;
  /** Trae el catálogo completo del origen, o lanza un error que dice por qué no pudo. */
  traer: () => Promise<CatalogoDelOrigen>;
  /** Quién la disparó desde la app. Sin valor: el cron. */
  disparadaPorId?: string;
}

export async function correrSincronizacion({ db, origen, lock, traer, disparadaPorId }: OpcionesDeLaCorrida): Promise<ResumenDeSincronizacion> {
  const [corrida] = await db
    .insert(sincronizacion)
    .values({ origen, disparadaPorId })
    .returning({ id: sincronizacion.id });

  try {
    const catalogo = await traer();

    const contadores = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${lock})`);
      return aplicar(tx, origen, corrida.id, catalogo);
    });

    await db
      .update(sincronizacion)
      .set({
        estado: EstadoSincronizacion.Ok,
        terminadaEn: sql`now()`,
        nuevas: contadores.nuevas,
        modificadas: contadores.modificadas,
        deprecadas: contadores.deprecadas,
        version: catalogo.version ?? null,
      })
      .where(eq(sincronizacion.id, corrida.id));

    return {
      id: corrida.id,
      estado: EstadoSincronizacion.Ok,
      ...contadores,
      ...(catalogo.version ? { version: catalogo.version } : {}),
    };
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    await db
      .update(sincronizacion)
      .set({ estado: EstadoSincronizacion.Error, terminadaEn: sql`now()`, error: mensaje })
      .where(eq(sincronizacion.id, corrida.id));

    return {
      id: corrida.id,
      estado: EstadoSincronizacion.Error,
      nuevas: 0,
      modificadas: 0,
      deprecadas: 0,
      actualizadas: 0,
      avisos: 0,
      error: mensaje,
    };
  }
}

type Contadores = Omit<ResumenDeSincronizacion, "id" | "estado" | "error" | "version">;
type Transaccion = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function aplicar(tx: Transaccion, origen: Origen, corridaId: string, catalogo: CatalogoDelOrigen): Promise<Contadores> {
  const almacenadas: ReglaAlmacenada[] = await tx
    .select({
      id: regla.id,
      clave: regla.clave,
      lenguaje: regla.lenguaje,
      nombre: regla.nombre,
      tipo: regla.tipo,
      severidadDefault: regla.severidadDefault,
      tags: regla.tags,
      atributoCleanCode: regla.atributoCleanCode,
      impactos: regla.impactos,
      parametros: regla.parametros,
      descripcion: regla.descripcion,
      hashDescripcion: regla.hashDescripcion,
      deprecada: sql<boolean>`${regla.deprecadaEn} is not null`,
      estado: estadoRegla.estado,
    })
    .from(regla)
    .innerJoin(estadoRegla, eq(estadoRegla.reglaId, regla.id))
    .where(eq(regla.origen, origen));

  const cambios = compararCatalogo(almacenadas, catalogo.reglas, catalogo.lenguajes);

  // Nuevas: la regla y su estado inicial (Pendiente de analizar, el valor por defecto).
  for (let i = 0; i < cambios.nuevas.length; i += TAMANO_DE_LOTE) {
    const lote = cambios.nuevas.slice(i, i + TAMANO_DE_LOTE);
    const creadas = await tx
      .insert(regla)
      .values(
        lote.map((r) => ({
          ...datosDeLaRegla(r),
          origen,
          clave: r.clave,
          lenguaje: r.lenguaje as Lenguaje,
          deprecadaEn: r.estado === "DEPRECATED" ? sql`now()` : null,
          altaEnSincronizacionId: corridaId,
        })),
      )
      .returning({ id: regla.id });
    await tx.insert(estadoRegla).values(creadas.map((c) => ({ reglaId: c.id })));
  }

  for (const { id, regla: delOrigen } of cambios.modificadas) {
    await tx
      .update(regla)
      .set({ ...datosDeLaRegla(delOrigen), ultimaModificacion: sql`now()`, modificadaEnSincronizacionId: corridaId })
      .where(eq(regla.id, id));
  }

  for (const { id, regla: delOrigen } of cambios.actualizadas) {
    await tx.update(regla).set(datosDeLaRegla(delOrigen)).where(eq(regla.id, id));
  }

  const deprecadas = cambios.deprecadas.map((d) => d.id);
  if (deprecadas.length > 0) {
    await tx.update(regla).set({ deprecadaEn: sql`now()` }).where(inArray(regla.id, deprecadas));
  }

  // Volver a estar disponible en el origen también es un cambio en la regla.
  const reactivadas = cambios.reactivadas.map((r) => r.id);
  if (reactivadas.length > 0) {
    await tx
      .update(regla)
      .set({ deprecadaEn: null, ultimaModificacion: sql`now()`, modificadaEnSincronizacionId: corridaId })
      .where(inArray(regla.id, reactivadas));
  }

  if (cambios.avisos.length > 0) {
    await tx
      .insert(aviso)
      .values(cambios.avisos.map((a) => ({ reglaId: a.reglaId, motivo: a.motivo, sincronizacionId: corridaId })));
  }

  const modificadas = new Set([...cambios.modificadas.map((m) => m.id), ...reactivadas]);

  return {
    nuevas: cambios.nuevas.length,
    modificadas: modificadas.size,
    deprecadas: deprecadas.length,
    actualizadas: cambios.actualizadas.length,
    avisos: cambios.avisos.length,
  };
}

/** Los campos de `regla` que vienen del origen y se mantienen al día. */
function datosDeLaRegla(r: ReglaDelOrigen) {
  return {
    nombre: r.nombre,
    descripcion: r.descripcion,
    tipo: r.tipo,
    severidadDefault: r.severidad,
    tags: r.tags,
    atributoCleanCode: r.atributoCleanCode,
    impactos: r.impactos,
    parametros: r.parametros,
    hashDescripcion: huellaDeRegla(r),
  };
}
