import { describe, expect, it } from "vitest";

import { describirReconciliacion } from "@/reconciliacion/resumen";

/** El resultado del botón "Reconciliar ahora", en una frase (entrega 6.2, paso 5). */

const ok = (abiertos: number, nuevos = 0, resueltos = 0) => ({ estado: "ok" as const, abiertos, nuevos, resueltos, error: null });

describe("resumen de una reconciliación", () => {
  it.each<[Parameters<typeof describirReconciliacion>[0], string]>([
    [ok(0), "Sonar coincide con la app."],
    [ok(0, 0, 2), "Sonar coincide con la app (2 desvíos resueltos)."],
    [ok(1, 1), "1 desvío con Sonar (1 nuevo)."],
    [ok(3, 1, 2), "3 desvíos con Sonar (1 nuevo, 2 resueltos)."],
    [ok(2), "2 desvíos con Sonar."],
    [{ estado: "error", abiertos: 0, nuevos: 0, resueltos: 0, error: "SonarQube no respondió bien. (HTTP 503)" }, "La reconciliación falló: SonarQube no respondió bien. (HTTP 503)"],
  ])("%o", (resumen, texto) => {
    expect(describirReconciliacion(resumen)).toBe(texto);
  });
});
