import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { corridaPrueba, muestraPrueba, regla, reglaEnCorrida, repositorioEnCorrida, resultadoPrueba } from "@/db/esquema";
import { elegirMuestras, idDeDiagnostico, identidadDeMuestra, lenguajeDeDiagnostico } from "@/dominio/prueba";
import { EstadoCorrida, EstadoRepositorioPrueba, EvaluacionMuestra, Lenguaje, Origen } from "@/dominio/valores";

/**
 * Ingesta de los resultados del job de prueba (entrega 6.5, paso 5): lo que manda el job
 * por cada repositorio de una corrida (lo arma .github/prueba/reducir-sarif.mjs).
 *
 * - Guarda cuántos issues levantó cada regla, cero incluido. Una regla que el analyzer no
 *   trae no tiene resultado: no se probó (decisión E7).
 * - Marca `probableLocalmente` en todas las reglas de Sonar para C#, según las que trae el
 *   analyzer (E7).
 * - Guarda hasta 20 muestras por regla, las ya evaluadas primero; una muestra que ya existía
 *   conserva su evaluación y toma la línea y el commit nuevos (E6).
 * - Repetir el envío de un repositorio reemplaza lo anterior.
 * - Cuando llegaron todos los repositorios, la corrida termina.
 */

export interface UbicacionRecibida {
  /** Relativo a la raíz del repositorio, ya normalizado. */
  archivo: string;
  linea: number;
  columna: number;
  mensaje: string;
}

export type ResultadoRecibido =
  | {
      repositorio: string;
      commit: string;
      estado: "ok";
      diagnosticosDisponibles: string[];
      /** Qué lenguajes se analizaron (E10). Sin el campo, todos. */
      lenguajesAnalizados?: ("cs" | "ts")[];
      reglas: { diagnostico: string; cantidad: number; ubicaciones: UbicacionRecibida[] }[];
    }
  | { repositorio: string; commit?: string; estado: "error"; error: string };

export type ResultadoDeIngesta =
  | {
      ok: true;
      corrida: { id: string; estado: EstadoCorrida };
      repositorio: string;
      estado: "ok" | "error";
      resultados: number;
      muestras: number;
      /** Los repositorios de la corrida que todavía no mandaron resultados. */
      faltan: string[];
    }
  | { ok: false; status: 404 | 409 | 422; error: string; mensaje: string; extra?: Record<string, unknown> };

/** Una transacción de la base. */
type Transaccion = Parameters<Parameters<Db["transaction"]>[0]>[0];

const ID_SONAR = /^S\d+$/;
const ID_LAIN = /^LAIN\d{3}$/;
/** Las de TypeScript (E8): de Sonar con el lenguaje adelante, y las ESLint propias. */
const ID_SONAR_TS = /^ts:S\d+$/;
const ID_LAINCO = /^lainco\//;
const FAMILIAS = [ID_SONAR, ID_LAIN, ID_SONAR_TS, ID_LAINCO];

/**
 * Si la regla se probó: su ID está entre los que trae el compilador. Si el job no informó
 * ninguno de esa familia (Sonar o propias), no se sabe: se da por probada, así un error del
 * job no hace pasar todas las reglas por "no se pueden probar".
 */
function seProbo(diagnostico: string, disponibles: ReadonlySet<string>, lenguajes: readonly string[] | undefined): boolean {
  // E10: un repositorio sin C# no prueba las reglas de C#, ni uno sin TypeScript las de TypeScript.
  if (lenguajes && !lenguajes.includes(lenguajeDeDiagnostico(diagnostico))) {
    return false;
  }
  const familia = FAMILIAS.find((f) => f.test(diagnostico)) ?? ID_LAIN;
  const hayDeLaFamilia = [...disponibles].some((id) => familia.test(id));
  return !hayDeLaFamilia || disponibles.has(diagnostico);
}

export async function registrarResultado({
  db,
  corridaId,
  resultado,
  ahora = new Date(),
}: {
  db: Db;
  corridaId: string;
  resultado: ResultadoRecibido;
  ahora?: Date;
}): Promise<ResultadoDeIngesta> {
  return db.transaction(async (tx) => {
    // El lock de la fila ordena los envíos de una misma corrida y la apertura de otra.
    const [corrida] = await tx.select().from(corridaPrueba).where(eq(corridaPrueba.id, corridaId)).for("update");
    if (!corrida) {
      return { ok: false, status: 404, error: "corridaNoEncontrada", mensaje: "No existe esa corrida." };
    }
    if (corrida.estado !== EstadoCorrida.EnCurso) {
      return {
        ok: false,
        status: 409,
        error: "corridaCerrada",
        mensaje: `La corrida ya está ${corrida.estado === EstadoCorrida.Terminada ? "terminada" : "fallida"}: no recibe más resultados.`,
      };
    }

    const repositorio = resultado.repositorio.toLowerCase();
    const [delRepositorio] = await tx
      .select({ repositorio: repositorioEnCorrida.repositorio })
      .from(repositorioEnCorrida)
      .where(and(eq(repositorioEnCorrida.corridaId, corridaId), eq(repositorioEnCorrida.repositorio, repositorio)));
    if (!delRepositorio) {
      return { ok: false, status: 422, error: "repositorioAjeno", mensaje: `${repositorio} no es un repositorio de esta corrida.` };
    }

    const reglasDeLaCorrida = await tx
      .select({ id: regla.id, origen: regla.origen, clave: regla.clave })
      .from(reglaEnCorrida)
      .innerJoin(regla, eq(regla.id, reglaEnCorrida.reglaId))
      .where(eq(reglaEnCorrida.corridaId, corridaId));
    const porDiagnostico = new Map(reglasDeLaCorrida.map((r) => [idDeDiagnostico(r), r.id]));

    let resultados = 0;
    let muestras = 0;

    if (resultado.estado === "ok") {
      const recibidos = resultado.reglas.map((r) => r.diagnostico);
      const faltantes = [...porDiagnostico.keys()].filter((d) => !recibidos.includes(d));
      const sobrantes = recibidos.filter((d, i) => !porDiagnostico.has(d) || recibidos.indexOf(d) !== i);
      if (faltantes.length > 0 || sobrantes.length > 0) {
        return {
          ok: false,
          status: 422,
          error: "reglasDistintas",
          mensaje: "El resultado tiene que traer exactamente las reglas de la corrida, una vez cada una.",
          extra: { faltan: faltantes.sort(), sobran: [...new Set(sobrantes)].sort() },
        };
      }
    }

    // Un envío repetido reemplaza al anterior.
    await tx.delete(resultadoPrueba).where(and(eq(resultadoPrueba.corridaId, corridaId), eq(resultadoPrueba.repositorio, repositorio)));

    if (resultado.estado === "error") {
      await tx
        .update(repositorioEnCorrida)
        .set({ estado: EstadoRepositorioPrueba.Error, error: resultado.error, commit: resultado.commit ?? null, recibidoEn: ahora })
        .where(and(eq(repositorioEnCorrida.corridaId, corridaId), eq(repositorioEnCorrida.repositorio, repositorio)));
    } else {
      const disponibles = new Set(resultado.diagnosticosDisponibles);
      await marcarProbablesLocalmente(tx, disponibles);

      for (const r of resultado.reglas) {
        if (!seProbo(r.diagnostico, disponibles, resultado.lenguajesAnalizados)) {
          continue;
        }
        const reglaId = porDiagnostico.get(r.diagnostico)!;
        await tx.insert(resultadoPrueba).values({ corridaId, repositorio, reglaId, cantidad: r.cantidad });
        resultados++;
        muestras += await guardarMuestras(tx, { corridaId, reglaId, repositorio, commit: resultado.commit, ubicaciones: r.ubicaciones });
      }

      await tx
        .update(repositorioEnCorrida)
        .set({ estado: EstadoRepositorioPrueba.Ok, error: null, commit: resultado.commit, recibidoEn: ahora })
        .where(and(eq(repositorioEnCorrida.corridaId, corridaId), eq(repositorioEnCorrida.repositorio, repositorio)));
    }

    const faltan = (
      await tx
        .select({ repositorio: repositorioEnCorrida.repositorio })
        .from(repositorioEnCorrida)
        .where(and(eq(repositorioEnCorrida.corridaId, corridaId), isNull(repositorioEnCorrida.estado)))
        .orderBy(repositorioEnCorrida.repositorio)
    ).map((r) => r.repositorio);
    let estado: EstadoCorrida = EstadoCorrida.EnCurso;
    if (faltan.length === 0) {
      await tx.update(corridaPrueba).set({ estado: EstadoCorrida.Terminada, terminadaEn: ahora }).where(eq(corridaPrueba.id, corridaId));
      estado = EstadoCorrida.Terminada;
    }

    return { ok: true, corrida: { id: corridaId, estado }, repositorio, estado: resultado.estado, resultados, muestras, faltan };
  });
}

/**
 * E7: las reglas de Sonar para C# que trae el analyzer se pueden probar; las demás, no.
 * Para todas las del inventario, no solo las de la corrida: así una regla que no está en
 * SonarAnalyzer.CSharp no puede entrar a En prueba (paso 7). Sin ninguna de Sonar en la
 * lista no se toca nada (sería un error del job, no que falten todas).
 *
 * Lo mismo para TypeScript (E9) con las de eslint-plugin-sonarjs (`ts:S####`), por separado:
 * un repositorio sin C# no dice nada de las de C#, ni uno sin TypeScript de las de TypeScript.
 */
async function marcarProbablesLocalmente(tx: Transaccion, disponibles: ReadonlySet<string>): Promise<void> {
  const porLenguaje = [
    { lenguaje: Lenguaje.CSharp, prefijo: "csharpsquid:", ids: [...disponibles].filter((id) => ID_SONAR.test(id)) },
    { lenguaje: Lenguaje.TypeScript, prefijo: "typescript:", ids: [...disponibles].filter((id) => ID_SONAR_TS.test(id)).map((id) => id.slice("ts:".length)) },
  ];
  for (const { lenguaje, prefijo, ids } of porLenguaje) {
    if (ids.length === 0) {
      continue;
    }
    const claves = ids.map((id) => `${prefijo}${id}`);
    await tx
      .update(regla)
      .set({ probableLocalmente: sql`${inArray(regla.clave, claves)}` })
      .where(and(eq(regla.origen, Origen.Sonar), eq(regla.lenguaje, lenguaje), sql`${regla.clave} like ${`${prefijo}%`}`));
  }
}

/** Guarda las muestras de una regla en un repositorio; devuelve cuántas. */
async function guardarMuestras(
  tx: Transaccion,
  { corridaId, reglaId, repositorio, commit, ubicaciones }: { corridaId: string; reglaId: string; repositorio: string; commit: string; ubicaciones: UbicacionRecibida[] },
): Promise<number> {
  if (ubicaciones.length === 0) {
    return 0;
  }
  const identidad = (u: { archivo: string; mensaje: string }) => identidadDeMuestra({ reglaId, repositorio, archivo: u.archivo, mensaje: u.mensaje });
  const evaluadas = await tx
    .select({ archivo: muestraPrueba.archivo, mensaje: muestraPrueba.mensaje })
    .from(muestraPrueba)
    .where(and(eq(muestraPrueba.reglaId, reglaId), eq(muestraPrueba.repositorio, repositorio), ne(muestraPrueba.evaluacion, EvaluacionMuestra.SinEvaluar)));

  const elegidas = elegirMuestras(ubicaciones, { identidad, evaluadas: new Set(evaluadas.map(identidad)) });
  for (const u of elegidas) {
    await tx
      .insert(muestraPrueba)
      .values({ reglaId, repositorio, archivo: u.archivo, mensaje: u.mensaje, linea: u.linea, columna: u.columna, commit, primeraCorridaId: corridaId, ultimaCorridaId: corridaId })
      .onConflictDoUpdate({
        target: [muestraPrueba.reglaId, muestraPrueba.repositorio, muestraPrueba.archivo, muestraPrueba.mensaje],
        set: { linea: u.linea, columna: u.columna, commit, ultimaCorridaId: corridaId },
      });
  }
  return elegidas.length;
}

