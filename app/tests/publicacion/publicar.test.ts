import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { EstadoPublicacion, Estado, Origen, Rol, type Estado as TipoEstado, type Lenguaje } from "@/dominio/valores";
import { ErrorDeSonar } from "@/sonar/http";
import type { Activacion, PerfilDeSonar } from "@/sonar/perfiles";

/**
 * Publicar en Sonar lo pendiente (entrega 6.2, paso 4), contra una base real y un Sonar
 * falso que registra cada pedido.
 *
 * Criterio del paso: "Con un Sonar simulado: incorporar llama a activate_rule con la
 * severidad y los parámetros; retirar llama a deactivate_rule; con Sonar caído queda
 * pendiente y el reintento la publica."
 *
 * Necesita DATABASE_URL_PRUEBAS. La publicación no mira el origen de la regla (eso lo
 * decide el encolado, paso 3), así que acá se usan reglas ESLint `PRUEBA-PUBL-`, que los
 * tests de sincronización no tocan, con sus publicaciones escritas directamente. Siempre
 * se publica por id, para no tomar las de otros tests que corren en paralelo.
 */

const url = process.env.DATABASE_URL_PRUEBAS;
const PREFIJO = "PRUEBA-PUBL-";
const PERFILES: Record<Lenguaje, string> = { cs: "Lainco C#", ts: "Lainco Typescript" };

interface Llamada {
  operacion: "buscarPerfil" | "activar" | "desactivar";
  perfil?: string;
  regla?: string;
  activacion?: Activacion;
}

/** Un Sonar falso. `falla` decide, por pedido, si responde con un error. */
function sonarFalso(falla: (llamada: Llamada) => Error | undefined = () => undefined, demora = 0) {
  const llamadas: Llamada[] = [];
  const registrar = async (llamada: Llamada) => {
    llamadas.push(llamada);
    if (demora) await new Promise((r) => setTimeout(r, demora));
    const error = falla(llamada);
    if (error) throw error;
  };
  return {
    llamadas,
    sonar: {
      async buscarPerfil(lenguaje: string, nombre: string): Promise<PerfilDeSonar> {
        await registrar({ operacion: "buscarPerfil", perfil: nombre });
        return { clave: `clave-${lenguaje}`, nombre, lenguaje, esDefault: true, heredaDe: null, esDeSonar: false, reglasActivas: 0 };
      },
      activarRegla: (perfil: string, regla: string, activacion: Activacion) => registrar({ operacion: "activar", perfil, regla, activacion }),
      desactivarRegla: (perfil: string, regla: string) => registrar({ operacion: "desactivar", perfil, regla }),
    },
  };
}

const caido = () => new ErrorDeSonar("servidor", "SonarQube no respondió bien. (HTTP 503)", 503);

describe.skipIf(!url)("publicar en Sonar lo pendiente", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { decision, estadoRegla, publicacion, regla, usuario } = await import("@/db/esquema");
  const { publicarPendientes, reintentarFallidas } = await import("@/publicacion/publicar");

  const db = () => obtenerDb();
  let autorId: string;
  let numero = 0;

  async function limpiar() {
    const mias = db().select({ id: regla.id }).from(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(publicacion).where(inArray(publicacion.reglaId, mias));
    await db().delete(decision).where(inArray(decision.reglaId, mias));
    await db().delete(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(usuario).where(like(usuario.email, "prueba-publ-%"));
  }

  beforeEach(async () => {
    await limpiar();
    const [autor] = await db()
      .insert(usuario)
      .values({ nombre: "Prueba publicación", email: "prueba-publ-decisor@laincosoftware.com", rol: Rol.Decisor })
      .returning({ id: usuario.id });
    autorId = autor.id;
  });
  afterAll(async () => {
    await limpiar();
    await db().$client.end();
  });

  interface Opciones {
    lenguaje?: Lenguaje;
    severidad?: string | null;
    parametros?: Record<string, string> | null;
    impactos?: { calidad: string; severidad: string }[];
  }

  /** Una regla en ese estado, con su decisión y su publicación pendiente. Devuelve ids y clave. */
  async function pendiente(estado: TipoEstado, opciones: Opciones = {}) {
    const clave = `${PREFIJO}${++numero}`;
    const [r] = await db()
      .insert(regla)
      .values({
        origen: Origen.Eslint,
        clave,
        lenguaje: opciones.lenguaje ?? "cs",
        nombre: clave,
        hashDescripcion: "x",
        impactos: opciones.impactos ?? [{ calidad: "MAINTAINABILITY", severidad: "LOW" }],
      })
      .returning({ id: regla.id });
    const incorporada = estado === Estado.Incorporada;
    await db()
      .insert(estadoRegla)
      .values({
        reglaId: r.id,
        estado,
        severidadAsignada: incorporada ? (opciones.severidad === undefined ? "MAJOR" : opciones.severidad) : null,
        parametros: incorporada ? (opciones.parametros ?? null) : null,
      });
    const [d] = await db()
      .insert(decision)
      .values({ reglaId: r.id, estadoAnterior: Estado.ARevisar, estadoNuevo: estado, autorId })
      .returning({ id: decision.id });
    const [p] = await db()
      .insert(publicacion)
      .values({ reglaId: r.id, decisionId: d.id, pedidaPorId: autorId })
      .returning({ id: publicacion.id });
    return { reglaId: r.id, publicacionId: p.id, clave };
  }

  const fila = async (id: string) => (await db().select().from(publicacion).where(eq(publicacion.id, id)))[0];

  const publicar = (sonar: ReturnType<typeof sonarFalso>["sonar"], ids: string[], extra: { sinEsperar?: boolean } = {}) =>
    publicarPendientes({ db: db(), sonar, perfiles: PERFILES, ids, ...extra });

  describe("qué se publica", () => {
    it("Incorporada se activa con la severidad traducida a cada impacto y los parámetros elegidos", async () => {
      const p = await pendiente(Estado.Incorporada, {
        severidad: "CRITICAL",
        parametros: { max: "7" },
        impactos: [
          { calidad: "MAINTAINABILITY", severidad: "LOW" },
          { calidad: "RELIABILITY", severidad: "MEDIUM" },
        ],
      });
      const { sonar, llamadas } = sonarFalso();

      const resumen = await publicar(sonar, [p.publicacionId]);

      expect(resumen).toEqual({ publicadas: 1, reprogramadas: 0, fallidas: 0, errores: [] });
      expect(llamadas).toEqual([
        { operacion: "buscarPerfil", perfil: "Lainco C#" },
        {
          operacion: "activar",
          perfil: "clave-cs",
          regla: p.clave,
          activacion: {
            impactos: [
              { calidad: "MAINTAINABILITY", severidad: "HIGH" },
              { calidad: "RELIABILITY", severidad: "HIGH" },
            ],
            parametros: { max: "7" },
          },
        },
      ]);
      expect(await fila(p.publicacionId)).toMatchObject({
        estado: EstadoPublicacion.Publicada,
        accion: "activar",
        severidad: "CRITICAL",
        parametros: { max: "7" },
        intentos: 1,
        ultimoError: null,
      });
      expect((await fila(p.publicacionId)).publicadaEn).toBeInstanceOf(Date);
    });

    it.each([Estado.Descartada, Estado.EnPrueba])("fuera de Incorporada (%s) se desactiva", async (estado) => {
      const p = await pendiente(estado);
      const { sonar, llamadas } = sonarFalso();

      await publicar(sonar, [p.publicacionId]);

      expect(llamadas.at(-1)).toEqual({ operacion: "desactivar", perfil: "clave-cs", regla: p.clave });
      expect(await fila(p.publicacionId)).toMatchObject({
        estado: EstadoPublicacion.Publicada,
        accion: "desactivar",
        severidad: null,
        parametros: null,
      });
    });

    it("se publica lo que dice la regla al publicar, no lo que decía al encolar", async () => {
      const p = await pendiente(Estado.Incorporada);
      // Antes de publicarse, la retiraron (la misma publicación pendiente, paso 3).
      await db()
        .update(estadoRegla)
        .set({ estado: Estado.Descartada, severidadAsignada: null })
        .where(eq(estadoRegla.reglaId, p.reglaId));
      const { sonar, llamadas } = sonarFalso();

      await publicar(sonar, [p.publicacionId]);

      expect(llamadas.filter((l) => l.operacion !== "buscarPerfil")).toEqual([
        { operacion: "desactivar", perfil: "clave-cs", regla: p.clave },
      ]);
    });

    it("cada regla va al perfil de su lenguaje, que se busca una sola vez por corrida", async () => {
      const ps = [
        await pendiente(Estado.Incorporada),
        await pendiente(Estado.Incorporada),
        await pendiente(Estado.Descartada, { lenguaje: "ts" }),
      ];
      const { sonar, llamadas } = sonarFalso();

      await publicar(sonar, ps.map((p) => p.publicacionId));

      expect(llamadas.filter((l) => l.operacion === "buscarPerfil").map((l) => l.perfil).sort()).toEqual([
        "Lainco C#",
        "Lainco Typescript",
      ]);
      expect(llamadas.filter((l) => l.operacion !== "buscarPerfil").map((l) => l.perfil)).toEqual(["clave-cs", "clave-cs", "clave-ts"]);
    });

    it("sin severidad elegida, se activa sin pedir impactos", async () => {
      const p = await pendiente(Estado.Incorporada, { severidad: null });
      const { sonar, llamadas } = sonarFalso();

      await publicar(sonar, [p.publicacionId]);

      expect(llamadas.at(-1)?.activacion).toEqual({ impactos: [], parametros: {} });
    });

    it("solo publica las pedidas", async () => {
      const pedida = await pendiente(Estado.Incorporada);
      const otra = await pendiente(Estado.Incorporada);
      const { sonar } = sonarFalso();

      await publicar(sonar, [pedida.publicacionId]);

      expect((await fila(otra.publicacionId)).estado).toBe(EstadoPublicacion.Pendiente);
    });

    it("una ya publicada no se vuelve a publicar", async () => {
      const p = await pendiente(Estado.Incorporada);
      const { sonar, llamadas } = sonarFalso();
      await publicar(sonar, [p.publicacionId]);

      expect(await publicar(sonar, [p.publicacionId])).toMatchObject({ publicadas: 0 });
      expect(llamadas.filter((l) => l.operacion === "activar")).toHaveLength(1);
    });
  });

  describe("si Sonar falla", () => {
    it("con Sonar caído queda pendiente, con el error y la espera; el reintento la publica", async () => {
      const p = await pendiente(Estado.Incorporada);
      const caida = sonarFalso((l) => (l.operacion === "activar" ? caido() : undefined));

      const resumen = await publicar(caida.sonar, [p.publicacionId]);

      expect(resumen).toMatchObject({ publicadas: 0, reprogramadas: 1, fallidas: 0 });
      expect(resumen.errores).toEqual([{ regla: p.clave, mensaje: expect.stringContaining("HTTP 503") }]);
      const reprogramada = await fila(p.publicacionId);
      expect(reprogramada).toMatchObject({ estado: EstadoPublicacion.Pendiente, intentos: 1, ultimoError: expect.stringContaining("503") });
      const [{ espera }] = (
        await db().execute<{ espera: number }>(
          sql`select extract(epoch from ${publicacion.proximoIntentoEn} - now())::int as espera from ${publicacion} where ${publicacion.id} = ${p.publicacionId}`,
        )
      ).rows;
      expect(espera).toBeGreaterThan(50);
      expect(espera).toBeLessThanOrEqual(60);

      // Mientras espera, una corrida normal no la toma.
      const levantado = sonarFalso();
      expect(await publicar(levantado.sonar, [p.publicacionId])).toMatchObject({ publicadas: 0 });
      // El reintento a demanda (el botón) sí, y la publica.
      expect(await publicar(levantado.sonar, [p.publicacionId], { sinEsperar: true })).toMatchObject({ publicadas: 1 });
      expect(await fila(p.publicacionId)).toMatchObject({ estado: EstadoPublicacion.Publicada, intentos: 2, ultimoError: null });
    });

    it("al quinto intento fallido queda fallida", async () => {
      const p = await pendiente(Estado.Incorporada);
      const { sonar } = sonarFalso((l) => (l.operacion === "activar" ? caido() : undefined));

      for (let i = 1; i <= 4; i++) {
        expect(await publicar(sonar, [p.publicacionId], { sinEsperar: true })).toMatchObject({ reprogramadas: 1 });
      }
      expect(await publicar(sonar, [p.publicacionId], { sinEsperar: true })).toMatchObject({ fallidas: 1 });
      expect(await fila(p.publicacionId)).toMatchObject({ estado: EstadoPublicacion.Fallida, intentos: 5 });
    });

    it("si Sonar rechaza el pedido, queda fallida enseguida: reintentar daría lo mismo", async () => {
      const p = await pendiente(Estado.Incorporada, { parametros: { max: "x" } });
      const { sonar } = sonarFalso((l) =>
        l.operacion === "activar" ? new ErrorDeSonar("pedidoInvalido", "SonarQube rechazó el pedido. (HTTP 400: Value 'x' must be an integer.)", 400) : undefined,
      );

      expect(await publicar(sonar, [p.publicacionId])).toMatchObject({ fallidas: 1 });
      expect(await fila(p.publicacionId)).toMatchObject({
        estado: EstadoPublicacion.Fallida,
        intentos: 1,
        accion: "activar",
        parametros: { max: "x" },
        ultimoError: expect.stringContaining("must be an integer"),
      });
    });

    it("un parámetro que el cliente no puede mandar también queda fallida, sin llamar a Sonar", async () => {
      const p = await pendiente(Estado.Incorporada, { parametros: { formato: "a;b" } });
      const real = await import("@/sonar/cliente");
      const llamadas: string[] = [];
      const sonar = real.crearClienteSonar({
        url: "https://sonar.invalid",
        token: "t",
        fetch: (async (u: string | URL) => {
          llamadas.push(String(u));
          return Response.json({ profiles: [{ key: "k", name: "Lainco C#", language: "cs" }] });
        }) as typeof fetch,
      });

      expect(await publicarPendientes({ db: db(), sonar, perfiles: PERFILES, ids: [p.publicacionId] })).toMatchObject({ fallidas: 1 });
      expect(llamadas.some((u) => u.includes("activate_rule"))).toBe(false);
      expect((await fila(p.publicacionId)).ultimoError).toContain("';'");
    });

    it("si el perfil no existe, es un problema de configuración: se reintenta, y no afecta al otro lenguaje", async () => {
      const cs = await pendiente(Estado.Incorporada);
      const ts = await pendiente(Estado.Incorporada, { lenguaje: "ts" });
      const { sonar, llamadas } = sonarFalso((l) =>
        l.operacion === "buscarPerfil" && l.perfil === "Lainco C#" ? new ErrorDeSonar("noEncontrado", "No hay un Quality Profile 'Lainco C#'.") : undefined,
      );

      const resumen = await publicar(sonar, [cs.publicacionId, ts.publicacionId]);

      expect(resumen).toMatchObject({ publicadas: 1, reprogramadas: 1, fallidas: 0 });
      expect((await fila(cs.publicacionId)).ultimoError).toContain("Lainco C#");
      expect(llamadas.filter((l) => l.operacion === "activar").map((l) => l.regla)).toEqual([ts.clave]);
    });

    it.each([
      ["permisos", new ErrorDeSonar("permisos", "El token de SonarQube no tiene permiso para administrar Quality Profiles.", 403)],
      ["autenticación", new ErrorDeSonar("autenticacion", "El token de SonarQube no es válido o venció.", 401)],
    ])("un problema de %s se reintenta: se arregla sin tocar la publicación", async (_caso, error) => {
      const p = await pendiente(Estado.Incorporada);
      const { sonar } = sonarFalso((l) => (l.operacion === "activar" ? error : undefined));

      expect(await publicar(sonar, [p.publicacionId])).toMatchObject({ reprogramadas: 1 });
    });
  });

  it("dos corridas a la vez no publican la misma publicación dos veces", async () => {
    const p = await pendiente(Estado.Incorporada);
    const { sonar, llamadas } = sonarFalso(undefined, 200);

    const resumenes = await Promise.all([publicar(sonar, [p.publicacionId]), publicar(sonar, [p.publicacionId])]);

    expect(llamadas.filter((l) => l.operacion === "activar")).toHaveLength(1);
    expect(resumenes.map((r) => r.publicadas).sort()).toEqual([0, 1]);
  });

  describe("reintentar las fallidas (el botón)", () => {
    async function fallida(estado: TipoEstado = Estado.Incorporada) {
      const p = await pendiente(estado);
      await db()
        .update(publicacion)
        .set({ estado: EstadoPublicacion.Fallida, intentos: 5, ultimoError: "Sonar no responde" })
        .where(eq(publicacion.id, p.publicacionId));
      return p;
    }

    it("vuelve a ponerla pendiente, sin intentos ni espera", async () => {
      const p = await fallida();

      expect(await reintentarFallidas(db(), [p.publicacionId])).toEqual([p.publicacionId]);
      expect(await fila(p.publicacionId)).toMatchObject({ estado: EstadoPublicacion.Pendiente, intentos: 0 });
    });

    it("no toca una fallida que ya quedó vieja: después hubo otra publicación de la regla", async () => {
      const p = await fallida();
      const [d] = await db()
        .insert(decision)
        .values({ reglaId: p.reglaId, estadoAnterior: Estado.Incorporada, estadoNuevo: Estado.Descartada, autorId })
        .returning({ id: decision.id });
      await db().insert(publicacion).values({ reglaId: p.reglaId, decisionId: d.id, pedidaPorId: autorId });

      expect(await reintentarFallidas(db(), [p.publicacionId])).toEqual([]);
      expect((await fila(p.publicacionId)).estado).toBe(EstadoPublicacion.Fallida);
    });

    it("solo las pedidas, y nunca una que no esté fallida", async () => {
      const pedida = await fallida();
      const otra = await fallida();
      const pend = await pendiente(Estado.Incorporada);

      expect(await reintentarFallidas(db(), [pedida.publicacionId, pend.publicacionId])).toEqual([pedida.publicacionId]);
      expect((await fila(otra.publicacionId)).estado).toBe(EstadoPublicacion.Fallida);
    });
  });
});
