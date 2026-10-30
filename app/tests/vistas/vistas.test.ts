import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { aParametros, leerFiltros } from "@/dominio/filtros";

/**
 * Vistas guardadas del inventario contra una base real (entrega 6.1, paso 9).
 *
 * Criterio del paso: "Se guarda y se recupera un conjunto de filtros."
 *
 * Necesita DATABASE_URL_PRUEBAS. Usa usuarios propios `prueba-vistas-` y los borra (sus
 * vistas se borran en cascada).
 */

const url = process.env.DATABASE_URL_PRUEBAS;

describe.skipIf(!url)("vistas guardadas contra la base", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { usuario, vistaGuardada } = await import("@/db/esquema");
  const { borrarVista, guardarVista, listarVistas } = await import("@/vistas/vistas");

  const db = () => obtenerDb();
  let ana: string;
  let beto: string;

  const BUSQUEDA = "estado=pendienteDeAnalizar&tag=react&tag=vue&orden=severidad&sentido=desc";

  async function limpiar() {
    await db().delete(usuario).where(like(usuario.email, "prueba-vistas-%"));
  }

  async function crearUsuario(nombre: string) {
    const [u] = await db()
      .insert(usuario)
      .values({ nombre, email: `prueba-vistas-${nombre.toLowerCase()}@laincosoftware.com` })
      .returning({ id: usuario.id });
    return u.id;
  }

  beforeEach(async () => {
    await limpiar();
    ana = await crearUsuario("Ana");
    beto = await crearUsuario("Beto");
  });
  afterAll(async () => {
    await limpiar();
    await db().$client.end();
  });

  it("se guarda y se recupera un conjunto de filtros", async () => {
    const filtros = leerFiltros(new URLSearchParams(BUSQUEDA));

    const guardada = await guardarVista(db(), ana, { nombre: "React y Vue pendientes", filtros, compartida: false });
    const [recuperada] = await listarVistas(db(), ana);

    expect(guardada).toMatchObject({ resultado: "creada" });
    expect(recuperada).toMatchObject({ nombre: "React y Vue pendientes", propia: true, compartida: false, autor: "Ana" });
    expect(recuperada.filtros).toEqual(filtros);
    // El link de la vista lleva a la misma búsqueda.
    expect(recuperada.parametros).toBe(aParametros(filtros));
  });

  it("en la base queda como los parámetros de la URL, legible", async () => {
    await guardarVista(db(), ana, {
      nombre: "Vista",
      filtros: leerFiltros(new URLSearchParams(BUSQUEDA)),
      compartida: false,
    });

    const [fila] = await db().select().from(vistaGuardada).where(eq(vistaGuardada.usuarioId, ana));
    expect(fila.filtros).toEqual({
      estado: ["pendienteDeAnalizar"],
      tag: ["react", "vue"],
      orden: ["severidad"],
      sentido: ["desc"],
    });
  });

  it("al recuperarla se ignoran los valores que ya no existen", async () => {
    // Por ejemplo, un estado que se renombró después de guardar la vista.
    await db()
      .insert(vistaGuardada)
      .values({ nombre: "Vieja", usuarioId: ana, filtros: { estado: ["aprobada", "enAnalisis"], tag: ["react"] } });

    const [vista] = await listarVistas(db(), ana);

    expect(vista.filtros.estados).toEqual(["enAnalisis"]);
    expect(vista.parametros).toBe("estado=enAnalisis&tag=react");
  });

  it("guardar con un nombre que ya existe actualiza esa vista", async () => {
    await guardarVista(db(), ana, { nombre: "Mi vista", filtros: leerFiltros({ tag: "react" }), compartida: false });

    const resultado = await guardarVista(db(), ana, {
      nombre: "  Mi vista ",
      filtros: leerFiltros({ tag: "vue" }),
      compartida: true,
    });

    expect(resultado).toMatchObject({ resultado: "actualizada" });
    const vistas = await listarVistas(db(), ana);
    expect(vistas).toHaveLength(1);
    expect(vistas[0]).toMatchObject({ nombre: "Mi vista", parametros: "tag=vue", compartida: true });
  });

  it("dos usuarios pueden tener vistas con el mismo nombre", async () => {
    await guardarVista(db(), ana, { nombre: "Pendientes", filtros: leerFiltros({}), compartida: false });
    await guardarVista(db(), beto, { nombre: "Pendientes", filtros: leerFiltros({}), compartida: false });

    expect(await listarVistas(db(), ana)).toHaveLength(1);
    expect(await listarVistas(db(), beto)).toHaveLength(1);
  });

  it("las vistas compartidas de otros se ven, pero no son propias", async () => {
    await guardarVista(db(), beto, { nombre: "De Beto, compartida", filtros: leerFiltros({ tag: "cwe" }), compartida: true });
    await guardarVista(db(), beto, { nombre: "De Beto, privada", filtros: leerFiltros({}), compartida: false });
    await guardarVista(db(), ana, { nombre: "De Ana", filtros: leerFiltros({}), compartida: false });

    const deAna = await listarVistas(db(), ana);

    expect(deAna.map((v) => [v.nombre, v.propia, v.autor])).toEqual([
      ["De Ana", true, "Ana"],
      ["De Beto, compartida", false, "Beto"],
    ]);
  });

  it("solo el autor puede borrar una vista, aunque esté compartida", async () => {
    const { id } = await guardarVista(db(), beto, {
      nombre: "Compartida",
      filtros: leerFiltros({}),
      compartida: true,
    });

    expect(await borrarVista(db(), ana, id)).toBe(false);
    expect(await listarVistas(db(), beto)).toHaveLength(1);

    expect(await borrarVista(db(), beto, id)).toBe(true);
    expect(await listarVistas(db(), beto)).toEqual([]);
  });

  it.each([
    ["vacío", "   "],
    ["de más de 80 caracteres", "x".repeat(81)],
  ])("un nombre %s no se acepta", async (_caso, nombre) => {
    await expect(guardarVista(db(), ana, { nombre, filtros: leerFiltros({}), compartida: false })).rejects.toThrow(
      /nombre/,
    );
  });

  it("las vistas propias van primero, en orden alfabético", async () => {
    await guardarVista(db(), beto, { nombre: "A de Beto", filtros: leerFiltros({}), compartida: true });
    for (const nombre of ["zeta", "Beta", "alfa"]) {
      await guardarVista(db(), ana, { nombre, filtros: leerFiltros({}), compartida: false });
    }

    expect((await listarVistas(db(), ana)).map((v) => v.nombre)).toEqual(["alfa", "Beta", "zeta", "A de Beto"]);
  });
});
