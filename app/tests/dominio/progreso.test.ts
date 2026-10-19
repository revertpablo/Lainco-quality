import { describe, expect, it } from "vitest";

import {
  avanceDe,
  DIAS_PARA_ESTANCADA_POR_DEFECTO,
  leerDias,
  resumirProgreso,
  type ConteoPorEstado,
} from "@/dominio/progreso";
import { Estado, Lenguaje, Origen } from "@/dominio/valores";

/**
 * Cuentas del tablero de progreso (entrega 6.1, paso 11).
 *
 * Criterio del paso: "Porcentaje triageado por lenguaje y tipo; reglas estancadas hace más
 * de N días."
 */

const conteo = (
  lenguaje: Lenguaje,
  tipo: string | null,
  estado: Estado,
  cantidad: number,
  origen: Origen = Origen.Sonar,
): ConteoPorEstado => ({ lenguaje, tipo, origen, estado, cantidad });

describe("avance", () => {
  it("triageada es toda regla que salió de Pendiente de analizar", () => {
    const avance = avanceDe([
      conteo("cs", "BUG", Estado.PendienteDeAnalizar, 6),
      conteo("cs", "BUG", Estado.ARevisar, 1),
      conteo("cs", "BUG", Estado.EnPrueba, 1),
      conteo("cs", "BUG", Estado.Incorporada, 1),
      conteo("cs", "BUG", Estado.Descartada, 1),
    ]);

    expect(avance).toEqual({
      total: 10,
      triageadas: 4,
      porcentaje: 40,
      porEstado: { pendienteDeAnalizar: 6, aRevisar: 1, enPrueba: 1, incorporada: 1, descartada: 1 },
    });
  });

  it("el porcentaje se redondea para abajo: con una sola pendiente no dice 100 %", () => {
    const avance = avanceDe([conteo("cs", "BUG", Estado.Descartada, 999), conteo("cs", "BUG", Estado.PendienteDeAnalizar, 1)]);

    expect(avance.porcentaje).toBe(99);
  });

  it("sin pendientes es 100 %", () => {
    expect(avanceDe([conteo("ts", "BUG", Estado.Incorporada, 3)]).porcentaje).toBe(100);
  });

  it("sin reglas es 0 %, no una división por cero", () => {
    expect(avanceDe([])).toMatchObject({ total: 0, triageadas: 0, porcentaje: 0 });
  });
});

describe("resumen por lenguaje, tipo y origen", () => {
  const conteos = [
    conteo("cs", "CODE_SMELL", Estado.PendienteDeAnalizar, 3),
    conteo("cs", "CODE_SMELL", Estado.Descartada, 1),
    conteo("cs", "BUG", Estado.Incorporada, 2),
    conteo("cs", null, Estado.PendienteDeAnalizar, 1, Origen.Roslyn),
    conteo("cs", "VULNERABILITY", Estado.ARevisar, 1),
    conteo("cs", "OTRO", Estado.ARevisar, 1),
    conteo("ts", "BUG", Estado.PendienteDeAnalizar, 4),
    conteo("ts", "BUG", Estado.Descartada, 4),
  ];
  const resumen = resumirProgreso(conteos, [Lenguaje.CSharp, Lenguaje.TypeScript], [Origen.Sonar, Origen.Roslyn, Origen.Eslint]);

  it("el total junta todo", () => {
    expect(resumen.total).toMatchObject({ total: 17, triageadas: 9, porcentaje: 52 });
  });

  it("por lenguaje, en el orden de la tabla de referencia", () => {
    expect(resumen.porLenguaje.map((l) => [l.lenguaje, l.avance.total, l.avance.porcentaje])).toEqual([
      ["cs", 9, 55],
      ["ts", 8, 50],
    ]);
  });

  it("por tipo dentro de cada lenguaje: bugs, vulnerabilidades, hotspots, code smells, otros y sin tipo", () => {
    expect(resumen.porLenguaje[0].porTipo.map((t) => [t.tipo, t.avance.total, t.avance.porcentaje])).toEqual([
      ["BUG", 2, 100],
      ["VULNERABILITY", 1, 100],
      ["CODE_SMELL", 4, 25],
      ["OTRO", 1, 100],
      [null, 1, 0],
    ]);
    expect(resumen.porLenguaje[1].porTipo.map((t) => t.tipo)).toEqual(["BUG"]);
  });

  it("por origen, sin los orígenes que no tienen reglas", () => {
    expect(resumen.porOrigen.map((o) => [o.origen, o.avance.total, o.avance.porEstado.pendienteDeAnalizar])).toEqual([
      ["sonar", 16, 7],
      ["roslyn", 1, 1],
    ]);
  });

  it("un lenguaje sin reglas no aparece", () => {
    const soloTs = resumirProgreso([conteo("ts", "BUG", Estado.Incorporada, 1)], ["cs", "ts"], [Origen.Sonar]);

    expect(soloTs.porLenguaje.map((l) => l.lenguaje)).toEqual(["ts"]);
  });
});

describe("N de las estancadas", () => {
  it.each<[string | string[] | undefined, number]>([
    [undefined, DIAS_PARA_ESTANCADA_POR_DEFECTO],
    ["", DIAS_PARA_ESTANCADA_POR_DEFECTO],
    ["7", 7],
    ["1", 1],
    ["365", 365],
    [["30", "7"], 30],
  ])("dias=%o es %i", (valor, esperado) => {
    expect(leerDias(valor)).toBe(esperado);
  });

  it.each(["0", "366", "-3", "2.5", "1e2", "diez", "0x10", "1000"])("dias=%s no vale: queda el valor por defecto", (valor) => {
    expect(leerDias(valor)).toBe(DIAS_PARA_ESTANCADA_POR_DEFECTO);
  });

  it("por defecto son 14", () => {
    expect(DIAS_PARA_ESTANCADA_POR_DEFECTO).toBe(14);
  });
});
