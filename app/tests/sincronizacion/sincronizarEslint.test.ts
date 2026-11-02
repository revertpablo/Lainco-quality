import { readFileSync } from "node:fs";

import { and, asc, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";

import { Estado, Origen } from "@/dominio/valores";
import type { ClienteGitHub, ReleaseDeGitHub } from "@/github/cliente";

/**
 * Job `sincronizar-eslint` contra una base real (entrega 6.4, parte ESLint, paso 1), con un
 * GitHub falso que devuelve el catálogo del release eslint-v0.1.0 de @lainco/eslint-plugin
 * (tests/fixtures/eslint/) o una versión cambiada.
 *
 * Criterio de la 6.4: "Publicar una versión nueva de @lainco/eslint-plugin agrega sus
 * reglas al inventario sin carga manual."
 *
 * Necesita DATABASE_URL_PRUEBAS. Cada test corre en una transacción que se descarta. Otros
 * tests usan reglas ESLint inventadas (con claves que no son `lainco/...`): dentro de la
 * transacción la sincronización las da por eliminadas, y eso no sale de acá.
 */

const url = process.env.DATABASE_URL_PRUEBAS;

interface Catalogo {
  version: string;
  reglas: { clave: string; titulo: string; documentacion: string; [campo: string]: unknown }[];
  [campo: string]: unknown;
}

const v010: Catalogo = JSON.parse(readFileSync(new URL("../fixtures/eslint/reglas-eslint.json", import.meta.url), "utf8"));

function version(numero: string, cambiar: (catalogo: Catalogo) => void = () => {}): Catalogo {
  const catalogo = structuredClone(v010);
  catalogo.version = numero;
  cambiar(catalogo);
  return catalogo;
}

function release(catalogo: Catalogo, cambios: Partial<ReleaseDeGitHub> = {}): ReleaseDeGitHub {
  return {
    tag: `eslint-v${catalogo.version}`,
    nombre: `@lainco/eslint-plugin ${catalogo.version}`,
    publicadoEn: new Date("2026-11-02T19:30:00Z"),
    url: `https://github.com/revertpablo/Lainco-quality/releases/tag/eslint-v${catalogo.version}`,
    assets: [{ nombre: "reglas-eslint.json", url: "https://api.github.com/assets/20" }],
    ...cambios,
  };
}

/** Un GitHub falso cuyo último release `eslint-v*` trae `catalogo`. */
function github(
  catalogo: Catalogo | string | null,
  cambios: Partial<ReleaseDeGitHub> = {},
): Pick<ClienteGitHub, "ultimoReleaseConPrefijo" | "descargarAsset"> & { prefijos: string[] } {
  const prefijos: string[] = [];
  return {
    prefijos,
    ultimoReleaseConPrefijo: async (prefijo) => {
      prefijos.push(prefijo);
      return catalogo === null ? null : release(typeof catalogo === "string" ? v010 : catalogo, cambios);
    },
    descargarAsset: async (asset) => {
      if (asset.nombre !== "reglas-eslint.json") throw new Error(`Bajó ${asset.nombre}.`);
      return typeof catalogo === "string" ? catalogo : JSON.stringify(catalogo);
    },
  };
}

describe.skipIf(!url)("sincronización de ESLint contra la base", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { aviso, estadoRegla, regla, sincronizacion } = await import("@/db/esquema");
  const { sincronizarEslint } = await import("@/sincronizacion/sincronizarEslint");

  let actual: Db | null = null;
  const db = () => actual ?? obtenerDb();

  class Descartada extends Error {}
  async function enTransaccion(prueba: () => Promise<void>) {
    const resultado = obtenerDb().transaction(async (tx) => {
      actual = tx as unknown as Db;
      try {
        await prueba();
      } finally {
        actual = null;
      }
      throw new Descartada();
    });
    await expect(resultado).rejects.toBeInstanceOf(Descartada);
  }

  const reglasLainco = () =>
    db()
      .select({
        clave: regla.clave,
        nombre: regla.nombre,
        lenguaje: regla.lenguaje,
        severidadDefault: regla.severidadDefault,
        tags: regla.tags,
        descripcion: regla.descripcion,
        deprecada: regla.deprecadaEn,
        estado: estadoRegla.estado,
      })
      .from(regla)
      .innerJoin(estadoRegla, eq(estadoRegla.reglaId, regla.id))
      .where(and(eq(regla.origen, Origen.Eslint), like(regla.clave, "lainco/%")))
      .orderBy(asc(regla.clave));

  const corrida = async (id: string) => (await db().select().from(sincronizacion).where(eq(sincronizacion.id, id)))[0];

  beforeAll(async () => {
    await db().delete(sincronizacion).where(eq(sincronizacion.origen, Origen.Eslint));
  });
  afterAll(async () => {
    await db().$client.end();
  });

  it("la primera corrida carga las reglas del último release eslint-v* en Pendiente de analizar", () => enTransaccion(async () => {
    const falso = github(v010);

    const resumen = await sincronizarEslint({ db: db(), github: falso });

    expect(falso.prefijos).toEqual(["eslint-v"]);
    expect(resumen).toMatchObject({ estado: "ok", nuevas: 1, version: "@lainco/eslint-plugin 0.1.0" });
    expect(await reglasLainco()).toEqual([
      {
        clave: "lainco/no-hardcoded-secrets",
        nombre: "No se permiten secretos escritos en el código",
        lenguaje: "ts",
        severidadDefault: "warning",
        tags: ["seguridad"],
        descripcion: v010.reglas[0].documentacion,
        deprecada: null,
        estado: Estado.PendienteDeAnalizar,
      },
    ]);
    expect(await corrida(resumen.id)).toMatchObject({ origen: "eslint", estado: "ok", version: "@lainco/eslint-plugin 0.1.0" });
  }));

  it("la segunda corrida con el mismo release no cambia nada", () => enTransaccion(async () => {
    await sincronizarEslint({ db: db(), github: github(v010) });
    const antes = await reglasLainco();

    const resumen = await sincronizarEslint({ db: db(), github: github(v010) });

    expect(resumen).toMatchObject({ estado: "ok", nuevas: 0, modificadas: 0 });
    expect(await reglasLainco()).toEqual(antes);
  }));

  it("una versión nueva agrega sus reglas y avisa si cambió una Incorporada", () => enTransaccion(async () => {
    await sincronizarEslint({ db: db(), github: github(v010) });
    const [fila] = await db().select({ id: regla.id }).from(regla).where(eq(regla.clave, "lainco/no-hardcoded-secrets"));
    await db().update(estadoRegla).set({ estado: Estado.Incorporada }).where(eq(estadoRegla.reglaId, fila.id));

    const v020 = version("0.2.0", (c) => {
      c.reglas[0].documentacion += "\n## Nueva sección\n";
      c.reglas.push({ ...structuredClone(v010.reglas[0]), clave: "lainco/no-unsafe-html", titulo: "No se permite HTML sin sanear" });
    });
    const resumen = await sincronizarEslint({ db: db(), github: github(v020) });

    expect(resumen).toMatchObject({ estado: "ok", nuevas: 1, modificadas: 1, avisos: 1, version: "@lainco/eslint-plugin 0.2.0" });
    expect((await reglasLainco()).map((r) => [r.clave, r.estado])).toEqual([
      ["lainco/no-hardcoded-secrets", Estado.Incorporada],
      ["lainco/no-unsafe-html", Estado.PendienteDeAnalizar],
    ]);
    expect(await db().select({ motivo: aviso.motivo }).from(aviso).where(eq(aviso.reglaId, fila.id))).toEqual([{ motivo: "modificada" }]);
  }));

  it.each([
    ["sin releases eslint-v*", github(null), "El repositorio no tiene ningún release eslint-v* publicado: todavía no hay catálogo de reglas ESLint."],
    ["un release sin el catálogo", github(v010, { assets: [] }), "El release eslint-v0.1.0 no tiene el catálogo reglas-eslint.json."],
    ["un catálogo que no es JSON", github("<html>"), "El catálogo reglas-eslint.json del release eslint-v0.1.0 no es JSON."],
    ["un catálogo de otra versión", github(v010, { tag: "eslint-v0.1.1" }), "El release eslint-v0.1.1 trae el catálogo de la versión 0.1.0."],
    ["un catálogo de Roslyn", github({ ...v010, origen: "roslyn" }), "El catálogo es de 'roslyn' y se esperaba uno de 'eslint'."],
  ])("con %s, la corrida queda con error y no se escribe nada", (_caso, falso, mensaje) => enTransaccion(async () => {
    const resumen = await sincronizarEslint({ db: db(), github: falso });

    expect(resumen).toMatchObject({ estado: "error", nuevas: 0, error: mensaje });
    expect(await reglasLainco()).toEqual([]);
  }));
});
