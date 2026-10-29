import { describe, expect, it } from "vitest";

import { EstadoCorrida, EstadoRepositorioPrueba } from "@/dominio/valores";
import { describirCorrida, describirMinimo, describirTasa, porcentaje } from "@/ui/prueba";

/** Textos de las pantallas de la prueba de reglas (entrega 6.5, paso 6). */

describe("describirMinimo", () => {
  it("cuenta lo que falta para poder incorporarla", () => {
    expect(describirMinimo({ minimo: 5, cuentan: 3, probableLocalmente: true })).toEqual({
      texto: "Lleva 3 de 5 corridas: faltan 2 para poder incorporarla.",
      cumple: false,
    });
    expect(describirMinimo({ minimo: 5, cuentan: 4, probableLocalmente: null }).texto).toBe("Lleva 4 de 5 corridas: falta 1 para poder incorporarla.");
    expect(describirMinimo({ minimo: 5, cuentan: 0, probableLocalmente: null }).texto).toBe("Todavía no tiene corridas: faltan 5 para poder incorporarla.");
  });

  it("dice cuando cumple el mínimo", () => {
    expect(describirMinimo({ minimo: 5, cuentan: 7, probableLocalmente: true })).toEqual({
      texto: "Cumple el mínimo: 7 corridas desde que entró en prueba (se piden 5).",
      cumple: true,
    });
    expect(describirMinimo({ minimo: 1, cuentan: 1, probableLocalmente: true }).texto).toBe("Cumple el mínimo: 1 corrida desde que entró en prueba (se pide 1).");
  });

  it("una regla que no se puede probar lo dice, en lugar de contar corridas", () => {
    expect(describirMinimo({ minimo: 5, cuentan: 0, probableLocalmente: false })).toEqual({
      texto: "No está en SonarAnalyzer.CSharp: el job no la puede probar. Puede incorporarse sin prueba desde A revisar.",
      cumple: false,
    });
  });
});

describe("describirTasa", () => {
  it("sin evaluadas no hay tasa", () => {
    expect(describirTasa({ evaluadas: 0, validas: 0, falsosPositivos: 0, sinEvaluar: 4, tasa: null })).toBe("Sin muestras evaluadas todavía.");
  });

  it("la tasa sobre las evaluadas, con cuántas son", () => {
    expect(describirTasa({ evaluadas: 4, validas: 3, falsosPositivos: 1, sinEvaluar: 6, tasa: 0.25 })).toBe(
      "25 % de falsos positivos: 1 de 4 muestras evaluadas.",
    );
    expect(describirTasa({ evaluadas: 1, validas: 1, falsosPositivos: 0, sinEvaluar: 0, tasa: 0 })).toBe("0 % de falsos positivos: 0 de 1 muestra evaluada.");
  });
});

describe("porcentaje", () => {
  it("redondea a entero", () => {
    expect(porcentaje(1 / 3)).toBe("33 %");
    expect(porcentaje(2 / 3)).toBe("67 %");
    expect(porcentaje(1)).toBe("100 %");
  });
});

describe("describirCorrida", () => {
  const repo = (repositorio: string, estado: EstadoRepositorioPrueba | null) => ({ repositorio, estado });

  it("en curso: cuántos repositorios faltan", () => {
    expect(describirCorrida({ estado: EstadoCorrida.EnCurso, error: null, repositorios: [repo("a/b", EstadoRepositorioPrueba.Ok), repo("a/c", null), repo("a/d", null)] })).toBe(
      "En curso: faltan 2 de 3 repositorios.",
    );
  });

  it("terminada: cuántos repositorios y cuántos con error", () => {
    expect(describirCorrida({ estado: EstadoCorrida.Terminada, error: null, repositorios: [repo("a/b", EstadoRepositorioPrueba.Ok), repo("a/c", EstadoRepositorioPrueba.Error)] })).toBe(
      "Terminada: 2 repositorios, 1 con error.",
    );
    expect(describirCorrida({ estado: EstadoCorrida.Terminada, error: null, repositorios: [repo("a/b", EstadoRepositorioPrueba.Ok)] })).toBe("Terminada: 1 repositorio analizado.");
  });

  it("fallida: el motivo", () => {
    expect(describirCorrida({ estado: EstadoCorrida.Fallida, error: "No terminó: el job abrió otra corrida.", repositorios: [] })).toBe(
      "Fallida. No terminó: el job abrió otra corrida.",
    );
  });
});
