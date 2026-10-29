import { describe, expect, it } from "vitest";

import { ErrorDeConfiguracionDePrueba, repositoriosDesdeEntorno } from "@/prueba/configuracion";

/**
 * La lista de repositorios del job de prueba (entrega 6.5, decisión E2): la variable
 * PRUEBA_REPOSITORIOS, con `owner/repo` (y, si hace falta, `:ruta/de/la.sln`) separados
 * por coma.
 */

const con = (valor?: string) => repositoriosDesdeEntorno({ PRUEBA_REPOSITORIOS: valor });

describe("repositoriosDesdeEntorno", () => {
  it("lee owner/repo separados por coma, sin solución", () => {
    expect(con("revertpablo/Lainco-quality,lainco/dico")).toEqual([
      { repositorio: "revertpablo/lainco-quality", solucion: null },
      { repositorio: "lainco/dico", solucion: null },
    ]);
  });

  it("lee la solución después de los dos puntos, con la ruta normalizada y sin cambiar sus mayúsculas", () => {
    expect(con("revertpablo/Lainco-quality:samples\\SampleSolution/SampleSolution.sln, lainco/dico : Dico.slnx")).toEqual([
      { repositorio: "revertpablo/lainco-quality", solucion: "samples/SampleSolution/SampleSolution.sln" },
      { repositorio: "lainco/dico", solucion: "Dico.slnx" },
    ]);
  });

  it("acepta espacios y saltos de línea, y no repite", () => {
    expect(con(" lainco/dico ,\n lainco/sigma,, Lainco/DICO ")).toEqual([
      { repositorio: "lainco/dico", solucion: null },
      { repositorio: "lainco/sigma", solucion: null },
    ]);
  });

  it("un repositorio dos veces con distinta solución es un error", () => {
    expect(() => con("lainco/dico:A.sln,lainco/dico:B.sln")).toThrow(/dos veces/);
    expect(() => con("lainco/dico,lainco/dico:B.sln")).toThrow(/dos veces/);
  });

  it.each([undefined, "", " , "])("sin repositorios (%j) es un error que nombra la variable", (valor) => {
    expect(() => con(valor)).toThrow(ErrorDeConfiguracionDePrueba);
    expect(() => con(valor)).toThrow(/PRUEBA_REPOSITORIOS/);
  });

  it.each(["lainco", "lainco/dico/otro", "lainco/di co", "lainco/"])("%s no es owner/repo", (entrada) => {
    expect(() => con(`lainco/dico,${entrada}`)).toThrow(new RegExp(`"${entrada.replace(/[./]/g, "\\$&")}" no es owner/repo`));
  });

  it.each(["lainco/dico:", "lainco/dico:Dico.csproj", "lainco/dico:/abs/Dico.sln", "lainco/dico:../otro/Dico.sln", "lainco/dico:C:\\Dico.sln"])(
    "%s no tiene una solución válida",
    (entrada) => {
      expect(() => con(entrada)).toThrow(/no es una solución/);
    },
  );
});
