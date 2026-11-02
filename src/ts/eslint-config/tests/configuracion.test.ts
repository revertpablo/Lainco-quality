import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ESLint, type Linter } from "eslint";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import configuracion, { configurar, crearConfiguracion, leerReglas } from "../src/index.js";

async function lintear(codigo: string, archivo = "src/config.ts", config: Linter.Config[] = configuracion, cwd?: string) {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config, cwd });
  const [resultado] = await eslint.lintText(codigo, { filePath: archivo });
  return resultado!.messages.map((m) => `${m.ruleId}: ${m.message}`);
}

describe("la configuración", () => {
  it("enciende las reglas elegidas", async () => {
    expect(await lintear("export const API_KEY = 'clave-abc';")).toEqual([
      "lainco/no-hardcoded-secrets: Secreto hardcodeado en 'API_KEY'",
    ]);
  });

  it("no trae las recomendadas de ESLint ni de typescript-eslint", async () => {
    // debugger (no-debugger), any (no-explicit-any), variable sin usar (no-unused-vars),
    // var (no-var), require (no-require-imports): todas son de recommended.
    const codigo = "debugger; var x: any = require('a'); let sinUsar = 1;";

    expect(await lintear(codigo)).toEqual([]);
  });

  it.each(["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"])("analiza %s", async (archivo) => {
    expect(await lintear("const password = 'abc';", archivo)).toHaveLength(1);
  });

  it("entiende TSX", async () => {
    const codigo = "const token = 'abc'; export const C = () => <div title={token} />;";

    expect(await lintear(codigo, "a.tsx")).toEqual(["lainco/no-hardcoded-secrets: Secreto hardcodeado en 'token'"]);
  });

  it("solo configura reglas de reglas.json", () => {
    const reglas = configuracion.flatMap((bloque) => Object.keys(bloque.rules ?? {}));

    expect(reglas.toSorted()).toEqual(Object.keys(leerReglas()).toSorted());
  });
});

describe("crearConfiguracion", () => {
  it("una regla en 'off' no corre", async () => {
    const config = crearConfiguracion({ "lainco/no-hardcoded-secrets": "off" });

    expect(await lintear("const password = 'abc';", "a.ts", config)).toEqual([]);
  });

  it("rechaza 'error': el que bloquea es el quality gate", () => {
    expect(() => crearConfiguracion({ "lainco/no-hardcoded-secrets": "error" })).toThrow(
      "lainco/no-hardcoded-secrets: severidad 'error' no permitida (solo 'warn' u 'off')",
    );
  });

  it("rechaza una regla que no existe en los plugins registrados", () => {
    expect(() => crearConfiguracion({ "lainco/no-existe": "warn" })).toThrow(
      "lainco/no-existe: la regla no existe en los plugins de la configuración",
    );
  });
});

describe("configurar: issues aceptados en Sonar", () => {
  let repo: string;
  const SECRETO = "export const API_KEY = 'clave-abc';";

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "repo-"));
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "web"));
    writeFileSync(
      join(repo, "sonar-accepted.json"),
      JSON.stringify({
        version: 1,
        proyecto: "p",
        rama: null,
        generado: "2026-11-02T12:00:00+00:00",
        issues: [{ archivo: "web/config.ts", regla: "lainco/no-hardcoded-secrets", mensaje: "Secreto hardcodeado en 'API_KEY'", estado: "ACCEPTED" }],
      }),
    );
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("en local oculta los issues aceptados", async () => {
    const config = configurar({ entorno: {}, raiz: repo });

    expect(await lintear(SECRETO, join(repo, "web", "config.ts"), config, repo)).toEqual([]);
    expect(await lintear(SECRETO, join(repo, "web", "otro.ts"), config, repo)).toHaveLength(1);
  });

  it("en CI no engancha el processor: el issue tiene que llegar a Sonar", async () => {
    const config = configurar({ entorno: { CI: "true" }, raiz: repo });

    expect(config[0]!.processor).toBeUndefined();
    expect(await lintear(SECRETO, join(repo, "web", "config.ts"), config, repo)).toHaveLength(1);
  });

  it("en local lanza la sincronización con el proyecto de sonar-project.properties", () => {
    writeFileSync(join(repo, "sonar-project.properties"), "sonar.projectKey=p\nsonar.organization=o\n");
    rmSync(join(repo, "sonar-accepted.json"));
    const lanzadas: string[][] = [];

    configurar({ entorno: { LAINCO_SONAR_TOKEN: "t" }, raiz: repo, lanzar: (a) => lanzadas.push(a) });

    expect(lanzadas).toEqual([
      ["--proyecto", "p", "--salida", join(repo, "sonar-accepted.json"), "--vigencia-horas", "8", "--organizacion", "o"],
    ]);
  });

  it("las opciones de sonar mandan sobre sonar-project.properties", () => {
    writeFileSync(join(repo, "sonar-project.properties"), "sonar.projectKey=p\n");
    rmSync(join(repo, "sonar-accepted.json"));
    const lanzadas: string[][] = [];

    configurar({
      sonar: { proyecto: "otro", vigenciaHoras: 2 },
      entorno: { LAINCO_SONAR_TOKEN: "t" },
      raiz: repo,
      lanzar: (a) => lanzadas.push(a),
    });

    expect(lanzadas[0]!.slice(0, 2)).toEqual(["--proyecto", "otro"]);
    expect(lanzadas[0]).toContain("2");
  });

  it("en CI no lanza la sincronización", () => {
    writeFileSync(join(repo, "sonar-project.properties"), "sonar.projectKey=p\n");
    rmSync(join(repo, "sonar-accepted.json"));
    const lanzadas: string[][] = [];

    configurar({ entorno: { CI: "true", LAINCO_SONAR_TOKEN: "t" }, raiz: repo, lanzar: (a) => lanzadas.push(a) });

    expect(lanzadas).toEqual([]);
  });
});
