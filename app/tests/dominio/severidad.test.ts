import { describe, expect, it } from "vitest";

import { IMPACTO_DE_SEVERIDAD, impactosParaPublicar, SEVERIDADES, SEVERIDADES_DE_IMPACTO } from "@/dominio/severidad";

/**
 * Severidad elegida al incorporar, traducida a los impactos que pide SonarQube Cloud
 * (entrega 6.2, paso 2).
 */

describe("severidad clásica traducida a impactos", () => {
  it.each([
    ["BLOCKER", "BLOCKER"],
    ["CRITICAL", "HIGH"],
    ["MAJOR", "MEDIUM"],
    ["MINOR", "LOW"],
    ["INFO", "INFO"],
  ])("%s es %s, la equivalencia de Sonar", (clasica, impacto) => {
    expect(impactosParaPublicar(clasica, [{ calidad: "MAINTAINABILITY", severidad: "LOW" }])).toEqual([
      { calidad: "MAINTAINABILITY", severidad: impacto },
    ]);
  });

  it("la severidad elegida va a cada calidad que la regla afecta, sin importar la que traía", () => {
    expect(
      impactosParaPublicar("CRITICAL", [
        { calidad: "SECURITY", severidad: "LOW" },
        { calidad: "RELIABILITY", severidad: "MEDIUM" },
      ]),
    ).toEqual([
      { calidad: "SECURITY", severidad: "HIGH" },
      { calidad: "RELIABILITY", severidad: "HIGH" },
    ]);
  });

  it("una calidad repetida en la regla va una sola vez", () => {
    expect(
      impactosParaPublicar("MINOR", [
        { calidad: "SECURITY", severidad: "LOW" },
        { calidad: "SECURITY", severidad: "HIGH" },
      ]),
    ).toEqual([{ calidad: "SECURITY", severidad: "LOW" }]);
  });

  it("sin severidad elegida no se piden impactos: Sonar usa los de la regla", () => {
    expect(impactosParaPublicar(null, [{ calidad: "SECURITY", severidad: "LOW" }])).toEqual([]);
  });

  it("una regla sin impactos se activa sin pedir ninguno", () => {
    expect(impactosParaPublicar("MAJOR", [])).toEqual([]);
  });

  it("una severidad que no es de Sonar es un error", () => {
    expect(() => impactosParaPublicar("HIGH", [{ calidad: "SECURITY", severidad: "LOW" }])).toThrow("'HIGH' no es una severidad");
  });

  it("la equivalencia cubre todas las severidades y respeta el orden de gravedad", () => {
    expect(SEVERIDADES.map((s) => IMPACTO_DE_SEVERIDAD[s])).toEqual([...SEVERIDADES_DE_IMPACTO]);
  });
});
