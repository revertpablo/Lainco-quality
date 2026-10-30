import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";
import { AlcanceToken, Estado, Origen, Rol, type Estado as TipoEstado, type Origen as TipoOrigen } from "@/dominio/valores";

/**
 * El ciclo de vida con la prueba de reglas (entrega 6.5, paso 7), contra la base:
 * En prueba → Incorporada exige el mínimo de corridas desde que la regla entró en prueba
 * (decisión E3), y una regla que no se puede probar no entra a En prueba (decisión E7).
 *
 * Necesita DATABASE_URL_PRUEBAS. Cada test corre en una transacción que se descarta.
 */

const url = process.env.DATABASE_URL_PRUEBAS;

class Descartada extends Error {}

const MINIMO = 3;

describe.skipIf(!url)("ciclo de vida con la prueba de reglas", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { corridaPrueba, decision, estadoRegla, regla, usuario } = await import("@/db/esquema");
  const { crearTokenServicio } = await import("@/servicio/tokensDeServicio");
  const { abrirCorrida } = await import("@/prueba/abrir");
  const { registrarResultado } = await import("@/prueba/ingesta");
  const { aplicarTransicion } = await import("@/transiciones/aplicarTransicion");

  interface Contexto {
    tx: Db;
    decisor: { id: string; rol: Rol };
    regla(origen: TipoOrigen, clave: string, estado: TipoEstado, cambios?: Partial<typeof regla.$inferInsert>): Promise<string>;
    /** Pasa la regla a otro estado como lo haría un usuario. */
    mover(id: string, desde: TipoEstado, hacia: TipoEstado, opciones?: { masiva?: boolean }): ReturnType<typeof aplicarTransicion>;
    /** Una corrida terminada con resultados de las reglas En prueba que el job corre. */
    corrida(): Promise<void>;
  }

  function enTransaccion(nombre: string, prueba: (c: Contexto) => Promise<void>) {
    it(nombre, async () => {
      const resultado = obtenerDb().transaction(async (transaccion) => {
        const tx = transaccion as unknown as Db;
        await tx.update(estadoRegla).set({ estado: Estado.EnAnalisis }).where(eq(estadoRegla.estado, Estado.EnPrueba));
        const token = await crearTokenServicio(tx, { nombre: "job-ciclo", alcance: AlcanceToken.Prueba, dias: 30 });
        const [decisor] = await tx
          .insert(usuario)
          .values({ nombre: "Decisora", email: "prueba-ciclo@laincosoftware.com", rol: Rol.Decisor })
          .returning({ id: usuario.id, rol: usuario.rol });

        const mover: Contexto["mover"] = async (id, desde, hacia, { masiva = false } = {}) => {
          // Solo las de Sonar eligen severidad al incorporarse; las propias traen la suya (R3).
          const [{ origen }] = await tx.select({ origen: regla.origen }).from(regla).where(eq(regla.id, id));
          const severidad = hacia === Estado.Incorporada && origen === Origen.Sonar ? "MAJOR" : undefined;
          return aplicarTransicion(tx, decisor, { reglas: [{ id, desde }], hacia, justificacion: "Probada en el código real.", severidad, masiva }, { minimoDeCorridas: MINIMO });
        };

        await prueba({
          tx,
          decisor,
          async regla(origen, clave, estado, cambios = {}) {
            const lenguaje = origen === Origen.Eslint || clave.startsWith("typescript:") ? "ts" : "cs";
            const [r] = await tx.insert(regla).values({ origen, clave, lenguaje, nombre: clave, hashDescripcion: "x", severidadDefault: "warning", ...cambios }).returning({ id: regla.id });
            await tx.insert(estadoRegla).values({ reglaId: r.id, estado });
            return r.id;
          },
          mover,
          async corrida() {
            const { corrida, reglas } = await abrirCorrida({ db: tx, tokenId: token.id, repositorios: [{ repositorio: "lainco/dico", solucion: null }] });
            if (!corrida) {
              return;
            }
            await registrarResultado({
              db: tx,
              corridaId: corrida.id,
              resultado: {
                repositorio: "lainco/dico",
                commit: "0b83618",
                estado: "ok",
                diagnosticosDisponibles: reglas.map((r) => r.diagnostico),
                reglas: reglas.map((r) => ({ diagnostico: r.diagnostico, cantidad: 0, ubicaciones: [] })),
              },
            });
          },
        });
        throw new Descartada();
      });
      await expect(resultado).rejects.toBeInstanceOf(Descartada);
    });
  }

  const motivos = (r: Awaited<ReturnType<Contexto["mover"]>>) => (r.ok ? [] : r.tipo === "rechazada" ? r.rechazos.flatMap((x) => x.motivos) : [r.tipo]);

  // --------------------------------------------------------- En prueba → Incorporada

  enTransaccion("una regla propia en prueba se incorpora recién con el mínimo de corridas", async (c) => {
    const id = await c.regla(Origen.Roslyn, "LAIN991", Estado.EnAnalisis);
    expect((await c.mover(id, Estado.EnAnalisis, Estado.EnPrueba)).ok).toBe(true);
    await c.corrida();
    await c.corrida();

    const antes = await c.mover(id, Estado.EnPrueba, Estado.Incorporada);
    expect(motivos(antes)).toEqual(["faltanResultadosDePrueba"]);

    await c.corrida();
    expect((await c.mover(id, Estado.EnPrueba, Estado.Incorporada)).ok).toBe(true);
  });

  enTransaccion("una de Sonar para C# también", async (c) => {
    const id = await c.regla(Origen.Sonar, "csharpsquid:S1118", Estado.EnAnalisis);
    await c.mover(id, Estado.EnAnalisis, Estado.EnPrueba);
    for (let i = 0; i < MINIMO - 1; i++) {
      await c.corrida();
    }
    expect(motivos(await c.mover(id, Estado.EnPrueba, Estado.Incorporada))).toEqual(["faltanResultadosDePrueba"]);
    await c.corrida();
    expect((await c.mover(id, Estado.EnPrueba, Estado.Incorporada)).ok).toBe(true);
  });

  enTransaccion("las corridas de una vuelta anterior por En prueba no cuentan", async (c) => {
    const id = await c.regla(Origen.Roslyn, "LAIN991", Estado.EnAnalisis);
    await c.mover(id, Estado.EnAnalisis, Estado.EnPrueba);
    for (let i = 0; i < MINIMO; i++) {
      await c.corrida();
    }
    // Vuelve a En análisis y entra de nuevo: hay que juntar las corridas otra vez.
    await c.mover(id, Estado.EnPrueba, Estado.EnAnalisis);
    const vuelta = await c.mover(id, Estado.EnAnalisis, Estado.EnPrueba);
    // Dentro de la transacción del test now() es siempre el mismo instante: la segunda
    // entrada se fecha ahora, después de las corridas de la primera vuelta.
    await c.tx.update(decision).set({ fecha: new Date() }).where(eq(decision.id, vuelta.ok ? vuelta.decisiones[0].decisionId : ""));
    await c.corrida();

    expect(motivos(await c.mover(id, Estado.EnPrueba, Estado.Incorporada))).toEqual(["faltanResultadosDePrueba"]);
  });

  enTransaccion("las corridas que fallaron no cuentan", async (c) => {
    const id = await c.regla(Origen.Roslyn, "LAIN991", Estado.EnAnalisis);
    await c.mover(id, Estado.EnAnalisis, Estado.EnPrueba);
    await c.corrida();
    await c.corrida();
    // Una corrida que se abre y no termina.
    await abrirCorrida({ db: c.tx, tokenId: (await c.tx.select().from(corridaPrueba).limit(1))[0].tokenId, repositorios: [{ repositorio: "lainco/dico", solucion: null }] });
    await c.tx.update(corridaPrueba).set({ estado: "fallida", terminadaEn: new Date(), error: "Se cortó." }).where(eq(corridaPrueba.estado, "enCurso"));

    expect(motivos(await c.mover(id, Estado.EnPrueba, Estado.Incorporada))).toEqual(["faltanResultadosDePrueba"]);
  });

  enTransaccion("desde En análisis se incorpora sin prueba", async (c) => {
    const id = await c.regla(Origen.Roslyn, "LAIN991", Estado.EnAnalisis);

    expect((await c.mover(id, Estado.EnAnalisis, Estado.Incorporada)).ok).toBe(true);
  });

  enTransaccion("una regla que el job de C# todavía no corre (TypeScript, ESLint) no queda trabada en prueba", async (c) => {
    for (const [origen, clave] of [
      [Origen.Sonar, "typescript:S1118"],
      [Origen.Eslint, "lainco/no-algo"],
    ] as const) {
      const id = await c.regla(origen, clave, Estado.EnPrueba);
      expect((await c.mover(id, Estado.EnPrueba, Estado.Incorporada)).ok, clave).toBe(true);
    }
  });

  // ------------------------------------------------------------------ hacia En prueba

  enTransaccion("una regla de Sonar que no está en SonarAnalyzer.CSharp no entra a En prueba", async (c) => {
    const id = await c.regla(Origen.Sonar, "csharpsquid:S9001", Estado.EnAnalisis, { probableLocalmente: false });

    expect(motivos(await c.mover(id, Estado.EnAnalisis, Estado.EnPrueba))).toEqual(["noSePuedeProbar"]);
    expect((await c.mover(id, Estado.EnAnalisis, Estado.Incorporada)).ok).toBe(true);
  });

  enTransaccion("en una operación masiva, una regla que no se puede probar frena el lote entero", async (c) => {
    const se = await c.regla(Origen.Sonar, "csharpsquid:S100", Estado.EnAnalisis, { probableLocalmente: true });
    const noSe = await c.regla(Origen.Sonar, "csharpsquid:S9001", Estado.EnAnalisis, { probableLocalmente: false });

    const resultado = await aplicarTransicion(
      c.tx,
      c.decisor,
      { reglas: [{ id: se, desde: Estado.EnAnalisis }, { id: noSe, desde: Estado.EnAnalisis }], hacia: Estado.EnPrueba, masiva: true },
      { minimoDeCorridas: MINIMO },
    );

    expect(resultado).toMatchObject({ ok: false, tipo: "rechazada", rechazos: [{ reglaId: noSe, motivos: ["noSePuedeProbar"] }] });
    const [estado] = await c.tx.select().from(estadoRegla).where(eq(estadoRegla.reglaId, se));
    expect(estado.estado).toBe(Estado.EnAnalisis);
  });

  enTransaccion("si todavía no se sabe si se puede probar, entra", async (c) => {
    const id = await c.regla(Origen.Sonar, "csharpsquid:S100", Estado.EnAnalisis, { probableLocalmente: null });

    expect((await c.mover(id, Estado.EnAnalisis, Estado.EnPrueba)).ok).toBe(true);
  });
});
