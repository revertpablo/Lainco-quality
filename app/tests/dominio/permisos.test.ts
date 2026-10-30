import { describe, expect, it } from "vitest";

import { TRANSICIONES, transicionesDisponibles, validarTransicion } from "@/dominio/transiciones";
import { Estado, Rol } from "@/dominio/valores";

/**
 * Qué acciones ve cada rol (entrega 6.1, paso 4: "un analista no ve las acciones de
 * decisor"). Las acciones sobre una regla son sus transiciones; las que se le muestran a
 * alguien salen de la misma tabla que valida el cambio, así que la pantalla y la
 * validación no pueden discrepar.
 */

const ESTADOS = Object.values(Estado);

const nombres = (desde: Estado, rol: Rol) =>
  transicionesDisponibles(desde, rol).map((t) => `${t.desde} → ${t.hacia}`);

describe("analista", () => {
  it.each(ESTADOS)("desde %s no ve ninguna transición que requiera decisor", (desde) => {
    const disponibles = transicionesDisponibles(desde, Rol.Analista);

    expect(disponibles.filter((t) => t.requiereDecisor)).toEqual([]);
  });

  it("solo ve las transiciones entre Pendiente, En análisis, En prueba y En duda, y el descarte desde Pendiente", () => {
    // FASE-6.md, sección 4, "Roles".
    const todas = ESTADOS.flatMap((desde) => nombres(desde, Rol.Analista)).sort();

    expect(todas).toEqual(
      [
        "pendienteDeAnalizar → enAnalisis",
        "pendienteDeAnalizar → enPrueba",
        "pendienteDeAnalizar → descartada",
        "enAnalisis → enPrueba",
        "enPrueba → enAnalisis",
        "descartada → enAnalisis",
        "enAnalisis → enDuda",
        "enPrueba → enDuda",
        "enDuda → enAnalisis",
        "enDuda → enPrueba",
      ].sort(),
    );
  });

  it("no ve ninguna acción sobre una regla Incorporada", () => {
    expect(transicionesDisponibles(Estado.Incorporada, Rol.Analista)).toEqual([]);
  });
});

describe("decisor", () => {
  it.each(ESTADOS)("desde %s ve todas las transiciones de la tabla", (desde) => {
    const deLaTabla = TRANSICIONES.filter((t) => t.desde === desde);

    expect(transicionesDisponibles(desde, Rol.Decisor)).toEqual(deLaTabla);
  });
});

describe("lo que se muestra coincide con lo que se valida", () => {
  const casos = ESTADOS.flatMap((desde) =>
    TRANSICIONES.filter((t) => t.desde === desde).flatMap((t) =>
      [Rol.Analista, Rol.Decisor].map((rol) => ({ desde, hacia: t.hacia, rol })),
    ),
  );

  it.each(casos)("$desde → $hacia con rol $rol", ({ desde, hacia, rol }) => {
    const visible = transicionesDisponibles(desde, rol).some((t) => t.hacia === hacia);
    // Con los demás requisitos cumplidos, lo único que decide es el rol.
    const resultado = validarTransicion({
      desde,
      hacia,
      rol,
      justificacion: "Justificación de prueba",
      severidad: "MAJOR",
      resultadosDePruebaDisponibles: true,
    });

    expect(resultado.valida).toBe(visible);
  });
});
