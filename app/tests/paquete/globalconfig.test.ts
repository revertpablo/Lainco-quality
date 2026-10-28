import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Estado } from "@/dominio/valores";
import { ErrorDeGlobalconfig, generarGlobalconfig, type ReglaDelPaquete } from "@/paquete/globalconfig";

/**
 * El `.globalconfig` del paquete Lainco.Analyzers generado desde el estado de la app
 * (entrega 6.4, paso 5; decisión R3).
 *
 * Criterio del paso: "con LAIN004 y LAIN005 incorporadas, el archivo generado equivale al
 * que hoy se mantiene a mano".
 */

// El de main antes del primer PR de la app (tests/fixtures/paquete/LEEME.md).
const MANTENIDO_A_MANO = readFileSync(new URL("../fixtures/paquete/Lainco.Analyzers.globalconfig", import.meta.url), "utf8");

const regla = (clave: string, estado: Estado, cambios: Partial<ReglaDelPaquete> = {}): ReglaDelPaquete => ({
  clave,
  titulo: `Título de ${clave}`,
  estado,
  severidadPorDefecto: "warning",
  eliminada: false,
  ...cambios,
});

/** Lo que lee el compilador: las líneas que no son comentarios ni están vacías. */
const configuracion = (texto: string) =>
  texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

describe("generar el .globalconfig", () => {
  it("con LAIN004 y LAIN005 incorporadas, configura lo mismo que el archivo mantenido a mano", () => {
    const generado = generarGlobalconfig([
      regla("LAIN005", Estado.Incorporada, { titulo: "No se permiten métodos estáticos" }),
      regla("LAIN004", Estado.Incorporada, { titulo: "No se permite inicialización inline de properties" }),
    ]);

    expect(configuracion(generado)).toEqual(configuracion(MANTENIDO_A_MANO));
    expect(configuracion(generado)).toEqual([
      "is_global = true",
      "dotnet_diagnostic.LAIN004.severity = warning",
      "dotnet_diagnostic.LAIN005.severity = warning",
    ]);
  });

  it("escribe el archivo completo: encabezado, y por regla, ordenadas por clave, su título y su severidad", () => {
    const generado = generarGlobalconfig([
      regla("LAIN006", Estado.ARevisar, { titulo: "No se permite ToList() sobre queries" }),
      regla("LAIN004", Estado.Incorporada, { titulo: "No se permite inicialización inline de properties" }),
    ]);

    expect(generado).toBe(
      [
        "# Severidades de las reglas LAIN.",
        "#",
        "# Lo genera la app de catálogo de reglas a partir de las decisiones registradas",
        "# (entrega 6.4): no editar a mano. Para cambiar la severidad de una regla, se decide en",
        "# la app, que abre el PR con este archivo.",
        "#",
        "# Este archivo viaja dentro del paquete NuGet: cambiar una severidad acá y publicar una",
        "# versión nueva cambia lo que ven todos los repositorios, sin tocar ningún .editorconfig.",
        "#",
        "# Las reglas LAIN nacen apagadas (decisión R6): este archivo enciende las Incorporadas,",
        "# con la severidad por defecto de su descriptor, y deja en 'none' las demás. Nunca",
        "# 'error': el que bloquea es el quality gate de SonarQube, y el suppressor de la Fase 4",
        "# necesita poder actuar sobre el diagnóstico (ver CLAUDE.md).",
        "",
        "is_global = true",
        "",
        "# LAIN004 — No se permite inicialización inline de properties",
        "dotnet_diagnostic.LAIN004.severity = warning",
        "",
        "# LAIN006 — No se permite ToList() sobre queries",
        "dotnet_diagnostic.LAIN006.severity = none",
        "",
      ].join("\n"),
    );
  });

  it.each([Estado.PendienteDeAnalizar, Estado.ARevisar, Estado.EnPrueba, Estado.Descartada])(
    "una regla %s va apagada",
    (estado) => {
      expect(configuracion(generarGlobalconfig([regla("LAIN004", estado)]))).toContain("dotnet_diagnostic.LAIN004.severity = none");
    },
  );

  it.each(["suggestion", "silent"])("una Incorporada va con la severidad de su descriptor: %s", (severidad) => {
    expect(configuracion(generarGlobalconfig([regla("LAIN004", Estado.Incorporada, { severidadPorDefecto: severidad })]))).toContain(
      `dotnet_diagnostic.LAIN004.severity = ${severidad}`,
    );
  });

  it("las reglas eliminadas del paquete no se configuran: el paquete ya no las trae", () => {
    const generado = generarGlobalconfig([regla("LAIN004", Estado.Incorporada), regla("LAIN005", Estado.Incorporada, { eliminada: true })]);

    expect(generado).not.toContain("LAIN005");
  });

  it("sin reglas, queda solo el encabezado", () => {
    expect(configuracion(generarGlobalconfig([]))).toEqual(["is_global = true"]);
  });

  it("un título con saltos de línea queda en un solo comentario", () => {
    const generado = generarGlobalconfig([regla("LAIN004", Estado.ARevisar, { titulo: "Dos\nlíneas  y\tespacios" })]);

    expect(generado).toContain("# LAIN004 — Dos líneas y espacios\n");
  });

  it("siempre igual para el mismo estado, con finales de línea \\n", () => {
    const reglas = [regla("LAIN004", Estado.Incorporada), regla("LAIN005", Estado.Descartada)];

    expect(generarGlobalconfig(reglas)).toBe(generarGlobalconfig([...reglas].reverse()));
    expect(generarGlobalconfig(reglas)).not.toContain("\r");
    expect(generarGlobalconfig(reglas).endsWith("\n")).toBe(true);
  });

  it("nunca 'error': si una Incorporada lo trae, no genera nada", () => {
    expect(() => generarGlobalconfig([regla("LAIN004", Estado.Incorporada, { severidadPorDefecto: "error" })])).toThrow(
      new ErrorDeGlobalconfig("LAIN004 tiene severidad 'error': una regla propia nunca bloquea el build (ver CLAUDE.md)."),
    );
  });

  it("una Incorporada sin severidad conocida es un error de datos", () => {
    expect(() => generarGlobalconfig([regla("LAIN004", Estado.Incorporada, { severidadPorDefecto: null })])).toThrow(
      "LAIN004 está Incorporada y no tiene una severidad válida para el .globalconfig: null.",
    );
    expect(() => generarGlobalconfig([regla("LAIN004", Estado.Incorporada, { severidadPorDefecto: "MAJOR" })])).toThrow(
      "LAIN004 está Incorporada y no tiene una severidad válida para el .globalconfig: MAJOR.",
    );
  });

  it("rechaza claves que no son LAIN### y claves repetidas", () => {
    expect(() => generarGlobalconfig([regla("csharpsquid:S2325", Estado.ARevisar)])).toThrow(
      "'csharpsquid:S2325' no es una clave de regla Roslyn propia (LAIN###).",
    );
    expect(() => generarGlobalconfig([regla("LAIN004", Estado.ARevisar), regla("LAIN004", Estado.Incorporada)])).toThrow(
      "LAIN004 está dos veces.",
    );
  });
});
