import { describe, expect, it } from "vitest";

import { destinosMasivos } from "@/dominio/transiciones";
import { Estado, Rol } from "@/dominio/valores";

/**
 * Qué cambios de estado ofrece la barra de selección para un grupo de reglas (paso 8).
 * Un destino se ofrece si **todas** las reglas seleccionadas pueden ir ahí en una
 * operación masiva y con el rol de quien mira. Sale de la tabla TRANSICIONES.
 */

const { PendienteDeAnalizar, ARevisar, EnPrueba, Incorporada, Descartada } = Estado;

const destinos = (estados: Estado[], rol: Rol) => destinosMasivos(estados, rol).map((d) => d.hacia);

describe("destinos de una operación masiva", () => {
  it("desde Pendiente, un analista puede mandar a A revisar, En prueba o Descartada", () => {
    expect(destinos([PendienteDeAnalizar], Rol.Analista)).toEqual([ARevisar, EnPrueba, Descartada]);
  });

  it("nunca ofrece Incorporada, ni a un decisor", () => {
    for (const estado of Object.values(Estado)) {
      expect(destinos([estado], Rol.Decisor)).not.toContain(Incorporada);
    }
  });

  it("con reglas de varios estados, solo los destinos que valen para todas", () => {
    // Pendiente → A revisar existe; A revisar → A revisar no. En prueba vale para las dos.
    expect(destinos([PendienteDeAnalizar, ARevisar], Rol.Analista)).toEqual([EnPrueba]);
  });

  it("un analista no ve los destinos que requieren decisor", () => {
    // A revisar → Descartada requiere decisor.
    expect(destinos([ARevisar], Rol.Analista)).toEqual([EnPrueba]);
    expect(destinos([ARevisar], Rol.Decisor)).toEqual([EnPrueba, Descartada]);
  });

  it("sin reglas no hay destinos", () => {
    expect(destinosMasivos([], Rol.Decisor)).toEqual([]);
  });

  it("dice si el destino exige justificación", () => {
    const desdePendiente = destinosMasivos([PendienteDeAnalizar], Rol.Analista);

    expect(desdePendiente).toEqual([
      { hacia: ARevisar, requiereJustificacion: false },
      { hacia: EnPrueba, requiereJustificacion: false },
      { hacia: Descartada, requiereJustificacion: true },
    ]);
  });

  it("si una de las reglas exige justificación, el destino la exige", () => {
    // Pendiente → En prueba no exige; Incorporada → En prueba sí.
    expect(destinosMasivos([PendienteDeAnalizar, Incorporada], Rol.Decisor)).toEqual([
      { hacia: EnPrueba, requiereJustificacion: true },
      { hacia: Descartada, requiereJustificacion: true },
    ]);
  });
});
