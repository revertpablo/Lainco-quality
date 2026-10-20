import { describe, expect, it } from "vitest";

import { accionEnSonar, cambiaElPerfil, despuesDeFallar, MAXIMO_DE_INTENTOS } from "@/dominio/publicacion";
import { TRANSICIONES } from "@/dominio/transiciones";
import { Estado, Origen } from "@/dominio/valores";

/**
 * Qué decisiones se publican en el Quality Profile de Sonar (entrega 6.2, paso 3).
 * Se recorre la tabla de transiciones entera, como en los tests del ciclo de vida.
 */

const { Incorporada } = Estado;

describe("qué decisiones cambian el perfil de Sonar", () => {
  it.each(TRANSICIONES.map((t) => [t.desde, t.hacia] as const))(
    "%s → %s de una regla de Sonar",
    (desde, hacia) => {
      const esperado = desde === Incorporada || hacia === Incorporada;
      expect(cambiaElPerfil(Origen.Sonar, desde, hacia)).toBe(esperado);
    },
  );

  it("de las 12 transiciones de la tabla, publican las 4 que entran a Incorporada o salen", () => {
    const publican = TRANSICIONES.filter((t) => cambiaElPerfil(Origen.Sonar, t.desde, t.hacia)).map((t) => `${t.desde} → ${t.hacia}`);

    expect(TRANSICIONES).toHaveLength(12);
    expect(publican).toEqual([
      "aRevisar → incorporada",
      "enPrueba → incorporada",
      "incorporada → descartada",
      "incorporada → enPrueba",
    ]);
  });

  it.each([Origen.Roslyn, Origen.Eslint, Origen.NormaIa])(
    "las reglas de %s no se publican en el perfil, aunque entren a Incorporada",
    (origen) => {
      for (const t of TRANSICIONES) {
        expect(cambiaElPerfil(origen, t.desde, t.hacia)).toBe(false);
      }
    },
  );
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
