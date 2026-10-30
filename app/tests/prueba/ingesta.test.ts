import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";
import { identidadDeMuestra } from "@/dominio/prueba";
import {
  AlcanceToken,
  Estado,
  EstadoCorrida,
  EstadoRepositorioPrueba,
  EvaluacionMuestra,
  Origen,
  Rol,
  type Estado as TipoEstado,
  type Origen as TipoOrigen,
} from "@/dominio/valores";

/**
 * Ingesta de resultados del job de prueba (entrega 6.5, paso 5): la ruta
 * POST /api/ci/prueba/corridas/{id}/resultados, de punta a punta contra la base. Cantidades
 * por regla, muestras (E6), reglas que se pueden probar (E7), envíos repetidos, el fin de la
 * corrida y los rechazos.
 *
 * Necesita DATABASE_URL_PRUEBAS. Cada test corre en una transacción que se descarta; al
 * empezar pasa a En análisis las reglas que la base tenga En prueba de otros tests.
 */

const url = process.env.DATABASE_URL_PRUEBAS;

class Descartada extends Error {}

const AHORA = new Date("2026-10-29T03:00:00Z");
const DESPUES = new Date("2026-10-29T03:30:00Z");
const DISPONIBLES = ["LAIN991", "S100", "S1118"];

interface Ubicacion {
  archivo: string;
  linea: number;
  columna: number;
  mensaje: string;
}

const u = (archivo: string, mensaje: string, linea = 1): Ubicacion => ({ archivo, linea, columna: 5, mensaje });

describe.skipIf(!url)("ingesta de resultados de prueba", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { corridaPrueba, estadoRegla, muestraPrueba, regla, repositorioEnCorrida, resultadoPrueba, usuario } = await import("@/db/esquema");
  const { crearTokenServicio } = await import("@/servicio/tokensDeServicio");
  const { abrirCorrida } = await import("@/prueba/abrir");
  const { manejarResultados } = await import("@/prueba/http");

  interface Contexto {
    tx: Db;
    token: string;
    corridaId: string;
    reglas: { lain: string; s1118: string; s9001: string; s100: string; s101: string; ts: string };
    /** Manda un resultado; devuelve la respuesta y su cuerpo. */
    enviar(cuerpo: unknown, opciones?: { corridaId?: string; token?: string; ahora?: Date }): Promise<{ status: number; json: Record<string, unknown> }>;
    /** Abre otra corrida (la anterior queda fallida si seguía en curso). */
    abrirOtra(ahora: Date): Promise<string>;
    muestras(reglaId: string): Promise<(typeof muestraPrueba.$inferSelect)[]>;
  }

  function enTransaccion(nombre: string, prueba: (c: Contexto) => Promise<void>) {
    it(nombre, async () => {
      const resultado = obtenerDb().transaction(async (transaccion) => {
        const tx = transaccion as unknown as Db;
        await tx.update(estadoRegla).set({ estado: Estado.EnAnalisis }).where(eq(estadoRegla.estado, Estado.EnPrueba));
        const creado = await crearTokenServicio(tx, { nombre: "job-de-prueba-ingesta", alcance: AlcanceToken.Prueba, dias: 30, ahora: new Date(AHORA.getTime() - 86_400_000) });

        const nueva = async (origen: TipoOrigen, clave: string, estado: TipoEstado, lenguaje: "cs" | "ts" = "cs") => {
          const [r] = await tx.insert(regla).values({ origen, clave, lenguaje, nombre: clave, hashDescripcion: "x" }).returning({ id: regla.id });
          await tx.insert(estadoRegla).values({ reglaId: r.id, estado });
          return r.id;
        };
        const reglas = {
          lain: await nueva(Origen.Roslyn, "LAIN991", Estado.EnPrueba),
          s1118: await nueva(Origen.Sonar, "csharpsquid:S1118", Estado.EnPrueba),
          s9001: await nueva(Origen.Sonar, "csharpsquid:S9001", Estado.EnPrueba),
          s100: await nueva(Origen.Sonar, "csharpsquid:S100", Estado.EnAnalisis),
          s101: await nueva(Origen.Sonar, "csharpsquid:S101", Estado.EnAnalisis),
          ts: await nueva(Origen.Sonar, "typescript:S1118", Estado.EnPrueba, "ts"),
        };
        const repositorios = [
          { repositorio: "lainco/dico", solucion: null },
          { repositorio: "lainco/sigma", solucion: null },
        ];
        const abrir = async (ahora: Date) => (await abrirCorrida({ db: tx, tokenId: creado.id, repositorios, ahora })).corrida!.id;
        const corridaId = await abrir(AHORA);

        await prueba({
          tx,
          token: creado.token,
          corridaId,
          reglas,
          async enviar(cuerpo, opciones = {}) {
            const pedido = new Request(`https://app.test/api/ci/prueba/corridas/${opciones.corridaId ?? corridaId}/resultados`, {
              method: "POST",
              headers: { authorization: `Bearer ${opciones.token ?? creado.token}`, "content-type": "application/json" },
              body: JSON.stringify(cuerpo),
            });
            const respuesta = await manejarResultados(pedido, opciones.corridaId ?? corridaId, { db: tx, ahora: opciones.ahora ?? DESPUES });
            return { status: respuesta.status, json: await respuesta.json() };
          },
          abrirOtra: abrir,
          muestras: (reglaId) => tx.select().from(muestraPrueba).where(eq(muestraPrueba.reglaId, reglaId)).orderBy(muestraPrueba.archivo),
        });
        throw new Descartada();
      });
      await expect(resultado).rejects.toBeInstanceOf(Descartada);
    });
  }

  /** Un resultado como el que arma reducir-sarif.mjs: todas las reglas de la corrida, cero incluido. */
  const ok = (cambios: Record<string, unknown> = {}, reglas?: { diagnostico: string; cantidad: number; ubicaciones: Ubicacion[] }[]) => ({
    repositorio: "lainco/dico",
    commit: "0b83618abcdef",
    estado: "ok",
    diagnosticosDisponibles: DISPONIBLES,
    reglas: reglas ?? [
      { diagnostico: "LAIN991", cantidad: 2, ubicaciones: [u("src/A.cs", "En 'Dico.A'", 3), u("src/B.cs", "En 'Dico.B'", 4)] },
      { diagnostico: "S1118", cantidad: 0, ubicaciones: [] },
      { diagnostico: "S9001", cantidad: 0, ubicaciones: [] },
    ],
    ...cambios,
  });

  // ------------------------------------------------------------------------ resultados

  enTransaccion("guarda las cantidades por regla, cero incluido, y las muestras con su referencia", async (c) => {
    const { status, json } = await c.enviar(ok());

    expect(status).toBe(200);
    expect(json).toMatchObject({ corrida: { id: c.corridaId, estado: EstadoCorrida.EnCurso }, repositorio: "lainco/dico", estado: "ok", resultados: 2, muestras: 2, faltan: ["lainco/sigma"] });
    const resultados = await c.tx.select().from(resultadoPrueba).where(eq(resultadoPrueba.corridaId, c.corridaId));
    expect(resultados.map((r) => [r.reglaId, r.repositorio, r.cantidad]).sort()).toEqual(
      [
        [c.reglas.lain, "lainco/dico", 2],
        [c.reglas.s1118, "lainco/dico", 0],
      ].sort(),
    );
    const muestras = await c.muestras(c.reglas.lain);
    expect(muestras.map((m) => ({ archivo: m.archivo, linea: m.linea, columna: m.columna, mensaje: m.mensaje, commit: m.commit, evaluacion: m.evaluacion }))).toEqual([
      { archivo: "src/A.cs", linea: 3, columna: 5, mensaje: "En 'Dico.A'", commit: "0b83618abcdef", evaluacion: EvaluacionMuestra.SinEvaluar },
      { archivo: "src/B.cs", linea: 4, columna: 5, mensaje: "En 'Dico.B'", commit: "0b83618abcdef", evaluacion: EvaluacionMuestra.SinEvaluar },
    ]);
    expect(muestras.every((m) => m.primeraCorridaId === c.corridaId && m.ultimaCorridaId === c.corridaId)).toBe(true);
    const [repositorio] = await c.tx.select().from(repositorioEnCorrida).where(and(eq(repositorioEnCorrida.corridaId, c.corridaId), eq(repositorioEnCorrida.repositorio, "lainco/dico")));
    expect(repositorio).toMatchObject({ estado: EstadoRepositorioPrueba.Ok, commit: "0b83618abcdef", recibidoEn: DESPUES, error: null });
  });

  enTransaccion("una regla que el analyzer no trae no tiene resultado: no se probó (E7)", async (c) => {
    await c.enviar(ok());

    const s9001 = await c.tx.select().from(resultadoPrueba).where(eq(resultadoPrueba.reglaId, c.reglas.s9001));
    expect(s9001).toEqual([]);
  });

  enTransaccion("marca qué reglas de Sonar para C# se pueden probar, estén o no en la corrida (E7)", async (c) => {
    await c.enviar(ok());

    const probable = async (id: string) => (await c.tx.select({ p: regla.probableLocalmente }).from(regla).where(eq(regla.id, id)))[0].p;
    expect(await probable(c.reglas.s1118)).toBe(true);
    expect(await probable(c.reglas.s100)).toBe(true);
    expect(await probable(c.reglas.s9001)).toBe(false);
    expect(await probable(c.reglas.s101)).toBe(false);
    // Las de TypeScript y las propias no se tocan.
    expect(await probable(c.reglas.ts)).toBeNull();
    expect(await probable(c.reglas.lain)).toBeNull();
  });

  enTransaccion("sin ninguna regla de Sonar en la lista, no marca nada (no confunde un error del job con reglas que faltan)", async (c) => {
    await c.enviar(ok({ diagnosticosDisponibles: ["LAIN991"] }));

    const marcadas = await c.tx.select({ p: regla.probableLocalmente }).from(regla).where(eq(regla.id, c.reglas.s101));
    expect(marcadas[0].p).toBeNull();
    // Y la S1118 tampoco se dio por no probada: sin lista de Sonar no se sabe.
    expect(await c.tx.select().from(resultadoPrueba).where(eq(resultadoPrueba.reglaId, c.reglas.s1118))).toHaveLength(1);
  });

  enTransaccion("un repositorio que no se pudo analizar queda con su error", async (c) => {
    const { status, json } = await c.enviar({ repositorio: "lainco/sigma", estado: "error", error: "No compiló: falta el feed privado.", commit: "abc1234" });

    expect(status).toBe(200);
    expect(json).toMatchObject({ estado: "error", resultados: 0, muestras: 0, faltan: ["lainco/dico"] });
    const [repositorio] = await c.tx.select().from(repositorioEnCorrida).where(and(eq(repositorioEnCorrida.corridaId, c.corridaId), eq(repositorioEnCorrida.repositorio, "lainco/sigma")));
    expect(repositorio).toMatchObject({ estado: EstadoRepositorioPrueba.Error, error: "No compiló: falta el feed privado.", commit: "abc1234", recibidoEn: DESPUES });
  });

  enTransaccion("cuando llegan todos los repositorios, la corrida termina", async (c) => {
    await c.enviar(ok());
    const { json } = await c.enviar({ repositorio: "lainco/sigma", estado: "error", error: "No se pudo clonar." });

    expect(json).toMatchObject({ corrida: { estado: EstadoCorrida.Terminada }, faltan: [] });
    const [corrida] = await c.tx.select().from(corridaPrueba).where(eq(corridaPrueba.id, c.corridaId));
    expect(corrida).toMatchObject({ estado: EstadoCorrida.Terminada, terminadaEn: DESPUES, error: null });
  });

  enTransaccion("repetir el envío de un repositorio reemplaza lo anterior, sin duplicar", async (c) => {
    await c.enviar(ok());
    const { status } = await c.enviar(
      ok({}, [
        { diagnostico: "LAIN991", cantidad: 1, ubicaciones: [u("src/A.cs", "En 'Dico.A'", 7)] },
        { diagnostico: "S1118", cantidad: 3, ubicaciones: [u("src/C.cs", "Clase C")] },
        { diagnostico: "S9001", cantidad: 0, ubicaciones: [] },
      ]),
    );

    expect(status).toBe(200);
    const resultados = await c.tx.select().from(resultadoPrueba).where(eq(resultadoPrueba.corridaId, c.corridaId));
    expect(resultados.map((r) => [r.reglaId, r.cantidad]).sort()).toEqual(
      [
        [c.reglas.lain, 1],
        [c.reglas.s1118, 3],
      ].sort(),
    );
    // La muestra de A.cs es la misma (línea nueva); la de B.cs ya no está en esta corrida pero no se borra.
    const muestras = await c.muestras(c.reglas.lain);
    expect(muestras.map((m) => [m.archivo, m.linea])).toEqual([
      ["src/A.cs", 7],
      ["src/B.cs", 4],
    ]);
  });

  enTransaccion("un repositorio que pasó a error después de ok pierde sus resultados", async (c) => {
    await c.enviar(ok());
    await c.enviar({ repositorio: "lainco/dico", estado: "error", error: "Se cortó." });

    expect(await c.tx.select().from(resultadoPrueba).where(eq(resultadoPrueba.corridaId, c.corridaId))).toEqual([]);
  });

  // -------------------------------------------------------------------------- muestras

  enTransaccion("guarda hasta 20 muestras por regla y repositorio; la cantidad es la real", async (c) => {
    const ubicaciones = Array.from({ length: 50 }, (_, i) => u(`src/A${String(i).padStart(2, "0")}.cs`, `Clase ${i}`));
    const { json } = await c.enviar(
      ok({}, [
        { diagnostico: "LAIN991", cantidad: 75, ubicaciones },
        { diagnostico: "S1118", cantidad: 0, ubicaciones: [] },
        { diagnostico: "S9001", cantidad: 0, ubicaciones: [] },
      ]),
    );

    expect(json).toMatchObject({ muestras: 20 });
    expect((await c.muestras(c.reglas.lain)).map((m) => m.archivo)).toEqual(ubicaciones.slice(0, 20).map((x) => x.archivo));
    const [r] = await c.tx.select().from(resultadoPrueba).where(eq(resultadoPrueba.reglaId, c.reglas.lain));
    expect(r.cantidad).toBe(75);
  });

  enTransaccion("en la corrida siguiente, las evaluadas vuelven primero y conservan la evaluación (E6)", async (c) => {
    const [evaluador] = await c.tx.insert(usuario).values({ nombre: "Analista", email: "prueba-ingesta@laincosoftware.com", rol: Rol.Analista }).returning();
    const ubicaciones = Array.from({ length: 30 }, (_, i) => u(`src/A${String(i).padStart(2, "0")}.cs`, `Clase ${i}`, 10));
    const cuerpo = (lineas: number, conS9001: boolean) =>
      ok({}, [
        { diagnostico: "LAIN991", cantidad: 30, ubicaciones: ubicaciones.map((x) => ({ ...x, linea: lineas })) },
        { diagnostico: "S1118", cantidad: 0, ubicaciones: [] },
        ...(conS9001 ? [{ diagnostico: "S9001", cantidad: 0, ubicaciones: [] }] : []),
      ]);
    await c.enviar(cuerpo(10, true));
    // Una muestra evaluada de una corrida anterior que hoy queda en el puesto 28.
    await c.tx.insert(muestraPrueba).values({
      reglaId: c.reglas.lain,
      repositorio: "lainco/dico",
      archivo: "src/A28.cs",
      mensaje: "Clase 28",
      linea: 2,
      commit: "viejo",
      primeraCorridaId: c.corridaId,
      ultimaCorridaId: c.corridaId,
      evaluacion: EvaluacionMuestra.FalsoPositivo,
      evaluadaPorId: evaluador.id,
      evaluadaEn: AHORA,
    });
    const primera = c.corridaId;
    const otra = await c.abrirOtra(new Date(DESPUES.getTime() + 86_400_000));

    // La S9001 ya no entra: la primera corrida la marcó como no probable (E7).
    const { status } = await c.enviar(cuerpo(12, false), { corridaId: otra, ahora: new Date(DESPUES.getTime() + 86_500_000) });
    expect(status).toBe(200);

    const deLaSegunda = (await c.muestras(c.reglas.lain)).filter((m) => m.ultimaCorridaId === otra);
    expect(deLaSegunda).toHaveLength(20);
    const a28 = deLaSegunda.find((m) => m.archivo === "src/A28.cs")!;
    expect(a28).toMatchObject({ evaluacion: EvaluacionMuestra.FalsoPositivo, evaluadaPorId: evaluador.id, linea: 12, commit: "0b83618abcdef", primeraCorridaId: primera });
    const a00 = deLaSegunda.find((m) => m.archivo === "src/A00.cs")!;
    expect(a00).toMatchObject({ primeraCorridaId: primera, linea: 12 });
    // La A19 entró en la primera corrida y en la segunda le cedió el lugar a la A28.
    expect(deLaSegunda.some((m) => m.archivo === "src/A19.cs")).toBe(false);
    expect(identidadDeMuestra({ reglaId: c.reglas.lain, repositorio: "lainco/dico", archivo: a28.archivo, mensaje: a28.mensaje })).toContain("A28");
  });

  // -------------------------------------------------------------------------- rechazos

  enTransaccion("sin un token válido, 401 y no cambia nada", async (c) => {
    const { status } = await c.enviar(ok(), { token: `lqs_${"x".repeat(43)}` });

    expect(status).toBe(401);
    expect(await c.tx.select().from(resultadoPrueba).where(eq(resultadoPrueba.corridaId, c.corridaId))).toEqual([]);
  });

  enTransaccion("una corrida que no existe: 404", async (c) => {
    expect((await c.enviar(ok(), { corridaId: "8f3b2c3e-0000-4000-8000-000000000000" })).status).toBe(404);
    expect((await c.enviar(ok(), { corridaId: "no-es-un-uuid" })).status).toBe(404);
  });

  enTransaccion("una corrida que ya terminó o falló: 409", async (c) => {
    await c.abrirOtra(DESPUES);

    const { status, json } = await c.enviar(ok());

    expect(status).toBe(409);
    expect(json.mensaje).toMatch(/fallida/);
  });

  enTransaccion("un repositorio que no es de la corrida: 422", async (c) => {
    const { status, json } = await c.enviar(ok({ repositorio: "lainco/otro" }));

    expect(status).toBe(422);
    expect(json.error).toBe("repositorioAjeno");
  });

  enTransaccion("las reglas tienen que ser exactamente las de la corrida: 422", async (c) => {
    const sinS9001 = ok({}, [
      { diagnostico: "LAIN991", cantidad: 0, ubicaciones: [] },
      { diagnostico: "S1118", cantidad: 0, ubicaciones: [] },
    ]);
    const conOtra = ok({}, [
      { diagnostico: "LAIN991", cantidad: 0, ubicaciones: [] },
      { diagnostico: "S1118", cantidad: 0, ubicaciones: [] },
      { diagnostico: "S9001", cantidad: 0, ubicaciones: [] },
      { diagnostico: "S2325", cantidad: 1, ubicaciones: [u("a.cs", "x")] },
    ]);

    for (const cuerpo of [sinS9001, conOtra]) {
      const { status, json } = await c.enviar(cuerpo);
      expect(status).toBe(422);
      expect(json.error).toBe("reglasDistintas");
    }
  });

  enTransaccion("un cuerpo mal formado: 400 con el detalle", async (c) => {
    const regla = (cambios: Record<string, unknown>) =>
      ok({}, [
        { diagnostico: "LAIN991", cantidad: 1, ubicaciones: [u("src/A.cs", "x")], ...cambios },
        { diagnostico: "S1118", cantidad: 0, ubicaciones: [] },
        { diagnostico: "S9001", cantidad: 0, ubicaciones: [] },
      ]);
    const invalidos = [
      ok({ estado: "otro" }),
      ok({ commit: "no es un sha" }),
      ok({ repositorio: "lainco" }),
      regla({ cantidad: -1 }),
      regla({ cantidad: 0 }),
      regla({ ubicaciones: [u("/home/runner/work/dico/src/A.cs", "x")] }),
      regla({ ubicaciones: [u("src/A.cs", "   ")] }),
      regla({ ubicaciones: [{ ...u("src/A.cs", "x"), linea: 0 }] }),
      regla({ cantidad: 300, ubicaciones: Array.from({ length: 201 }, (_, i) => u(`a${i}.cs`, "x")) }),
      { repositorio: "lainco/dico", estado: "error" },
    ];
    for (const cuerpo of invalidos) {
      const { status, json } = await c.enviar(cuerpo);
      expect(status, JSON.stringify(cuerpo).slice(0, 200)).toBe(400);
      expect(json.error).toBe("pedidoInvalido");
    }
  });
});
