import { describe, expect, it } from "vitest";

import { FILTROS_POR_DEFECTO, aParametros, leerFiltros } from "@/dominio/filtros";

/**
 * Filtros del inventario (entrega 6.1, paso 8; FASE-6.md, sección 5). Viven en la URL: así
 * se comparten con un link y el paso 9 (vistas guardadas) solo tiene que guardarlos.
 */

describe("leer la URL", () => {
  it("sin parámetros, los filtros por defecto", () => {
    expect(leerFiltros({})).toEqual(FILTROS_POR_DEFECTO);
  });

  it("lee cada filtro, con valores repetidos como lista", () => {
    const filtros = leerFiltros({
      q: "  null  ",
      estado: ["pendienteDeAnalizar", "aRevisar"],
      lenguaje: "cs",
      origen: "sonar",
      tipo: ["BUG", "VULNERABILITY"],
      severidad: "MAJOR",
      tag: ["react", "angular"],
      atributo: "CLEAR",
      novedad: "nuevas",
      deprecadas: "excluir",
      orden: "severidad",
      sentido: "desc",
    });

    expect(filtros).toEqual({
      q: "null",
      estados: ["pendienteDeAnalizar", "aRevisar"],
      lenguajes: ["cs"],
      origenes: ["sonar"],
      tipos: ["BUG", "VULNERABILITY"],
      severidades: ["MAJOR"],
      tags: ["react", "angular"],
      atributos: ["CLEAR"],
      novedad: "nuevas",
      deprecadas: "excluir",
      orden: "severidad",
      sentido: "desc",
    });
  });

  it("acepta URLSearchParams", () => {
    const filtros = leerFiltros(new URLSearchParams("tag=react&tag=vue&estado=aRevisar"));

    expect(filtros.tags).toEqual(["react", "vue"]);
    expect(filtros.estados).toEqual(["aRevisar"]);
  });

  it("ignora los valores que no existen, en vez de fallar", () => {
    // Una URL vieja o editada a mano no tiene que romper la pantalla.
    const filtros = leerFiltros({
      estado: ["aprobada", "aRevisar"],
      lenguaje: "java",
      origen: "otro",
      novedad: "viejas",
      deprecadas: "quizas",
      orden: "color",
      sentido: "arriba",
    });

    expect(filtros).toEqual({ ...FILTROS_POR_DEFECTO, estados: ["aRevisar"] });
  });

  it("sin repetidos ni vacíos", () => {
    expect(leerFiltros({ tag: ["react", "", "react", " vue "] }).tags).toEqual(["react", "vue"]);
  });

  it("acota la cantidad y el largo de los valores", () => {
    const filtros = leerFiltros({ tag: Array.from({ length: 200 }, (_, i) => `t${i}`), q: "x".repeat(500) });

    expect(filtros.tags).toHaveLength(50);
    expect(filtros.q).toHaveLength(100);
  });
});

describe("escribir la URL", () => {
  it("los filtros por defecto no escriben nada", () => {
    expect(aParametros(FILTROS_POR_DEFECTO)).toBe("");
  });

  it("ida y vuelta dan lo mismo", () => {
    const filtros = leerFiltros({
      q: "Dispose",
      estado: ["pendienteDeAnalizar"],
      tag: ["react", "vue"],
      novedad: "modificadas",
      deprecadas: "solo",
      orden: "nombre",
      sentido: "desc",
    });

    expect(leerFiltros(new URLSearchParams(aParametros(filtros)))).toEqual(filtros);
  });

  it("siempre en el mismo orden, para que la misma búsqueda dé la misma URL", () => {
    const a = aParametros(leerFiltros({ tag: "react", estado: "aRevisar" }));
    const b = aParametros(leerFiltros({ estado: "aRevisar", tag: "react" }));

    expect(a).toBe(b);
    expect(a).toBe("estado=aRevisar&tag=react");
  });
});
