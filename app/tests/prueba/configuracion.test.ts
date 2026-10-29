import { describe, expect, it } from "vitest";

import { ErrorDeConfiguracionDePrueba, repositoriosDesdeEntorno } from "@/prueba/configuracion";

/**
 * La lista de repositorios del job de prueba (entrega 6.5, decisión E2): la variable
 * PRUEBA_REPOSITORIOS, con `owner/repo` separados por coma.
 */

const con = (valor?: string) => repositoriosDesdeEntorno({ PRUEBA_REPOSITORIOS: valor });

describe("repositoriosDesdeEntorno", () => {
  it("lee owner/repo separados por coma", () => {
    expect(con("revertpablo/Lainco-quality,lainco/dico")).toEqual(["revertpablo/lainco-quality", "lainco/dico"]);
  });

  it("acepta espacios y saltos de línea, y no repite", () => {
    expect(con(" lainco/dico ,\n lainco/sigma,, Lainco/DICO ")).toEqual(["lainco/dico", "lainco/sigma"]);
  });

  it("guarda en minúsculas, como los compara GitHub", () => {
    expect(con("Lainco/Sigma.Web")).toEqual(["lainco/sigma.web"]);
  });

  it.each([undefined, "", " , "])("sin repositorios (%j) es un error que nombra la variable", (valor) => {
    expect(() => con(valor)).toThrow(ErrorDeConfiguracionDePrueba);
    expect(() => con(valor)).toThrow(/PRUEBA_REPOSITORIOS/);
  });

  it.each(["lainco", "lainco/dico/otro", "https://github.com/lainco/dico", "lainco/di co", "lainco/"])("%s no es owner/repo", (entrada) => {
    expect(() => con(`lainco/dico,${entrada}`)).toThrow(new RegExp(`"${entrada.replace(/[./]/g, "\\$&")}"`));
  });
});
