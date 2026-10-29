import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { corridaPrueba, decision, estadoRegla, muestraPrueba, regla, reglaEnCorrida, repositorioEnCorrida, resultadoPrueba, usuario } from "@/db/esquema";
import { corridasQueCuentan, linkDeMuestra, tasaDeFalsosPositivos, type TasaDeFalsosPositivos } from "@/dominio/prueba";
import { Estado, EstadoCorrida, type EstadoRepositorioPrueba, type EvaluacionMuestra, type Origen } from "@/dominio/valores";

/**
 * Lo que muestran las pantallas de la prueba de reglas (entrega 6.5, paso 6): la sección
 * Prueba del detalle de una regla, la pantalla Prueba y la insignia del encabezado.
 */

export interface RepositorioDeLaCorrida {
  repositorio: string;
  /** Null: todavía no llegaron sus resultados. */
  estado: EstadoRepositorioPrueba | null;
  error: string | null;
  /** Issues de la regla en el repositorio; null si no hay resultado (error, pendiente o no se probó). */
  cantidad: number | null;
}

export interface CorridaDeLaRegla {
  id: string;
  iniciadaEn: Date;
  estado: EstadoCorrida;
  error: string | null;
  /** Suma de los repositorios con resultado; null si ninguno tiene. */
  total: number | null;
  repositorios: RepositorioDeLaCorrida[];
}

export interface MuestraParaMostrar {
  id: string;
  repositorio: string;
  archivo: string;
  linea: number;
  columna: number | null;
  mensaje: string;
  commit: string;
  /** El código en GitHub, en el commit analizado (decisión E1). */
  link: string;
  evaluacion: EvaluacionMuestra;
  evaluadaPor: string | null;
  evaluadaEn: Date | null;
}

export interface PruebaDeRegla {
  probableLocalmente: boolean | null;
  /** La última vez que entró a En prueba; null si nunca entró. */
  entroEnPrueba: Date | null;
  minimo: number;
  /** Corridas que cuentan para el mínimo (decisión E3). */
  cuentan: number;
  /** Las últimas corridas que la incluyeron, de la más nueva. */
  corridas: CorridaDeLaRegla[];
  /** Las muestras de la última corrida con resultados de la regla. */
  muestras: MuestraParaMostrar[];
  tasa: TasaDeFalsosPositivos;
}

/** La última vez que cada regla entró a En prueba. */
async function entradasEnPrueba(db: Db, reglaIds: string[]): Promise<Map<string, Date>> {
  if (reglaIds.length === 0) {
    return new Map();
  }
  const filas = await db
    .select({ reglaId: decision.reglaId, fecha: max(decision.fecha) })
    .from(decision)
    .where(and(inArray(decision.reglaId, reglaIds), eq(decision.estadoNuevo, Estado.EnPrueba)))
    .groupBy(decision.reglaId);
  return new Map(filas.filter((f) => f.fecha).map((f) => [f.reglaId, f.fecha!]));
}

/** Las corridas que incluyeron cada regla, con su total y si tuvieron resultados, de la más nueva. */
async function corridasDeLasReglas(db: Db, reglaIds: string[]) {
  if (reglaIds.length === 0) {
    return [];
  }
  return db
    .select({
      reglaId: reglaEnCorrida.reglaId,
      id: corridaPrueba.id,
      iniciadaEn: corridaPrueba.iniciadaEn,
      estado: corridaPrueba.estado,
      error: corridaPrueba.error,
      resultados: sql<number>`count(${resultadoPrueba.reglaId})::int`,
      total: sql<number | null>`sum(${resultadoPrueba.cantidad})::int`,
    })
    .from(reglaEnCorrida)
    .innerJoin(corridaPrueba, eq(corridaPrueba.id, reglaEnCorrida.corridaId))
    .leftJoin(resultadoPrueba, and(eq(resultadoPrueba.corridaId, reglaEnCorrida.corridaId), eq(resultadoPrueba.reglaId, reglaEnCorrida.reglaId)))
    .where(inArray(reglaEnCorrida.reglaId, reglaIds))
    .groupBy(reglaEnCorrida.reglaId, corridaPrueba.id)
    .orderBy(desc(corridaPrueba.iniciadaEn));
}

/** Lo que muestra la sección Prueba del detalle de una regla. */
export async function pruebaDeRegla(db: Db, reglaId: string, { minimo, limite = 10 }: { minimo: number; limite?: number }): Promise<PruebaDeRegla> {
  const [[delaRegla], entradas, corridas] = await Promise.all([
    db.select({ probableLocalmente: regla.probableLocalmente }).from(regla).where(eq(regla.id, reglaId)),
    entradasEnPrueba(db, [reglaId]),
    corridasDeLasReglas(db, [reglaId]),
  ]);
  const entroEnPrueba = entradas.get(reglaId) ?? null;
  const cuentan = entroEnPrueba
    ? corridasQueCuentan(
        corridas.map((c) => ({ iniciadaEn: c.iniciadaEn, estado: c.estado, conResultados: c.resultados > 0 })),
        entroEnPrueba,
      )
    : 0;

  const mostradas = corridas.slice(0, limite);
  const repositorios = mostradas.length
    ? await db
        .select({
          corridaId: repositorioEnCorrida.corridaId,
          repositorio: repositorioEnCorrida.repositorio,
          estado: repositorioEnCorrida.estado,
          error: repositorioEnCorrida.error,
          cantidad: resultadoPrueba.cantidad,
        })
        .from(repositorioEnCorrida)
        .leftJoin(
          resultadoPrueba,
          and(
            eq(resultadoPrueba.corridaId, repositorioEnCorrida.corridaId),
            eq(resultadoPrueba.repositorio, repositorioEnCorrida.repositorio),
            eq(resultadoPrueba.reglaId, reglaId),
          ),
        )
        .where(inArray(repositorioEnCorrida.corridaId, mostradas.map((c) => c.id)))
        .orderBy(asc(repositorioEnCorrida.repositorio))
    : [];

  const conResultados = corridas.find((c) => c.resultados > 0);
  const muestras = conResultados ? await muestrasDeLaCorrida(db, reglaId, conResultados.id) : [];

  return {
    probableLocalmente: delaRegla?.probableLocalmente ?? null,
    entroEnPrueba,
    minimo,
    cuentan,
    corridas: mostradas.map((c) => ({
      id: c.id,
      iniciadaEn: c.iniciadaEn,
      estado: c.estado,
      error: c.error,
      total: c.resultados > 0 ? c.total : null,
      repositorios: repositorios
        .filter((r) => r.corridaId === c.id)
        .map(({ repositorio, estado, error, cantidad }) => ({ repositorio, estado, error, cantidad })),
    })),
    muestras,
    tasa: tasaDeFalsosPositivos(muestras.map((m) => m.evaluacion)),
  };
}

async function muestrasDeLaCorrida(db: Db, reglaId: string, corridaId: string): Promise<MuestraParaMostrar[]> {
  const filas = await db
    .select({
      id: muestraPrueba.id,
      repositorio: muestraPrueba.repositorio,
      archivo: muestraPrueba.archivo,
      linea: muestraPrueba.linea,
      columna: muestraPrueba.columna,
      mensaje: muestraPrueba.mensaje,
      commit: muestraPrueba.commit,
      evaluacion: muestraPrueba.evaluacion,
      evaluadaPor: usuario.nombre,
      evaluadaEn: muestraPrueba.evaluadaEn,
    })
    .from(muestraPrueba)
    .leftJoin(usuario, eq(usuario.id, muestraPrueba.evaluadaPorId))
    .where(and(eq(muestraPrueba.reglaId, reglaId), eq(muestraPrueba.ultimaCorridaId, corridaId)))
    .orderBy(asc(muestraPrueba.repositorio), asc(muestraPrueba.archivo), asc(muestraPrueba.linea));
  return filas.map((m) => ({ ...m, link: linkDeMuestra(m) }));
}

export interface CorridaParaMostrar {
  id: string;
  iniciadaEn: Date;
  terminadaEn: Date | null;
  estado: EstadoCorrida;
  error: string | null;
  workflowUrl: string | null;
  versionSonarAnalyzer: string | null;
  versionLaincoAnalyzers: string | null;
  /** Cuántas reglas probó. */
  reglas: number;
  repositorios: { repositorio: string; estado: EstadoRepositorioPrueba | null; error: string | null; commit: string | null }[];
}

export interface ReglaEnPrueba {
  id: string;
  origen: Origen;
  clave: string;
  nombre: string;
  probableLocalmente: boolean | null;
  /** Issues en la última corrida con resultados; null si el job todavía no la corrió. */
  ultimoTotal: number | null;
  cuentan: number;
  tasa: TasaDeFalsosPositivos;
}

/** Lo que muestra la pantalla Prueba: las últimas corridas y las reglas En prueba. */
export async function panelDePrueba(db: Db, { minimo, limite = 15 }: { minimo: number; limite?: number }): Promise<{ minimo: number; corridas: CorridaParaMostrar[]; reglas: ReglaEnPrueba[] }> {
  const corridas = await db
    .select({
      id: corridaPrueba.id,
      iniciadaEn: corridaPrueba.iniciadaEn,
      terminadaEn: corridaPrueba.terminadaEn,
      estado: corridaPrueba.estado,
      error: corridaPrueba.error,
      workflowUrl: corridaPrueba.workflowUrl,
      versionSonarAnalyzer: corridaPrueba.versionSonarAnalyzer,
      versionLaincoAnalyzers: corridaPrueba.versionLaincoAnalyzers,
      reglas: sql<number>`(select count(*)::int from ${reglaEnCorrida} where ${reglaEnCorrida.corridaId} = ${corridaPrueba.id})`,
    })
    .from(corridaPrueba)
    .orderBy(desc(corridaPrueba.iniciadaEn))
    .limit(limite);
  const repositorios = corridas.length
    ? await db
        .select({
          corridaId: repositorioEnCorrida.corridaId,
          repositorio: repositorioEnCorrida.repositorio,
          estado: repositorioEnCorrida.estado,
          error: repositorioEnCorrida.error,
          commit: repositorioEnCorrida.commit,
        })
        .from(repositorioEnCorrida)
        .where(inArray(repositorioEnCorrida.corridaId, corridas.map((c) => c.id)))
        .orderBy(asc(repositorioEnCorrida.repositorio))
    : [];

  const enPrueba = await db
    .select({ id: regla.id, origen: regla.origen, clave: regla.clave, nombre: regla.nombre, probableLocalmente: regla.probableLocalmente })
    .from(regla)
    .innerJoin(estadoRegla, eq(estadoRegla.reglaId, regla.id))
    .where(eq(estadoRegla.estado, Estado.EnPrueba))
    .orderBy(asc(regla.clave));
  const ids = enPrueba.map((r) => r.id);
  const [entradas, corridasPorRegla, evaluaciones] = await Promise.all([
    entradasEnPrueba(db, ids),
    corridasDeLasReglas(db, ids),
    ids.length
      ? db
          .select({ reglaId: muestraPrueba.reglaId, ultimaCorridaId: muestraPrueba.ultimaCorridaId, evaluacion: muestraPrueba.evaluacion })
          .from(muestraPrueba)
          .where(inArray(muestraPrueba.reglaId, ids))
      : Promise.resolve([]),
  ]);

  const reglas = enPrueba.map((r) => {
    const deLaRegla = corridasPorRegla.filter((c) => c.reglaId === r.id);
    const ultima = deLaRegla.find((c) => c.resultados > 0);
    const entro = entradas.get(r.id);
    return {
      ...r,
      ultimoTotal: ultima ? ultima.total : null,
      cuentan: entro ? corridasQueCuentan(deLaRegla.map((c) => ({ iniciadaEn: c.iniciadaEn, estado: c.estado, conResultados: c.resultados > 0 })), entro) : 0,
      tasa: tasaDeFalsosPositivos(evaluaciones.filter((e) => e.reglaId === r.id && e.ultimaCorridaId === ultima?.id).map((e) => e.evaluacion)),
    };
  });

  return {
    minimo,
    corridas: corridas.map((c) => ({
      ...c,
      repositorios: repositorios.filter((r) => r.corridaId === c.id).map(({ repositorio, estado, error, commit }) => ({ repositorio, estado, error, commit })),
    })),
    reglas,
  };
}

/** Lo que pide atención en la pantalla Prueba (la insignia del encabezado): la última corrida. */
export async function atencionDePrueba(db: Db): Promise<{ cantidad: number; detalle: string }> {
  const [ultima] = await db.select({ id: corridaPrueba.id, estado: corridaPrueba.estado }).from(corridaPrueba).orderBy(desc(corridaPrueba.iniciadaEn)).limit(1);
  if (!ultima || ultima.estado === EstadoCorrida.EnCurso) {
    return { cantidad: 0, detalle: "" };
  }
  if (ultima.estado === EstadoCorrida.Fallida) {
    return { cantidad: 1, detalle: "la última corrida falló" };
  }
  const [{ conError }] = await db
    .select({ conError: sql<number>`count(*)::int` })
    .from(repositorioEnCorrida)
    .where(and(eq(repositorioEnCorrida.corridaId, ultima.id), eq(repositorioEnCorrida.estado, "error")));
  return conError === 0
    ? { cantidad: 0, detalle: "" }
    : { cantidad: conError, detalle: `${conError === 1 ? "1 repositorio" : `${conError} repositorios`} con error en la última corrida` };
}

/**
 * Cuántas corridas cuentan para el mínimo de cada regla (decisión E3): terminadas, con
 * resultados de la regla, desde la última vez que entró a En prueba. Lo usa el ciclo de vida
 * para En prueba → Incorporada (src/transiciones/aplicarTransicion.ts).
 */
export async function corridasQueCuentanPorRegla(db: Db, reglaIds: string[]): Promise<Map<string, number>> {
  const [entradas, corridas] = await Promise.all([entradasEnPrueba(db, reglaIds), corridasDeLasReglas(db, reglaIds)]);
  return new Map(
    reglaIds.map((id) => {
      const entro = entradas.get(id);
      const deLaRegla = corridas.filter((c) => c.reglaId === id).map((c) => ({ iniciadaEn: c.iniciadaEn, estado: c.estado, conResultados: c.resultados > 0 }));
      return [id, entro ? corridasQueCuentan(deLaRegla, entro) : 0];
    }),
  );
}
