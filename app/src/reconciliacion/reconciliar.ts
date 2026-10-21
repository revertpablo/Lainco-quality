import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { desvio, estadoRegla, publicacion, reconciliacion, regla } from "@/db/esquema";
import { compararPerfil, type DesvioDetectado, type EntradaDeReconciliacion } from "@/dominio/reconciliacion";
import { EstadoPublicacion, EstadoSincronizacion, Estado, Lenguaje, Origen } from "@/dominio/valores";
import type { ClienteSonar } from "@/sonar/cliente";

/**
 * La reconciliación con Sonar (entrega 6.2, paso 5): compara el Quality Profile real de
 * cada lenguaje con la app y deja los desvíos al día. La comparación en sí está en
 * src/dominio/reconciliacion.ts.
 *
 * 1. Lee Sonar: el perfil gestionado, sus reglas activas y el perfil que usa cada
 *    proyecto. Si algo falla, la corrida termina con error **sin tocar los desvíos**: con
 *    una foto incompleta se darían por resueltos desvíos que siguen ahí.
 * 2. Lee la app: las reglas de Sonar Incorporadas, y las que tienen una publicación en
 *    camino (pendiente, o publicada durante esta corrida), que todavía no son desvíos.
 * 3. Compara y, en una transacción: un desvío que sigue se actualiza (`vistoEn`, el
 *    detalle), uno nuevo se agrega, y uno abierto que ya no aparece se da por resuelto.
 *
 * Dos corridas a la vez se hacen una después de la otra en el paso 3 (advisory lock).
 */

export interface OpcionesDeReconciliacion {
  db: Db;
  sonar: Pick<ClienteSonar, "buscarPerfil" | "reglasActivas" | "proyectos" | "perfilesDelProyecto">;
  /** Nombre del perfil gestionado de cada lenguaje (src/sonar/configuracion.ts). */
  perfiles: Record<Lenguaje, string>;
  /** Quién la disparó desde la app. Sin valor: el cron. */
  disparadaPorId?: string;
}

export interface ResumenDeReconciliacion {
  id: string;
  estado: EstadoSincronizacion;
  abiertos: number;
  nuevos: number;
  resueltos: number;
  advertencias: string[];
  error: string | null;
}

/** Un número cualquiera, fijo: identifica el lock de la reconciliación. */
const LOCK_DE_RECONCILIACION = 6_200_005;

export async function reconciliar(opciones: OpcionesDeReconciliacion): Promise<ResumenDeReconciliacion> {
  const { db, sonar, perfiles } = opciones;
  const [corrida] = await db
    .insert(reconciliacion)
    .values({ disparadaPorId: opciones.disparadaPorId ?? null })
    .returning({ id: reconciliacion.id, iniciadaEn: reconciliacion.iniciadaEn });

  const terminar = async (resumen: Omit<ResumenDeReconciliacion, "id">): Promise<ResumenDeReconciliacion> => {
    await db
      .update(reconciliacion)
      .set({ ...resumen, terminadaEn: sql`now()` })
      .where(eq(reconciliacion.id, corrida.id));
    return { id: corrida.id, ...resumen };
  };

  // 1. Sonar.
  const lenguajes = Object.keys(perfiles) as Lenguaje[];
  const advertencias: string[] = [];
  let fotos: { lenguaje: Lenguaje; perfil: Awaited<ReturnType<typeof sonar.buscarPerfil>>; activas: Awaited<ReturnType<typeof sonar.reglasActivas>> }[];
  let proyectos: { clave: string; nombre: string; perfiles: Awaited<ReturnType<typeof sonar.perfilesDelProyecto>> }[];
  try {
    fotos = [];
    for (const lenguaje of lenguajes) {
      const perfil = await sonar.buscarPerfil(lenguaje, perfiles[lenguaje]);
      const activas = await sonar.reglasActivas(perfil.clave);
      if (perfil.reglasActivas !== activas.length) {
        advertencias.push(
          `El perfil '${perfil.nombre}' dice tener ${perfil.reglasActivas} reglas activas y la búsqueda devolvió ${activas.length}.`,
        );
      }
      fotos.push({ lenguaje, perfil, activas });
    }
    proyectos = [];
    for (const proyecto of await sonar.proyectos()) {
      proyectos.push({ ...proyecto, perfiles: await sonar.perfilesDelProyecto(proyecto.clave) });
    }
  } catch (e) {
    return terminar({
      estado: EstadoSincronizacion.Error,
      abiertos: 0,
      nuevos: 0,
      resueltos: 0,
      advertencias,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 2. La app, leída después de Sonar: lo que se publicó mientras tanto cuenta como en camino.
  const [deSonar, incorporadas, enCamino] = await Promise.all([
    db.select({ id: regla.id, clave: regla.clave }).from(regla).where(eq(regla.origen, Origen.Sonar)),
    db
      .select({
        reglaId: regla.id,
        clave: regla.clave,
        lenguaje: regla.lenguaje,
        severidad: estadoRegla.severidadAsignada,
        parametros: estadoRegla.parametros,
        impactos: regla.impactos,
        definicion: regla.parametros,
      })
      .from(regla)
      .innerJoin(estadoRegla, eq(estadoRegla.reglaId, regla.id))
      .where(and(eq(regla.origen, Origen.Sonar), eq(estadoRegla.estado, Estado.Incorporada))),
    db
      .selectDistinct({ reglaId: publicacion.reglaId })
      .from(publicacion)
      .where(
        or(
          eq(publicacion.estado, EstadoPublicacion.Pendiente),
          and(eq(publicacion.estado, EstadoPublicacion.Publicada), gte(publicacion.publicadaEn, corrida.iniciadaEn)),
        ),
      ),
  ]);
  const reglaIdPorClave = new Map(deSonar.map((r) => [r.clave, r.id]));
  const conPublicacionPendiente = new Set(enCamino.map((p) => p.reglaId));

  const detectados: DesvioDetectado[] = fotos.flatMap(({ lenguaje, perfil, activas }) => {
    const entrada: EntradaDeReconciliacion = {
      lenguaje,
      perfil,
      activas,
      incorporadas: incorporadas
        .filter((i) => i.lenguaje === lenguaje)
        .map((i) => ({
          clave: i.clave,
          reglaId: i.reglaId,
          severidad: i.severidad,
          parametros: i.parametros ?? {},
          impactosDeLaRegla: i.impactos ?? [],
          parametrosPorDefecto: Object.fromEntries(
            (i.definicion ?? []).filter((p) => p.valorDefault !== undefined).map((p) => [p.clave, p.valorDefault!]),
          ),
        })),
      proyectos: proyectos.map((p) => {
        const usado = p.perfiles.find((perfilDelProyecto) => perfilDelProyecto.lenguaje === lenguaje);
        return { clave: p.clave, nombre: p.nombre, perfil: usado ? { clave: usado.clave, nombre: usado.nombre } : null };
      }),
      reglaIdPorClave,
      conPublicacionPendiente,
    };
    return compararPerfil(entrada);
  });

  // 3. Los desvíos, al día.
  const { nuevos, resueltos, abiertos } = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_DE_RECONCILIACION})`);

    const abiertosAntes = await tx
      .select({ id: desvio.id, tipo: desvio.tipo, lenguaje: desvio.lenguaje, clave: desvio.clave })
      .from(desvio)
      .where(and(isNull(desvio.resueltoEn), inArray(desvio.lenguaje, lenguajes)));
    const llave = (d: { tipo: string; lenguaje: string; clave: string }) => `${d.tipo}|${d.lenguaje}|${d.clave}`;
    const porLlave = new Map(abiertosAntes.map((d) => [llave(d), d.id]));
    const vistos = new Set<string>();
    let nuevos = 0;

    for (const d of detectados) {
      const existente = porLlave.get(llave(d));
      if (existente) {
        vistos.add(existente);
        await tx
          .update(desvio)
          .set({ vistoEn: sql`now()`, detalle: d.detalle, reglaId: d.reglaId })
          .where(eq(desvio.id, existente));
      } else {
        await tx.insert(desvio).values({ tipo: d.tipo, lenguaje: d.lenguaje, clave: d.clave, reglaId: d.reglaId, detalle: d.detalle });
        nuevos++;
      }
    }

    const desaparecidos = abiertosAntes.filter((d) => !vistos.has(d.id)).map((d) => d.id);
    if (desaparecidos.length > 0) {
      await tx.update(desvio).set({ resueltoEn: sql`now()` }).where(inArray(desvio.id, desaparecidos));
    }
    return { nuevos, resueltos: desaparecidos.length, abiertos: detectados.length };
  });

  return terminar({ estado: EstadoSincronizacion.Ok, abiertos, nuevos, resueltos, advertencias, error: null });
}
