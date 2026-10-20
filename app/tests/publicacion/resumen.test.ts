import { describe, expect, it } from "vitest";

import { describirPublicacion } from "@/publicacion/resumen";

/** El resultado del botón "Publicar pendientes", en una frase (entrega 6.2, paso 4). */

const resumen = (publicadas: number, reprogramadas = 0, fallidas = 0, errores: { regla: string; mensaje: string }[] = []) => ({
  publicadas,
  reprogramadas,
  fallidas,
  errores,
});

describe("resumen de una publicación", () => {
  it.each<[ReturnType<typeof resumen>, string]>([
    [resumen(0), "No había nada pendiente de publicar en Sonar."],
    [resumen(1), "Se publicó 1 regla en Sonar."],
    [resumen(3), "Se publicaron 3 reglas en Sonar."],
    [
      resumen(2, 1, 0, [{ regla: "csharpsquid:S1", mensaje: "SonarQube no respondió bien. (HTTP 503)" }]),
      "Se publicaron 2 reglas en Sonar; 1 falló y se va a reintentar. csharpsquid:S1: SonarQube no respondió bien. (HTTP 503)",
    ],
    [
      resumen(0, 0, 2, [
        { regla: "csharpsquid:S1", mensaje: "Valor inválido." },
        { regla: "csharpsquid:S2", mensaje: "Otro." },
      ]),
      "2 fallaron y no se reintentan solas. csharpsquid:S1: Valor inválido.",
    ],
    [resumen(0, 2, 0, [{ regla: "x", mensaje: "y" }]), "2 fallaron y se van a reintentar. x: y"],
  ])("%o", (r, texto) => {
    expect(describirPublicacion(r)).toBe(texto);
  });
});
