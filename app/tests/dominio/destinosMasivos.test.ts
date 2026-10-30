import { describe, expect, it } from "vitest";

import { destinosMasivos } from "@/dominio/transiciones";
import { Estado, Rol } from "@/dominio/valores";

/**
 * Qué cambios de estado ofrece la barra de selección para un grupo de reglas (paso 8).
 * Un destino se ofrece si **todas** las reglas seleccionadas pueden ir ahí en una
 * operación masiva y con el rol de quien mira. Sale de la tabla TRANSICIONES.
 */

const { PendienteDeAnalizar, EnAnalisis, EnPrueba, EnDuda, Incorporada, Descartada } = Estado;

const destinos = (estados: Estado[], rol: Rol) => destinosMasivos(estados, rol).map((d) => d.hacia);

describe("destinos de una operación masiva", () => {
  it("desde Pendiente, un analista puede mandar a En análisis, En prueba o Descartada", () => {
    expect(destinos([PendienteDeAnalizar], Rol.Analista)).toEqual([EnAnalisis, EnPrueba, Descartada]);
  });

  it("nunca ofrece Incorporada, ni a un decisor", () => {
    for (const estado of Object.values(Estado)) {
      expect(destinos([estado], Rol.Decisor)).not.toContain(Incorporada);
    }
  });

  it("con reglas de varios estados, solo los destinos que valen para todas", () => {
    // Pendiente → En análisis existe; En análisis → En análisis no. En prueba vale para las dos.
    expect(destinos([PendienteDeAnalizar, EnAnalisis], Rol.Analista)).toEqual([EnPrueba]);
  });

  it("un analista no ve los destinos que requieren decisor", () => {
    // En análisis → Descartada requiere decisor.
    expect(destinos([EnAnalisis], Rol.Analista)).toEqual([EnPrueba, EnDuda]);
    expect(destinos([EnAnalisis], Rol.Decisor)).toEqual([EnPrueba, EnDuda, Descartada]);
  });

  it("En duda (2026-10-30): se entra en masa desde En análisis y En prueba, con justificación, y se sale en masa salvo a Incorporada", () => {
    expect(destinosMasivos([EnAnalisis, EnPrueba], Rol.Analista)).toEqual([{ hacia: EnDuda, requiereJustificacion: true }]);
    expect(destinos([EnDuda], Rol.Analista)).toEqual([EnAnalisis, EnPrueba]);
    expect(destinos([EnDuda], Rol.Decisor)).toEqual([EnAnalisis, EnPrueba, Descartada]);
  });

  it("sin reglas no hay destinos", () => {
    expect(destinosMasivos([], Rol.Decisor)).toEqual([]);
  });

  it("dice si el destino exige justificación", () => {
    const desdePendiente = destinosMasivos([PendienteDeAnalizar], Rol.Analista);

    expect(desdePendiente).toEqual([
      { hacia: EnAnalisis, requiereJustificacion: false },
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
