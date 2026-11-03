import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { decision, estado, estadoRegla, prConfiguracion, publicacion, regla, usuario } from "@/db/esquema";
import { despuesDeFallar, type TipoDeFalla } from "@/dominio/publicacion";
import { AccionPublicacion, DestinoPublicacion, Estado, EstadoPr, EstadoPublicacion, Origen, type OrigenDePaquete } from "@/dominio/valores";
import { ErrorDeGitHub, type ClienteGitHub, type PrDeGitHub } from "@/github/cliente";

import { ErrorDeGlobalconfig } from "./globalconfig";
import { PAQUETE_ROSLYN, type DefinicionDelPaquete } from "./paquetes";
import { cuerpoDelPr, ErrorDelPr, type DecisionDeRegla } from "./pr";
import { ErrorDeReglasJson } from "./reglasJson";

/**
 * Publicar en el paquete (entrega 6.4, paso 6; decisiones R4 y R5): lleva al
 * `.globalconfig` de Lainco.Analyzers lo que dice la app, con **un** PR que se crea o se
 * actualiza.
 *
 * Cada decisión que entra o sale de Incorporada en una regla propia deja una publicación
 * pendiente con destino "PR de configuración" (paso 4). Esta función las toma todas
 * juntas, porque el PR es uno solo:
 *
 * 1. Genera el `.globalconfig` con el estado de **todas** las reglas Roslyn en ese momento.
 * 2. Lee de la rama base (`main`) el `.globalconfig`, el proyecto del paquete y
 *    `AnalyzerReleases`, y arma lo que propone el PR (./pr.ts).
 * 3. Si `main` ya está así, no hace falta PR: las publicaciones quedan publicadas y, si
 *    había un PR abierto, se cierra (ya no propone nada).
 * 4. Si no, crea un commit sobre `main` con los cambios, mueve la rama del PR a ese commit
 *    (forzando: el PR siempre es un solo commit sobre el `main` del momento) y crea el PR o
 *    le actualiza el título y la descripción.
 *
 * Las publicaciones quedan "publicadas" cuando el PR las contiene: que se mergee y se
 * publique la versión es el seguimiento del paso 7. Si GitHub falla, se reintenta como la
 * publicación en Sonar (src/dominio/publicacion.ts). Dos corridas a la vez no se pisan: la
 * segunda espera el lock y, si la primera publicó todo, no encuentra nada pendiente.
 *
 * Lo mismo para @lainco/eslint-config y su `reglas.json` (entrega 6.4, parte ESLint,
 * decisión L3): cada paquete tiene su PR, su rama y su lock, y toma solo las
 * publicaciones de las reglas de su origen (./paquetes.ts).
 */

/** La rama del PR de configuración de Lainco.Analyzers (R5). */
export const RAMA_DEL_PR = PAQUETE_ROSLYN.rama;

export interface OpcionesDePublicacionDelPaquete {
  db: Db;
  github: Pick<
    ClienteGitHub,
    "commitDeRama" | "leerArchivo" | "crearCommit" | "crearRama" | "moverRama" | "prAbierto" | "crearPr" | "actualizarPr"
  >;
  /** La rama sobre la que se abre el PR. Por defecto, `main`. */
  base?: string;
  /** Sin esperar los reintentos programados: el botón. */
  sinEsperar?: boolean;
  /**
   * Llevar main a lo que dice la app aunque no haya nada pendiente: corregir el desvío del
   * paquete (paso 7), cuando main cambió por fuera de la app.
   */
  forzar?: boolean;
  /** Qué paquete. Por defecto, Lainco.Analyzers. */
  paquete?: DefinicionDelPaquete;
}

export interface ResumenDelPaquete {
  publicadas: number;
  reprogramadas: number;
  fallidas: number;
  /** El PR que las contiene; null si no hubo nada pendiente o main ya estaba así. */
  pr: PrDeGitHub | null;
  /** La versión que propone el PR. */
  version: string | null;
  error: string | null;
}

export async function publicarPaquete({
  db,
  github,
  base = "main",
  sinEsperar = false,
  forzar = false,
  paquete = PAQUETE_ROSLYN,
}: OpcionesDePublicacionDelPaquete): Promise<ResumenDelPaquete> {
  const resumen: ResumenDelPaquete = { publicadas: 0, reprogramadas: 0, fallidas: 0, pr: null, version: null, error: null };

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${paquete.lockPublicar})`);

    const pendientes = await tx
      .select({ id: publicacion.id, intentos: publicacion.intentos, reglaId: publicacion.reglaId })
      .from(publicacion)
      .innerJoin(regla, eq(regla.id, publicacion.reglaId))
      .where(
        and(
          eq(publicacion.destino, DestinoPublicacion.PrConfiguracion),
          eq(regla.origen, paquete.origen),
          eq(publicacion.estado, EstadoPublicacion.Pendiente),
          sinEsperar ? undefined : lte(publicacion.proximoIntentoEn, sql`now()`),
        ),
      )
      .orderBy(asc(publicacion.creadaEn))
      .for("update", { of: publicacion, skipLocked: true });
    if (pendientes.length === 0 && !forzar) {
      return resumen;
    }

    const reglas = await reglasDelPaquete(tx, paquete.origen);

    let pr: PrDeGitHub | null;
    try {
      const generado = paquete.generar(reglas);

      const commitBase = await github.commitDeRama(base);
      if (!commitBase) {
        throw new ErrorDelPr(`No existe la rama ${base} en el repositorio.`);
      }
      const main = await leerDeMain(github, commitBase, base, paquete);
      const plan = paquete.plan(main, generado);
      const abierto = await github.prAbierto(paquete.rama);

      if (!plan) {
        // main ya tiene lo que dice la app: un PR abierto ya no propone nada.
        if (abierto) {
          await github.actualizarPr(abierto.numero, {
            cuerpo: `Se cerró solo: \`${base}\` ya tiene el \`${paquete.archivo}\` que dice el catálogo de reglas.`,
            cerrar: true,
          });
          await tx
            .update(prConfiguracion)
            .set({ estado: EstadoPr.Cerrado, cerradoEn: sql`now()`, revisadoEn: sql`now()` })
            .where(eq(prConfiguracion.numero, abierto.numero));
        }
        pr = null;
      } else {
        const decisiones = await ultimasDecisiones(tx, plan.cambios.map((c) => c.clave), paquete.origen);
        const titulo = paquete.titulo(plan.version);
        const cuerpo = cuerpoDelPr({ ...plan, decisiones, paquete });

        const commit = await github.crearCommit({ base: commitBase, mensaje: titulo, archivos: plan.archivos });
        if (await github.commitDeRama(paquete.rama)) {
          await github.moverRama(paquete.rama, commit);
        } else {
          await github.crearRama(paquete.rama, commit);
        }

        if (abierto) {
          await github.actualizarPr(abierto.numero, { titulo, cuerpo });
          pr = abierto;
        } else {
          pr = await github.crearPr({ titulo, cuerpo, rama: paquete.rama, base });
        }
        resumen.version = plan.version;

        // El seguimiento (paso 7) arranca acá: abierto, con la versión que propone.
        await tx
          .insert(prConfiguracion)
          .values({ numero: pr.numero, paquete: paquete.origen, url: pr.url, version: plan.version })
          .onConflictDoUpdate({
            target: prConfiguracion.numero,
            set: { url: pr.url, version: plan.version, estado: EstadoPr.Abierto, actualizadoEn: sql`now()`, mergeadoEn: null, cerradoEn: null },
          });
      }
    } catch (e) {
      const { falla, mensaje } = clasificar(e);
      resumen.error = mensaje;
      for (const p of pendientes) {
        const siguiente = despuesDeFallar(p.intentos + 1, falla);
        await tx
          .update(publicacion)
          .set({
            intentos: p.intentos + 1,
            ultimoError: mensaje,
            ...(siguiente.fallida
              ? { estado: EstadoPublicacion.Fallida }
              : { proximoIntentoEn: sql`now() + make_interval(mins => ${siguiente.esperaEnMinutos})` }),
          })
          .where(eq(publicacion.id, p.id));
        resumen[siguiente.fallida ? "fallidas" : "reprogramadas"]++;
      }
      return resumen;
    }

    // Cada publicación queda con lo que el PR (o main) tiene de su regla.
    const porId = new Map(reglas.map((r) => [r.id, r]));
    for (const p of pendientes) {
      const actual = porId.get(p.reglaId);
      const activa = actual?.estado === Estado.Incorporada;
      await tx
        .update(publicacion)
        .set({
          estado: EstadoPublicacion.Publicada,
          publicadaEn: sql`now()`,
          intentos: p.intentos + 1,
          ultimoError: null,
          accion: activa ? AccionPublicacion.Activar : AccionPublicacion.Desactivar,
          severidad: activa ? (actual?.severidadPorDefecto ?? null) : null,
          prNumero: pr?.numero ?? null,
          prUrl: pr?.url ?? null,
        })
        .where(eq(publicacion.id, p.id));
    }
    resumen.publicadas = pendientes.length;
    resumen.pr = pr;
    return resumen;
  });
}

/** Los archivos de main que necesita el plan del paquete, por ruta. */
async function leerDeMain(
  github: OpcionesDePublicacionDelPaquete["github"],
  commit: string,
  base: string,
  paquete: DefinicionDelPaquete,
): Promise<Map<string, string>> {
  const rutas = [paquete.rutas.configuracion, paquete.rutas.version, ...paquete.rutas.otras];
  const contenidos = await Promise.all(
    rutas.map(async (ruta) => {
      const contenido = await github.leerArchivo(ruta, commit);
      if (contenido === null) {
        throw new ErrorDelPr(`No está ${ruta} en ${base}.`);
      }
      return [ruta, contenido] as const;
    }),
  );
  return new Map(contenidos);
}

type Transaccion = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Las reglas propias de un origen con su estado: de lo que sale el archivo de configuración. */
export function reglasDelPaquete(db: Pick<Db, "select">, origen: OrigenDePaquete = Origen.Roslyn) {
  return db
    .select({
      id: regla.id,
      clave: regla.clave,
      titulo: regla.nombre,
      estado: estadoRegla.estado,
      severidadPorDefecto: regla.severidadDefault,
      eliminada: sql<boolean>`${regla.deprecadaEn} is not null`,
    })
    .from(regla)
    .innerJoin(estadoRegla, eq(estadoRegla.reglaId, regla.id))
    .where(eq(regla.origen, origen));
}

/**
 * Para la descripción del PR, la decisión que explica el estado de cada regla del paquete:
 * la última que la llevó al estado en que está.
 */
async function ultimasDecisiones(tx: Transaccion, claves: string[], origen: OrigenDePaquete): Promise<Map<string, DecisionDeRegla>> {
  if (claves.length === 0) return new Map();
  const filas = await tx
    .selectDistinctOn([regla.id], {
      clave: regla.clave,
      titulo: regla.nombre,
      estado: estado.descripcion,
      autor: usuario.nombre,
      fecha: decision.fecha,
      justificacion: decision.justificacion,
    })
    .from(decision)
    .innerJoin(regla, eq(regla.id, decision.reglaId))
    .innerJoin(estado, eq(estado.codigo, decision.estadoNuevo))
    .innerJoin(usuario, eq(usuario.id, decision.autorId))
    .innerJoin(estadoRegla, and(eq(estadoRegla.reglaId, regla.id), eq(estadoRegla.estado, decision.estadoNuevo)))
    .where(and(eq(regla.origen, origen), inArray(regla.clave, claves)))
    .orderBy(regla.id, desc(decision.fecha));
  return new Map(filas.map(({ clave, ...d }) => [clave, d]));
}

/**
 * Por qué falló, como en la publicación en Sonar: la red o GitHub caído se reintentan;
 * un token sin permiso o un repositorio que no se encuentra también (se arreglan sin tocar
 * la publicación); lo que hay en main o en la app que no permite armar el PR, y un pedido
 * que GitHub rechaza, necesitan que alguien lo mire.
 */
function clasificar(e: unknown): { falla: TipoDeFalla; mensaje: string } {
  const mensaje = e instanceof Error ? e.message : String(e);
  if (e instanceof ErrorDelPr || e instanceof ErrorDeGlobalconfig || e instanceof ErrorDeReglasJson) {
    return { falla: "permanente", mensaje };
  }
  if (e instanceof ErrorDeGitHub) {
    const falla: TipoDeFalla =
      e.tipo === "autenticacion" || e.tipo === "permisos" || e.tipo === "noEncontrado"
        ? "configuracion"
        : e.tipo === "pedidoInvalido"
          ? "permanente"
          : "transitorio";
    return { falla, mensaje };
  }
  return { falla: "transitorio", mensaje };
}

/**
 * Vuelve a poner pendientes las publicaciones al paquete que fallaron (el botón), sin
 * esperas ni intentos acumulados. Solo las que siguen siendo la última palabra sobre su
 * regla. Devuelve cuántas.
 */
export async function reintentarFallidasDelPaquete(db: Db): Promise<number> {
  const reactivadas = await db.execute(sql`
    update ${publicacion} set ${sql.identifier("estado")} = ${EstadoPublicacion.Pendiente},
      ${sql.identifier("intentos")} = 0, ${sql.identifier("proximoIntentoEn")} = now()
    where ${publicacion.destino} = ${DestinoPublicacion.PrConfiguracion}
      and ${publicacion.estado} = ${EstadoPublicacion.Fallida}
      and not exists (
        select 1 from ${publicacion} as posterior
        where posterior."reglaId" = ${publicacion.reglaId}
          and posterior."creadaEn" > ${publicacion.creadaEn}
          and posterior.estado in (${EstadoPublicacion.Pendiente}, ${EstadoPublicacion.Publicada})
      )`);
  return reactivadas.rowCount ?? 0;
}
