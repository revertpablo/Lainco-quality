import { describe, expect, it } from "vitest";

import { accionEnSonar, despuesDeFallar, destinoDeLaDecision, destinoDePublicacion, MAXIMO_DE_INTENTOS } from "@/dominio/publicacion";
import { TRANSICIONES } from "@/dominio/transiciones";
import { DestinoPublicacion, Estado, Origen } from "@/dominio/valores";

/**
 * Qué decisiones se publican y dónde: las reglas de Sonar en el Quality Profile (entrega
 * 6.2, paso 3) y las propias en el PR de configuración (entrega 6.4, paso 4). Se recorre
 * la tabla de transiciones entera, como en los tests del ciclo de vida.
 */

const { Incorporada } = Estado;

describe("dónde se publica cada origen", () => {
  it.each([
    [Origen.Sonar, DestinoPublicacion.PerfilSonar],
    [Origen.Roslyn, DestinoPublicacion.PrConfiguracion],
    [Origen.Eslint, DestinoPublicacion.PrConfiguracion],
    // Las normas de IA no se publican en ningún lado: las aplica el revisor IA (Fase 7).
    [Origen.NormaIa, null],
  ])("%s → %s", (origen, destino) => {
    expect(destinoDePublicacion(origen)).toBe(destino);
  });
});

describe("qué decisiones se publican", () => {
  it.each(TRANSICIONES.map((t) => [t.desde, t.hacia] as const))("%s → %s", (desde, hacia) => {
    const publica = desde === Incorporada || hacia === Incorporada;
    expect(destinoDeLaDecision(Origen.Sonar, desde, hacia)).toBe(publica ? DestinoPublicacion.PerfilSonar : null);
    expect(destinoDeLaDecision(Origen.Roslyn, desde, hacia)).toBe(publica ? DestinoPublicacion.PrConfiguracion : null);
    expect(destinoDeLaDecision(Origen.NormaIa, desde, hacia)).toBeNull();
  });

  it("de las 12 transiciones de la tabla, publican las 4 que entran a Incorporada o salen", () => {
    const publican = TRANSICIONES.filter((t) => destinoDeLaDecision(Origen.Sonar, t.desde, t.hacia)).map((t) => `${t.desde} → ${t.hacia}`);

    expect(TRANSICIONES).toHaveLength(12);
    expect(publican).toEqual([
      "aRevisar → incorporada",
      "enPrueba → incorporada",
      "incorporada → descartada",
      "incorporada → enPrueba",
    ]);
  });
});

describe("qué se le pide a Sonar", () => {
  it("Incorporada se activa", () => {
    expect(accionEnSonar(Incorporada)).toBe("activar");
  });

  it.each([Estado.PendienteDeAnalizar, Estado.ARevisar, Estado.EnPrueba, Estado.Descartada])("%s se desactiva", (estado) => {
    expect(accionEnSonar(estado)).toBe("desactivar");
  });
});

describe("reintentos de una publicación que falló", () => {
  it.each([
    [1, 1],
    [2, 5],
    [3, 30],
    [4, 120],
  ])("después del intento %i fallido espera %i minutos", (intentos, minutos) => {
    expect(despuesDeFallar(intentos, "transitorio")).toEqual({ fallida: false, esperaEnMinutos: minutos });
  });

  it(`al intento ${MAXIMO_DE_INTENTOS} queda fallida: se reintenta a mano`, () => {
    expect(MAXIMO_DE_INTENTOS).toBe(5);
    expect(despuesDeFallar(5, "transitorio")).toEqual({ fallida: true });
    expect(despuesDeFallar(6, "transitorio")).toEqual({ fallida: true });
  });

  it("un rechazo de Sonar no se reintenta: daría lo mismo", () => {
    expect(despuesDeFallar(1, "permanente")).toEqual({ fallida: true });
  });

  it("un problema de configuración se reintenta como uno transitorio", () => {
    expect(despuesDeFallar(2, "configuracion")).toEqual({ fallida: false, esperaEnMinutos: 5 });
  });
});
