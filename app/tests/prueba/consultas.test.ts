import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";
import { AlcanceToken, Estado, EstadoCorrida, EstadoRepositorioPrueba, EvaluacionMuestra, Origen, Rol } from "@/dominio/valores";

/**
 * Lo que muestran las pantallas de la prueba de reglas (entrega 6.5, paso 6): la prueba de
 * una regla (corridas, issues por repositorio, mínimo, muestras y tasa), el panel de
 * corridas, lo que pide atención, y evaluar una muestra.
 *
 * Necesita DATABASE_URL_PRUEBAS. Cada test corre en una transacción que se descarta. Los
 * datos se cargan como los carga el job: abriendo corridas y registrando resultados.
 */

const url = process.env.DATABASE_URL_PRUEBAS;

class Descartada extends Error {}

const DIA = 86_400_000;
const INICIO = new Date("2026-10-20T03:00:00Z");
const dia = (n: number) => new Date(INICIO.getTime() + n * DIA);
const REPOS = [
  { repositorio: "lainco/dico", solucion: null },
  { repositorio: "lainco/sigma", solucion: null },
];

describe.skipIf(!url)("consultas de la prueba de reglas", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { corridaPrueba, decision, estadoRegla, muestraPrueba, regla, usuario } = await import("@/db/esquema");
  const { crearTokenServicio } = await import("@/servicio/tokensDeServicio");
  const { abrirCorrida } = await import("@/prueba/abrir");
  const { registrarResultado } = await import("@/prueba/ingesta");
  const { atencionDePrueba, panelDePrueba, pruebaDeRegla } = await import("@/prueba/consultas");
  const { evaluarMuestra } = await import("@/prueba/evaluar");

  interface Contexto {
    tx: Db;
    lain: string;
    s1118: string;
    usuarioId: string;
    /** Una corrida completa el día n: dico con `cantidad` issues de LAIN991 (y sus ubicaciones), sigma con error. */
    corrida(n: number, cantidad: number, opciones?: { sigmaOk?: boolean; terminar?: boolean }): Promise<string>;
  }

  function enTransaccion(nombre: string, prueba: (c: Contexto) => Promise<void>) {
    it(nombre, async () => {
      const resultado = obtenerDb().transaction(async (transaccion) => {
        const tx = transaccion as unknown as Db;
        await tx.update(estadoRegla).set({ estado: Estado.ARevisar }).where(eq(estadoRegla.estado, Estado.EnPrueba));
        await tx.update(corridaPrueba).set({ estado: EstadoCorrida.Fallida, terminadaEn: dia(-30), error: "vieja" }).where(eq(corridaPrueba.estado, EstadoCorrida.EnCurso));
        const token = await crearTokenServicio(tx, { nombre: "job-consultas", alcance: AlcanceToken.Prueba, dias: 365, ahora: dia(-10) });
        const [yo] = await tx.insert(usuario).values({ nombre: "Ana Analista", email: "prueba-consultas@laincosoftware.com", rol: Rol.Analista }).returning();
        const nueva = async (origen: Origen, clave: string) => {
          const [r] = await tx.insert(regla).values({ origen, clave, lenguaje: "cs", nombre: `Regla ${clave}`, hashDescripcion: "x" }).returning({ id: regla.id });
          await tx.insert(estadoRegla).values({ reglaId: r.id, estado: Estado.EnPrueba });
          // Entró a En prueba el día 0.
          await tx.insert(decision).values({ reglaId: r.id, estadoAnterior: Estado.ARevisar, estadoNuevo: Estado.EnPrueba, autorId: yo.id, fecha: INICIO });
          return r.id;
        };
        const lain = await nueva(Origen.Roslyn, "LAIN991");
        const s1118 = await nueva(Origen.Sonar, "csharpsquid:S1118");

        await prueba({
          tx,
          lain,
          s1118,
          usuarioId: yo.id,
          async corrida(n, cantidad, { sigmaOk = false, terminar = true } = {}) {
            const { corrida } = await abrirCorrida({ db: tx, tokenId: token.id, repositorios: REPOS, ahora: dia(n) });
            const ubicaciones = Array.from({ length: Math.min(cantidad, 3) }, (_, i) => ({ archivo: `src/A${i}.cs`, linea: 10 + n, columna: 1, mensaje: `En 'Dico.A${i}'` }));
            await registrarResultado({
              db: tx,
              corridaId: corrida!.id,
              ahora: new Date(dia(n).getTime() + 3_600_000),
              resultado: {
                repositorio: "lainco/dico",
                commit: `abc${n}def0`,
                estado: "ok",
                diagnosticosDisponibles: ["LAIN991", "S1118"],
                reglas: [
                  { diagnostico: "LAIN991", cantidad, ubicaciones },
                  { diagnostico: "S1118", cantidad: 0, ubicaciones: [] },
                ],
              },
            });
            if (terminar) {
              await registrarResultado({
                db: tx,
                corridaId: corrida!.id,
                ahora: new Date(dia(n).getTime() + 3_600_000),
                resultado: sigmaOk
                  ? { repositorio: "lainco/sigma", commit: "fff0000", estado: "ok", diagnosticosDisponibles: ["LAIN991", "S1118"], reglas: [{ diagnostico: "LAIN991", cantidad: 1, ubicaciones: [] }, { diagnostico: "S1118", cantidad: 0, ubicaciones: [] }] }
                  : { repositorio: "lainco/sigma", estado: "error", error: "No compiló." },
              });
            }
            return corrida!.id;
          },
        });
        throw new Descartada();
      });
      await expect(resultado).rejects.toBeInstanceOf(Descartada);
    });
  }

  // --------------------------------------------------------------- prueba de una regla

  enTransaccion("una regla sin corridas: nada que mostrar y le faltan todas", async (c) => {
    const prueba = await pruebaDeRegla(c.tx, c.lain, { minimo: 5 });

    expect(prueba).toMatchObject({ entroEnPrueba: INICIO, minimo: 5, cuentan: 0, corridas: [], muestras: [], tasa: { evaluadas: 0, tasa: null } });
  });

  enTransaccion("las corridas de la regla, de la más nueva, con el total y cada repositorio", async (c) => {
    await c.corrida(1, 4);
    await c.corrida(2, 2, { sigmaOk: true });

    const prueba = await pruebaDeRegla(c.tx, c.lain, { minimo: 5 });

    expect(prueba.corridas.map((x) => ({ iniciadaEn: x.iniciadaEn, estado: x.estado, total: x.total }))).toEqual([
      { iniciadaEn: dia(2), estado: EstadoCorrida.Terminada, total: 3 },
      { iniciadaEn: dia(1), estado: EstadoCorrida.Terminada, total: 4 },
    ]);
    expect(prueba.corridas[1].repositorios).toEqual([
      { repositorio: "lainco/dico", estado: EstadoRepositorioPrueba.Ok, error: null, cantidad: 4 },
      { repositorio: "lainco/sigma", estado: EstadoRepositorioPrueba.Error, error: "No compiló.", cantidad: null },
    ]);
    expect(prueba.corridas[0].repositorios.map((r) => r.cantidad)).toEqual([2, 1]);
    expect(prueba.cuentan).toBe(2);
  });

  enTransaccion("cuentan las terminadas desde que entró en prueba; no las de antes ni las fallidas", async (c) => {
    await c.corrida(-3, 1);
    await c.corrida(1, 1);
    await c.corrida(2, 1, { terminar: false });
    await c.corrida(3, 1);
    await c.corrida(4, 1, { terminar: false });

    const prueba = await pruebaDeRegla(c.tx, c.lain, { minimo: 5 });

    // La del día 2 quedó fallida al abrirse la del 3; la del día 4 sigue en curso.
    expect(prueba.corridas.map((x) => x.estado)).toEqual([EstadoCorrida.EnCurso, EstadoCorrida.Terminada, EstadoCorrida.Fallida, EstadoCorrida.Terminada, EstadoCorrida.Terminada]);
    expect(prueba.cuentan).toBe(2);
  });

  enTransaccion("las muestras son las de la última corrida con resultados, con su link, y la tasa sale de ellas", async (c) => {
    await c.corrida(1, 3);
    const segunda = await c.corrida(2, 2);
    const [a0] = await c.tx.select().from(muestraPrueba).where(eq(muestraPrueba.archivo, "src/A0.cs"));
    await evaluarMuestra(c.tx, { muestraId: a0.id, evaluacion: EvaluacionMuestra.FalsoPositivo, usuarioId: c.usuarioId, ahora: dia(3) });

    const prueba = await pruebaDeRegla(c.tx, c.lain, { minimo: 5 });

    // A2 apareció en la primera corrida pero no en la segunda.
    expect(prueba.muestras.map((m) => m.archivo)).toEqual(["src/A0.cs", "src/A1.cs"]);
    expect(prueba.muestras[0]).toMatchObject({
      repositorio: "lainco/dico",
      linea: 12,
      commit: "abc2def0",
      link: "https://github.com/lainco/dico/blob/abc2def0/src/A0.cs#L12",
      evaluacion: EvaluacionMuestra.FalsoPositivo,
      evaluadaPor: "Ana Analista",
      evaluadaEn: dia(3),
    });
    expect(prueba.muestras[1]).toMatchObject({ evaluacion: EvaluacionMuestra.SinEvaluar, evaluadaPor: null });
    expect(prueba.tasa).toEqual({ evaluadas: 1, validas: 0, falsosPositivos: 1, sinEvaluar: 1, tasa: 1 });
    expect(prueba.corridas[0].id).toBe(segunda);
  });

  enTransaccion("muestra hasta el límite de corridas, pero cuenta todas", async (c) => {
    for (let n = 1; n <= 4; n++) {
      await c.corrida(n, 1);
    }

    const prueba = await pruebaDeRegla(c.tx, c.lain, { minimo: 5, limite: 2 });

    expect(prueba.corridas.map((x) => x.iniciadaEn)).toEqual([dia(4), dia(3)]);
    expect(prueba.cuentan).toBe(4);
  });

  // ---------------------------------------------------------------------- panel

  enTransaccion("el panel lista las corridas con sus repositorios y las reglas en prueba", async (c) => {
    await c.corrida(1, 4);
    await c.corrida(2, 2, { sigmaOk: true });

    const panel = await panelDePrueba(c.tx, { minimo: 5 });

    expect(panel.corridas[0]).toMatchObject({ iniciadaEn: dia(2), estado: EstadoCorrida.Terminada, reglas: 2 });
    expect(panel.corridas[0].repositorios.map((r) => [r.repositorio, r.estado])).toEqual([
      ["lainco/dico", EstadoRepositorioPrueba.Ok],
      ["lainco/sigma", EstadoRepositorioPrueba.Ok],
    ]);
    expect(panel.corridas[1].repositorios[1]).toMatchObject({ estado: EstadoRepositorioPrueba.Error, error: "No compiló." });
    const lain = panel.reglas.find((r) => r.id === c.lain)!;
    expect(lain).toMatchObject({ clave: "LAIN991", nombre: "Regla LAIN991", ultimoTotal: 3, cuentan: 2, tasa: { evaluadas: 0 } });
    const s1118 = panel.reglas.find((r) => r.id === c.s1118)!;
    expect(s1118).toMatchObject({ ultimoTotal: 0, cuentan: 2 });
  });

  enTransaccion("una regla en prueba que el job no corrió figura sin total", async (c) => {
    const panel = await panelDePrueba(c.tx, { minimo: 5 });

    expect(panel.reglas.find((r) => r.id === c.lain)).toMatchObject({ ultimoTotal: null, cuentan: 0 });
  });

  // ------------------------------------------------------------------- atención

  enTransaccion("pide atención por los repositorios con error de la última corrida, o porque falló", async (c) => {
    await c.corrida(1, 1, { sigmaOk: true });
    expect(await atencionDePrueba(c.tx)).toEqual({ cantidad: 0, detalle: "" });

    await c.corrida(2, 1);
    expect(await atencionDePrueba(c.tx)).toEqual({ cantidad: 1, detalle: "1 repositorio con error en la última corrida" });

    await c.corrida(3, 1, { terminar: false });
    await c.corrida(4, 1, { sigmaOk: true });
    expect((await atencionDePrueba(c.tx)).cantidad).toBe(0);

    await c.corrida(5, 1, { terminar: false });
    await c.tx.update(corridaPrueba).set({ estado: EstadoCorrida.Fallida, terminadaEn: dia(6), error: "Se cortó." }).where(eq(corridaPrueba.estado, EstadoCorrida.EnCurso));
    expect(await atencionDePrueba(c.tx)).toEqual({ cantidad: 1, detalle: "la última corrida falló" });
  });

  // ------------------------------------------------------------------- evaluar

  enTransaccion("evaluar una muestra guarda quién y cuándo; volver a sin evaluar lo borra", async (c) => {
    await c.corrida(1, 1);
    const [m] = await c.tx.select().from(muestraPrueba).where(eq(muestraPrueba.reglaId, c.lain));

    expect(await evaluarMuestra(c.tx, { muestraId: m.id, evaluacion: EvaluacionMuestra.Valida, usuarioId: c.usuarioId, ahora: dia(2) })).toBe(true);
    let [despues] = await c.tx.select().from(muestraPrueba).where(eq(muestraPrueba.id, m.id));
    expect(despues).toMatchObject({ evaluacion: EvaluacionMuestra.Valida, evaluadaPorId: c.usuarioId, evaluadaEn: dia(2) });

    await evaluarMuestra(c.tx, { muestraId: m.id, evaluacion: EvaluacionMuestra.SinEvaluar, usuarioId: c.usuarioId, ahora: dia(3) });
    [despues] = await c.tx.select().from(muestraPrueba).where(eq(muestraPrueba.id, m.id));
    expect(despues).toMatchObject({ evaluacion: EvaluacionMuestra.SinEvaluar, evaluadaPorId: null, evaluadaEn: null });
  });

  enTransaccion("evaluar una muestra que no existe no hace nada", async (c) => {
    expect(await evaluarMuestra(c.tx, { muestraId: "8f3b2c3e-0000-4000-8000-000000000000", evaluacion: EvaluacionMuestra.Valida, usuarioId: c.usuarioId })).toBe(false);
  });
});
