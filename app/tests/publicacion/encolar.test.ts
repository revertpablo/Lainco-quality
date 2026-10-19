import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";
import { EstadoPublicacion, Estado, Origen, Rol, TipoDesvio, type Estado as TipoEstado } from "@/dominio/valores";

/**
 * Encolar la publicación al decidir (entrega 6.2, paso 3): `aplicarTransicion` agrega la
 * fila de `publicacion` en la misma transacción que la decisión, solo cuando una regla de
 * Sonar entra a Incorporada o sale.
 *
 * Criterio del paso: "Incorporar crea una publicación pendiente; retirar también; un
 * descarte masivo desde Pendiente no crea ninguna; si la transición falla, no queda nada
 * encolado."
 *
 * Necesita DATABASE_URL_PRUEBAS. Usa reglas de origen Sonar, que los tests de
 * sincronización borran en paralelo: por eso **cada test corre en una transacción que se
 * descarta al final**. Lo que crea nunca llega a ser visible para los demás tests, y no
 * queda nada que limpiar. `aplicarTransicion` abre la suya adentro, como un savepoint.
 */

const url = process.env.DATABASE_URL_PRUEBAS;
const PREFIJO = "PRUEBA-ENC-";

class Descartada extends Error {}

describe.skipIf(!url)("encolar la publicación al decidir", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { decision, desvio, estadoRegla, publicacion, regla, usuario } = await import("@/db/esquema");
  const { aplicarTransicion } = await import("@/transiciones/aplicarTransicion");

  interface Contexto {
    tx: Db;
    decisor: { id: string; rol: Rol };
    analista: { id: string; rol: Rol };
    /** Crea una regla en ese estado y devuelve su id. */
    regla(estado: TipoEstado, origen?: Origen): Promise<string>;
    publicacionesDe(...reglaIds: string[]): Promise<(typeof publicacion.$inferSelect)[]>;
  }

  /** Corre el test en una transacción que nunca se confirma. */
  function enTransaccion(nombre: string, prueba: (c: Contexto) => Promise<void>) {
    it(nombre, async () => {
      let numero = 0;
      const resultado = obtenerDb().transaction(async (transaccion) => {
        const tx = transaccion as unknown as Db;
        const nuevoUsuario = async (rol: Rol) =>
          (
            await tx
              .insert(usuario)
              .values({ nombre: `Prueba ${rol}`, email: `prueba-enc-${rol}@laincosoftware.com`, rol })
              .returning({ id: usuario.id, rol: usuario.rol })
          )[0];

        await prueba({
          tx,
          decisor: await nuevoUsuario(Rol.Decisor),
          analista: await nuevoUsuario(Rol.Analista),
          async regla(estado, origen = Origen.Sonar) {
            const [creada] = await tx
              .insert(regla)
              .values({ origen, clave: `${PREFIJO}${++numero}`, lenguaje: "cs", nombre: "x", hashDescripcion: "x" })
              .returning({ id: regla.id });
            await tx.insert(estadoRegla).values({ reglaId: creada.id, estado });
            return creada.id;
          },
          publicacionesDe: (...reglaIds) => tx.select().from(publicacion).where(inArray(publicacion.reglaId, reglaIds)),
        });
        throw new Descartada();
      });
      await expect(resultado).rejects.toBeInstanceOf(Descartada);
    });
  }

  const incorporar = (c: Contexto, id: string, desde: TipoEstado = Estado.ARevisar) =>
    aplicarTransicion(c.tx, c.decisor, {
      reglas: [{ id, desde }],
      hacia: Estado.Incorporada,
      severidad: "MAJOR",
      justificacion: "La queremos",
      masiva: false,
    });

  describe("qué decisiones encolan", () => {
    enTransaccion("incorporar deja una publicación pendiente de esa decisión", async (c) => {
      const id = await c.regla(Estado.ARevisar);

      const resultado = await incorporar(c, id);

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      const [pub] = await c.publicacionesDe(id);
      expect(pub).toMatchObject({
        estado: EstadoPublicacion.Pendiente,
        decisionId: resultado.decisiones[0].decisionId,
        desvioId: null,
        pedidaPorId: c.decisor.id,
        intentos: 0,
        ultimoError: null,
        accion: null,
        publicadaEn: null,
      });
      expect(resultado.publicaciones).toEqual([pub.id]);
    });

    enTransaccion("incorporar desde En prueba también", async (c) => {
      const id = await c.regla(Estado.EnPrueba);

      await incorporar(c, id, Estado.EnPrueba);

      expect(await c.publicacionesDe(id)).toHaveLength(1);
    });

    enTransaccion("retirar (Incorporada → Descartada) encola", async (c) => {
      const id = await c.regla(Estado.Incorporada);

      const resultado = await aplicarTransicion(c.tx, c.decisor, {
        reglas: [{ id, desde: Estado.Incorporada }],
        hacia: Estado.Descartada,
        justificacion: "Ya no",
        masiva: false,
      });

      expect(resultado.ok && resultado.publicaciones).toHaveLength(1);
      expect(await c.publicacionesDe(id)).toHaveLength(1);
    });

    enTransaccion("volver a probar (Incorporada → En prueba) encola: En prueba no está activa en Sonar", async (c) => {
      const id = await c.regla(Estado.Incorporada);

      await aplicarTransicion(c.tx, c.decisor, {
        reglas: [{ id, desde: Estado.Incorporada }],
        hacia: Estado.EnPrueba,
        justificacion: "Cambió en Sonar",
        masiva: false,
      });

      expect(await c.publicacionesDe(id)).toHaveLength(1);
    });

    enTransaccion("un descarte masivo desde Pendiente no encola nada", async (c) => {
      const ids = [await c.regla(Estado.PendienteDeAnalizar), await c.regla(Estado.PendienteDeAnalizar), await c.regla(Estado.PendienteDeAnalizar)];

      const resultado = await aplicarTransicion(c.tx, c.analista, {
        reglas: ids.map((id) => ({ id, desde: Estado.PendienteDeAnalizar })),
        hacia: Estado.Descartada,
        justificacion: "No usamos React",
        masiva: true,
      });

      expect(resultado.ok && resultado.publicaciones).toEqual([]);
      expect(await c.publicacionesDe(...ids)).toEqual([]);
    });

    enTransaccion("una transición que no toca Incorporada no encola", async (c) => {
      const id = await c.regla(Estado.ARevisar);

      await aplicarTransicion(c.tx, c.analista, {
        reglas: [{ id, desde: Estado.ARevisar }],
        hacia: Estado.EnPrueba,
        masiva: false,
      });

      expect(await c.publicacionesDe(id)).toEqual([]);
    });

    enTransaccion("una regla que no es de Sonar no se publica en el perfil", async (c) => {
      const id = await c.regla(Estado.ARevisar, Origen.Roslyn);

      const resultado = await incorporar(c, id);

      expect(resultado.ok).toBe(true);
      expect(await c.publicacionesDe(id)).toEqual([]);
    });

    enTransaccion("en un retiro masivo, una publicación por cada regla de Sonar", async (c) => {
      const deSonar = [await c.regla(Estado.Incorporada), await c.regla(Estado.Incorporada)];
      const propia = await c.regla(Estado.Incorporada, Origen.Roslyn);

      const resultado = await aplicarTransicion(c.tx, c.decisor, {
        reglas: [...deSonar, propia].map((id) => ({ id, desde: Estado.Incorporada })),
        hacia: Estado.Descartada,
        justificacion: "Retiro en lote",
        masiva: true,
      });

      expect(resultado.ok && resultado.publicaciones).toHaveLength(2);
      expect((await c.publicacionesDe(...deSonar, propia)).map((p) => p.reglaId).sort()).toEqual([...deSonar].sort());
    });
  });

  describe("si la transición no se aplica, no queda nada encolado", () => {
    enTransaccion("rechazada: un analista no puede incorporar", async (c) => {
      const id = await c.regla(Estado.ARevisar);

      const resultado = await aplicarTransicion(c.tx, c.analista, {
        reglas: [{ id, desde: Estado.ARevisar }],
        hacia: Estado.Incorporada,
        severidad: "MAJOR",
        justificacion: "x",
        masiva: false,
      });

      expect(resultado).toMatchObject({ ok: false, tipo: "rechazada" });
      expect(await c.publicacionesDe(id)).toEqual([]);
    });

    enTransaccion("el estado cambió mientras tanto", async (c) => {
      const id = await c.regla(Estado.EnPrueba);

      const resultado = await incorporar(c, id, Estado.ARevisar);

      expect(resultado).toMatchObject({ ok: false, tipo: "estadoCambio" });
      expect(await c.publicacionesDe(id)).toEqual([]);
    });

    enTransaccion("todo o nada: si una regla del lote no puede, ninguna encola", async (c) => {
      const puede = await c.regla(Estado.Incorporada);
      // De Descartada solo se vuelve a A revisar.
      const noPuede = await c.regla(Estado.Descartada);

      const resultado = await aplicarTransicion(c.tx, c.decisor, {
        reglas: [
          { id: puede, desde: Estado.Incorporada },
          { id: noPuede, desde: Estado.Descartada },
        ],
        hacia: Estado.EnPrueba,
        justificacion: "x",
        masiva: true,
      });

      expect(resultado).toMatchObject({ ok: false, tipo: "rechazada" });
      expect(await c.publicacionesDe(puede, noPuede)).toEqual([]);
    });
  });

  describe("una sola publicación pendiente por regla", () => {
    enTransaccion("si la anterior no se publicó, la nueva decisión la toma y vuelve a intentarse ya", async (c) => {
      const id = await c.regla(Estado.ARevisar);
      const primera = await incorporar(c, id);
      // La primera ya había fallado dos veces y esperaba para reintentar.
      await c.tx
        .update(publicacion)
        .set({ intentos: 2, ultimoError: "Sonar no responde", proximoIntentoEn: sql`now() + interval '1 hour'` })
        .where(eq(publicacion.reglaId, id));

      const segunda = await aplicarTransicion(c.tx, c.decisor, {
        reglas: [{ id, desde: Estado.Incorporada }],
        hacia: Estado.Descartada,
        justificacion: "Me arrepentí",
        masiva: false,
      });

      expect(primera.ok && segunda.ok).toBe(true);
      if (!primera.ok || !segunda.ok) return;
      const filas = await c.publicacionesDe(id);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        id: primera.publicaciones[0],
        estado: EstadoPublicacion.Pendiente,
        decisionId: segunda.decisiones[0].decisionId,
        intentos: 0,
        ultimoError: null,
      });
      expect(segunda.publicaciones).toEqual(primera.publicaciones);
      const [{ ahora }] = await c.tx.execute<{ ahora: Date }>(sql`select now() as ahora`).then((r) => r.rows);
      expect(filas[0].proximoIntentoEn.getTime()).toBeLessThanOrEqual(new Date(ahora).getTime());
    });

    enTransaccion("una ya publicada no se toca: la nueva decisión encola otra", async (c) => {
      const id = await c.regla(Estado.ARevisar);
      const primera = await incorporar(c, id);
      await c.tx
        .update(publicacion)
        .set({ estado: EstadoPublicacion.Publicada, accion: "activar", publicadaEn: sql`now()` })
        .where(eq(publicacion.reglaId, id));

      await aplicarTransicion(c.tx, c.decisor, {
        reglas: [{ id, desde: Estado.Incorporada }],
        hacia: Estado.Descartada,
        justificacion: "Ya no",
        masiva: false,
      });

      const filas = await c.publicacionesDe(id);
      expect(filas.map((f) => f.estado).sort()).toEqual([EstadoPublicacion.Pendiente, EstadoPublicacion.Publicada]);
      expect(filas.find((f) => f.estado === EstadoPublicacion.Publicada)!.id).toBe(primera.ok && primera.publicaciones[0]);
    });

    enTransaccion("una pendiente por la corrección de un desvío pasa a ser de la decisión", async (c) => {
      const id = await c.regla(Estado.ARevisar);
      const [d] = await c.tx
        .insert(desvio)
        .values({ tipo: TipoDesvio.ActivaSinIncorporar, lenguaje: "cs", clave: `${PREFIJO}desvio`, reglaId: id })
        .returning({ id: desvio.id });
      await c.tx.insert(publicacion).values({ reglaId: id, desvioId: d.id, pedidaPorId: c.analista.id });

      const resultado = await incorporar(c, id);

      const [fila] = await c.publicacionesDe(id);
      expect(fila).toMatchObject({
        desvioId: null,
        decisionId: resultado.ok ? resultado.decisiones[0].decisionId : "",
        pedidaPorId: c.decisor.id,
      });
    });
  });

  enTransaccion("la decisión y su publicación quedan juntas: la publicación apunta a la decisión escrita", async (c) => {
    const id = await c.regla(Estado.ARevisar);

    await incorporar(c, id);

    const [fila] = await c.tx
      .select({ estadoNuevo: decision.estadoNuevo, reglaDeLaDecision: decision.reglaId })
      .from(publicacion)
      .innerJoin(decision, eq(decision.id, publicacion.decisionId))
      .where(eq(publicacion.reglaId, id));
    expect(fila).toEqual({ estadoNuevo: Estado.Incorporada, reglaDeLaDecision: id });
  });
});
