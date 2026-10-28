import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ErrorDelPr,
  cuerpoDelPr,
  moverAShipped,
  planDelPr,
  RUTAS,
  severidadesDelGlobalconfig,
  subirParche,
  tituloDelPr,
} from "@/paquete/pr";

/**
 * Lo que propone el PR de configuración (entrega 6.4, paso 6; decisiones R4 y R5), sin
 * red ni base: qué archivos cambian, a qué versión y con qué descripción. Usa como "lo que
 * hay en main" los archivos del repositorio antes del primer PR de la app
 * (tests/fixtures/paquete/).
 */

// Los archivos de main antes del primer PR de la app (tests/fixtures/paquete/LEEME.md).
const repo = (ruta: string) => readFileSync(new URL(`../fixtures/paquete/${ruta.split("/").at(-1)}`, import.meta.url), "utf8");
const MAIN = {
  globalconfig: repo(RUTAS.globalconfig),
  csproj: repo(RUTAS.csproj),
  shipped: repo(RUTAS.shipped),
  unshipped: repo(RUTAS.unshipped),
};

const GLOBALCONFIG_DE_LA_APP = [
  "# encabezado",
  "",
  "is_global = true",
  "",
  "# LAIN004 — Uno",
  "dotnet_diagnostic.LAIN004.severity = warning",
  "",
  "# LAIN005 — Dos",
  "dotnet_diagnostic.LAIN005.severity = none",
  "",
].join("\n");

describe("subir la versión del paquete", () => {
  it("sube el parche en el <Version> del proyecto", () => {
    const csproj = "<Project>\n  <PropertyGroup>\n    <Version>0.1.9</Version>\n  </PropertyGroup>\n</Project>\n";

    expect(subirParche(csproj)).toEqual({
      anterior: "0.1.9",
      nueva: "0.1.10",
      texto: "<Project>\n  <PropertyGroup>\n    <Version>0.1.10</Version>\n  </PropertyGroup>\n</Project>\n",
    });
  });

  it("funciona con el proyecto del paquete", () => {
    expect(subirParche(MAIN.csproj)).toMatchObject({ anterior: "0.1.0", nueva: "0.1.1" });
  });

  it.each([
    ["sin <Version>", "<Project></Project>"],
    ["con dos <Version>", "<Version>1.0.0</Version><Version>1.0.1</Version>"],
    ["con una versión previa", "<Version>0.2.0-beta.1</Version>"],
  ])("falla %s: lo tiene que arreglar una persona", (_caso, csproj) => {
    expect(() => subirParche(csproj)).toThrow(ErrorDelPr);
  });
});

describe("mover las reglas sin publicar a la versión nueva", () => {
  it("pasa las secciones de Unshipped a Shipped, bajo la versión, y deja en Unshipped solo los comentarios", () => {
    const shipped = "; publicadas\n\n## Release 0.1.0\n\n### New Rules\n\nRule ID | Category | Severity | Notes\n--------|----------|----------|------\nLAIN004 | Diseño | Warning | x\n";
    const unshipped =
      "; sin publicar\r\n;\r\n; ### New Rules (ejemplo)\r\n\r\n### Changed Rules\r\n\r\nRule ID | New Category | New Severity | Old Category | Old Severity | Notes\r\n--------|---|---|---|---|---\r\nLAIN004 | Diseño | Disabled | Diseño | Warning | x\r\n";

    expect(moverAShipped(shipped, unshipped, "0.1.1")).toEqual({
      shipped:
        "; publicadas\n\n## Release 0.1.0\n\n### New Rules\n\nRule ID | Category | Severity | Notes\n--------|----------|----------|------\nLAIN004 | Diseño | Warning | x\n" +
        "\n## Release 0.1.1\n\n### Changed Rules\n\nRule ID | New Category | New Severity | Old Category | Old Severity | Notes\n--------|---|---|---|---|---\nLAIN004 | Diseño | Disabled | Diseño | Warning | x\n",
      unshipped: "; sin publicar\n;\n; ### New Rules (ejemplo)\n",
    });
  });

  it("con los archivos de main: el cambio de LAIN004 y LAIN005 a Disabled pasa a la 0.1.1", () => {
    const movidas = moverAShipped(MAIN.shipped, MAIN.unshipped, "0.1.1")!;

    expect(movidas.shipped).toContain("## Release 0.1.1\n\n### Changed Rules");
    expect(movidas.shipped).toMatch(/LAIN005 \| Diseño\s+\| Disabled/);
    expect(movidas.unshipped).not.toMatch(/^LAIN/m);
    expect(movidas.unshipped).toMatch(/^; LAIN0XX/m);
  });

  it("si Unshipped no tiene reglas, no hay nada que mover", () => {
    expect(moverAShipped(MAIN.shipped, "; nada\n;\n; ### New Rules\n", "0.1.1")).toBeNull();
  });

  it("si la versión ya está en Shipped, falla", () => {
    expect(() => moverAShipped(MAIN.shipped, MAIN.unshipped, "0.1.0")).toThrow("AnalyzerReleases.Shipped.md ya tiene la versión 0.1.0.");
  });
});

describe("severidades de un .globalconfig", () => {
  it("lee cada regla, sin importar comentarios ni finales de línea", () => {
    expect(severidadesDelGlobalconfig(MAIN.globalconfig.replace(/\n/g, "\r\n"))).toEqual(
      new Map([
        ["LAIN004", "warning"],
        ["LAIN005", "warning"],
      ]),
    );
  });
});

describe("qué propone el PR", () => {
  it("si el .globalconfig de main ya es el de la app, nada", () => {
    expect(planDelPr({ main: MAIN, globalconfig: MAIN.globalconfig.replace(/\n/g, "\r\n") })).toBeNull();
  });

  it("si difiere: el .globalconfig, la versión y AnalyzerReleases, con los cambios regla por regla", () => {
    const plan = planDelPr({ main: MAIN, globalconfig: GLOBALCONFIG_DE_LA_APP })!;

    expect(plan.versionAnterior).toBe("0.1.0");
    expect(plan.version).toBe("0.1.1");
    expect(plan.archivos.map((a) => a.ruta)).toEqual([RUTAS.globalconfig, RUTAS.csproj, RUTAS.shipped, RUTAS.unshipped]);
    expect(plan.archivos[0].contenido).toBe(GLOBALCONFIG_DE_LA_APP);
    expect(plan.archivos[1].contenido).toContain("<Version>0.1.1</Version>");
    expect(plan.archivos[2].contenido).toContain("## Release 0.1.1");
    expect(plan.cambios).toEqual([{ clave: "LAIN005", enMain: "warning", conElPr: "none" }]);
    expect(plan.releasesMovidas).toBe(true);
  });

  it("sin reglas en Unshipped, no toca AnalyzerReleases", () => {
    const plan = planDelPr({ main: { ...MAIN, unshipped: "; nada\n" }, globalconfig: GLOBALCONFIG_DE_LA_APP })!;

    expect(plan.archivos.map((a) => a.ruta)).toEqual([RUTAS.globalconfig, RUTAS.csproj]);
    expect(plan.releasesMovidas).toBe(false);
  });

  it("una regla que el PR saca (ya no está en el paquete) también es un cambio", () => {
    const plan = planDelPr({ main: MAIN, globalconfig: "is_global = true\n\ndotnet_diagnostic.LAIN004.severity = warning\n" })!;

    expect(plan.cambios).toEqual([{ clave: "LAIN005", enMain: "warning", conElPr: null }]);
  });

  it("una regla que no estaba en main aparece como nueva", () => {
    const plan = planDelPr({ main: { ...MAIN, globalconfig: "is_global = true\n" }, globalconfig: GLOBALCONFIG_DE_LA_APP })!;

    expect(plan.cambios).toEqual([
      { clave: "LAIN004", enMain: null, conElPr: "warning" },
      { clave: "LAIN005", enMain: null, conElPr: "none" },
    ]);
  });
});

describe("título y descripción del PR", () => {
  it("el título dice el paquete y la versión", () => {
    expect(tituloDelPr("0.1.1")).toBe("Lainco.Analyzers 0.1.1: severidades decididas en el catálogo de reglas");
  });

  it("la descripción lista cada cambio con la decisión que lo explica", () => {
    const cuerpo = cuerpoDelPr({
      versionAnterior: "0.1.0",
      version: "0.1.1",
      cambios: [
        { clave: "LAIN004", enMain: "none", conElPr: "warning" },
        { clave: "LAIN006", enMain: null, conElPr: "none" },
        { clave: "LAIN007", enMain: "warning", conElPr: null },
      ],
      decisiones: new Map([
        [
          "LAIN004",
          { titulo: "Sin inicialización | inline", estado: "Incorporada", autor: "Federico Sánchez", fecha: new Date("2026-10-28T19:00:00Z"), justificacion: "Regla dura\nacordada." },
        ],
      ]),
      releasesMovidas: true,
    });

    expect(cuerpo).toBe(
      [
        "Lleva al paquete las decisiones del catálogo de reglas: actualiza el `.globalconfig` de `Lainco.Analyzers` y sube la versión de 0.1.0 a 0.1.1. **Al mergearlo, el workflow publica la versión nueva.**",
        "",
        "| Regla | En main | Con este PR | Decisión |",
        "|---|---|---|---|",
        "| LAIN004 — Sin inicialización \\| inline | `none` | `warning` | Incorporada por Federico Sánchez el 28/10/2026: Regla dura acordada. |",
        "| LAIN006 | (no está) | `none` | No se decidió nada: la regla está en el paquete y nadie la eligió. |",
        "| LAIN007 | `warning` | (se quita) | La regla ya no está en el paquete. |",
        "",
        "Además mueve las reglas de `AnalyzerReleases.Unshipped.md` a `AnalyzerReleases.Shipped.md`, bajo la 0.1.1.",
        "",
        "---",
        "Lo genera la app de catálogo de reglas: no editarlo a mano. Si cambia una decisión antes del merge, la app actualiza este mismo PR.",
        "",
      ].join("\n"),
    );
  });
});
