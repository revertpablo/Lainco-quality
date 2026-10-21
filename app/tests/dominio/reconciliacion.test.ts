import { describe, expect, it } from "vitest";

import {
  compararPerfil,
  type ActivaEnSonar,
  type EntradaDeReconciliacion,
  type IncorporadaEnLaApp,
} from "@/dominio/reconciliacion";

/**
 * Qué diferencias hay entre la app y el perfil de Sonar (entrega 6.2, paso 5;
 * FASE-6.md, sección 10).
 *
 * Criterio del paso: "Activar una regla a mano en el Sonar simulado genera el desvío;
 * corregirlo lo cierra." (Lo de cerrarlo se prueba contra la base.)
 */

const PERFIL = { clave: "qp-cs", nombre: "Lainco C#", esDefault: true, heredaDe: null };
const MANTENIBILIDAD_MEDIA = [{ calidad: "MAINTAINABILITY", severidad: "MEDIUM" }];

function incorporada(clave: string, cambios: Partial<IncorporadaEnLaApp> = {}): IncorporadaEnLaApp {
  return {
    clave,
    reglaId: `id-${clave}`,
    severidad: "MAJOR",
    parametros: {},
    impactosDeLaRegla: [{ calidad: "MAINTAINABILITY", severidad: "LOW" }],
    parametrosPorDefecto: {},
    ...cambios,
  };
}

function activa(clave: string, cambios: Partial<ActivaEnSonar> = {}): ActivaEnSonar {
  return { clave, impactos: MANTENIBILIDAD_MEDIA, parametros: {}, ...cambios };
}

/** Un perfil en orden: lo incorporado está activo, como se decidió. */
function entrada(cambios: Partial<EntradaDeReconciliacion> = {}): EntradaDeReconciliacion {
  return {
    lenguaje: "cs",
    perfil: PERFIL,
    activas: [activa("cs:S1")],
    incorporadas: [incorporada("cs:S1")],
    proyectos: [{ clave: "revertpablo_Lainco-quality", nombre: "Lainco-quality", perfil: { clave: "qp-cs", nombre: "Lainco C#" } }],
    reglaIdPorClave: new Map([
      ["cs:S1", "id-cs:S1"],
      ["cs:S2", "id-cs:S2"],
    ]),
    conPublicacionPendiente: new Set(),
    ...cambios,
  };
}

const tipos = (e: EntradaDeReconciliacion) => compararPerfil(e).map((d) => `${d.tipo} ${d.clave}`);

describe("reglas", () => {
  it("un perfil igual a la app no tiene desvíos", () => {
    expect(compararPerfil(entrada())).toEqual([]);
  });

  it("una regla activada a mano en Sonar es un desvío, ubicada en el inventario", () => {
    const desvios = compararPerfil(entrada({ activas: [activa("cs:S1"), activa("cs:S2", { parametros: { max: "3" } })] }));

    expect(desvios).toEqual([
      {
        tipo: "activaSinIncorporar",
        lenguaje: "cs",
        clave: "cs:S2",
        reglaId: "id-cs:S2",
        detalle: { esperado: "inactiva", encontrado: { impactos: MANTENIBILIDAD_MEDIA, parametros: { max: "3" } } },
      },
    ]);
  });

  it("una regla activa que no está en el inventario también es un desvío, sin regla", () => {
    const [desvio] = compararPerfil(entrada({ activas: [activa("cs:S1"), activa("cs:NUEVA")] }));

    expect(desvio).toMatchObject({ tipo: "activaSinIncorporar", clave: "cs:NUEVA", reglaId: null });
  });

  it("una Incorporada que no está activa es un desvío", () => {
    expect(tipos(entrada({ activas: [] }))).toEqual(["incorporadaInactiva cs:S1"]);
  });

  it("con otra severidad en algún impacto, es un desvío que dice cuál se esperaba", () => {
    const desvios = compararPerfil(
      entrada({ activas: [activa("cs:S1", { impactos: [{ calidad: "MAINTAINABILITY", severidad: "HIGH" }] })] }),
    );

    expect(desvios).toEqual([
      expect.objectContaining({
        tipo: "severidadDistinta",
        detalle: { esperado: MANTENIBILIDAD_MEDIA, encontrado: [{ calidad: "MAINTAINABILITY", severidad: "HIGH" }] },
      }),
    ]);
  });

  it("se compara la severidad elegida traducida a cada impacto de la regla", () => {
    const regla = incorporada("cs:S1", {
      severidad: "CRITICAL",
      impactosDeLaRegla: [
        { calidad: "SECURITY", severidad: "LOW" },
        { calidad: "RELIABILITY", severidad: "LOW" },
      ],
    });
    const bien = [
      { calidad: "SECURITY", severidad: "HIGH" },
      { calidad: "RELIABILITY", severidad: "HIGH" },
    ];

    expect(tipos(entrada({ incorporadas: [regla], activas: [activa("cs:S1", { impactos: bien })] }))).toEqual([]);
    expect(
      tipos(entrada({ incorporadas: [regla], activas: [activa("cs:S1", { impactos: [bien[0], { calidad: "RELIABILITY", severidad: "LOW" }] })] })),
    ).toEqual(["severidadDistinta cs:S1"]);
  });

  it("sin severidad elegida no se compara la severidad: Sonar usa la de la regla", () => {
    const regla = incorporada("cs:S1", { severidad: null });

    expect(tipos(entrada({ incorporadas: [regla], activas: [activa("cs:S1", { impactos: [{ calidad: "MAINTAINABILITY", severidad: "BLOCKER" }] })] }))).toEqual([]);
  });

  it("un parámetro elegido con otro valor en Sonar es un desvío", () => {
    const desvios = compararPerfil(
      entrada({
        incorporadas: [incorporada("cs:S1", { parametros: { max: "5" } })],
        activas: [activa("cs:S1", { parametros: { max: "9" } })],
      }),
    );

    expect(desvios).toEqual([
      expect.objectContaining({ tipo: "parametrosDistintos", detalle: { esperado: { max: "5" }, encontrado: { max: "9" } } }),
    ]);
  });

  it("un parámetro no elegido tiene que estar con el valor de Sonar; si no tiene valor por defecto, no se compara", () => {
    const regla = incorporada("cs:S1", { parametrosPorDefecto: { max: "7" } });

    expect(tipos(entrada({ incorporadas: [regla], activas: [activa("cs:S1", { parametros: { max: "7", otro: "x" } })] }))).toEqual([]);
    expect(tipos(entrada({ incorporadas: [regla], activas: [activa("cs:S1", { parametros: { max: "8" } })] }))).toEqual([
      "parametrosDistintos cs:S1",
    ]);
  });

  it("severidad y parámetros distintos son dos desvíos", () => {
    const desvios = tipos(
      entrada({
        incorporadas: [incorporada("cs:S1", { parametros: { max: "5" } })],
        activas: [activa("cs:S1", { impactos: [{ calidad: "MAINTAINABILITY", severidad: "INFO" }], parametros: { max: "1" } })],
      }),
    );

    expect(desvios).toEqual(["severidadDistinta cs:S1", "parametrosDistintos cs:S1"]);
  });

  it("una regla con una publicación pendiente no es desvío: ya está por resolverse", () => {
    expect(
      tipos(
        entrada({
          activas: [activa("cs:S2")],
          incorporadas: [incorporada("cs:S1")],
          conPublicacionPendiente: new Set(["id-cs:S1", "id-cs:S2"]),
        }),
      ),
    ).toEqual([]);
  });
});

describe("perfil y proyectos", () => {
  it("un perfil que hereda de otro es un desvío", () => {
    const [desvio] = compararPerfil(entrada({ perfil: { ...PERFIL, heredaDe: { clave: "sw", nombre: "Sonar way" } } }));

    expect(desvio).toEqual({
      tipo: "perfilConHerencia",
      lenguaje: "cs",
      clave: "Lainco C#",
      reglaId: null,
      detalle: { esperado: "sin herencia", encontrado: "Sonar way" },
    });
  });

  it("un perfil que no es el default es un desvío (decisión P5)", () => {
    expect(tipos(entrada({ perfil: { ...PERFIL, esDefault: false } }))).toEqual(["perfilNoEsDefault Lainco C#"]);
  });

  it("un proyecto que usa otro perfil es un desvío que dice cuál usa", () => {
    const [desvio] = compararPerfil(
      entrada({
        proyectos: [
          { clave: "p1", nombre: "P1", perfil: { clave: "qp-cs", nombre: "Lainco C#" } },
          { clave: "p2", nombre: "P2", perfil: { clave: "sw", nombre: "Sonar way comprehensive" } },
        ],
      }),
    );

    expect(desvio).toMatchObject({ tipo: "proyectoConOtroPerfil", clave: "p2", detalle: { esperado: "Lainco C#", encontrado: "Sonar way comprehensive" } });
  });

  it("un proyecto sin perfil para el lenguaje también", () => {
    expect(tipos(entrada({ proyectos: [{ clave: "p1", nombre: "P1", perfil: null }] }))).toEqual(["proyectoConOtroPerfil p1"]);
  });
});
