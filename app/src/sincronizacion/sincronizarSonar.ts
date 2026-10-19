import { eq, inArray, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { aviso, estadoRegla, regla, sincronizacion } from "@/db/esquema";
import { compararCatalogo, huellaDeRegla, type ReglaAlmacenada, type ReglaDelOrigen } from "@/dominio/sincronizacion";
import { EstadoSincronizacion, Lenguaje, Origen } from "@/dominio/valores";
import type { ClienteSonar, ReglaDeSonar } from "@/sonar/cliente";

/**
 * Job `sincronizar-sonar` (FASE-6.md, sección 3; FASE-6-APP.md, sección 4).
 *
 * 1. Registra la corrida en `sincronizacion`, en curso.
 * 2. Trae de Sonar todas las reglas de C# y TypeScript. Si no puede traerlas completas,
 *    la corrida termina con error y no se toca nada.
 * 3. En una sola transacción: compara con lo guardado (src/dominio/sincronizacion.ts),
 *    crea las nuevas en Pendiente de analizar, actualiza las modificadas, marca las
 *    deprecadas y escribe los avisos.
 * 4. Cierra la corrida con los contadores, o con el error.
 *
 * Dos corridas a la vez (el cron y el botón, o dos botones) no se pisan: la transacción
 * toma un lock de Postgres, así que la segunda espera a la primera y, al comparar, ya ve
 * lo que la primera escribió.
 */

/** Lenguajes que se sincronizan. */
export const LENGUAJES_SINCRONIZADOS = [Lenguaje.CSharp, Lenguaje.TypeScript];

/** Identifica el lock de la sincronización con Sonar (pg_advisory_xact_lock). */
const LOCK_SINCRONIZAR_SONAR = 6_100_601;

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
  error?: string;
}

export interface OpcionesDeSincronizacion {
  db: Db;
  sonar: ClienteSonar;
  /** Quién la disparó desde la app. Sin valor: el cron. */
  disparadaPorId?: string;
}

export async function sincronizarSonar({ db, sonar, disparadaPorId }: OpcionesDeSincronizacion): Promise<ResumenDeSincronizacion> {
  const [corrida] = await db
    .insert(sincronizacion)
    .values({ origen: Origen.Sonar, disparadaPorId })
    .returning({ id: sincronizacion.id });

  try {
    const delOrigen: ReglaDeSonar[] = [];
    for (const lenguaje of LENGUAJES_SINCRONIZADOS) {
      delOrigen.push(...(await sonar.buscarReglas(lenguaje)));
    }

    const resumen = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_SINCRONIZAR_SONAR})`);
      return aplicar(tx, corrida.id, delOrigen);
    });

    await db
      .update(sincronizacion)
      .set({
        estado: EstadoSincronizacion.Ok,
        terminadaEn: sql`now()`,
        nuevas: resumen.nuevas,
        modificadas: resumen.modificadas,
        deprecadas: resumen.deprecadas,
      })
      .where(eq(sincronizacion.id, corrida.id));

    return { id: corrida.id, estado: EstadoSincronizacion.Ok, ...resumen };
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

type Contadores = Omit<ResumenDeSincronizacion, "id" | "estado" | "error">;
type Transaccion = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function aplicar(tx: Transaccion, corridaId: string, delOrigen: ReglaDeSonar[]): Promise<Contadores> {
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
    .where(eq(regla.origen, Origen.Sonar));

  const cambios = compararCatalogo(almacenadas, delOrigen, LENGUAJES_SINCRONIZADOS);

  // Nuevas: la regla y su estado inicial (Pendiente de analizar, el valor por defecto).
  for (let i = 0; i < cambios.nuevas.length; i += TAMANO_DE_LOTE) {
    const lote = cambios.nuevas.slice(i, i + TAMANO_DE_LOTE);
    const creadas = await tx
      .insert(regla)
      .values(
        lote.map((r) => ({
          ...datosDeLaRegla(r),
          origen: Origen.Sonar,
          clave: r.clave,
          lenguaje: r.lenguaje as Lenguaje,
          deprecadaEn: r.estado === "DEPRECATED" ? sql`now()` : null,
          altaEnSincronizacionId: corridaId,
        })),
      )
      .returning({ id: regla.id });
    await tx.insert(estadoRegla).values(creadas.map((c) => ({ reglaId: c.id })));
  }

  for (const { id, regla: deSonar } of cambios.modificadas) {
    await tx
      .update(regla)
      .set({ ...datosDeLaRegla(deSonar), ultimaModificacion: sql`now()`, modificadaEnSincronizacionId: corridaId })
      .where(eq(regla.id, id));
  }

  for (const { id, regla: deSonar } of cambios.actualizadas) {
    await tx.update(regla).set(datosDeLaRegla(deSonar)).where(eq(regla.id, id));
  }

  const deprecadas = cambios.deprecadas.map((d) => d.id);
  if (deprecadas.length > 0) {
    await tx.update(regla).set({ deprecadaEn: sql`now()` }).where(inArray(regla.id, deprecadas));
  }

  // Volver a estar disponible en Sonar también es un cambio en la regla.
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

/** Los campos de `regla` que vienen de Sonar y se mantienen al día. */
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
