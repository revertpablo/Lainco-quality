import { describe, expect, it } from "vitest";

import { perfilesDesdeEntorno, VARIABLE_DE_PERFIL } from "@/sonar/configuracion";

/** Perfiles de Sonar que gestiona la app (entrega 6.2, paso 1; decisión P3). */

describe("perfiles de Sonar por variable de entorno", () => {
  it("lee el nombre del perfil de cada lenguaje", () => {
    expect(perfilesDesdeEntorno({ SONAR_PERFIL_CS: "Lainco C#", SONAR_PERFIL_TS: "Lainco Typescript" })).toEqual({
      cs: "Lainco C#",
      ts: "Lainco Typescript",
    });
  });

  it("saca los espacios de los bordes, no los del medio", () => {
    expect(perfilesDesdeEntorno({ SONAR_PERFIL_CS: "  Lainco C# ", SONAR_PERFIL_TS: "Lainco  Typescript\n" })).toEqual({
      cs: "Lainco C#",
      ts: "Lainco  Typescript",
    });
  });

  it.each<[string, Record<string, string>, string]>([
    ["faltan las dos", {}, "SONAR_PERFIL_CS, SONAR_PERFIL_TS"],
    ["falta la de TypeScript", { SONAR_PERFIL_CS: "Lainco C#" }, "SONAR_PERFIL_TS"],
    ["la de C# está vacía", { SONAR_PERFIL_CS: "  ", SONAR_PERFIL_TS: "Lainco Typescript" }, "SONAR_PERFIL_CS"],
  ])("rechaza la configuración si %s, diciendo cuál", (_caso, entorno, faltan) => {
    expect(() => perfilesDesdeEntorno(entorno)).toThrow(`Faltan variables de entorno para publicar en SonarQube: ${faltan}.`);
  });

  it("no tiene valores por defecto: publicar en el perfil equivocado cambia lo que analiza Sonar", () => {
    expect(() => perfilesDesdeEntorno({})).toThrow();
  });

  it("hay una variable por cada lenguaje del inventario", () => {
    expect(Object.keys(VARIABLE_DE_PERFIL).sort()).toEqual(["cs", "ts"]);
  });
});
