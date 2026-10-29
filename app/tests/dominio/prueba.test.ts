import { describe, expect, it } from "vitest";

import {
  claveDeDiagnostico,
  corridasQueCuentan,
  corridasQueFaltan,
  elegirMuestras,
  ErrorDePrueba,
  generarGlobalconfigDePrueba,
  idDeDiagnostico,
  identidadDeMuestra,
  linkDeMuestra,
  normalizarArchivo,
  tasaDeFalsosPositivos,
} from "@/dominio/prueba";
import { EstadoCorrida, EvaluacionMuestra, Origen } from "@/dominio/valores";

/**
 * Lo que la entrega 6.5 (paso 2) decide sin base ni red: el .globalconfig con el que el job
 * compila, cómo se traduce un diagnóstico a una regla del inventario, cuándo dos muestras
 * son la misma (E6), la tasa de falsos positivos y las corridas que cuentan para el mínimo
 * (E3).
 */

const sonar = (id: string) => ({ origen: Origen.Sonar, clave: `csharpsquid:${id}` });
const roslyn = (clave: string) => ({ origen: Origen.Roslyn, clave });

describe("idDeDiagnostico", () => {
  it("una regla de Sonar para C# es su ID de SonarAnalyzer.CSharp", () => {
    expect(idDeDiagnostico(sonar("S2325"))).toBe("S2325");
  });

  it("una regla Roslyn propia es su clave", () => {
    expect(idDeDiagnostico(roslyn("LAIN001"))).toBe("LAIN001");
  });

  it.each([
    ["de Sonar para TypeScript", { origen: Origen.Sonar, clave: "typescript:S1234" }],
    ["de ESLint", { origen: Origen.Eslint, clave: "lainco/no-algo" }],
    ["norma de IA", { origen: Origen.NormaIa, clave: "LAIN-D012" }],
    ["Roslyn con otra forma", roslyn("CA1822")],
  ])("una regla %s no se puede probar con el job de C#", (_caso, regla) => {
    expect(() => idDeDiagnostico(regla)).toThrow(ErrorDePrueba);
  });
});

describe("claveDeDiagnostico", () => {
  it("traduce el ruleId del SARIF a la regla del inventario", () => {
    expect(claveDeDiagnostico("S2325")).toEqual(sonar("S2325"));
    expect(claveDeDiagnostico("LAIN001")).toEqual(roslyn("LAIN001"));
  });

  it.each(["CS0168", "CA1822", "IDE0005", "AD0001", "s2325", "LAIN01", ""])("%s no es de una regla del inventario", (id) => {
    expect(claveDeDiagnostico(id)).toBeNull();
  });
});

describe("generarGlobalconfigDePrueba", () => {
  const lineasQueLeeElCompilador = (texto: string) => texto.split("\n").filter((l) => l !== "" && !l.startsWith("#"));

  it("enciende solo las reglas en prueba y apaga todos los demás analyzers", () => {
    const texto = generarGlobalconfigDePrueba([sonar("S2325"), roslyn("LAIN001"), sonar("S1118")]);

    expect(lineasQueLeeElCompilador(texto)).toEqual([
      "is_global = true",
      "global_level = 1000",
      "dotnet_analyzer_diagnostic.severity = none",
      "dotnet_diagnostic.LAIN001.severity = warning",
      "dotnet_diagnostic.S1118.severity = warning",
      "dotnet_diagnostic.S2325.severity = warning",
    ]);
  });

  it("dice qué es y que no se edita a mano", () => {
    expect(generarGlobalconfigDePrueba([roslyn("LAIN001")])).toMatch(/^# .*prueba.*\n/);
  });

  it("sin reglas apaga todo", () => {
    expect(lineasQueLeeElCompilador(generarGlobalconfigDePrueba([]))).toEqual([
      "is_global = true",
      "global_level = 1000",
      "dotnet_analyzer_diagnostic.severity = none",
    ]);
  });

  it("una regla repetida va una vez", () => {
    const texto = generarGlobalconfigDePrueba([roslyn("LAIN001"), roslyn("LAIN001")]);

    expect(texto.match(/LAIN001/g)).toHaveLength(1);
  });

  it("rechaza una regla que no es de C#", () => {
    expect(() => generarGlobalconfigDePrueba([{ origen: Origen.Eslint, clave: "lainco/no-algo" }])).toThrow(ErrorDePrueba);
  });
});

describe("normalizarArchivo", () => {
  it.each([
    ["src/Dominio/Pedido.cs", "src/Dominio/Pedido.cs"],
    ["src\\Dominio\\Pedido.cs", "src/Dominio/Pedido.cs"],
    ["./src/Dominio/Pedido.cs", "src/Dominio/Pedido.cs"],
    ["src//Dominio/./Pedido.cs", "src/Dominio/Pedido.cs"],
  ])("%s queda %s", (ruta, esperada) => {
    expect(normalizarArchivo(ruta)).toBe(esperada);
  });

  it.each(["/home/runner/work/repo/Pedido.cs", "C:\\repo\\Pedido.cs", "../otro/Pedido.cs", "src/../../Pedido.cs", "", "file:///repo/Pedido.cs"])(
    "%s no es una ruta dentro del repositorio",
    (ruta) => {
      expect(() => normalizarArchivo(ruta)).toThrow(ErrorDePrueba);
    },
  );
});

describe("identidadDeMuestra", () => {
  const muestra = { reglaId: "r1", repositorio: "lainco/dico", archivo: "src/Pedido.cs", mensaje: "El constructor de 'Dico.Pedido'…" };

  it("la misma regla, repositorio, archivo y mensaje es la misma muestra, aunque cambie la línea", () => {
    expect(identidadDeMuestra(muestra)).toBe(identidadDeMuestra({ ...muestra }));
  });

  it("el repositorio no distingue mayúsculas, como en GitHub", () => {
    expect(identidadDeMuestra({ ...muestra, repositorio: "Lainco/DICO" })).toBe(identidadDeMuestra(muestra));
  });

  it("los espacios de más en el mensaje no cuentan", () => {
    expect(identidadDeMuestra({ ...muestra, mensaje: `  ${muestra.mensaje}  ` })).toBe(identidadDeMuestra(muestra));
  });

  it.each([
    ["otra regla", { reglaId: "r2" }],
    ["otro repositorio", { repositorio: "lainco/otro" }],
    ["otro archivo", { archivo: "src/Cliente.cs" }],
    ["otro mensaje", { mensaje: "El constructor de 'Dico.Cliente'…" }],
  ])("con %s es otra", (_caso, cambio) => {
    expect(identidadDeMuestra({ ...muestra, ...cambio })).not.toBe(identidadDeMuestra(muestra));
  });

  it("un separador dentro de un campo no hace que dos muestras distintas coincidan", () => {
    const a = identidadDeMuestra({ ...muestra, archivo: "a", mensaje: "b\u0000c" });
    const b = identidadDeMuestra({ ...muestra, archivo: "a\u0000b", mensaje: "c" });
    expect(a).not.toBe(b);
  });
});

describe("linkDeMuestra", () => {
  it("lleva al archivo y la línea en GitHub, en el commit analizado", () => {
    expect(linkDeMuestra({ repositorio: "lainco/dico", commit: "0b83618abc", archivo: "src/Dominio/Pedido.cs", linea: 14 })).toBe(
      "https://github.com/lainco/dico/blob/0b83618abc/src/Dominio/Pedido.cs#L14",
    );
  });

  it("codifica los caracteres especiales de cada parte de la ruta", () => {
    expect(linkDeMuestra({ repositorio: "lainco/dico", commit: "abc", archivo: "src/Mis Clases/Año#1.cs", linea: 3 })).toBe(
      "https://github.com/lainco/dico/blob/abc/src/Mis%20Clases/A%C3%B1o%231.cs#L3",
    );
  });
});

describe("tasaDeFalsosPositivos", () => {
  const { SinEvaluar, Valida, FalsoPositivo } = EvaluacionMuestra;

  it("es falsos positivos sobre evaluadas; las sin evaluar no cuentan", () => {
    expect(tasaDeFalsosPositivos([Valida, FalsoPositivo, FalsoPositivo, Valida, SinEvaluar, SinEvaluar])).toEqual({
      evaluadas: 4,
      validas: 2,
      falsosPositivos: 2,
      sinEvaluar: 2,
      tasa: 0.5,
    });
  });

  it("sin evaluadas no hay tasa", () => {
    expect(tasaDeFalsosPositivos([SinEvaluar]).tasa).toBeNull();
    expect(tasaDeFalsosPositivos([]).tasa).toBeNull();
  });

  it("todas válidas da 0, todas falsos positivos da 1", () => {
    expect(tasaDeFalsosPositivos([Valida, Valida]).tasa).toBe(0);
    expect(tasaDeFalsosPositivos([FalsoPositivo]).tasa).toBe(1);
  });
});

describe("corridasQueCuentan", () => {
  const entroEnPrueba = new Date("2026-10-20T00:00:00Z");
  const corrida = (dia: number, cambios: Partial<{ estado: EstadoCorrida; conResultados: boolean }> = {}) => ({
    iniciadaEn: new Date(`2026-10-${String(dia).padStart(2, "0")}T03:00:00Z`),
    estado: EstadoCorrida.Terminada,
    conResultados: true,
    ...cambios,
  });

  it("cuentan las terminadas con resultados de la regla desde que entró a En prueba", () => {
    expect(corridasQueCuentan([corrida(21), corrida(22), corrida(23)], entroEnPrueba)).toBe(3);
  });

  it("no cuentan las de antes de entrar (una vuelta anterior por En prueba)", () => {
    expect(corridasQueCuentan([corrida(18), corrida(19), corrida(21)], entroEnPrueba)).toBe(1);
  });

  it("cuenta una que arrancó en el mismo instante en que entró", () => {
    expect(corridasQueCuentan([{ ...corrida(20), iniciadaEn: entroEnPrueba }], entroEnPrueba)).toBe(1);
  });

  it("no cuentan las que siguen en curso ni las que fallaron", () => {
    expect(corridasQueCuentan([corrida(21, { estado: EstadoCorrida.EnCurso }), corrida(22, { estado: EstadoCorrida.Fallida }), corrida(23)], entroEnPrueba)).toBe(1);
  });

  it("no cuenta una corrida sin resultados de la regla (ningún repositorio compiló)", () => {
    expect(corridasQueCuentan([corrida(21, { conResultados: false }), corrida(22)], entroEnPrueba)).toBe(1);
  });
});

describe("corridasQueFaltan", () => {
  it("es lo que falta para el mínimo, nunca negativo", () => {
    expect(corridasQueFaltan(5, 2)).toBe(3);
    expect(corridasQueFaltan(5, 5)).toBe(0);
    expect(corridasQueFaltan(5, 8)).toBe(0);
  });
});

describe("elegirMuestras", () => {
  const ubicacion = (archivo: string, mensaje = `En ${archivo}`, linea = 1) => ({ archivo, linea, columna: 1, mensaje });
  const identidad = (u: { archivo: string; mensaje: string }) =>
    identidadDeMuestra({ reglaId: "r1", repositorio: "lainco/dico", archivo: u.archivo, mensaje: u.mensaje });

  it("toma hasta el máximo, en el orden en que llegan", () => {
    const ubicaciones = Array.from({ length: 30 }, (_, i) => ubicacion(`A${String(i).padStart(2, "0")}.cs`));

    const elegidas = elegirMuestras(ubicaciones, { identidad, evaluadas: new Set(), maximo: 20 });

    expect(elegidas.map((u) => u.archivo)).toEqual(ubicaciones.slice(0, 20).map((u) => u.archivo));
  });

  it("primero las ya evaluadas, aunque lleguen al final (E6)", () => {
    const ubicaciones = Array.from({ length: 30 }, (_, i) => ubicacion(`A${String(i).padStart(2, "0")}.cs`));
    const evaluadas = new Set([identidad(ubicaciones[28]), identidad(ubicaciones[25])]);

    const elegidas = elegirMuestras(ubicaciones, { identidad, evaluadas, maximo: 5 });

    expect(elegidas.map((u) => u.archivo)).toEqual(["A25.cs", "A28.cs", "A00.cs", "A01.cs", "A02.cs"]);
  });

  it("dos ubicaciones con la misma identidad son una muestra: queda la primera", () => {
    const elegidas = elegirMuestras([ubicacion("A.cs", "igual", 3), ubicacion("A.cs", "igual", 9), ubicacion("B.cs")], {
      identidad,
      evaluadas: new Set(),
      maximo: 20,
    });

    expect(elegidas.map((u) => [u.archivo, u.linea])).toEqual([
      ["A.cs", 3],
      ["B.cs", 1],
    ]);
  });

  it("el máximo por defecto es 20", () => {
    const ubicaciones = Array.from({ length: 50 }, (_, i) => ubicacion(`A${i}.cs`));

    expect(elegirMuestras(ubicaciones, { identidad, evaluadas: new Set() })).toHaveLength(20);
  });
});
