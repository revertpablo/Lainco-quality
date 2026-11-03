import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Estado } from "@/dominio/valores";
import type { ReglaDelPaquete } from "@/paquete/globalconfig";
import { ErrorDeReglasJson, generarReglasJson, severidadesDeReglasJson } from "@/paquete/reglasJson";

/**
 * `reglas.json` de @lainco/eslint-config generado desde el estado de la app (entrega 6.4,
 * parte ESLint, paso 2; decisión L2): el `.globalconfig` de ESLint.
 */

// El de main antes del primer PR de la app: escrito a mano en la Fase 5.
const MANTENIDO_A_MANO = readFileSync(new URL("../../../src/ts/eslint-config/reglas.json", import.meta.url), "utf8");

const regla = (clave: string, estado: Estado, cambios: Partial<ReglaDelPaquete> = {}): ReglaDelPaquete => ({
  clave,
  titulo: `Título de ${clave}`,
  estado,
  severidadPorDefecto: "warning",
  eliminada: false,
  ...cambios,
});

describe("generar reglas.json", () => {
  it("con lainco/no-hardcoded-secrets incorporada, enciende lo mismo que el archivo mantenido a mano", () => {
    const generado = generarReglasJson([regla("lainco/no-hardcoded-secrets", Estado.Incorporada)]);

    expect(JSON.parse(generado).reglas).toEqual(JSON.parse(MANTENIDO_A_MANO).reglas);
  });

  it("Incorporadas en warn, el resto en off, ordenadas por clave, con el comentario y un salto al final", () => {
    const generado = generarReglasJson([
      regla("lainco/zeta", Estado.EnPrueba),
      regla("lainco/alfa", Estado.Incorporada),
      regla("lainco/beta", Estado.Descartada),
    ]);

    const leido = JSON.parse(generado);
    expect(Object.entries(leido.reglas)).toEqual([
      ["lainco/alfa", "warn"],
      ["lainco/beta", "off"],
      ["lainco/zeta", "off"],
    ]);
    expect(leido.comentario).toContain("Lo genera la app de catálogo de reglas");
    expect(leido.comentario).toContain("no editar a mano");
    expect(generado).toMatch(/^\{\n {2}"comentario": /);
    expect(generado.endsWith("}\n")).toBe(true);
  });

  it("no configura las reglas eliminadas del plugin", () => {
    const generado = generarReglasJson([regla("lainco/vieja", Estado.Incorporada, { eliminada: true }), regla("lainco/nueva", Estado.Incorporada)]);

    expect(JSON.parse(generado).reglas).toEqual({ "lainco/nueva": "warn" });
  });

  it("el mismo estado da siempre el mismo archivo", () => {
    const reglas = [regla("lainco/b", Estado.Incorporada), regla("lainco/a", Estado.EnAnalisis)];

    expect(generarReglasJson(reglas)).toBe(generarReglasJson(reglas.toReversed()));
  });

  it.each([
    ["una clave que no es lainco/<kebab>", [regla("no-debugger", Estado.Incorporada)], "'no-debugger' no es una clave de regla ESLint propia (lainco/<nombre-kebab>)."],
    ["una clave repetida", [regla("lainco/a", Estado.Incorporada), regla("lainco/a", Estado.EnAnalisis)], "lainco/a está dos veces."],
    ["severidad error", [regla("lainco/a", Estado.Incorporada, { severidadPorDefecto: "error" })], "lainco/a tiene severidad 'error': una regla propia nunca bloquea (ver CLAUDE.md)."],
    ["una Incorporada sin severidad", [regla("lainco/a", Estado.Incorporada, { severidadPorDefecto: null })], "lainco/a está Incorporada y no tiene una severidad que ESLint entienda: null."],
  ])("rechaza %s", (_caso, reglas, mensaje) => {
    expect(() => generarReglasJson(reglas)).toThrow(new ErrorDeReglasJson(mensaje));
  });
});

describe("leer reglas.json", () => {
  it("las severidades de cada regla", () => {
    expect(severidadesDeReglasJson(MANTENIDO_A_MANO)).toEqual(new Map([["lainco/no-hardcoded-secrets", "warn"]]));
  });

  it("un archivo que no es JSON o no tiene reglas no tiene severidades", () => {
    expect(severidadesDeReglasJson("{")).toEqual(new Map());
    expect(severidadesDeReglasJson("{}")).toEqual(new Map());
  });
});
