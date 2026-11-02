import { and, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { desvio, prConfiguracion, publicacion, regla, revisionPaquete } from "@/db/esquema";
import { DestinoPublicacion, EstadoPr, EstadoPublicacion, EstadoSincronizacion } from "@/dominio/valores";
import type { ClienteGitHub } from "@/github/cliente";

import { PAQUETE_ROSLYN, type DefinicionDelPaquete } from "./paquetes";
import type { CambioDeRegla } from "./pr";
import { reglasDelPaquete } from "./publicar";

/**
 * Revisión del paquete (entrega 6.4, paso 7): el seguimiento de lo que la app publica en
 * Lainco.Analyzers. Corre con un cron diario y con el botón de la pantalla Paquete.
 *
 * 1. Trae de GitHub el estado de cada PR de configuración que la app tiene abierto:
 *    mergeado o cerrado sin mergear.
 * 2. Lee de main el `.globalconfig` y la versión del paquete.
 * 3. Si el `.globalconfig` de main no es el que genera la app, no hay un PR abierto que lo
 *    corrija y no hay nada pendiente de pasar al paquete, es un **desvío**: alguien cambió
 *    main a mano, o el PR se cerró sin mergear. Un decisor lo corrige abriendo el PR
 *    (`publicarPaquete` con `forzar`). Si deja de darse, se cierra solo.
 *
 * La versión publicada no se mira acá: la trae la sincronización de Roslyn del último
 * release (paso 3), y la pantalla la compara con la del último PR mergeado.
 *
 * Si GitHub falla, la revisión queda con error y el desvío no se toca.
 *
 * Lo mismo para @lainco/eslint-config y su `reglas.json` (entrega 6.4, parte ESLint,
 * decisión L4): cada paquete se revisa por su lado, con sus PRs y su desvío.
 */

/** Cómo se identifica el desvío de Lainco.Analyzers en la tabla de desvíos. */
export const DESVIO_DEL_PAQUETE = PAQUETE_ROSLYN.desvio;

export interface OpcionesDeRevision {
  db: Db;
  github: Pick<ClienteGitHub, "estadoDePr" | "commitDeRama" | "leerArchivo" | "prAbierto">;
  base?: string;
  /** Quién la disparó desde la app. Sin valor: el cron. */
  disparadaPorId?: string;
  /** Qué paquete. Por defecto, Lainco.Analyzers. */
  paquete?: DefinicionDelPaquete;
}

export interface ResumenDeRevision {
  id: string;
  estado: typeof EstadoSincronizacion.Ok | typeof EstadoSincronizacion.Error;
  versionEnMain: string | null;
  coincide: boolean | null;
  /** Los PRs que cambiaron de estado en esta revisión. */
  prsCambiados: { numero: number; estado: EstadoPr }[];
  /** Qué pasó con el desvío: apareció, sigue, se cerró, o no hay. */
  desvio: "nuevo" | "sigue" | "resuelto" | null;
  error: string | null;
}

/**
 * Lo que guarda el desvío, con la forma de los desvíos con Sonar: por cada regla con otra
 * severidad, la que dice la app (`esperado`) y la de main (`encontrado`). Null: la regla no
 * está en ese archivo.
 */
export interface DetalleDelDesvioDelPaquete {
  esperado: Record<string, string | null>;
  encontrado: Record<string, string | null>;
}

export function detalleDelDesvio(cambios: CambioDeRegla[]): DetalleDelDesvioDelPaquete {
  return {
    esperado: Object.fromEntries(cambios.map((c) => [c.clave, c.conElPr])),
    encontrado: Object.fromEntries(cambios.map((c) => [c.clave, c.enMain])),
  };
}

export async function revisarPaquete({
  db,
  github,
  base = "main",
  disparadaPorId,
  paquete = PAQUETE_ROSLYN,
}: OpcionesDeRevision): Promise<ResumenDeRevision> {
  const [revision] = await db
    .insert(revisionPaquete)
    .values({ disparadaPorId, paquete: paquete.origen })
    .returning({ id: revisionPaquete.id });
  const resumen: ResumenDeRevision = {
    id: revision.id,
    estado: EstadoSincronizacion.Ok,
    versionEnMain: null,
    coincide: null,
    prsCambiados: [],
    desvio: null,
    error: null,
  };

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${paquete.lockRevisar})`);

      // 1. Los PRs abiertos, al día.
      const abiertos = await tx
        .select({ numero: prConfiguracion.numero })
        .from(prConfiguracion)
        .where(and(eq(prConfiguracion.estado, EstadoPr.Abierto), eq(prConfiguracion.paquete, paquete.origen)));
      for (const { numero } of abiertos) {
        const enGitHub = await github.estadoDePr(numero);
        if (enGitHub && enGitHub.estado !== EstadoPr.Abierto) {
          resumen.prsCambiados.push({ numero, estado: enGitHub.estado });
        }
        await tx
          .update(prConfiguracion)
          .set({
            revisadoEn: sql`now()`,
            ...(enGitHub && enGitHub.estado !== EstadoPr.Abierto
              ? { estado: enGitHub.estado, mergeadoEn: enGitHub.mergeadoEn, cerradoEn: enGitHub.cerradoEn }
              : {}),
          })
          .where(eq(prConfiguracion.numero, numero));
      }

      // 2. Lo que hay en main.
      const commit = await github.commitDeRama(base);
      if (!commit) {
        throw new Error(`No existe la rama ${base} en el repositorio.`);
      }
      const { configuracion, version } = paquete.rutas;
      const [enMain, archivoDeVersion] = await Promise.all([github.leerArchivo(configuracion, commit), github.leerArchivo(version, commit)]);
      if (enMain === null || archivoDeVersion === null) {
        throw new Error(`No está ${enMain === null ? configuracion : version} en ${base}.`);
      }
      resumen.versionEnMain = paquete.versionDe(archivoDeVersion);

      const deLaApp = paquete.generar(await reglasDelPaquete(tx, paquete.origen));
      resumen.coincide = paquete.coincide(enMain, deLaApp);

      // 3. El desvío. Con un PR abierto o algo pendiente de pasar al paquete, la diferencia
      // ya está en camino: no es un desvío.
      const prAbierto = await github.prAbierto(paquete.rama);
      const [pendiente] = await tx
        .select({ id: publicacion.id })
        .from(publicacion)
        .innerJoin(regla, eq(regla.id, publicacion.reglaId))
        .where(
          and(
            eq(publicacion.destino, DestinoPublicacion.PrConfiguracion),
            eq(publicacion.estado, EstadoPublicacion.Pendiente),
            eq(regla.origen, paquete.origen),
          ),
        )
        .limit(1);
      const hayDesvio = !resumen.coincide && !prAbierto && !pendiente;

      const [abierto] = await tx
        .select({ id: desvio.id })
        .from(desvio)
        .where(
          and(
            isNull(desvio.resueltoEn),
            eq(desvio.tipo, paquete.desvio.tipo),
            eq(desvio.lenguaje, paquete.desvio.lenguaje),
            eq(desvio.clave, paquete.desvio.clave),
          ),
        );
      if (hayDesvio) {
        const detalle = detalleDelDesvio(paquete.cambios(enMain, deLaApp));
        if (abierto) {
          await tx.update(desvio).set({ vistoEn: sql`now()`, detalle }).where(eq(desvio.id, abierto.id));
          resumen.desvio = "sigue";
        } else {
          await tx.insert(desvio).values({ ...paquete.desvio, detalle });
          resumen.desvio = "nuevo";
        }
      } else if (abierto) {
        await tx.update(desvio).set({ resueltoEn: sql`now()` }).where(eq(desvio.id, abierto.id));
        resumen.desvio = "resuelto";
      }
    });

    await db
      .update(revisionPaquete)
      .set({ estado: EstadoSincronizacion.Ok, terminadaEn: sql`now()`, versionEnMain: resumen.versionEnMain, coincide: resumen.coincide })
      .where(eq(revisionPaquete.id, revision.id));
    return resumen;
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    await db
      .update(revisionPaquete)
      .set({ estado: EstadoSincronizacion.Error, terminadaEn: sql`now()`, error: mensaje })
      .where(eq(revisionPaquete.id, revision.id));
    return { ...resumen, estado: EstadoSincronizacion.Error, desvio: null, prsCambiados: [], error: mensaje };
  }
}
