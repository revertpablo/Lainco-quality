import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ErrorDeCatalogo, leerCatalogo, reglasDelCatalogo } from "@/catalogo/formato";
import { huellaDeRegla } from "@/dominio/sincronizacion";

/**
 * El catálogo de reglas propias (docs/catalogo-de-reglas.md) del lado de la app (entrega
 * 6.4, paso 3). La grabación es el asset del release v0.1.0 de Lainco.Analyzers.
 */

const grabado: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("../fixtures/roslyn/reglas-roslyn.json", import.meta.url), "utf8"),
);

const conCambios = (cambios: Record<string, unknown>) => ({ ...structuredClone(grabado), ...cambios });
const conRegla = (cambios: Record<string, unknown>) => {
  const catalogo = structuredClone(grabado) as { reglas: Record<string, unknown>[] };
  catalogo.reglas[0] = { ...catalogo.reglas[0], ...cambios };
  return catalogo;
};

describe("leer el catálogo de reglas propias", () => {
  it("lee el catálogo del release 0.1.0", () => {
    const catalogo = leerCatalogo(grabado, "roslyn");

    expect(catalogo).toMatchObject({ formato: 1, origen: "roslyn", paquete: "Lainco.Analyzers", version: "0.1.0", lenguaje: "cs" });
    expect(catalogo.reglas.map((r) => r.clave)).toEqual(["LAIN004", "LAIN005"]);
  });

  it("ignora los campos que no conoce: agregar un campo no cambia el formato", () => {
    const catalogo = leerCatalogo({ ...conRegla({ nueva: 1 }), otro: "x" }, "roslyn");

    expect(catalogo.reglas[0]).not.toHaveProperty("nueva");
  });

  it("rechaza un formato que no conoce, con un mensaje que lo dice", () => {
    expect(() => leerCatalogo(conCambios({ formato: 2 }), "roslyn")).toThrow(
      new ErrorDeCatalogo("El catálogo tiene el formato 2 y la app conoce el 1: hay que actualizar la app."),
    );
    expect(() => leerCatalogo("no es un catálogo", "roslyn")).toThrow(ErrorDeCatalogo);
  });

  it("rechaza un catálogo de otro origen", () => {
    expect(() => leerCatalogo(grabado, "eslint")).toThrow("El catálogo es de 'roslyn' y se esperaba uno de 'eslint'.");
  });

  it.each([
    ["sin reglas", conCambios({ reglas: [] })],
    ["con un lenguaje desconocido", conCambios({ lenguaje: "java" })],
    ["con severidad error", conRegla({ severidadPorDefecto: "error" })],
    ["con una regla sin título", conRegla({ titulo: "" })],
    ["con una regla sin documentación", conRegla({ documentacion: undefined })],
  ])("rechaza un catálogo %s", (_caso, catalogo) => {
    expect(() => leerCatalogo(catalogo, "roslyn")).toThrow(ErrorDeCatalogo);
  });

  it("rechaza claves que no son de reglas propias del origen", () => {
    expect(() => leerCatalogo(conRegla({ clave: "csharpsquid:S2325" }), "roslyn")).toThrow(
      "La regla 'csharpsquid:S2325' no tiene una clave de Roslyn (LAIN###).",
    );
  });

  it("rechaza una clave repetida", () => {
    const catalogo = structuredClone(grabado) as { reglas: Record<string, unknown>[] };
    catalogo.reglas[1] = { ...catalogo.reglas[1], clave: "LAIN004" };

    expect(() => leerCatalogo(catalogo, "roslyn")).toThrow("La regla LAIN004 está repetida en el catálogo.");
  });
});

describe("las reglas del catálogo, como las compara la sincronización", () => {
  it("traduce cada regla a la forma común a todos los orígenes", () => {
    const [lain004] = reglasDelCatalogo(leerCatalogo(grabado, "roslyn"));

    expect(lain004).toMatchObject({
      clave: "LAIN004",
      nombre: "No se permite inicialización inline de properties",
      lenguaje: "cs",
      estado: "READY",
      tipo: null,
      // R3: la severidad la dice la regla, con las palabras del .globalconfig.
      severidad: "warning",
      tags: ["diseño"],
      atributoCleanCode: null,
      impactos: [],
      parametros: [],
    });
    // La descripción es la documentación completa, en markdown.
    expect(lain004.descripcion).toMatch(/^# LAIN004 — No se permite inicialización inline de properties\n/);
  });

  it("cambiar la documentación o la severidad cambia la huella; cambiar el título, no", () => {
    const base = reglasDelCatalogo(leerCatalogo(grabado, "roslyn"))[0];
    const conOtra = (cambios: Record<string, unknown>) => reglasDelCatalogo(leerCatalogo(conRegla(cambios), "roslyn"))[0];

    expect(huellaDeRegla(conOtra({ documentacion: "# Otra\n" }))).not.toBe(huellaDeRegla(base));
    expect(huellaDeRegla(conOtra({ severidadPorDefecto: "suggestion" }))).not.toBe(huellaDeRegla(base));
    expect(huellaDeRegla(conOtra({ titulo: "Otro título" }))).toBe(huellaDeRegla(base));
  });
});
