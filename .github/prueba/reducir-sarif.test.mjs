// Tests de reducir-sarif.mjs (entrega 6.5, paso 4). Sin dependencias:
//
//   node --test .github/prueba/
//
// fixtures/Dominio-net8.0.sarif es un SARIF real del compilador (SonarAnalyzer.CSharp
// 10.35 y Lainco.Analyzers 0.2.0 sobre un proyecto de prueba), con las rutas cambiadas por
// las de un runner de GitHub y recortado: de cada regla quedó solo el id, y se sacaron las
// "invocations" (las opciones del compilador), que el reductor no usa.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ErrorDeReduccion, reducir } from "./reducir-sarif.mjs";

const RAIZ = "/home/runner/work/dico/dico";
const real = JSON.parse(readFileSync(new URL("./fixtures/Dominio-net8.0.sarif", import.meta.url), "utf8"));

/** Un SARIF mínimo con los resultados dados (y las reglas que se indiquen como disponibles). */
function sarif(resultados, reglas = ["S1118", "S2325", "LAIN001"]) {
  return { version: "2.1.0", runs: [{ tool: { driver: { name: "csc", rules: reglas.map((id) => ({ id })) } }, results: resultados }] };
}

function resultado(ruleId, archivo, linea, mensaje = `Mensaje de ${ruleId}`, extra = {}) {
  return {
    ruleId,
    level: "warning",
    message: { text: mensaje },
    locations: [{ physicalLocation: { artifactLocation: { uri: `file://${RAIZ}/${archivo}` }, region: { startLine: linea, startColumn: 5 } } }],
    ...extra,
  };
}

const opciones = (sarifs, cambios = {}) => ({
  sarifs,
  raiz: RAIZ,
  repositorio: "lainco/dico",
  commit: "0b83618",
  diagnosticos: ["LAIN001", "S1118", "S2325"],
  ...cambios,
});

describe("reducir", () => {
  it("con el SARIF real: cuenta por regla, cero incluido, con las ubicaciones relativas al repositorio", () => {
    const { cuerpo } = reducir(opciones([real]));

    assert.equal(cuerpo.repositorio, "lainco/dico");
    assert.equal(cuerpo.commit, "0b83618");
    assert.equal(cuerpo.estado, "ok");
    assert.deepEqual(cuerpo.reglas, [
      {
        diagnostico: "LAIN001",
        cantidad: 1,
        ubicaciones: [{ archivo: "src/Dominio/Pedido.cs", linea: 5, columna: 12, mensaje: "El constructor sin parámetros de 'Dominio.Pedido' debe ser protected, porque el tipo tiene otros constructores" }],
      },
      {
        diagnostico: "S1118",
        cantidad: 1,
        ubicaciones: [{ archivo: "src/Dominio/Pedido.cs", linea: 18, columna: 14, mensaje: "Add a 'protected' constructor or the 'static' keyword to the class declaration." }],
      },
      { diagnostico: "S2325", cantidad: 0, ubicaciones: [] },
    ]);
  });

  it("con el SARIF real: informa las reglas de Sonar y propias que trae el compilador (E7), sin las internas de Sonar", () => {
    const { cuerpo } = reducir(opciones([real]));

    assert.ok(cuerpo.diagnosticosDisponibles.includes("S1118"));
    assert.ok(cuerpo.diagnosticosDisponibles.includes("LAIN001"));
    // SonarAnalyzer.CSharp 10.35 trae 456 reglas de C#; más las 3 de Lainco.Analyzers 0.2.0.
    assert.equal(cuerpo.diagnosticosDisponibles.length, 459);
    assert.ok(cuerpo.diagnosticosDisponibles.every((id) => /^(S\d+|LAIN\d{3})$/.test(id)));
    assert.ok(!cuerpo.diagnosticosDisponibles.some((id) => id.startsWith("CA") || id.startsWith("S9999")));
    assert.deepEqual(cuerpo.diagnosticosDisponibles, [...cuerpo.diagnosticosDisponibles].sort());
  });

  it("ignora los diagnósticos de reglas que no están en la corrida", () => {
    const { cuerpo } = reducir(opciones([sarif([resultado("S1118", "a.cs", 1), resultado("S9999-metrics", "a.cs", 1), resultado("CS0168", "a.cs", 2)])]));

    assert.deepEqual(
      cuerpo.reglas.map((r) => [r.diagnostico, r.cantidad]),
      [["LAIN001", 0], ["S1118", 1], ["S2325", 0]],
    );
  });

  it("un issue que aparece en varios proyectos o target frameworks cuenta una vez", () => {
    const uno = resultado("S1118", "src/Comun.cs", 3);
    const { cuerpo } = reducir(opciones([sarif([uno]), sarif([uno, resultado("S1118", "src/Comun.cs", 9)])]));

    assert.equal(cuerpo.reglas.find((r) => r.diagnostico === "S1118").cantidad, 2);
  });

  it("no cuenta lo suprimido en el código ni lo que está fuera del repositorio, y lo informa", () => {
    const { cuerpo, descartados } = reducir(
      opciones([
        sarif([
          resultado("S1118", "a.cs", 1, "x", { suppressions: [{ kind: "inSource" }] }),
          { ...resultado("S1118", "a.cs", 2), locations: [{ physicalLocation: { artifactLocation: { uri: "file:///home/runner/.nuget/packages/x/y.cs" }, region: { startLine: 1 } } }] },
          { ...resultado("S1118", "a.cs", 3), locations: [] },
          resultado("S1118", "b.cs", 4),
        ]),
      ]),
    );

    assert.equal(cuerpo.reglas.find((r) => r.diagnostico === "S1118").cantidad, 1);
    assert.deepEqual(descartados, { suprimidos: 1, fueraDelRepositorio: 1, sinUbicacion: 1 });
  });

  it("decodifica la URI y no confunde la raíz con un directorio que empieza igual", () => {
    const { cuerpo } = reducir(
      opciones([
        sarif([
          { ...resultado("S1118", "x", 1), locations: [{ physicalLocation: { artifactLocation: { uri: `file://${RAIZ}/src/Mis%20Clases/A%C3%B1o.cs` }, region: { startLine: 7 } } }] },
          { ...resultado("S1118", "x", 2), locations: [{ physicalLocation: { artifactLocation: { uri: `file://${RAIZ}-otro/src/A.cs` }, region: { startLine: 1 } } }] },
        ]),
      ]),
    );

    assert.deepEqual(cuerpo.reglas.find((r) => r.diagnostico === "S1118").ubicaciones, [{ archivo: "src/Mis Clases/Año.cs", linea: 7, columna: 1, mensaje: "Mensaje de S1118" }]);
  });

  it("guarda hasta el máximo de ubicaciones por regla, en orden, pero la cantidad es la real", () => {
    const muchos = Array.from({ length: 30 }, (_, i) => resultado("S1118", `src/A${String(29 - i).padStart(2, "0")}.cs`, 1));
    const { cuerpo } = reducir(opciones([sarif(muchos)], { maximo: 10 }));

    const s1118 = cuerpo.reglas.find((r) => r.diagnostico === "S1118");
    assert.equal(s1118.cantidad, 30);
    assert.equal(s1118.ubicaciones.length, 10);
    assert.deepEqual(
      s1118.ubicaciones.map((u) => u.archivo),
      Array.from({ length: 10 }, (_, i) => `src/A${String(i).padStart(2, "0")}.cs`),
    );
  });

  it("el máximo por defecto es 200", () => {
    const muchos = Array.from({ length: 250 }, (_, i) => resultado("S1118", "a.cs", i + 1));
    const { cuerpo } = reducir(opciones([sarif(muchos)]));

    assert.equal(cuerpo.reglas.find((r) => r.diagnostico === "S1118").ubicaciones.length, 200);
  });

  it("sin ningún SARIF es un error: no compiló ningún proyecto C#", () => {
    assert.throws(() => reducir(opciones([])), ErrorDeReduccion);
  });

  it("un SARIF que no es SARIF es un error", () => {
    assert.throws(() => reducir(opciones([{ algo: 1 }])), /SARIF/);
  });
});
