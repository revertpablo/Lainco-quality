import { readFileSync } from "node:fs";

import { and, asc, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Estado, Origen } from "@/dominio/valores";
import type { ClienteGitHub, ReleaseDeGitHub } from "@/github/cliente";
import { ErrorDeGitHub } from "@/github/cliente";

/**
 * Job `sincronizar-roslyn` contra una base real (entrega 6.4, paso 3), con un GitHub falso
 * que devuelve el catálogo del release v0.1.0 de Lainco.Analyzers
 * (tests/fixtures/roslyn/) o una versión cambiada.
 *
 * Criterio de la 6.4: "Publicar una versión nueva de Lainco.Analyzers agrega sus reglas al
 * inventario sin carga manual."
 *
 * Necesita DATABASE_URL_PRUEBAS. **Borra todas las reglas Roslyn, sus avisos y las
 * sincronizaciones de Roslyn de esa base**: por eso los demás tests usan reglas de otros
 * orígenes.
 */

const url = process.env.DATABASE_URL_PRUEBAS;

interface Catalogo {
  version: string;
  reglas: { clave: string; titulo: string; documentacion: string; severidadPorDefecto: string; [campo: string]: unknown }[];
  [campo: string]: unknown;
}

const v010: Catalogo = JSON.parse(readFileSync(new URL("../fixtures/roslyn/reglas-roslyn.json", import.meta.url), "utf8"));

/** El catálogo de una versión nueva: `cambiar` lo modifica. */
function version(numero: string, cambiar: (catalogo: Catalogo) => void = () => {}): Catalogo {
  const catalogo = structuredClone(v010);
  catalogo.version = numero;
  cambiar(catalogo);
  return catalogo;
}

function release(catalogo: Catalogo, cambios: Partial<ReleaseDeGitHub> = {}): ReleaseDeGitHub {
  return {
    tag: `v${catalogo.version}`,
    nombre: `Lainco.Analyzers ${catalogo.version}`,
    publicadoEn: new Date("2026-10-28T18:45:00Z"),
    url: `https://github.com/revertpablo/Lainco-quality/releases/tag/v${catalogo.version}`,
    assets: [
      { nombre: `Lainco.Analyzers.${catalogo.version}.nupkg`, url: "https://api.github.com/assets/1" },
      { nombre: "reglas-roslyn.json", url: "https://api.github.com/assets/2" },
    ],
    ...cambios,
  };
}

/** Un GitHub falso cuyo último release trae `catalogo` (como texto, si se pasa uno). */
function github(
  catalogo: Catalogo | string | null,
  cambios: Partial<ReleaseDeGitHub> = {},
): Pick<ClienteGitHub, "ultimoRelease" | "descargarAsset"> {
  return {
    ultimoRelease: async () =>
      catalogo === null ? null : release(typeof catalogo === "string" ? v010 : catalogo, cambios),
    descargarAsset: async (asset) => {
      if (asset.nombre !== "reglas-roslyn.json") throw new Error(`Bajó ${asset.nombre}.`);
      return typeof catalogo === "string" ? catalogo : JSON.stringify(catalogo);
    },
  };
}

describe.skipIf(!url)("sincronización de Roslyn contra la base", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { aviso, decision, estadoRegla, publicacion, regla, sincronizacion, usuario } = await import("@/db/esquema");
  const { sincronizarRoslyn } = await import("@/sincronizacion/sincronizarRoslyn");
  const { ultimasSincronizacionesOk } = await import("@/inventario/consulta");

  const db = () => obtenerDb();

  async function limpiar() {
    const deRoslyn = db().select({ id: regla.id }).from(regla).where(eq(regla.origen, Origen.Roslyn));
    await db().delete(aviso).where(inArray(aviso.reglaId, deRoslyn));
    await db().delete(publicacion).where(inArray(publicacion.reglaId, deRoslyn));
    await db().delete(decision).where(inArray(decision.reglaId, deRoslyn));
    await db().delete(regla).where(eq(regla.origen, Origen.Roslyn));
    await db().delete(regla).where(like(regla.clave, "PRUEBA-ROS-%"));
    await db().delete(sincronizacion).where(eq(sincronizacion.origen, Origen.Roslyn));
    await db().delete(usuario).where(like(usuario.email, "prueba-ros-%"));
  }

  const reglasRoslyn = () =>
    db()
      .select({
        clave: regla.clave,
        nombre: regla.nombre,
        lenguaje: regla.lenguaje,
        tipo: regla.tipo,
        severidadDefault: regla.severidadDefault,
        tags: regla.tags,
        descripcion: regla.descripcion,
        deprecada: regla.deprecadaEn,
        estado: estadoRegla.estado,
        alta: regla.altaEnSincronizacionId,
        modificadaEn: regla.modificadaEnSincronizacionId,
      })
      .from(regla)
      .innerJoin(estadoRegla, eq(estadoRegla.reglaId, regla.id))
      .where(eq(regla.origen, Origen.Roslyn))
      .orderBy(asc(regla.clave));

  async function ponerEnEstado(clave: string, estado: Estado) {
    const [fila] = await db()
      .select({ id: regla.id })
      .from(regla)
      .where(and(eq(regla.origen, Origen.Roslyn), eq(regla.clave, clave)));
    await db().update(estadoRegla).set({ estado }).where(eq(estadoRegla.reglaId, fila.id));
    return fila.id;
  }

  const corrida = async (id: string) => (await db().select().from(sincronizacion).where(eq(sincronizacion.id, id)))[0];

  beforeEach(limpiar);
  afterAll(async () => {
    await limpiar();
    await db().$client.end();
  });

  it("la primera corrida carga las reglas del último release en Pendiente de analizar", async () => {
    const resumen = await sincronizarRoslyn({ db: db(), github: github(v010) });

    expect(resumen).toMatchObject({ estado: "ok", nuevas: 2, modificadas: 0, deprecadas: 0, avisos: 0, version: "Lainco.Analyzers 0.1.0" });

    const reglas = await reglasRoslyn();
    expect(reglas.map((r) => [r.clave, r.estado, r.alta])).toEqual([
      ["LAIN004", Estado.PendienteDeAnalizar, resumen.id],
      ["LAIN005", Estado.PendienteDeAnalizar, resumen.id],
    ]);
    expect(reglas[1]).toMatchObject({
      nombre: "No se permiten métodos estáticos",
      lenguaje: "cs",
      tipo: null,
      severidadDefault: "warning",
      tags: ["diseño"],
      deprecada: null,
    });
    expect(reglas[1].descripcion).toBe(v010.reglas[1].documentacion);

    expect(await corrida(resumen.id)).toMatchObject({
      origen: "roslyn",
      estado: "ok",
      nuevas: 2,
      version: "Lainco.Analyzers 0.1.0",
      error: null,
    });
    // Cuenta para "nuevas" en el inventario.
    expect(await ultimasSincronizacionesOk(db())).toContain(resumen.id);
  });

  it("la segunda corrida con el mismo release no cambia nada", async () => {
    await sincronizarRoslyn({ db: db(), github: github(v010) });
    const antes = await reglasRoslyn();

    const resumen = await sincronizarRoslyn({ db: db(), github: github(v010) });

    expect(resumen).toMatchObject({ estado: "ok", nuevas: 0, modificadas: 0, deprecadas: 0, actualizadas: 0, avisos: 0 });
    expect(await reglasRoslyn()).toEqual(antes);
  });

  it("una versión nueva agrega sus reglas, actualiza las cambiadas y depreca las que ya no están", async () => {
    await sincronizarRoslyn({ db: db(), github: github(v010) });
    const lain004 = await ponerEnEstado("LAIN004", Estado.Incorporada);
    const lain005 = await ponerEnEstado("LAIN005", Estado.Incorporada);

    const v020 = version("0.2.0", (c) => {
      c.reglas[0].documentacion += "\n## Nueva sección\n";
      c.reglas.splice(1, 1);
      c.reglas.push({ ...structuredClone(v010.reglas[1]), clave: "LAIN006", titulo: "No se permite ToList() sobre queries" });
    });
    const resumen = await sincronizarRoslyn({ db: db(), github: github(v020) });

    expect(resumen).toMatchObject({ estado: "ok", nuevas: 1, modificadas: 1, deprecadas: 1, avisos: 2, version: "Lainco.Analyzers 0.2.0" });

    const reglas = await reglasRoslyn();
    expect(reglas.map((r) => [r.clave, r.estado, r.deprecada !== null])).toEqual([
      ["LAIN004", Estado.Incorporada, false],
      // Eliminada del paquete: queda en el inventario, deprecada, con su estado.
      ["LAIN005", Estado.Incorporada, true],
      ["LAIN006", Estado.PendienteDeAnalizar, false],
    ]);
    expect(reglas[0].descripcion).toContain("## Nueva sección");
    expect(reglas[0].modificadaEn).toBe(resumen.id);

    // Las dos estaban Incorporadas: hay que revisar el cambio y decidir qué hacer con la eliminada.
    const avisos = await db()
      .select({ reglaId: aviso.reglaId, motivo: aviso.motivo })
      .from(aviso)
      .where(inArray(aviso.reglaId, [lain004, lain005]))
      .orderBy(asc(aviso.motivo));
    expect(avisos).toEqual([
      { reglaId: lain005, motivo: "eliminada" },
      { reglaId: lain004, motivo: "modificada" },
    ]);
  });

  it("una regla que vuelve al paquete deja de estar deprecada", async () => {
    await sincronizarRoslyn({ db: db(), github: github(v010) });
    await sincronizarRoslyn({ db: db(), github: github(version("0.2.0", (c) => void c.reglas.splice(1, 1))) });

    const resumen = await sincronizarRoslyn({ db: db(), github: github(version("0.3.0")) });

    expect(resumen).toMatchObject({ estado: "ok", modificadas: 1, deprecadas: 0 });
    expect((await reglasRoslyn()).every((r) => r.deprecada === null)).toBe(true);
  });

  it("no toca las reglas de otros orígenes", async () => {
    const [otra] = await db()
      .insert(regla)
      .values({ origen: Origen.Eslint, clave: "PRUEBA-ROS-1", lenguaje: "cs", nombre: "De otro origen", hashDescripcion: "x" })
      .returning({ id: regla.id });
    await db().insert(estadoRegla).values({ reglaId: otra.id });

    await sincronizarRoslyn({ db: db(), github: github(v010) });

    const [despues] = await db().select({ deprecadaEn: regla.deprecadaEn }).from(regla).where(eq(regla.id, otra.id));
    expect(despues.deprecadaEn).toBeNull();
  });

  it.each([
    ["sin releases", github(null), "El repositorio no tiene ningún release publicado: todavía no hay catálogo de reglas Roslyn."],
    ["un release sin el catálogo", github(v010, { assets: [] }), "El release v0.1.0 no tiene el catálogo reglas-roslyn.json."],
    ["un catálogo que no es JSON", github("<html>"), "El catálogo reglas-roslyn.json del release v0.1.0 no es JSON."],
    ["un catálogo de otra versión", github(v010, { tag: "v0.1.1" }), "El release v0.1.1 trae el catálogo de la versión 0.1.0."],
    [
      "un formato que la app no conoce",
      github({ ...v010, formato: 2 }),
      "El catálogo tiene el formato 2 y la app conoce el 1: hay que actualizar la app.",
    ],
  ])("con %s, la corrida queda con error y no se escribe nada", async (_caso, falso, mensaje) => {
    const resumen = await sincronizarRoslyn({ db: db(), github: falso });

    expect(resumen).toMatchObject({ estado: "error", nuevas: 0, error: mensaje });
    expect(await corrida(resumen.id)).toMatchObject({ estado: "error", error: mensaje, version: null });
    expect(await reglasRoslyn()).toEqual([]);
  });

  it("si GitHub falla, dice por qué", async () => {
    const falso = {
      ultimoRelease: async () => {
        throw new ErrorDeGitHub("autenticacion", "El token de GitHub no es válido o venció. (HTTP 401)", 401);
      },
      descargarAsset: async () => "",
    };

    const resumen = await sincronizarRoslyn({ db: db(), github: falso });

    expect(resumen).toMatchObject({ estado: "error", error: "El token de GitHub no es válido o venció. (HTTP 401)" });
  });

  it("registra quién la disparó desde la app", async () => {
    const [persona] = await db()
      .insert(usuario)
      .values({ nombre: "Rosa Roslyn", email: "prueba-ros-analista@laincosoftware.com" })
      .returning({ id: usuario.id });

    const resumen = await sincronizarRoslyn({ db: db(), github: github(v010), disparadaPorId: persona.id });

    expect((await corrida(resumen.id)).disparadaPorId).toBe(persona.id);
  });
});
