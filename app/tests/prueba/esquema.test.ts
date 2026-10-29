import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";
import { AlcanceToken, EstadoCorrida, EstadoRepositorioPrueba, EvaluacionMuestra, Origen, Rol } from "@/dominio/valores";

/**
 * Tablas de la prueba de reglas contra una base real (entrega 6.5, paso 2): corridas, sus
 * reglas y repositorios, resultados y muestras. Lo que se prueba son las restricciones de la
 * base, que cuidan los datos aunque el código de la ingesta tenga un error.
 *
 * Necesita DATABASE_URL_PRUEBAS. Cada test corre en una transacción que se descarta; cada
 * operación que tiene que fallar, en un savepoint.
 */

const url = process.env.DATABASE_URL_PRUEBAS;

class Descartada extends Error {}

describe.skipIf(!url)("tablas de la prueba de reglas", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { corridaPrueba, muestraPrueba, regla, reglaEnCorrida, repositorioEnCorrida, resultadoPrueba, tokenServicio, usuario } = await import("@/db/esquema");

  interface Contexto {
    tx: Db;
    corridaId: string;
    reglaId: string;
    /** Una regla que la corrida no incluyó. */
    otraReglaId: string;
    evaluadorId: string;
    /** Que la operación falle por la restricción indicada, sin abortar la transacción del test. */
    falla(restriccion: string, operacion: (tx: Db) => Promise<unknown>): Promise<void>;
    muestra(cambios?: Partial<typeof muestraPrueba.$inferInsert>): typeof muestraPrueba.$inferInsert;
  }

  function enTransaccion(nombre: string, prueba: (c: Contexto) => Promise<void>) {
    it(nombre, async () => {
      const resultado = obtenerDb().transaction(async (transaccion) => {
        const tx = transaccion as unknown as Db;
        const [token] = await tx
          .insert(tokenServicio)
          .values({ nombre: "prueba-esquema", alcance: AlcanceToken.Prueba, hash: "a".repeat(64), prefijo: "lqs_aaaaaa", expiraEn: new Date(Date.now() + 86_400_000) })
          .returning();
        const [corrida] = await tx.insert(corridaPrueba).values({ tokenId: token.id }).returning();
        const reglas = await tx
          .insert(regla)
          .values(
            ["LAIN991", "LAIN992"].map((clave) => ({ origen: Origen.Roslyn, clave, lenguaje: "cs" as const, nombre: clave, hashDescripcion: "x", severidadDefault: "warning" })),
          )
          .returning({ id: regla.id });
        await tx.insert(reglaEnCorrida).values({ corridaId: corrida.id, reglaId: reglas[0].id });
        await tx.insert(repositorioEnCorrida).values({ corridaId: corrida.id, repositorio: "lainco/dico" });
        const [evaluador] = await tx.insert(usuario).values({ nombre: "Evaluador", email: "prueba-esquema-prueba@laincosoftware.com", rol: Rol.Analista }).returning();

        await prueba({
          tx,
          corridaId: corrida.id,
          reglaId: reglas[0].id,
          otraReglaId: reglas[1].id,
          evaluadorId: evaluador.id,
          async falla(restriccion, operacion) {
            await expect(tx.transaction((sp) => operacion(sp as unknown as Db))).rejects.toMatchObject({ cause: { constraint: restriccion } });
          },
          muestra: (cambios = {}) => ({
            reglaId: reglas[0].id,
            repositorio: "lainco/dico",
            archivo: "src/Dominio/Pedido.cs",
            mensaje: "El constructor sin parámetros de 'Dico.Pedido' debe ser protected",
            linea: 14,
            commit: "0b83618",
            primeraCorridaId: corrida.id,
            ultimaCorridaId: corrida.id,
            ...cambios,
          }),
        });
        throw new Descartada();
      });
      await expect(resultado).rejects.toBeInstanceOf(Descartada);
    });
  }

  // ------------------------------------------------------------------- corridas

  enTransaccion("una corrida terminada o fallida tiene fecha de fin, y una fallida, su error", async (c) => {
    const { tx, corridaId } = c;
    const cambiar = (cambios: Partial<typeof corridaPrueba.$inferInsert>) => (sp: Db) => sp.update(corridaPrueba).set(cambios).where(eq(corridaPrueba.id, corridaId));

    await c.falla("corridaPruebaTerminadaConFecha", cambiar({ estado: EstadoCorrida.Terminada }));
    await c.falla("corridaPruebaTerminadaConFecha", cambiar({ terminadaEn: new Date() }));
    await c.falla("corridaPruebaFallidaConError", cambiar({ estado: EstadoCorrida.Fallida, terminadaEn: new Date() }));
    await c.falla("corridaPruebaFallidaConError", cambiar({ estado: EstadoCorrida.Terminada, terminadaEn: new Date(), error: "x" }));

    await cambiar({ estado: EstadoCorrida.Fallida, terminadaEn: new Date(), error: "La reemplazó una corrida nueva." })(tx);
    const [corrida] = await tx.select().from(corridaPrueba).where(eq(corridaPrueba.id, corridaId));
    expect(corrida.estado).toBe(EstadoCorrida.Fallida);
  });

  // -------------------------------------------------------------- repositorios

  enTransaccion("un repositorio va como owner/repo en minúsculas", async (c) => {
    for (const repositorio of ["Lainco/Dico", "lainco", "lainco/dico/otro", "https://github.com/lainco/dico", ""]) {
      await c.falla("repositorioEnCorridaFormato", (sp) => sp.insert(repositorioEnCorrida).values({ corridaId: c.corridaId, repositorio }));
    }
    await c.tx.insert(repositorioEnCorrida).values({ corridaId: c.corridaId, repositorio: "lainco/lainco-quality.v2_x" });
  });

  enTransaccion("un repositorio informado tiene fecha; uno analizado, su commit; uno con error, el motivo", async (c) => {
    const informar = (cambios: Partial<typeof repositorioEnCorrida.$inferInsert>) => (sp: Db) =>
      sp.update(repositorioEnCorrida).set(cambios).where(eq(repositorioEnCorrida.corridaId, c.corridaId));

    await c.falla("repositorioEnCorridaRecibidoConEstado", informar({ estado: EstadoRepositorioPrueba.Ok, commit: "abc" }));
    await c.falla("repositorioEnCorridaOkConCommit", informar({ estado: EstadoRepositorioPrueba.Ok, recibidoEn: new Date() }));
    await c.falla("repositorioEnCorridaErrorConMotivo", informar({ estado: EstadoRepositorioPrueba.Error, recibidoEn: new Date() }));
    await c.falla("repositorioEnCorridaErrorConMotivo", informar({ estado: EstadoRepositorioPrueba.Ok, recibidoEn: new Date(), commit: "abc", error: "x" }));

    await informar({ estado: EstadoRepositorioPrueba.Error, recibidoEn: new Date(), error: "No compiló: falta el feed privado." })(c.tx);
  });

  // ---------------------------------------------------------------- resultados

  enTransaccion("un resultado es de un repositorio y una regla de la corrida, y no es negativo", async (c) => {
    const resultado = (cambios: Partial<typeof resultadoPrueba.$inferInsert>) => (sp: Db) =>
      sp.insert(resultadoPrueba).values({ corridaId: c.corridaId, repositorio: "lainco/dico", reglaId: c.reglaId, cantidad: 3, ...cambios });

    await c.falla("resultadoPruebaRepositorio", resultado({ repositorio: "lainco/otro" }));
    await c.falla("resultadoPruebaRegla", resultado({ reglaId: c.otraReglaId }));
    await c.falla("resultadoPruebaCantidadNoNegativa", resultado({ cantidad: -1 }));

    await resultado({ cantidad: 0 })(c.tx);
    await c.falla("resultadoPruebaPk", resultado({ cantidad: 2 }));
  });

  enTransaccion("borrar una corrida borra sus reglas, repositorios y resultados", async (c) => {
    await c.tx.insert(resultadoPrueba).values({ corridaId: c.corridaId, repositorio: "lainco/dico", reglaId: c.reglaId, cantidad: 3 });

    await c.tx.delete(corridaPrueba).where(eq(corridaPrueba.id, c.corridaId));

    expect(await c.tx.select().from(resultadoPrueba).where(eq(resultadoPrueba.corridaId, c.corridaId))).toEqual([]);
    expect(await c.tx.select().from(reglaEnCorrida).where(eq(reglaEnCorrida.corridaId, c.corridaId))).toEqual([]);
    expect(await c.tx.select().from(repositorioEnCorrida).where(eq(repositorioEnCorrida.corridaId, c.corridaId))).toEqual([]);
  });

  // ------------------------------------------------------------------ muestras

  enTransaccion("una muestra es una sola por regla, repositorio, archivo y mensaje, aunque cambie la línea", async (c) => {
    await c.tx.insert(muestraPrueba).values(c.muestra());

    await c.falla("muestraPruebaIdentidad", (sp) => sp.insert(muestraPrueba).values(c.muestra({ linea: 20, commit: "otro" })));
    await c.tx.insert(muestraPrueba).values(c.muestra({ mensaje: "El constructor sin parámetros de 'Dico.Cliente' debe ser protected" }));
  });

  enTransaccion("una muestra guarda una referencia al código, no código", async (c) => {
    for (const archivo of ["/home/runner/work/dico/Pedido.cs", "src\\Pedido.cs", ""]) {
      await c.falla("muestraPruebaArchivoRelativo", (sp) => sp.insert(muestraPrueba).values(c.muestra({ archivo })));
    }
    await c.falla("muestraPruebaRepositorio", (sp) => sp.insert(muestraPrueba).values(c.muestra({ repositorio: "Lainco/Dico" })));
    await c.falla("muestraPruebaMensajeSinEspaciosDeMas", (sp) => sp.insert(muestraPrueba).values(c.muestra({ mensaje: " con espacios " })));
    await c.falla("muestraPruebaPosicion", (sp) => sp.insert(muestraPrueba).values(c.muestra({ linea: 0 })));
    await c.falla("muestraPruebaPosicion", (sp) => sp.insert(muestraPrueba).values(c.muestra({ columna: 0 })));
  });

  enTransaccion("una muestra evaluada dice quién y cuándo; una sin evaluar, no", async (c) => {
    const [muestra] = await c.tx.insert(muestraPrueba).values(c.muestra()).returning();
    const evaluar = (cambios: Partial<typeof muestraPrueba.$inferInsert>) => (sp: Db) => sp.update(muestraPrueba).set(cambios).where(eq(muestraPrueba.id, muestra.id));

    await c.falla("muestraPruebaEvaluadaConAutor", evaluar({ evaluacion: EvaluacionMuestra.FalsoPositivo }));
    await c.falla("muestraPruebaEvaluadaConAutor", evaluar({ evaluacion: EvaluacionMuestra.Valida, evaluadaPorId: c.evaluadorId }));
    await c.falla("muestraPruebaEvaluadaConAutor", evaluar({ evaluadaPorId: c.evaluadorId, evaluadaEn: new Date() }));

    await evaluar({ evaluacion: EvaluacionMuestra.FalsoPositivo, evaluadaPorId: c.evaluadorId, evaluadaEn: new Date() })(c.tx);
    await evaluar({ evaluacion: EvaluacionMuestra.SinEvaluar, evaluadaPorId: null, evaluadaEn: null })(c.tx);
  });
});
