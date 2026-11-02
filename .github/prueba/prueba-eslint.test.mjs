// Tests de prueba-eslint.mjs (entrega 6.5, parte TypeScript). Sin dependencias:
//
//   node --test .github/prueba/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ErrorDePruebaEslint, mapaDeSonarjs, reducirEslint, reglasDeEslint } from "./prueba-eslint.mjs";

const RAIZ = "/home/runner/work/web/web";

/** Reglas de eslint-plugin-sonarjs como las trae el plugin: la clave de Sonar está en la URL. */
const SONARJS = {
  "class-name": { meta: { docs: { url: "https://sonarsource.github.io/rspec/#/rspec/S101/javascript" } } },
  "no-unused-vars": { meta: { docs: { url: "https://sonarsource.github.io/rspec/#/rspec/S1481/javascript" } } },
  "sin-url": { meta: { docs: {} } },
};

describe("mapaDeSonarjs", () => {
  it("de cada regla saca su clave de Sonar de la URL de la documentación", () => {
    assert.deepEqual(
      mapaDeSonarjs(SONARJS),
      new Map([
        ["S101", "sonarjs/class-name"],
        ["S1481", "sonarjs/no-unused-vars"],
      ]),
    );
  });
});

describe("reglasDeEslint", () => {
  const mapa = mapaDeSonarjs(SONARJS);
  const propias = ["no-hardcoded-secrets"];

  it("traduce las reglas de TypeScript de la corrida a reglas de ESLint, y deja afuera las de C#", () => {
    const { reglas, porEslint } = reglasDeEslint(["S1118", "LAIN001", "ts:S1481", "lainco/no-hardcoded-secrets"], mapa, propias);

    assert.deepEqual(reglas, { "lainco/no-hardcoded-secrets": "warn", "sonarjs/no-unused-vars": "warn" });
    assert.deepEqual(
      porEslint,
      new Map([
        ["sonarjs/no-unused-vars", "ts:S1481"],
        ["lainco/no-hardcoded-secrets", "lainco/no-hardcoded-secrets"],
      ]),
    );
  });

  it("una regla que no está en los plugins no se corre: no está disponible", () => {
    const { reglas, disponibles } = reglasDeEslint(["ts:S9999", "lainco/no-existe"], mapa, propias);

    assert.deepEqual(reglas, {});
    assert.deepEqual(disponibles, ["lainco/no-hardcoded-secrets", "ts:S101", "ts:S1481"]);
  });
});

describe("reducirEslint", () => {
  const porEslint = new Map([
    ["sonarjs/no-unused-vars", "ts:S1481"],
    ["lainco/no-hardcoded-secrets", "lainco/no-hardcoded-secrets"],
  ]);
  const mensaje = (ruleId, linea, texto = `Mensaje de ${ruleId}`) => ({ ruleId, line: linea, column: 3, message: texto, severity: 1 });

  it("cuenta por regla, cero incluido, con rutas relativas y ordenadas", () => {
    const { reglas, descartados } = reducirEslint({
      resultados: [
        { filePath: `${RAIZ}/src/b.ts`, messages: [mensaje("lainco/no-hardcoded-secrets", 9, "Secreto hardcodeado en 'API_KEY'")] },
        { filePath: `${RAIZ}/src/a.ts`, messages: [mensaje("lainco/no-hardcoded-secrets", 2, "Secreto hardcodeado en 'token'"), mensaje(null, 1, "Parsing error")] },
      ],
      raiz: RAIZ,
      diagnosticos: ["S1118", "lainco/no-hardcoded-secrets", "ts:S1481"],
      porEslint,
    });

    assert.deepEqual(reglas, [
      {
        diagnostico: "lainco/no-hardcoded-secrets",
        cantidad: 2,
        ubicaciones: [
          { archivo: "src/a.ts", linea: 2, columna: 3, mensaje: "Secreto hardcodeado en 'token'" },
          { archivo: "src/b.ts", linea: 9, columna: 3, mensaje: "Secreto hardcodeado en 'API_KEY'" },
        ],
      },
      { diagnostico: "ts:S1481", cantidad: 0, ubicaciones: [] },
    ]);
    assert.deepEqual(descartados, { sinRegla: 1, fueraDelRepositorio: 0 });
  });

  it("no cuenta lo que está fuera del repositorio ni las reglas que no son de la corrida", () => {
    const { reglas, descartados } = reducirEslint({
      resultados: [
        { filePath: "/home/runner/work/otro/x.ts", messages: [mensaje("sonarjs/no-unused-vars", 1)] },
        { filePath: `${RAIZ}/a.ts`, messages: [mensaje("no-debugger", 1)] },
      ],
      raiz: RAIZ,
      diagnosticos: ["ts:S1481"],
      porEslint,
    });

    assert.deepEqual(reglas, [{ diagnostico: "ts:S1481", cantidad: 0, ubicaciones: [] }]);
    assert.equal(descartados.fueraDelRepositorio, 1);
  });

  it("hasta --maximo ubicaciones; la cantidad es la real", () => {
    const { reglas } = reducirEslint({
      resultados: [{ filePath: `${RAIZ}/a.ts`, messages: [1, 2, 3].map((l) => mensaje("sonarjs/no-unused-vars", l)) }],
      raiz: RAIZ,
      diagnosticos: ["ts:S1481"],
      porEslint,
      maximo: 2,
    });

    assert.equal(reglas[0].cantidad, 3);
    assert.equal(reglas[0].ubicaciones.length, 2);
  });

  it("sin reglas de TypeScript en la corrida es un error del job", () => {
    assert.throws(() => reducirEslint({ resultados: [], raiz: RAIZ, diagnosticos: ["S1118"], porEslint }), ErrorDePruebaEslint);
  });
});
