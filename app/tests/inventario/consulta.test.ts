import { inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FILTROS_POR_DEFECTO, type Filtros } from "@/dominio/filtros";
import { Estado, Origen } from "@/dominio/valores";

/**
 * Consulta del inventario contra una base real (paso 8). Usa reglas propias con clave
 * `PRUEBA-INV-` (origen eslint, para no chocar con los tests de sincronización, que tocan
 * las de Sonar y Roslyn) y siempre filtra por ese texto, porque la base la comparten otros
 * tests en paralelo.
 */

const url = process.env.DATABASE_URL_PRUEBAS;
const PREFIJO = "PRUEBA-INV-";

describe.skipIf(!url)("consulta del inventario contra la base", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { estadoRegla, regla, sincronizacion } = await import("@/db/esquema");
  const { buscarReglas, opcionesDeFiltro } = await import("@/inventario/consulta");

  const db = () => obtenerDb();
  let corridaId: string;

  const REGLAS = [
    { clave: "A1", nombre: "Null checks", tipo: "BUG", severidad: "BLOCKER", tags: ["react", "pitfall"], estado: Estado.PendienteDeAnalizar, lenguaje: "ts" },
    { clave: "A2", nombre: "Unused variable", tipo: "CODE_SMELL", severidad: "MINOR", tags: ["unused"], estado: Estado.PendienteDeAnalizar, lenguaje: "cs" },
    { clave: "A3", nombre: "SQL injection", tipo: "VULNERABILITY", severidad: "CRITICAL", tags: ["cwe", "react"], estado: Estado.EnAnalisis, lenguaje: "cs" },
    { clave: "A4", nombre: "Deprecated API_100%", tipo: "CODE_SMELL", severidad: null, tags: [], estado: Estado.Descartada, lenguaje: "cs", deprecada: true },
    { clave: "A5", nombre: "Hotspot", tipo: "SECURITY_HOTSPOT", severidad: "MAJOR", tags: ["vue"], estado: Estado.Incorporada, lenguaje: "ts", nueva: true },
  ] as const;

  async function limpiar() {
    await db().delete(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(sincronizacion).where(sql`${sincronizacion.error} = 'prueba-inventario'`);
  }

  beforeAll(async () => {
    await limpiar();
    const [corrida] = await db()
      .insert(sincronizacion)
      .values({ origen: Origen.Eslint, error: "prueba-inventario" })
      .returning({ id: sincronizacion.id });
    corridaId = corrida.id;

    for (const r of REGLAS) {
      const [creada] = await db()
        .insert(regla)
        .values({
          origen: Origen.Eslint,
          clave: `${PREFIJO}${r.clave}`,
          nombre: r.nombre,
          lenguaje: r.lenguaje,
          tipo: r.tipo,
          severidadDefault: r.severidad,
          tags: [...r.tags],
          atributoCleanCode: "CLEAR",
          hashDescripcion: "x",
          deprecadaEn: "deprecada" in r ? sql`now()` : null,
          altaEnSincronizacionId: "nueva" in r ? corridaId : null,
          modificadaEnSincronizacionId: r.clave === "A2" ? corridaId : null,
        })
        .returning({ id: regla.id });
      await db().insert(estadoRegla).values({ reglaId: creada.id, estado: r.estado });
    }
  });
  afterAll(async () => {
    await limpiar();
    await db().$client.end();
  });

  async function claves(cambios: Partial<Filtros>, ultimas: string[] = [corridaId]) {
    const filas = await buscarReglas(db(), { ...FILTROS_POR_DEFECTO, q: PREFIJO, ...cambios }, ultimas);
    return filas.map((f) => f.clave.slice(PREFIJO.length));
  }

  it("sin más filtros, todas, ordenadas por clave", async () => {
    expect(await claves({})).toEqual(["A1", "A2", "A3", "A4", "A5"]);
  });

  it.each<[string, Partial<Filtros>, string[]]>([
    ["un tag", { tags: ["react"] }, ["A1", "A3"]],
    ["varios tags: alcanza con uno", { tags: ["unused", "vue"] }, ["A2", "A5"]],
    ["estado", { estados: [Estado.PendienteDeAnalizar] }, ["A1", "A2"]],
    ["varios estados", { estados: [Estado.EnAnalisis, Estado.Incorporada] }, ["A3", "A5"]],
    ["lenguaje", { lenguajes: ["ts"] }, ["A1", "A5"]],
    ["tipo", { tipos: ["CODE_SMELL"] }, ["A2", "A4"]],
    ["severidad", { severidades: ["BLOCKER", "CRITICAL"] }, ["A1", "A3"]],
    ["origen", { origenes: [Origen.Sonar] }, []],
    ["sin deprecadas", { deprecadas: "excluir" }, ["A1", "A2", "A3", "A5"]],
    ["solo deprecadas", { deprecadas: "solo" }, ["A4"]],
    ["nuevas en la última sincronización", { novedad: "nuevas" }, ["A5"]],
    ["modificadas en la última sincronización", { novedad: "modificadas" }, ["A2"]],
    ["varios filtros a la vez", { tags: ["react"], estados: [Estado.PendienteDeAnalizar] }, ["A1"]],
  ])("filtra por %s", async (_caso, filtros, esperadas) => {
    expect(await claves(filtros)).toEqual(esperadas);
  });

  it("el texto busca en la clave y en el nombre, sin distinguir mayúsculas", async () => {
    expect(await claves({ q: "sql INJ" })).toEqual(["A3"]);
    expect(await claves({ q: "sql inj" })).toEqual(["A3"]);
    expect(await claves({ q: "prueba-inv-a2" })).toEqual(["A2"]);
  });

  it("los comodines del texto se toman literales", async () => {
    expect(await claves({ q: "API_100%" })).toEqual(["A4"]);
    expect(await claves({ q: "API_1000" })).toEqual([]);
  });

  it("sin sincronización previa, nada es nuevo ni modificado", async () => {
    expect(await claves({ novedad: "nuevas" }, [])).toEqual([]);
  });

  it("con la última sincronización de cada origen, es nueva la que llegó en cualquiera de ellas", async () => {
    const deOtroOrigen = crypto.randomUUID();

    expect(await claves({ novedad: "nuevas" }, [deOtroOrigen, corridaId])).toEqual(await claves({ novedad: "nuevas" }));
    expect(await claves({ novedad: "nuevas" }, [deOtroOrigen])).toEqual([]);
  });

  it.each<[Partial<Filtros>, string[]]>([
    [{ orden: "clave", sentido: "desc" }, ["A5", "A4", "A3", "A2", "A1"]],
    [{ orden: "nombre" }, ["A4", "A5", "A1", "A3", "A2"]],
    // De más a menos grave; sin severidad, al final.
    [{ orden: "severidad" }, ["A1", "A3", "A5", "A2", "A4"]],
    [{ orden: "severidad", sentido: "desc" }, ["A2", "A5", "A3", "A1", "A4"]],
    // En el orden del ciclo de vida.
    [{ orden: "estado" }, ["A1", "A2", "A3", "A5", "A4"]],
  ])("ordena: %o", async (filtros, esperadas) => {
    expect(await claves(filtros)).toEqual(esperadas);
  });

  it("cada fila trae lo que muestra la tabla", async () => {
    const [fila] = await buscarReglas(db(), { ...FILTROS_POR_DEFECTO, q: `${PREFIJO}A5` }, [corridaId]);

    expect(fila).toMatchObject({
      clave: `${PREFIJO}A5`,
      nombre: "Hotspot",
      origen: "eslint",
      lenguaje: "ts",
      tipo: "SECURITY_HOTSPOT",
      severidad: "MAJOR",
      tags: ["vue"],
      atributoCleanCode: "CLEAR",
      estado: Estado.Incorporada,
      deprecada: false,
      nueva: true,
      modificada: false,
    });
  });

  it("las opciones de filtro salen del catálogo, con la cantidad de reglas por tag", async () => {
    const opciones = await opcionesDeFiltro(db());

    expect(opciones.estados.map((e) => e.codigo)).toEqual(Object.values(Estado));
    expect(opciones.tipos).toEqual(expect.arrayContaining(["BUG", "CODE_SMELL", "SECURITY_HOTSPOT", "VULNERABILITY"]));
    // Las severidades, de más a menos grave.
    const conocidas = opciones.severidades.filter((s) => ["BLOCKER", "CRITICAL", "MAJOR", "MINOR"].includes(s));
    expect(conocidas).toEqual(["BLOCKER", "CRITICAL", "MAJOR", "MINOR"]);
    const react = opciones.tags.find((t) => t.tag === "react");
    expect(react?.cantidad).toBeGreaterThanOrEqual(2);
    expect(opciones.total).toBeGreaterThanOrEqual(REGLAS.length);
  });

  it("los ids sirven para operar sobre las reglas", async () => {
    const filas = await buscarReglas(db(), { ...FILTROS_POR_DEFECTO, q: PREFIJO, tags: ["react"] }, [corridaId]);
    const estados = await db()
      .select({ estado: estadoRegla.estado })
      .from(estadoRegla)
      .where(inArray(estadoRegla.reglaId, filas.map((f) => f.id)));

    expect(estados.map((e) => e.estado).sort()).toEqual([Estado.EnAnalisis, Estado.PendienteDeAnalizar].sort());
  });
});
