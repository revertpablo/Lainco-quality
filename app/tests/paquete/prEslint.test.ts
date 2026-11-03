import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ErrorDelPr } from "@/paquete/pr";
import { planDelPrEslint, RUTAS_ESLINT, subirParcheDelPackageJson, versionDelPackageJson } from "@/paquete/prEslint";

/**
 * Lo que propone el PR de @lainco/eslint-config (entrega 6.4, parte ESLint, decisión L3):
 * `reglas.json` y el parche de la versión de la config. Sin red ni base.
 */

const leer = (ruta: string) => readFileSync(new URL(`../../../${ruta}`, import.meta.url), "utf8");
const MAIN = { reglas: leer(RUTAS_ESLINT.reglas), paquete: leer(RUTAS_ESLINT.paquete) };

const reglasJson = (reglas: Record<string, string>) => `${JSON.stringify({ comentario: "x", reglas }, null, 2)}\n`;

describe("el PR de @lainco/eslint-config", () => {
  it("sube el parche de la versión sin tocar el resto del package.json", () => {
    const { anterior, nueva, texto } = subirParcheDelPackageJson(MAIN.paquete);

    expect([anterior, nueva]).toEqual(["0.1.0", "0.1.1"]);
    expect(texto).toBe(MAIN.paquete.replace('"version": "0.1.0"', '"version": "0.1.1"'));
    // La dependencia exacta del plugin no cambia: las reglas del plugin son las mismas.
    expect(JSON.parse(texto).dependencies["@lainco/eslint-plugin"]).toBe("0.1.0");
  });

  it("lee la versión del package.json", () => {
    expect(versionDelPackageJson(MAIN.paquete)).toBe("0.1.0");
    expect(versionDelPackageJson("{}")).toBeNull();
  });

  it.each([
    ["sin versión", "{}", "src/ts/eslint-config/package.json no tiene un \"version\"."],
    ["con sufijo", '{ "version": "0.2.0-beta.1" }', "La versión de @lainco/eslint-config en main es '0.2.0-beta.1': para subirla sola tiene que ser X.Y.Z, sin sufijo."],
  ])("no sube una versión %s", (_caso, texto, mensaje) => {
    expect(() => subirParcheDelPackageJson(texto)).toThrow(new ErrorDelPr(mensaje));
  });

  it("si main ya tiene el reglas.json de la app, no hay nada que proponer", () => {
    expect(planDelPrEslint({ main: MAIN, generado: MAIN.reglas.replace(/\n/g, "\r\n") })).toBeNull();
  });

  it("si no, cambia reglas.json y la versión, y lista las reglas que cambian", () => {
    const enMain = { ...MAIN, reglas: reglasJson({ "lainco/a": "warn", "lainco/b": "warn" }) };
    const generado = reglasJson({ "lainco/a": "warn", "lainco/b": "off", "lainco/c": "warn" });

    const plan = planDelPrEslint({ main: enMain, generado });

    expect(plan).toEqual({
      versionAnterior: "0.1.0",
      version: "0.1.1",
      archivos: [
        { ruta: "src/ts/eslint-config/reglas.json", contenido: generado },
        { ruta: "src/ts/eslint-config/package.json", contenido: MAIN.paquete.replace('"version": "0.1.0"', '"version": "0.1.1"') },
      ],
      cambios: [
        { clave: "lainco/b", enMain: "warn", conElPr: "off" },
        { clave: "lainco/c", enMain: null, conElPr: "warn" },
      ],
      releasesMovidas: false,
    });
  });
});
