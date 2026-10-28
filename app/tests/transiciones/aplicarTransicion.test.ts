import { and, asc, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Estado, Origen, Rol, type Estado as TipoEstado } from "@/dominio/valores";

/**
 * `aplicarTransicion` contra una base real (entrega 6.1, paso 7). Es la única función que
 * cambia el estado de una regla: valida con src/dominio/transiciones.ts y escribe
 * `estadoRegla` y `decision` en la misma transacción.
 *
 * Criterio del paso: "Un intento de incorporación masiva se rechaza."
 *
 * Necesita DATABASE_URL_PRUEBAS (ver tests/auth/usuarios.test.ts). Usa reglas de origen
 * normaIa (ningún test lo sincroniza y, como en Sonar, al incorporar se elige la severidad)
 * con clave `PRUEBA-TRANS-` y un analista `prueba-trans-`; los borra al empezar y al terminar.
 */

const url = process.env.DATABASE_URL_PRUEBAS;
const PREFIJO = "PRUEBA-TRANS-";

describe.skipIf(!url)("aplicarTransicion contra la base", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { decision, estadoRegla, regla, usuario } = await import("@/db/esquema");
  const { aplicarTransicion } = await import("@/transiciones/aplicarTransicion");

  const db = () => obtenerDb();

  let analista: { id: string; rol: Rol };
  let decisor: { id: string; rol: Rol };

  async function limpiar() {
    const mias = db().select({ id: regla.id }).from(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(decision).where(inArray(decision.reglaId, mias));
    await db().delete(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(usuario).where(like(usuario.email, "prueba-trans-%"));
  }

  /** Crea reglas de prueba en los estados indicados y devuelve sus ids, en orden. */
  async function reglas(...estados: TipoEstado[]): Promise<string[]> {
    const ids: string[] = [];
    for (const [i, estado] of estados.entries()) {
      const [creada] = await db()
        .insert(regla)
        .values({
          origen: Origen.NormaIa,
          clave: `${PREFIJO}${i}`,
          lenguaje: "cs",
          nombre: `Regla de prueba ${i}`,
          hashDescripcion: "x",
          parametros: [{ clave: "max", descripcion: "Máximo" }],
        })
        .returning({ id: regla.id });
      await db().insert(estadoRegla).values({ reglaId: creada.id, estado });
      ids.push(creada.id);
    }
    return ids;
  }

  async function estadoDe(id: string) {
    const [fila] = await db().select().from(estadoRegla).where(eq(estadoRegla.reglaId, id));
    return fila;
  }

  async function decisionesDe(ids: string[]) {
    return db().select().from(decision).where(inArray(decision.reglaId, ids)).orderBy(asc(decision.fecha));
  }

  beforeEach(async () => {
    await limpiar();
    const [a] = await db()
      .insert(usuario)
      .values({ nombre: "Analista de prueba", email: "prueba-trans-analista@laincosoftware.com" })
      .returning({ id: usuario.id, rol: usuario.rol });
    analista = a;
    const [d] = await db()
      .select({ id: usuario.id, rol: usuario.rol })
      .from(usuario)
      .where(eq(usuario.email, "federico.sanchez@laincosoftware.com"));
    decisor = d;
  });
  afterAll(async () => {
    await limpiar();
    await db().$client.end();
  });

  // ------------------------------------------------------------------- individual

  describe("individual", () => {
    it("un analista pasa una regla de Pendiente a A revisar", async () => {
      const [id] = await reglas(Estado.PendienteDeAnalizar);

      const resultado = await aplicarTransicion(db(), analista, {
        reglas: [{ id, desde: Estado.PendienteDeAnalizar }],
        hacia: Estado.ARevisar,
        masiva: false,
      });

      expect(resultado).toMatchObject({ ok: true, loteId: null });
      expect((await estadoDe(id)).estado).toBe(Estado.ARevisar);
      const [registrada] = await decisionesDe([id]);
      expect(registrada).toMatchObject({
        estadoAnterior: Estado.PendienteDeAnalizar,
        estadoNuevo: Estado.ARevisar,
        autorId: analista.id,
        justificacion: null,
        loteId: null,
        basadaEnSugerencia: false,
      });
      expect(resultado.ok && resultado.decisiones).toEqual([
        { reglaId: id, decisionId: registrada.id, desde: Estado.PendienteDeAnalizar, hacia: Estado.ARevisar },
      ]);
    });

    it("un analista no puede incorporar, y no se escribe nada", async () => {
      const [id] = await reglas(Estado.ARevisar);

      const resultado = await aplicarTransicion(db(), analista, {
        reglas: [{ id, desde: Estado.ARevisar }],
        hacia: Estado.Incorporada,
        justificacion: "Aplica a todo el código",
        severidad: "MAJOR",
        masiva: false,
      });

      expect(resultado).toEqual({
        ok: false,
        tipo: "rechazada",
        rechazos: [{ reglaId: id, motivos: ["requiereRolDecisor"] }],
      });
      expect((await estadoDe(id)).estado).toBe(Estado.ARevisar);
      expect(await decisionesDe([id])).toEqual([]);
    });

    it("un decisor incorpora con justificación, severidad y parámetros", async () => {
      const [id] = await reglas(Estado.ARevisar);

      const resultado = await aplicarTransicion(db(), decisor, {
        reglas: [{ id, desde: Estado.ARevisar }],
        hacia: Estado.Incorporada,
        justificacion: "Bugs reales en el código actual",
        severidad: "CRITICAL",
        parametros: { max: "5" },
        masiva: false,
      });

      expect(resultado.ok).toBe(true);
      expect(await estadoDe(id)).toMatchObject({
        estado: Estado.Incorporada,
        severidadAsignada: "CRITICAL",
        parametros: { max: "5" },
      });
      const [registrada] = await decisionesDe([id]);
      expect(registrada).toMatchObject({
        autorId: decisor.id,
        justificacion: "Bugs reales en el código actual",
        severidad: "CRITICAL",
        parametros: { max: "5" },
      });
    });

    it("la justificación se guarda sin espacios de más", async () => {
      const [id] = await reglas(Estado.PendienteDeAnalizar);

      await aplicarTransicion(db(), analista, {
        reglas: [{ id, desde: Estado.PendienteDeAnalizar }],
        hacia: Estado.Descartada,
        justificacion: "  No usamos WCF  \n",
        masiva: false,
      });

      expect((await decisionesDe([id]))[0].justificacion).toBe("No usamos WCF");
    });

    it("un parámetro que la regla no tiene se rechaza", async () => {
      const [id] = await reglas(Estado.ARevisar);

      const resultado = await aplicarTransicion(db(), decisor, {
        reglas: [{ id, desde: Estado.ARevisar }],
        hacia: Estado.Incorporada,
        justificacion: "x",
        severidad: "MAJOR",
        parametros: { maximo: "5" },
        masiva: false,
      });

      expect(resultado).toEqual({
        ok: false,
        tipo: "rechazada",
        rechazos: [{ reglaId: id, motivos: ["parametroDesconocido"] }],
      });
      expect((await estadoDe(id)).estado).toBe(Estado.ARevisar);
    });

    it("al sacar una regla de Incorporada se borran la severidad y los parámetros asignados", async () => {
      const [id] = await reglas(Estado.ARevisar);
      await aplicarTransicion(db(), decisor, {
        reglas: [{ id, desde: Estado.ARevisar }],
        hacia: Estado.Incorporada,
        justificacion: "x",
        severidad: "MAJOR",
        parametros: { max: "5" },
        masiva: false,
      });

      await aplicarTransicion(db(), decisor, {
        reglas: [{ id, desde: Estado.Incorporada }],
        hacia: Estado.EnPrueba,
        justificacion: "Cambió en Sonar",
        masiva: false,
      });

      expect(await estadoDe(id)).toMatchObject({ estado: Estado.EnPrueba, severidadAsignada: null, parametros: null });
      // El historial conserva con qué severidad estuvo incorporada.
      expect((await decisionesDe([id])).map((d) => d.severidad)).toEqual(["MAJOR", null]);
    });

    it("Pendiente → Incorporada no existe, ni siquiera para un decisor", async () => {
      const [id] = await reglas(Estado.PendienteDeAnalizar);

      const resultado = await aplicarTransicion(db(), decisor, {
        reglas: [{ id, desde: Estado.PendienteDeAnalizar }],
        hacia: Estado.Incorporada,
        justificacion: "x",
        severidad: "MAJOR",
        masiva: false,
      });

      expect(resultado).toMatchObject({ ok: false, rechazos: [{ motivos: ["transicionNoPermitida"] }] });
    });
  });

  // ---------------------------------------------------------------------- masiva

  describe("masiva", () => {
    it("un intento de incorporación masiva se rechaza, aunque la haga un decisor", async () => {
      const ids = await reglas(Estado.ARevisar, Estado.EnPrueba);

      const resultado = await aplicarTransicion(db(), decisor, {
        reglas: [
          { id: ids[0], desde: Estado.ARevisar },
          { id: ids[1], desde: Estado.EnPrueba },
        ],
        hacia: Estado.Incorporada,
        justificacion: "Todas aplican",
        severidad: "MAJOR",
        masiva: true,
      });

      expect(resultado).toEqual({
        ok: false,
        tipo: "rechazada",
        rechazos: ids.map((reglaId) => ({ reglaId, motivos: ["noAdmiteOperacionMasiva"] })),
      });
      expect((await estadoDe(ids[0])).estado).toBe(Estado.ARevisar);
      expect((await estadoDe(ids[1])).estado).toBe(Estado.EnPrueba);
      expect(await decisionesDe(ids)).toEqual([]);
    });

    it("una masiva de una sola regla también es masiva: hacia Incorporada se rechaza", async () => {
      const [id] = await reglas(Estado.ARevisar);

      const resultado = await aplicarTransicion(db(), decisor, {
        reglas: [{ id, desde: Estado.ARevisar }],
        hacia: Estado.Incorporada,
        justificacion: "x",
        severidad: "MAJOR",
        masiva: true,
      });

      expect(resultado).toMatchObject({ ok: false, rechazos: [{ motivos: ["noAdmiteOperacionMasiva"] }] });
    });

    it("un descarte masivo deja la misma justificación y el mismo lote en cada decisión", async () => {
      const ids = await reglas(Estado.PendienteDeAnalizar, Estado.PendienteDeAnalizar, Estado.PendienteDeAnalizar);

      const resultado = await aplicarTransicion(db(), analista, {
        reglas: ids.map((id) => ({ id, desde: Estado.PendienteDeAnalizar })),
        hacia: Estado.Descartada,
        justificacion: "Reglas de Xamarin: no lo usamos",
        masiva: true,
      });

      expect(resultado.ok).toBe(true);
      const loteId = resultado.ok ? resultado.loteId : null;
      expect(loteId).toMatch(/^[0-9a-f-]{36}$/);

      const registradas = await decisionesDe(ids);
      expect(registradas).toHaveLength(3);
      for (const d of registradas) {
        expect(d).toMatchObject({
          estadoAnterior: Estado.PendienteDeAnalizar,
          estadoNuevo: Estado.Descartada,
          autorId: analista.id,
          justificacion: "Reglas de Xamarin: no lo usamos",
          loteId,
        });
      }
      for (const id of ids) {
        expect((await estadoDe(id)).estado).toBe(Estado.Descartada);
      }
    });

    it("las reglas de un lote pueden venir de estados distintos", async () => {
      const ids = await reglas(Estado.PendienteDeAnalizar, Estado.ARevisar);

      const resultado = await aplicarTransicion(db(), analista, {
        reglas: [
          { id: ids[0], desde: Estado.PendienteDeAnalizar },
          { id: ids[1], desde: Estado.ARevisar },
        ],
        hacia: Estado.EnPrueba,
        masiva: true,
      });

      expect(resultado.ok).toBe(true);
      expect((await decisionesDe(ids)).map((d) => d.estadoAnterior).sort()).toEqual(
        [Estado.ARevisar, Estado.PendienteDeAnalizar].sort(),
      );
    });

    it("es todo o nada: si una regla no puede, no cambia ninguna", async () => {
      // Descartar desde Pendiente lo puede hacer un analista; desde A revisar, no.
      const ids = await reglas(Estado.PendienteDeAnalizar, Estado.ARevisar, Estado.PendienteDeAnalizar);

      const resultado = await aplicarTransicion(db(), analista, {
        reglas: [
          { id: ids[0], desde: Estado.PendienteDeAnalizar },
          { id: ids[1], desde: Estado.ARevisar },
          { id: ids[2], desde: Estado.PendienteDeAnalizar },
        ],
        hacia: Estado.Descartada,
        justificacion: "No aplica",
        masiva: true,
      });

      expect(resultado).toEqual({
        ok: false,
        tipo: "rechazada",
        rechazos: [{ reglaId: ids[1], motivos: ["requiereRolDecisor"] }],
      });
      expect(await decisionesDe(ids)).toEqual([]);
      expect((await estadoDe(ids[0])).estado).toBe(Estado.PendienteDeAnalizar);
    });

    it("las mismas reglas de requisitos que de a una: sin justificación no se descarta", async () => {
      const ids = await reglas(Estado.PendienteDeAnalizar, Estado.PendienteDeAnalizar);

      const resultado = await aplicarTransicion(db(), decisor, {
        reglas: ids.map((id) => ({ id, desde: Estado.PendienteDeAnalizar })),
        hacia: Estado.Descartada,
        justificacion: "   ",
        masiva: true,
      });

      expect(resultado).toMatchObject({
        ok: false,
        rechazos: ids.map((reglaId) => ({ reglaId, motivos: ["faltaJustificacion"] })),
      });
    });
  });

  // ----------------------------------------------------------------- concurrencia

  describe("lo que cambió mientras tanto", () => {
    it("si la regla ya no está en el estado que vio el usuario, no se aplica", async () => {
      const [id] = await reglas(Estado.ARevisar);

      const resultado = await aplicarTransicion(db(), decisor, {
        reglas: [{ id, desde: Estado.PendienteDeAnalizar }],
        hacia: Estado.Descartada,
        justificacion: "x",
        masiva: false,
      });

      expect(resultado).toEqual({
        ok: false,
        tipo: "estadoCambio",
        reglas: [{ id, esperado: Estado.PendienteDeAnalizar, actual: Estado.ARevisar }],
      });
      expect(await decisionesDe([id])).toEqual([]);
    });

    it("una regla que no existe se informa", async () => {
      const [id] = await reglas(Estado.PendienteDeAnalizar);
      const inexistente = "00000000-0000-4000-8000-000000000000";

      const resultado = await aplicarTransicion(db(), analista, {
        reglas: [
          { id, desde: Estado.PendienteDeAnalizar },
          { id: inexistente, desde: Estado.PendienteDeAnalizar },
        ],
        hacia: Estado.ARevisar,
        masiva: true,
      });

      expect(resultado).toEqual({ ok: false, tipo: "noEncontradas", reglaIds: [inexistente] });
      expect(await decisionesDe([id])).toEqual([]);
    });

    it("dos cambios a la vez sobre la misma regla: el segundo ve el estado nuevo y no se aplica", async () => {
      const [id] = await reglas(Estado.PendienteDeAnalizar);
      const pedido = (hacia: TipoEstado) =>
        aplicarTransicion(db(), decisor, {
          reglas: [{ id, desde: Estado.PendienteDeAnalizar }],
          hacia,
          justificacion: "x",
          masiva: false,
        });

      const resultados = await Promise.all([pedido(Estado.ARevisar), pedido(Estado.Descartada)]);

      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      expect(resultados.filter((r) => !r.ok)).toMatchObject([{ tipo: "estadoCambio" }]);
      expect(await decisionesDe([id])).toHaveLength(1);
    });

    it("el rol que cuenta es el que recibe la función, no el que se pida", async () => {
      // La API pasa el usuario de la sesión, con el rol leído de la base.
      const [id] = await reglas(Estado.ARevisar);
      const [filaAnalista] = await db()
        .select({ id: usuario.id, rol: usuario.rol })
        .from(usuario)
        .where(and(eq(usuario.id, analista.id)));

      const resultado = await aplicarTransicion(db(), filaAnalista, {
        reglas: [{ id, desde: Estado.ARevisar }],
        hacia: Estado.Descartada,
        justificacion: "x",
        masiva: false,
      });

      expect(resultado).toMatchObject({ ok: false, rechazos: [{ motivos: ["requiereRolDecisor"] }] });
    });
  });
});
