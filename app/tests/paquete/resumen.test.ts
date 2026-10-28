import { describe, expect, it } from "vitest";

import type { ResumenDelPaquete } from "@/paquete/publicar";
import { describirPublicacionDelPaquete } from "@/paquete/resumen";

/** El resultado de publicar en el paquete, en una frase (entrega 6.4, paso 6). */

const resumen = (cambios: Partial<ResumenDelPaquete>): ResumenDelPaquete => ({
  publicadas: 0,
  reprogramadas: 0,
  fallidas: 0,
  pr: null,
  version: null,
  error: null,
  ...cambios,
});

describe("resumen de publicar en el paquete", () => {
  it.each<[Partial<ResumenDelPaquete>, string]>([
    [{}, "No había nada pendiente de pasar al paquete."],
    [
      { publicadas: 2, pr: { numero: 4, url: "https://github.com/x/y/pull/4" }, version: "0.1.1" },
      "PR #4 con 2 reglas (Lainco.Analyzers 0.1.1).",
    ],
    [{ publicadas: 1 }, "1 regla sin PR: main ya tiene el .globalconfig de la app."],
    [{ reprogramadas: 1, error: "GitHub no respondió bien. (HTTP 502)" }, "No se pudo actualizar el PR de configuración; se va a reintentar: GitHub no respondió bien. (HTTP 502)"],
    [{ fallidas: 1, error: "La versión es previa." }, "No se pudo actualizar el PR de configuración y no se reintenta solo: La versión es previa."],
  ])("%o → %s", (cambios, texto) => {
    expect(describirPublicacionDelPaquete(resumen(cambios))).toBe(texto);
  });
});
