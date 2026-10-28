import { asc, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AccionPublicacion,
  Estado,
  EstadoPublicacion,
  Origen,
  Rol,
  TipoDesvio,
} from "@/dominio/valores";

/**
 * Tablas de la publicación a Sonar contra una base real (entrega 6.2, paso 1): la cola
 * `publicacion` y los desvíos. Lo que se prueba son las restricciones de la base, que
 * cuidan los datos aunque el código tenga un error.
 *
 * Necesita DATABASE_URL_PRUEBAS. Usa reglas `PRUEBA-PUB-` (origen eslint, que ningún test sincroniza) y el usuario
 * `prueba-pub-`, y los borra al terminar.
 */

const url = process.env.DATABASE_URL_PRUEBAS;
const PREFIJO = "PRUEBA-PUB-";

describe.skipIf(!url)("tablas de la publicación a Sonar", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const esquema = await import("@/db/esquema");
  const { accionPublicacion, decision, desvio, estadoPublicacion, estadoRegla, publicacion, regla, tipoDesvio, usuario } = esquema;

  const db = () => obtenerDb();
  let autorId: string;
  let reglaId: string;
  let otraReglaId: string;
  let decisionId: string;

  async function limpiar() {
    const reglas = db().select({ id: regla.id }).from(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(publicacion).where(sql`${publicacion.reglaId} in ${reglas}`);
    await db().delete(desvio).where(like(desvio.clave, `${PREFIJO}%`));
    await db().delete(decision).where(sql`${decision.reglaId} in ${reglas}`);
    await db().delete(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(usuario).where(like(usuario.email, "prueba-pub-%"));
  }

  /** El código de error de Postgres de una operación que tiene que fallar. */
  async function codigoDeError(operacion: () => Promise<unknown>): Promise<string> {
    try {
      await operacion();
    } catch (error) {
      const causa = (error as { cause?: { code?: string; constraint?: string } }).cause;
      return `${causa?.code}:${causa?.constraint}`;
    }
    throw new Error("La operación no falló");
  }

  const pendiente = (cambios: Partial<typeof publicacion.$inferInsert> = {}) =>
    db()
      .insert(publicacion)
      .values({ reglaId, decisionId, pedidaPorId: autorId, ...cambios })
      .returning({ id: publicacion.id });

  beforeAll(async () => {
    await limpiar();
    const [autor] = await db()
      .insert(usuario)
      .values({ nombre: "Paula Publicación", email: "prueba-pub-autor@laincosoftware.com", rol: Rol.Decisor })
      .returning({ id: usuario.id });
    autorId = autor.id;

    const ids: string[] = [];
    for (const clave of ["R1", "R2"]) {
      const [creada] = await db()
        .insert(regla)
        .values({ origen: Origen.Eslint, clave: `${PREFIJO}${clave}`, nombre: clave, lenguaje: "cs", hashDescripcion: "x" })
        .returning({ id: regla.id });
      await db().insert(estadoRegla).values({ reglaId: creada.id, estado: Estado.ARevisar });
      ids.push(creada.id);
    }
    [reglaId, otraReglaId] = ids;

    const [d] = await db()
      .insert(decision)
      .values({ reglaId, estadoAnterior: Estado.PendienteDeAnalizar, estadoNuevo: Estado.ARevisar, autorId })
      .returning({ id: decision.id });
    decisionId = d.id;
  });
  afterAll(async () => {
    await limpiar();
    await db().$client.end();
  });

  it("las tablas de referencia tienen los mismos códigos que el programa, en orden", async () => {
    const codigos = async (tabla: typeof estadoPublicacion | typeof accionPublicacion | typeof tipoDesvio) =>
      (await db().select({ codigo: tabla.codigo }).from(tabla).orderBy(asc(tabla.orden))).map((f) => f.codigo);

    expect(await codigos(estadoPublicacion)).toEqual(Object.values(EstadoPublicacion));
    expect(await codigos(accionPublicacion)).toEqual(Object.values(AccionPublicacion));
    expect(await codigos(tipoDesvio)).toEqual(Object.values(TipoDesvio));
  });

  describe("publicacion", () => {
    it("una publicación nueva queda pendiente, sin intentos y lista para publicarse", async () => {
      const [{ id }] = await pendiente();
      const [fila] = await db().select().from(publicacion).where(eq(publicacion.id, id));

      expect(fila).toMatchObject({ estado: EstadoPublicacion.Pendiente, intentos: 0, accion: null, publicadaEn: null });
      expect(fila.proximoIntentoEn.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      await db().delete(publicacion).where(eq(publicacion.id, id));
    });

    it("una sola pendiente por regla", async () => {
      await pendiente();

      expect(await codigoDeError(() => pendiente())).toBe("23505:publicacionPendienteUnica");
      // Otra regla sí puede tener la suya.
      await pendiente({ reglaId: otraReglaId });
      await db().delete(publicacion).where(sql`${publicacion.reglaId} in (${reglaId}, ${otraReglaId})`);
    });

    it("las publicadas y las fallidas no cuentan: la regla puede volver a encolarse", async () => {
      await pendiente({ estado: EstadoPublicacion.Publicada, accion: AccionPublicacion.Activar, publicadaEn: new Date() });
      await pendiente({ estado: EstadoPublicacion.Fallida, intentos: 5, ultimoError: "Sonar no responde" });
      await pendiente();

      const filas = await db().select({ estado: publicacion.estado }).from(publicacion).where(eq(publicacion.reglaId, reglaId));
      expect(filas.map((f) => f.estado).sort()).toEqual(["fallida", "pendiente", "publicada"]);
      await db().delete(publicacion).where(eq(publicacion.reglaId, reglaId));
    });

    it.each<[string, Partial<typeof publicacion.$inferInsert>, string]>([
      ["sin decisión ni desvío", { decisionId: null }, "23514:publicacionPorDecisionODesvio"],
      ["publicada sin fecha", { estado: EstadoPublicacion.Publicada, accion: AccionPublicacion.Activar }, "23514:publicacionPublicadaConFecha"],
      ["con fecha de publicada sin estar publicada", { publicadaEn: new Date() }, "23514:publicacionPublicadaConFecha"],
      ["publicada sin acción", { estado: EstadoPublicacion.Publicada, publicadaEn: new Date() }, "23514:publicacionPublicadaConAccion"],
      ["con intentos negativos", { intentos: -1 }, "23514:publicacionIntentosNoNegativos"],
      ["con un estado que no existe", { estado: "enCurso" as EstadoPublicacion }, "23503:publicacionEstado"],
      ["con una acción que no existe", { accion: "borrar" as AccionPublicacion }, "23503:publicacionAccion"],
    ])("rechaza una publicación %s", async (_caso, cambios, error) => {
      expect(await codigoDeError(() => pendiente(cambios))).toBe(error);
    });

    it("la pide una decisión o un desvío, no los dos", async () => {
      const [d] = await db()
        .insert(desvio)
        .values({ tipo: TipoDesvio.IncorporadaInactiva, lenguaje: "cs", clave: `${PREFIJO}R1`, reglaId })
        .returning({ id: desvio.id });

      expect(await codigoDeError(() => pendiente({ desvioId: d.id }))).toBe("23514:publicacionPorDecisionODesvio");
      const [{ id }] = await pendiente({ decisionId: null, desvioId: d.id });
      expect(id).toBeTruthy();
      await db().delete(publicacion).where(eq(publicacion.id, id));
      await db().delete(desvio).where(eq(desvio.id, d.id));
    });

    it("se borra con su regla", async () => {
      const [creada] = await db()
        .insert(regla)
        .values({ origen: Origen.Eslint, clave: `${PREFIJO}BORRAR`, nombre: "x", lenguaje: "cs", hashDescripcion: "x" })
        .returning({ id: regla.id });
      const [d] = await db()
        .insert(desvio)
        .values({ tipo: TipoDesvio.IncorporadaInactiva, lenguaje: "cs", clave: `${PREFIJO}BORRAR`, reglaId: creada.id })
        .returning({ id: desvio.id });
      await db().insert(publicacion).values({ reglaId: creada.id, desvioId: d.id, pedidaPorId: autorId });

      await db().delete(regla).where(eq(regla.id, creada.id));

      expect(await db().select().from(publicacion).where(eq(publicacion.reglaId, creada.id))).toEqual([]);
      expect(await db().select().from(desvio).where(eq(desvio.id, d.id))).toEqual([]);
    });
  });

  describe("desvio", () => {
    const abierto = (cambios: Partial<typeof desvio.$inferInsert> = {}) =>
      db()
        .insert(desvio)
        .values({ tipo: TipoDesvio.ActivaSinIncorporar, lenguaje: "cs", clave: `${PREFIJO}S100`, ...cambios })
        .returning({ id: desvio.id });

    it("puede no tener regla: una activada a mano puede no estar en el inventario", async () => {
      const [{ id }] = await abierto({ detalle: { encontrado: { severidad: "MAJOR" } } });
      const [fila] = await db().select().from(desvio).where(eq(desvio.id, id));

      expect(fila).toMatchObject({ reglaId: null, resueltoEn: null, detalle: { encontrado: { severidad: "MAJOR" } } });
      await db().delete(desvio).where(eq(desvio.id, id));
    });

    it("el mismo desvío abierto una sola vez; resuelto, puede volver a abrirse", async () => {
      const [{ id }] = await abierto();

      expect(await codigoDeError(() => abierto())).toBe("23505:desvioAbiertoUnico");
      // Otro tipo u otro lenguaje sobre la misma clave es otro desvío.
      const otros = [await abierto({ tipo: TipoDesvio.SeveridadDistinta }), await abierto({ lenguaje: "ts" })];

      await db().update(desvio).set({ resueltoEn: new Date() }).where(eq(desvio.id, id));
      const [{ id: reabierto }] = await abierto();
      expect(reabierto).not.toBe(id);

      await db().delete(desvio).where(like(desvio.clave, `${PREFIJO}S100`));
      expect(otros).toHaveLength(2);
    });

    it("no se puede ver antes de detectarlo", async () => {
      expect(
        await codigoDeError(() => abierto({ detectadoEn: new Date(), vistoEn: new Date(Date.now() - 60_000) })),
      ).toBe("23514:desvioVistoDespuesDeDetectado");
    });

    it("rechaza un tipo que no existe", async () => {
      expect(await codigoDeError(() => abierto({ tipo: "otro" as TipoDesvio }))).toBe("23503:desvioTipo");
    });
  });
});
