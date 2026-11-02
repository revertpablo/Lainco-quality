import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Linter } from "eslint";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lanzarSincronizacion, leerProyectoDeSonar } from "../src/aceptados/lanzador.js";
import { crearProcessor } from "../src/aceptados/processor.js";
import { buscarRaiz, esCI } from "../src/entorno.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "repo-"));
  mkdirSync(join(repo, ".git"));
  mkdirSync(join(repo, "web", "src"), { recursive: true });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function aceptados(...issues: { archivo: string; regla: string; mensaje: string }[]) {
  writeFileSync(
    join(repo, "sonar-accepted.json"),
    JSON.stringify({
      version: 1,
      proyecto: "p",
      rama: null,
      generado: "2026-11-02T12:00:00+00:00",
      issues: issues.map((i) => ({ ...i, estado: "ACCEPTED" })),
    }),
  );
}

function mensaje(ruleId: string | null, message: string, line = 1): Linter.LintMessage {
  return { ruleId, message, line, column: 1, severity: 1 };
}

const SECRETO = mensaje("lainco/no-hardcoded-secrets", "Secreto hardcodeado en 'API_KEY'");
const OTRO = mensaje("lainco/no-hardcoded-secrets", "Secreto hardcodeado en 'DbConfig.password'", 5);

describe("el processor", () => {
  // Entorno explícito: con el de la máquina, en CI (GITHUB_ACTIONS) el processor no oculta nada.
  const local = crearProcessor({ entorno: {} });
  const archivo = () => join(repo, "web", "src", "config.ts");

  it("deja el código como está", () => {
    expect(local.preprocess!("const a = 1;", archivo())).toEqual(["const a = 1;"]);
    expect(local.supportsAutofix).toBe(true);
  });

  it("oculta los issues aceptados en Sonar: archivo + regla + mensaje, sin importar la línea", () => {
    aceptados({ archivo: "web/src/config.ts", regla: "lainco/no-hardcoded-secrets", mensaje: "Secreto hardcodeado en 'API_KEY'" });

    expect(local.postprocess!([[{ ...SECRETO, line: 40 }, OTRO]], archivo())).toEqual([OTRO]);
  });

  it("la ruta no distingue mayúsculas ni el tipo de barra", () => {
    aceptados({ archivo: "Web\\SRC/config.ts", regla: "lainco/no-hardcoded-secrets", mensaje: "Secreto hardcodeado en 'API_KEY'" });

    expect(local.postprocess!([[SECRETO]], archivo())).toEqual([]);
  });

  it.each([
    ["otro archivo", { archivo: "web/src/otro.ts", regla: "lainco/no-hardcoded-secrets", mensaje: "Secreto hardcodeado en 'API_KEY'" }],
    ["otra regla", { archivo: "web/src/config.ts", regla: "lainco/otra", mensaje: "Secreto hardcodeado en 'API_KEY'" }],
    ["otro mensaje (el símbolo cambió de nombre)", { archivo: "web/src/config.ts", regla: "lainco/no-hardcoded-secrets", mensaje: "Secreto hardcodeado en 'API_KEY_2'" }],
  ])("no oculta con %s", (_caso, issue) => {
    aceptados(issue);

    expect(local.postprocess!([[SECRETO]], archivo())).toEqual([SECRETO]);
  });

  it("no oculta errores de parseo (sin regla)", () => {
    aceptados({ archivo: "web/src/config.ts", regla: "lainco/no-hardcoded-secrets", mensaje: "Parsing error" });
    const deParseo = mensaje(null, "Parsing error");

    expect(local.postprocess!([[deParseo]], archivo())).toEqual([deParseo]);
  });

  it.each([
    ["no está", null],
    ["no es JSON", "{"],
    ["tiene otra versión", JSON.stringify({ version: 2, issues: [] })],
  ])("si el archivo %s, no oculta nada", (_caso, contenido) => {
    if (contenido !== null) writeFileSync(join(repo, "sonar-accepted.json"), contenido);

    expect(local.postprocess!([[SECRETO]], archivo())).toEqual([SECRETO]);
  });

  it("relee el archivo cuando cambia", () => {
    aceptados();
    expect(local.postprocess!([[SECRETO]], archivo())).toEqual([SECRETO]);

    aceptados({ archivo: "web/src/config.ts", regla: "lainco/no-hardcoded-secrets", mensaje: "Secreto hardcodeado en 'API_KEY'" });
    const despues = new Date(Date.now() + 5_000);
    utimesSync(join(repo, "sonar-accepted.json"), despues, despues);

    expect(local.postprocess!([[SECRETO]], archivo())).toEqual([]);
  });

  it.each([
    [{ CI: "true" }],
    [{ GITHUB_ACTIONS: "true" }],
    [{ TF_BUILD: "True" }],
    [{ LAINCO_SUPPRESS_ACCEPTED: "false" }],
  ])("con %j no oculta nada: en CI el issue tiene que seguir llegando a Sonar", (entorno) => {
    aceptados({ archivo: "web/src/config.ts", regla: "lainco/no-hardcoded-secrets", mensaje: "Secreto hardcodeado en 'API_KEY'" });

    expect(crearProcessor({ entorno }).postprocess!([[SECRETO]], archivo())).toEqual([SECRETO]);
  });

  it("LAINCO_SONAR_ACEPTADOS cambia dónde está el archivo", () => {
    mkdirSync(join(repo, "cache"));
    writeFileSync(
      join(repo, "cache", "sonar-accepted.json"),
      JSON.stringify({ version: 1, issues: [{ archivo: "web/src/config.ts", regla: "lainco/no-hardcoded-secrets", mensaje: "Secreto hardcodeado en 'API_KEY'" }] }),
    );
    const processor = crearProcessor({ entorno: { LAINCO_SONAR_ACEPTADOS: join(repo, "cache", "sonar-accepted.json") } });

    expect(processor.postprocess!([[SECRETO]], archivo())).toEqual([]);
  });
});

describe("entorno", () => {
  it.each([
    [{}, false],
    [{ CI: "true" }, true],
    [{ CI: "1" }, true],
    [{ CI: "false" }, false],
    [{ CI: "0" }, false],
    [{ GITHUB_ACTIONS: "true" }, true],
    [{ TF_BUILD: "True" }, true],
  ])("esCI(%j) es %s", (entorno, esperado) => {
    expect(esCI(entorno)).toBe(esperado);
  });

  it("la raíz es la carpeta con .git, carpeta o archivo (worktrees)", () => {
    expect(buscarRaiz(join(repo, "web", "src"))).toBe(repo);

    rmSync(join(repo, ".git"), { recursive: true });
    writeFileSync(join(repo, ".git"), "gitdir: ../otro");
    expect(buscarRaiz(join(repo, "web", "src"))).toBe(repo);
  });
});

describe("lanzarSincronizacion", () => {
  function lanzar(cambios: Partial<Parameters<typeof lanzarSincronizacion>[0]> = {}) {
    const lanzadas: string[][] = [];
    const lanzada = lanzarSincronizacion({
      raiz: repo,
      proyecto: "revertpablo_Lainco-quality",
      entorno: { LAINCO_SONAR_TOKEN: "t" },
      lanzar: (argumentos) => lanzadas.push(argumentos),
      ...cambios,
    });
    return { lanzada, lanzadas };
  }

  it("lanza la herramienta con la vigencia, hacia el archivo de la raíz", () => {
    const { lanzada, lanzadas } = lanzar({ organizacion: "revertpablo", rama: "main" });

    expect(lanzada).toBe(true);
    expect(lanzadas).toEqual([
      [
        "--proyecto", "revertpablo_Lainco-quality",
        "--salida", join(repo, "sonar-accepted.json"),
        "--vigencia-horas", "8",
        "--organizacion", "revertpablo",
        "--rama", "main",
      ],
    ]);
  });

  it("no lanza nada si el archivo está vigente", () => {
    aceptados();

    expect(lanzar().lanzada).toBe(false);
  });

  it.each([
    ["en CI", { entorno: { CI: "true", LAINCO_SONAR_TOKEN: "t" } }],
    ["sin token", { entorno: {} }],
    ["sin proyecto", { proyecto: null }],
    ["apagada", { entorno: { LAINCO_SONAR_SYNC: "false", LAINCO_SONAR_TOKEN: "t" } }],
  ])("no lanza nada %s", (_caso, cambios) => {
    expect(lanzar(cambios).lanzada).toBe(false);
  });

  it("lee el proyecto y la organización de sonar-project.properties", () => {
    writeFileSync(
      join(repo, "sonar-project.properties"),
      "# comentario\nsonar.projectKey = revertpablo_Lainco-quality\nsonar.organization=revertpablo\nsonar.sources=web\n",
    );

    expect(leerProyectoDeSonar(repo)).toEqual({ proyecto: "revertpablo_Lainco-quality", organizacion: "revertpablo" });
  });

  it("sin sonar-project.properties no hay proyecto", () => {
    expect(leerProyectoDeSonar(repo)).toEqual({ proyecto: null, organizacion: null });
  });
});
