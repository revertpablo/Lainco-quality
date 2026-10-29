import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";
import { AlcanceToken } from "@/dominio/valores";

/**
 * Tokens de servicio contra una base real (entrega 6.5, paso 1, decisión E5): crearlos,
 * darlos de baja, listarlos y validarlos, y la autorización de las rutas de /api/ci/.
 *
 * Necesita DATABASE_URL_PRUEBAS. Cada test corre en una transacción que se descarta.
 */

const url = process.env.DATABASE_URL_PRUEBAS;

class Descartada extends Error {}

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-10-29T12:00:00Z");

describe.skipIf(!url)("tokens de servicio", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { tokenServicio } = await import("@/db/esquema");
  const { crearTokenServicio, listarTokensServicio, revocarTokenServicio, validarTokenServicio, ErrorDeTokenServicio } = await import(
    "@/servicio/tokensDeServicio"
  );
  const { autorizarServicio } = await import("@/servicio/autorizar");

  function enTransaccion(nombre: string, prueba: (tx: Db) => Promise<void>) {
    it(nombre, async () => {
      const resultado = obtenerDb().transaction(async (transaccion) => {
        await prueba(transaccion as unknown as Db);
        throw new Descartada();
      });
      await expect(resultado).rejects.toBeInstanceOf(Descartada);
    });
  }

  const crear = (tx: Db, nombre = "job-de-prueba", dias = 365, ahora = AHORA) =>
    crearTokenServicio(tx, { nombre, alcance: AlcanceToken.Prueba, dias, ahora });

  const pedidoCon = (token?: string) =>
    new Request("https://app.test/api/ci/prueba/configuracion", token ? { headers: { authorization: `Bearer ${token}` } } : {});

  // ------------------------------------------------------------------------- crear

  enTransaccion("crear devuelve el token una sola vez: la base guarda el hash y el prefijo", async (tx) => {
    const { token } = await crear(tx);

    const [fila] = await tx.select().from(tokenServicio).where(eq(tokenServicio.nombre, "job-de-prueba"));
    expect(fila.hash).not.toBe(token);
    expect(token.startsWith(fila.prefijo)).toBe(true);
    expect(Object.values(fila).map(String)).not.toContain(token);
    expect(fila).toMatchObject({ alcance: AlcanceToken.Prueba, ultimoUsoEn: null, revocadoEn: null });
    expect(fila.expiraEn.getTime() - fila.creadoEn.getTime()).toBe(365 * DIA);
  });

  enTransaccion("dos tokens no pueden tener el mismo nombre", async (tx) => {
    await crear(tx);

    await expect(crear(tx)).rejects.toThrow(ErrorDeTokenServicio);
    await expect(crear(tx)).rejects.toThrow(/Ya existe/);
  });

  enTransaccion("vence entre 1 y 365 días después de crearlo", async (tx) => {
    for (const dias of [0, -1, 366, 1.5]) {
      await expect(crear(tx, `job-${dias}`, dias)).rejects.toThrow(/entre 1 y 365/);
    }
    await expect(crear(tx, "job-un-dia", 1)).resolves.toBeDefined();
  });

  enTransaccion("el nombre no puede estar vacío", async (tx) => {
    await expect(crear(tx, "  ")).rejects.toThrow(/nombre/);
  });

  enTransaccion("la base rechaza un hash que no es un SHA-256", async (tx) => {
    const insertar = tx.insert(tokenServicio).values({
      nombre: "a-mano",
      alcance: AlcanceToken.Prueba,
      hash: "lqs_el-token-en-claro",
      prefijo: "lqs_el-tok",
      expiraEn: new Date(AHORA.getTime() + DIA),
    });

    await expect(insertar).rejects.toMatchObject({ cause: { constraint: "tokenServicioHashSha256" } });
  });

  // ---------------------------------------------------------------------- validar

  enTransaccion("un token vigente del alcance pedido es válido, y queda registrado su uso", async (tx) => {
    const { token } = await crear(tx);
    const despues = new Date(AHORA.getTime() + DIA);

    const resultado = await validarTokenServicio(tx, token, AlcanceToken.Prueba, despues);

    expect(resultado).toMatchObject({ valido: true, nombre: "job-de-prueba" });
    const [fila] = await tx.select().from(tokenServicio).where(eq(tokenServicio.nombre, "job-de-prueba"));
    expect(fila.ultimoUsoEn).toEqual(despues);
  });

  enTransaccion("un token que la app no emitió no es válido", async (tx) => {
    await crear(tx);

    expect(await validarTokenServicio(tx, `lqs_${"x".repeat(43)}`, AlcanceToken.Prueba, AHORA)).toEqual({ valido: false, motivo: "desconocido" });
  });

  enTransaccion("un token vencido no es válido, desde el momento en que vence", async (tx) => {
    const { token } = await crear(tx, "job-de-prueba", 30);
    const vence = new Date(AHORA.getTime() + 30 * DIA);

    expect(await validarTokenServicio(tx, token, AlcanceToken.Prueba, new Date(vence.getTime() - 1))).toMatchObject({ valido: true });
    expect(await validarTokenServicio(tx, token, AlcanceToken.Prueba, vence)).toEqual({ valido: false, motivo: "vencido" });
  });

  enTransaccion("un token dado de baja no es válido", async (tx) => {
    const { token } = await crear(tx);

    expect(await revocarTokenServicio(tx, "job-de-prueba", AHORA)).toBe(true);

    expect(await validarTokenServicio(tx, token, AlcanceToken.Prueba, AHORA)).toEqual({ valido: false, motivo: "revocado" });
  });

  enTransaccion("un token no válido no registra uso", async (tx) => {
    const { token } = await crear(tx);
    await revocarTokenServicio(tx, "job-de-prueba", AHORA);

    await validarTokenServicio(tx, token, AlcanceToken.Prueba, AHORA);

    const [fila] = await tx.select().from(tokenServicio).where(eq(tokenServicio.nombre, "job-de-prueba"));
    expect(fila.ultimoUsoEn).toBeNull();
  });

  // ------------------------------------------------------------- revocar y listar

  enTransaccion("dar de baja uno que no existe o que ya está dado de baja no cambia nada", async (tx) => {
    await crear(tx);
    await revocarTokenServicio(tx, "job-de-prueba", AHORA);

    expect(await revocarTokenServicio(tx, "no-existe", AHORA)).toBe(false);
    expect(await revocarTokenServicio(tx, "job-de-prueba", new Date(AHORA.getTime() + DIA))).toBe(false);
    const [fila] = await tx.select().from(tokenServicio).where(eq(tokenServicio.nombre, "job-de-prueba"));
    expect(fila.revocadoEn).toEqual(AHORA);
  });

  enTransaccion("el listado dice el estado de cada token y no muestra el hash", async (tx) => {
    await tx.delete(tokenServicio);
    await crear(tx, "vigente");
    await crear(tx, "vencido", 1, new Date(AHORA.getTime() - 2 * DIA));
    await crear(tx, "de-baja");
    await revocarTokenServicio(tx, "de-baja", AHORA);

    const lista = await listarTokensServicio(tx, AHORA);

    expect(lista.map((t) => [t.nombre, t.estado])).toEqual([
      ["de-baja", "revocado"],
      ["vencido", "vencido"],
      ["vigente", "vigente"],
    ]);
    expect(lista.every((t) => !("hash" in t))).toBe(true);
    expect(lista[2]).toMatchObject({ alcance: AlcanceToken.Prueba, prefijo: expect.stringMatching(/^lqs_/) });
  });

  // ------------------------------------------------------- autorizar en /api/ci/

  enTransaccion("autorizarServicio deja pasar un token válido y dice cuál es", async (tx) => {
    const { token } = await crear(tx);

    const resultado = await autorizarServicio(pedidoCon(token), AlcanceToken.Prueba, { db: tx, ahora: AHORA });

    expect(resultado).toMatchObject({ autorizado: true, nombre: "job-de-prueba" });
  });

  enTransaccion("autorizarServicio responde 401 igual sin token, con uno desconocido, vencido o dado de baja", async (tx) => {
    const { token: vencido } = await crear(tx, "vencido", 1, new Date(AHORA.getTime() - 2 * DIA));
    const { token: deBaja } = await crear(tx, "de-baja");
    await revocarTokenServicio(tx, "de-baja", AHORA);

    const cuerpos = new Set<string>();
    for (const token of [undefined, "un-secreto-cualquiera", `lqs_${"x".repeat(43)}`, vencido, deBaja]) {
      const resultado = await autorizarServicio(pedidoCon(token), AlcanceToken.Prueba, { db: tx, ahora: AHORA });
      expect(resultado).toBeInstanceOf(Response);
      const respuesta = resultado as Response;
      expect(respuesta.status).toBe(401);
      cuerpos.add(await respuesta.text());
    }
    // La respuesta no dice por qué: no da pistas sobre qué tokens existen.
    expect(cuerpos.size).toBe(1);
  });
});
