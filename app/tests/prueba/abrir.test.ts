import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";
import { AlcanceToken, Estado, EstadoCorrida, Origen, type Estado as TipoEstado, type Origen as TipoOrigen } from "@/dominio/valores";

/**
 * Abrir una corrida de prueba (entrega 6.5, paso 3): qué reglas entran, qué repositorios,
 * qué configuración recibe el job, y la ruta POST /api/ci/prueba/corridas.
 *
 * Necesita DATABASE_URL_PRUEBAS. Cada test corre en una transacción que se descarta. Al
 * empezar, pasa a A revisar las reglas que la base de pruebas tenga En prueba de otros
 * tests, así cada uno ve solo las suyas.
 */

const url = process.env.DATABASE_URL_PRUEBAS;

class Descartada extends Error {}

const AHORA = new Date("2026-10-29T03:00:00Z");
const ENTORNO = { PRUEBA_REPOSITORIOS: "revertpablo/Lainco-quality, lainco/dico" };

describe.skipIf(!url)("abrir una corrida de prueba", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { corridaPrueba, estadoRegla, regla, reglaEnCorrida, repositorioEnCorrida } = await import("@/db/esquema");
  const { crearTokenServicio } = await import("@/servicio/tokensDeServicio");
  const { abrirCorrida } = await import("@/prueba/abrir");
  const { manejarAbrirCorrida } = await import("@/prueba/http");

  interface Contexto {
    tx: Db;
    tokenId: string;
    token: string;
    regla(origen: TipoOrigen, clave: string, estado?: TipoEstado, cambios?: Partial<typeof regla.$inferInsert>): Promise<string>;
    pedido(cuerpo?: unknown, encabezados?: Record<string, string>): Request;
  }

  function enTransaccion(nombre: string, prueba: (c: Contexto) => Promise<void>) {
    it(nombre, async () => {
      const resultado = obtenerDb().transaction(async (transaccion) => {
        const tx = transaccion as unknown as Db;
        await tx.update(estadoRegla).set({ estado: Estado.ARevisar }).where(eq(estadoRegla.estado, Estado.EnPrueba));
        const creado = await crearTokenServicio(tx, { nombre: "job-de-prueba-abrir", alcance: AlcanceToken.Prueba, dias: 30, ahora: new Date(AHORA.getTime() - 86_400_000) });

        await prueba({
          tx,
          tokenId: creado.id,
          token: creado.token,
          async regla(origen, clave, estado = Estado.EnPrueba, cambios = {}) {
            const lenguaje = clave.startsWith("typescript:") || origen === Origen.Eslint ? "ts" : "cs";
            const [creada] = await tx
              .insert(regla)
              .values({ origen, clave, lenguaje, nombre: `Regla ${clave}`, hashDescripcion: "x", ...cambios })
              .returning({ id: regla.id });
            await tx.insert(estadoRegla).values({ reglaId: creada.id, estado });
            return creada.id;
          },
          pedido(cuerpo = {}, encabezados = {}) {
            return new Request("https://app.test/api/ci/prueba/corridas", {
              method: "POST",
              headers: { authorization: `Bearer ${creado.token}`, "content-type": "application/json", ...encabezados },
              body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
            });
          },
        });
        throw new Descartada();
      });
      await expect(resultado).rejects.toBeInstanceOf(Descartada);
    });
  }

  const abrir = (c: Contexto, cambios: Partial<Parameters<typeof abrirCorrida>[0]> = {}) =>
    abrirCorrida({ db: c.tx, tokenId: c.tokenId, repositorios: ["revertpablo/lainco-quality", "lainco/dico"], ahora: AHORA, ...cambios });

  // ------------------------------------------------------------------- abrirCorrida

  enTransaccion("abre la corrida con las reglas En prueba de C# y los repositorios, pendientes", async (c) => {
    const s1118 = await c.regla(Origen.Sonar, "csharpsquid:S1118");
    const lain = await c.regla(Origen.Roslyn, "LAIN991");

    const abierta = await abrir(c, { workflowUrl: "https://github.com/revertpablo/Lainco-quality/actions/runs/1", versiones: { sonarAnalyzer: "10.15.0", laincoAnalyzers: "0.2.0" } });

    expect(abierta.corrida).not.toBeNull();
    const id = abierta.corrida!.id;
    expect(abierta.reglas).toEqual([
      { id: lain, clave: "LAIN991", diagnostico: "LAIN991" },
      { id: s1118, clave: "csharpsquid:S1118", diagnostico: "S1118" },
    ]);
    expect(abierta.repositorios).toEqual(["revertpablo/lainco-quality", "lainco/dico"]);
    expect(abierta.globalconfig).toContain("dotnet_diagnostic.S1118.severity = warning");
    expect(abierta.globalconfig).toContain("dotnet_diagnostic.LAIN991.severity = warning");

    const [corrida] = await c.tx.select().from(corridaPrueba).where(eq(corridaPrueba.id, id));
    expect(corrida).toMatchObject({
      estado: EstadoCorrida.EnCurso,
      iniciadaEn: AHORA,
      tokenId: c.tokenId,
      workflowUrl: "https://github.com/revertpablo/Lainco-quality/actions/runs/1",
      versionSonarAnalyzer: "10.15.0",
      versionLaincoAnalyzers: "0.2.0",
    });
    const reglas = await c.tx.select().from(reglaEnCorrida).where(eq(reglaEnCorrida.corridaId, id));
    expect(reglas.map((r) => r.reglaId).sort()).toEqual([s1118, lain].sort());
    const repositorios = await c.tx.select().from(repositorioEnCorrida).where(eq(repositorioEnCorrida.corridaId, id));
    expect(repositorios.map((r) => [r.repositorio, r.estado]).sort()).toEqual([
      ["lainco/dico", null],
      ["revertpablo/lainco-quality", null],
    ]);
  });

  enTransaccion("deja afuera lo que no se prueba con el job de C#", async (c) => {
    const entra = await c.regla(Origen.Sonar, "csharpsquid:S2325");
    const sinSaber = await c.regla(Origen.Sonar, "csharpsquid:S100", Estado.EnPrueba, { probableLocalmente: null });
    const afuera = [
      await c.regla(Origen.Sonar, "csharpsquid:S101", Estado.ARevisar),
      await c.regla(Origen.Sonar, "csharpsquid:S102", Estado.Incorporada),
      await c.regla(Origen.Sonar, "csharpsquid:S103", Estado.EnPrueba, { probableLocalmente: false }),
      await c.regla(Origen.Sonar, "csharpsquid:S104", Estado.EnPrueba, { deprecadaEn: AHORA }),
      await c.regla(Origen.Sonar, "typescript:S1234"),
      await c.regla(Origen.Eslint, "lainco/no-algo"),
      await c.regla(Origen.Roslyn, "LAIN992", Estado.PendienteDeAnalizar),
    ];

    const abierta = await abrir(c);

    const ids = abierta.reglas.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([entra, sinSaber]));
    for (const id of afuera) {
      expect(ids).not.toContain(id);
    }
    expect(abierta.globalconfig).not.toMatch(/S101|S102|S103|S104|S1234/);
  });

  enTransaccion("sin reglas En prueba no abre corrida", async (c) => {
    await c.regla(Origen.Sonar, "csharpsquid:S2325", Estado.ARevisar);
    const antes = await c.tx.$count(corridaPrueba);

    const abierta = await abrir(c);

    expect(abierta).toEqual({ corrida: null, reglas: [], repositorios: [], globalconfig: null });
    expect(await c.tx.$count(corridaPrueba)).toBe(antes);
  });

  enTransaccion("una corrida anterior que quedó en curso pasa a fallida, con el motivo", async (c) => {
    await c.regla(Origen.Roslyn, "LAIN991");
    const vieja = await abrir(c, { ahora: new Date(AHORA.getTime() - 86_400_000) });

    await abrir(c);

    const [corrida] = await c.tx.select().from(corridaPrueba).where(eq(corridaPrueba.id, vieja.corrida!.id));
    expect(corrida).toMatchObject({ estado: EstadoCorrida.Fallida, terminadaEn: AHORA });
    expect(corrida.error).toMatch(/No terminó/);
  });

  enTransaccion("también la cierra aunque esta vez no haya reglas para probar", async (c) => {
    const lain = await c.regla(Origen.Roslyn, "LAIN991");
    const vieja = await abrir(c, { ahora: new Date(AHORA.getTime() - 86_400_000) });
    await c.tx.update(estadoRegla).set({ estado: Estado.Incorporada }).where(eq(estadoRegla.reglaId, lain));

    await abrir(c);

    const [corrida] = await c.tx.select().from(corridaPrueba).where(eq(corridaPrueba.id, vieja.corrida!.id));
    expect(corrida.estado).toBe(EstadoCorrida.Fallida);
  });

  enTransaccion("una corrida ya terminada no se toca", async (c) => {
    await c.regla(Origen.Roslyn, "LAIN991");
    const vieja = await abrir(c, { ahora: new Date(AHORA.getTime() - 86_400_000) });
    const fin = new Date(AHORA.getTime() - 3_600_000);
    await c.tx.update(corridaPrueba).set({ estado: EstadoCorrida.Terminada, terminadaEn: fin }).where(eq(corridaPrueba.id, vieja.corrida!.id));

    await abrir(c);

    const [corrida] = await c.tx.select().from(corridaPrueba).where(eq(corridaPrueba.id, vieja.corrida!.id));
    expect(corrida).toMatchObject({ estado: EstadoCorrida.Terminada, terminadaEn: fin });
  });

  // ------------------------------------------------------- POST /api/ci/prueba/corridas

  const manejar = (c: Contexto, pedido: Request, entorno: Record<string, string | undefined> = ENTORNO) =>
    manejarAbrirCorrida(pedido, { db: c.tx, ahora: AHORA, entorno });

  enTransaccion("la ruta abre la corrida y devuelve lo que necesita el job", async (c) => {
    await c.regla(Origen.Roslyn, "LAIN991");

    const respuesta = await manejar(c, c.pedido({ workflowUrl: "https://github.com/revertpablo/Lainco-quality/actions/runs/7", versiones: { sonarAnalyzer: "10.15.0" } }));

    expect(respuesta.status).toBe(201);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toMatchObject({
      corrida: { id: expect.any(String), iniciadaEn: AHORA.toISOString() },
      repositorios: ["revertpablo/lainco-quality", "lainco/dico"],
      reglas: [{ clave: "LAIN991", diagnostico: "LAIN991" }],
      globalconfig: expect.stringContaining("dotnet_diagnostic.LAIN991.severity = warning"),
    });
    const [corrida] = await c.tx.select().from(corridaPrueba).where(eq(corridaPrueba.id, cuerpo.corrida.id));
    expect(corrida).toMatchObject({ versionSonarAnalyzer: "10.15.0", versionLaincoAnalyzers: null });
  });

  enTransaccion("sin reglas para probar responde 200 sin corrida", async (c) => {
    const respuesta = await manejar(c, c.pedido());

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toMatchObject({ corrida: null, mensaje: expect.stringMatching(/En prueba/) });
  });

  enTransaccion("sin un token válido, 401 y no abre nada", async (c) => {
    await c.regla(Origen.Roslyn, "LAIN991");
    const antes = await c.tx.$count(corridaPrueba);

    for (const authorization of ["", "Bearer otro", `Bearer lqs_${"x".repeat(43)}`]) {
      expect((await manejar(c, c.pedido({}, { authorization }))).status).toBe(401);
    }
    expect(await c.tx.$count(corridaPrueba)).toBe(antes);
  });

  enTransaccion("un cuerpo que no es JSON o no tiene la forma esperada: 415 o 400", async (c) => {
    await c.regla(Origen.Roslyn, "LAIN991");

    expect((await manejar(c, c.pedido({}, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await manejar(c, c.pedido("{ no es json"))).status).toBe(400);
    for (const cuerpo of [{ workflowUrl: "no es una url" }, { workflowUrl: "http://otro.sitio/x" }, { otroCampo: 1 }, { versiones: { sonarAnalyzer: 10 } }, []]) {
      const respuesta = await manejar(c, c.pedido(cuerpo));
      expect(respuesta.status, JSON.stringify(cuerpo)).toBe(400);
    }
    expect(await c.tx.$count(corridaPrueba, eq(corridaPrueba.tokenId, c.tokenId))).toBe(0);
  });

  enTransaccion("sin PRUEBA_REPOSITORIOS, 500 con un mensaje que la nombra, y no abre nada", async (c) => {
    await c.regla(Origen.Roslyn, "LAIN991");

    const respuesta = await manejar(c, c.pedido(), {});

    expect(respuesta.status).toBe(500);
    expect((await respuesta.json()).mensaje).toMatch(/PRUEBA_REPOSITORIOS/);
    expect(await c.tx.$count(corridaPrueba, eq(corridaPrueba.tokenId, c.tokenId))).toBe(0);
  });
});
