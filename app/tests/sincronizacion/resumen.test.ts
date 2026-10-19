import { describe, expect, it } from "vitest";

import { describirResumen } from "@/sincronizacion/resumen";

describe("resumen de una corrida para el usuario", () => {
  const ok = { estado: "ok", nuevas: 0, modificadas: 0, deprecadas: 0 };

  it.each([
    [{}, "Sin cambios en Sonar."],
    [{ nuevas: 1123 }, "1123 reglas nuevas."],
    [{ nuevas: 1 }, "1 regla nueva."],
    [{ modificadas: 1, deprecadas: 2 }, "1 modificada, 2 deprecadas."],
    [{ nuevas: 3, modificadas: 2, deprecadas: 1 }, "3 reglas nuevas, 2 modificadas, 1 deprecada."],
  ])("%o → %s", (cambios, texto) => {
    expect(describirResumen({ ...ok, ...cambios })).toBe(texto);
  });

  it("si falló, dice por qué", () => {
    expect(describirResumen({ ...ok, estado: "error", error: "Token vencido." })).toBe(
      "La sincronización falló: Token vencido.",
    );
  });
});
