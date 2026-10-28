import { describe, expect, it } from "vitest";

import { describirValor } from "@/ui/desvios";

/** Lo esperado y lo encontrado de un desvío, en texto (entrega 6.2, paso 6). */

describe("valores de un desvío", () => {
  it.each<[unknown, string]>([
    ["inactiva", "inactiva"],
    [null, "—"],
    [[{ calidad: "MAINTAINABILITY", severidad: "MEDIUM" }], "Mantenibilidad: Medium"],
    [
      [
        { calidad: "SECURITY", severidad: "HIGH" },
        { calidad: "RELIABILITY", severidad: "LOW" },
      ],
      "Seguridad: High, Confiabilidad: Low",
    ],
    [[], "sin impactos"],
    [{ max: "5", formato: "^a$" }, "max = 5, formato = ^a$"],
    [{ max: null }, "max = sin valor"],
    [{ impactos: [{ calidad: "MAINTAINABILITY", severidad: "HIGH" }], parametros: {} }, "Mantenibilidad: High"],
    [{ impactos: [{ calidad: "SECURITY", severidad: "LOW" }], parametros: { max: "3" } }, "Seguridad: Low; max = 3"],
    [{ severidad: "MAJOR", parametros: { max: "5" } }, "activa; severidad Major; max = 5"],
    [{ severidad: null, parametros: {} }, "activa"],
    [[{ calidad: "OTRA", severidad: "RARA" }], "OTRA: RARA"],
  ])("%j se lee «%s»", (valor, texto) => {
    expect(describirValor(valor)).toBe(texto);
  });
});
