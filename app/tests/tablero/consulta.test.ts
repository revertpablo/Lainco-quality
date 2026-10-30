import { eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Estado, Origen, Rol } from "@/dominio/valores";

/**
 * Consultas del tablero de progreso contra una base real (entrega 6.1, paso 11).
 *
 * Necesita DATABASE_URL_PRUEBAS. Usa reglas `PRUEBA-TAB-` con origen normaIa (ningún otro
 * test usa ese origen, así los conteos se pueden mirar aunque los tests corran en
 * paralelo) y el usuario `prueba-tab-`, y los borra al terminar.
 */

const url = process.env.DATABASE_URL_PRUEBAS;
const PREFIJO = "PRUEBA-TAB-";

describe.skipIf(!url)("consultas del tablero de progreso", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { decision, estadoRegla, regla, usuario } = await import("@/db/esquema");
  const { conteosPorEstado, reglasEstancadas, referencias } = await import("@/tablero/consulta");

  const db = () => obtenerDb();
  let autorId: string;

  /** clave, lenguaje, tipo, estado, hace cuántos días entró al estado */
  const REGLAS = [
    ["P1", "cs", "BUG", Estado.PendienteDeAnalizar, 100],
    ["P2", "cs", "BUG", Estado.PendienteDeAnalizar, 100],
    ["R1", "cs", "BUG", Estado.EnAnalisis, 20],
    ["R2", "cs", "CODE_SMELL", Estado.EnAnalisis, 3],
    ["E1", "ts", null, Estado.EnPrueba, 40],
    ["E2", "ts", null, Estado.EnPrueba, 15],
    ["I1", "ts", "BUG", Estado.Incorporada, 300],
    ["D1", "ts", "BUG", Estado.Descartada, 300],
  ] as const;

  async function limpiar() {
    const viejas = db().select({ id: regla.id }).from(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(decision).where(sql`${decision.reglaId} in ${viejas}`);
    await db().delete(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(usuario).where(like(usuario.email, "prueba-tab-%"));
  }

  beforeAll(async () => {
    await limpiar();
    const [autor] = await db()
      .insert(usuario)
      .values({ nombre: "Tamara Tablero", email: "prueba-tab-autor@laincosoftware.com", rol: Rol.Analista })
      .returning({ id: usuario.id });
    autorId = autor.id;
    const [otro] = await db()
      .insert(usuario)
      .values({ nombre: "Otro Autor", email: "prueba-tab-otro@laincosoftware.com", rol: Rol.Analista })
      .returning({ id: usuario.id });

    for (const [clave, lenguaje, tipo, estado, dias] of REGLAS) {
      const [creada] = await db()
        .insert(regla)
        .values({ origen: Origen.NormaIa, clave: `${PREFIJO}${clave}`, nombre: `Regla ${clave}`, lenguaje, tipo, hashDescripcion: "x" })
        .returning({ id: regla.id });
      const desde = sql`now() - make_interval(days => ${dias}, hours => 1)`;
      await db().insert(estadoRegla).values({ reglaId: creada.id, estado, actualizadoEn: desde });
      if (clave === "E1") {
        // Antes pasó por En análisis, de la mano de otra persona: "quién la pasó" es el último.
        await db().insert(decision).values({
          reglaId: creada.id,
          estadoAnterior: Estado.PendienteDeAnalizar,
          estadoNuevo: Estado.EnAnalisis,
          autorId: otro.id,
          fecha: sql`now() - make_interval(days => 60)`,
        });
        await db().insert(decision).values({
          reglaId: creada.id,
          estadoAnterior: Estado.EnAnalisis,
          estadoNuevo: estado,
          autorId,
          fecha: desde,
        });
      } else if (estado !== Estado.PendienteDeAnalizar) {
        await db().insert(decision).values({
          reglaId: creada.id,
          estadoAnterior: Estado.PendienteDeAnalizar,
          estadoNuevo: estado,
          autorId,
          fecha: desde,
        });
      }
    }
  });
  afterAll(async () => {
    await limpiar();
    await db().$client.end();
  });

  it("cuenta las reglas por lenguaje, tipo, origen y estado", async () => {
    const propios = (await conteosPorEstado(db())).filter((c) => c.origen === Origen.NormaIa);
    const clave = (c: { lenguaje: string; tipo: string | null; estado: string }) => `${c.lenguaje}/${c.tipo ?? "-"}/${c.estado}`;

    expect(Object.fromEntries(propios.map((c) => [clave(c), c.cantidad]))).toEqual({
      "cs/BUG/pendienteDeAnalizar": 2,
      "cs/BUG/enAnalisis": 1,
      "cs/CODE_SMELL/enAnalisis": 1,
      "ts/-/enPrueba": 2,
      "ts/BUG/incorporada": 1,
      "ts/BUG/descartada": 1,
    });
  });

  it("estancadas: solo En análisis y En prueba con más de N días, de la más vieja a la más nueva", async () => {
    const claves = async (dias: number) =>
      (await reglasEstancadas(db(), dias)).filter((r) => r.clave.startsWith(PREFIJO)).map((r) => r.clave.slice(PREFIJO.length));

    expect(await claves(14)).toEqual(["E1", "R1", "E2"]);
    expect(await claves(30)).toEqual(["E1"]);
    expect(await claves(2)).toEqual(["E1", "R1", "E2", "R2"]);
    expect(await claves(60)).toEqual([]);
  });

  it("cada estancada dice desde cuándo, cuántos días y quién la pasó", async () => {
    const [e1] = (await reglasEstancadas(db(), 30)).filter((r) => r.clave === `${PREFIJO}E1`);

    expect(e1).toMatchObject({
      nombre: "Regla E1",
      lenguaje: "ts",
      estado: Estado.EnPrueba,
      estadoDescripcion: "En prueba",
      dias: 40,
      autor: "Tamara Tablero",
    });
    expect(e1.desde).toBeInstanceOf(Date);
    expect(Date.now() - e1.desde.getTime()).toBeGreaterThan(40 * 86_400_000);
  });

  it("al pasar de estado deja de estar estancada", async () => {
    const [r1] = await db().select({ id: regla.id }).from(regla).where(eq(regla.clave, `${PREFIJO}R1`));
    await db().update(estadoRegla).set({ estado: Estado.EnPrueba, actualizadoEn: sql`now()` }).where(eq(estadoRegla.reglaId, r1.id));

    expect((await reglasEstancadas(db(), 14)).map((r) => r.clave)).not.toContain(`${PREFIJO}R1`);
  });

  it("los textos de referencia vienen en el orden de sus tablas", async () => {
    const { estados, lenguajes, origenes } = await referencias(db());

    expect(estados.map((e) => e.codigo)).toEqual(Object.values(Estado));
    expect(lenguajes.map((l) => l.codigo)).toEqual(["cs", "ts"]);
    expect(origenes.map((o) => o.codigo)).toContain(Origen.NormaIa);
  });
});
