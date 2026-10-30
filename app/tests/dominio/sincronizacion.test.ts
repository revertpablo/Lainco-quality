import { describe, expect, it } from "vitest";

import {
  compararCatalogo,
  huellaDeRegla,
  type ReglaAlmacenada,
  type ReglaDelOrigen,
} from "@/dominio/sincronizacion";
import { Estado, type Estado as TipoEstado } from "@/dominio/valores";

/**
 * Comparación del catálogo de Sonar con lo almacenado (FASE-6.md, sección 3; entrega 6.1,
 * paso 6). Sin base ni red: recibe las dos listas y dice qué hay que hacer.
 */

function deSonar(clave: string, cambios: Partial<ReglaDelOrigen> = {}): ReglaDelOrigen {
  return {
    clave,
    nombre: `Regla ${clave}`,
    lenguaje: clave.startsWith("typescript") ? "ts" : "cs",
    estado: "READY",
    tipo: "CODE_SMELL",
    severidad: "MAJOR",
    tags: ["pitfall"],
    atributoCleanCode: "CLEAR",
    impactos: [{ calidad: "MAINTAINABILITY", severidad: "HIGH" }],
    parametros: [],
    descripcion: `<p>${clave}</p>`,
    ...cambios,
  };
}

/** Lo que quedaría almacenado después de sincronizar `regla`. */
function almacenada(
  id: string,
  regla: ReglaDelOrigen,
  cambios: Partial<ReglaAlmacenada> = {},
): ReglaAlmacenada {
  return {
    id,
    clave: regla.clave,
    lenguaje: regla.lenguaje,
    nombre: regla.nombre,
    tipo: regla.tipo,
    severidadDefault: regla.severidad,
    tags: regla.tags,
    atributoCleanCode: regla.atributoCleanCode,
    impactos: regla.impactos,
    parametros: regla.parametros,
    descripcion: regla.descripcion,
    hashDescripcion: huellaDeRegla(regla),
    deprecada: regla.estado === "DEPRECATED",
    estado: Estado.PendienteDeAnalizar,
    ...cambios,
  };
}

const LENGUAJES = ["cs", "ts"];

function comparar(almacenadas: ReglaAlmacenada[], sonar: ReglaDelOrigen[]) {
  return compararCatalogo(almacenadas, sonar, LENGUAJES);
}

function vacio(resultado: ReturnType<typeof compararCatalogo>) {
  return {
    nuevas: resultado.nuevas.length,
    modificadas: resultado.modificadas.length,
    actualizadas: resultado.actualizadas.length,
    deprecadas: resultado.deprecadas.length,
    reactivadas: resultado.reactivadas.length,
    avisos: resultado.avisos.length,
  };
}

const SIN_CAMBIOS = { nuevas: 0, modificadas: 0, actualizadas: 0, deprecadas: 0, reactivadas: 0, avisos: 0 };

// ---------------------------------------------------------------------------------

describe("primera sincronización", () => {
  it("todas las reglas de Sonar son nuevas", () => {
    const sonar = [deSonar("csharpsquid:S1"), deSonar("csharpsquid:S2"), deSonar("typescript:S1")];

    const resultado = comparar([], sonar);

    expect(resultado.nuevas.map((r) => r.clave)).toEqual(["csharpsquid:S1", "csharpsquid:S2", "typescript:S1"]);
    expect({ ...vacio(resultado), nuevas: 0 }).toEqual(SIN_CAMBIOS);
  });

  it("una regla que ya viene deprecada se crea marcada como deprecada", () => {
    const resultado = comparar([], [deSonar("csharpsquid:S1", { estado: "DEPRECATED" })]);

    expect(resultado.nuevas).toHaveLength(1);
    expect(resultado.nuevas[0].estado).toBe("DEPRECATED");
    // No cuenta como "deprecada en esta sincronización": no estaba antes.
    expect(resultado.deprecadas).toEqual([]);
  });
});

describe("segunda sincronización sin cambios en Sonar", () => {
  it("no crea ni modifica nada", () => {
    const sonar = [
      deSonar("csharpsquid:S1"),
      deSonar("csharpsquid:S2", { estado: "DEPRECATED" }),
      deSonar("typescript:S1", { parametros: [{ clave: "max", valorDefault: "3" }] }),
    ];
    const guardadas = sonar.map((r, i) => almacenada(`id-${i}`, r));

    expect(vacio(comparar(guardadas, sonar))).toEqual(SIN_CAMBIOS);
  });

  it("el orden de tags, parámetros e impactos no importa", () => {
    const regla = deSonar("csharpsquid:S1", {
      tags: ["a", "b"],
      parametros: [
        { clave: "max", valorDefault: "3" },
        { clave: "min", descripcion: "Mínimo" },
      ],
      impactos: [
        { calidad: "MAINTAINABILITY", severidad: "HIGH" },
        { calidad: "RELIABILITY", severidad: "LOW" },
      ],
    });
    const guardada = almacenada("id-1", regla, {
      tags: ["b", "a"],
      parametros: [
        { descripcion: "Mínimo", clave: "min" },
        { valorDefault: "3", clave: "max" },
      ],
      impactos: [
        { severidad: "LOW", calidad: "RELIABILITY" },
        { severidad: "HIGH", calidad: "MAINTAINABILITY" },
      ],
    });

    expect(vacio(comparar([guardada], [regla]))).toEqual(SIN_CAMBIOS);
  });

  it("la huella no depende del orden de los parámetros ni de sus campos", () => {
    const a = deSonar("x:S1", { parametros: [{ clave: "a", valorDefault: "1", tipo: "INTEGER" }, { clave: "b" }] });
    const b = deSonar("x:S1", { parametros: [{ clave: "b" }, { tipo: "INTEGER", valorDefault: "1", clave: "a" }] });

    expect(huellaDeRegla(a)).toBe(huellaDeRegla(b));
  });
});

describe("regla modificada en Sonar", () => {
  const original = deSonar("csharpsquid:S1", { parametros: [{ clave: "max", valorDefault: "3" }] });

  it.each([
    ["la descripción", { descripcion: "<p>Otra</p>" }],
    ["un parámetro", { parametros: [{ clave: "max", valorDefault: "5" }] }],
    ["un parámetro nuevo", { parametros: [{ clave: "max", valorDefault: "3" }, { clave: "min" }] }],
    ["la severidad por defecto", { severidad: "CRITICAL" }],
  ])("si cambia %s, se marca modificada", (_caso, cambios) => {
    const resultado = comparar([almacenada("id-1", original)], [{ ...original, ...cambios }]);

    expect(resultado.modificadas.map((m) => m.id)).toEqual(["id-1"]);
    expect(resultado.modificadas[0].regla.clave).toBe("csharpsquid:S1");
    expect(resultado.actualizadas).toEqual([]);
  });

  it.each([
    ["el nombre", { nombre: "Otro nombre" }],
    ["los tags", { tags: ["pitfall", "nuevo"] }],
    ["el tipo", { tipo: "BUG" }],
    ["el atributo de clean code", { atributoCleanCode: "LOGICAL" }],
    ["los impactos", { impactos: [{ calidad: "SECURITY", severidad: "HIGH" }] }],
  ])("si cambia solo %s, se actualiza sin marcarla modificada", (_caso, cambios) => {
    // FASE-6.md: "modificada" es cuando cambia la descripción, los parámetros o la
    // severidad por defecto. El resto se mantiene al día sin avisar.
    const resultado = comparar([almacenada("id-1", original)], [{ ...original, ...cambios }]);

    expect(resultado.actualizadas.map((a) => a.id)).toEqual(["id-1"]);
    expect(resultado.modificadas).toEqual([]);
  });

  it.each([
    [Estado.Incorporada, true],
    [Estado.EnPrueba, true],
    [Estado.PendienteDeAnalizar, false],
    [Estado.EnAnalisis, false],
    [Estado.Descartada, false],
  ] as [TipoEstado, boolean][])("si estaba %s, avisa: %s", (estado, avisa) => {
    const resultado = comparar(
      [almacenada("id-1", original, { estado })],
      [{ ...original, descripcion: "<p>Otra</p>" }],
    );

    expect(resultado.avisos).toEqual(avisa ? [{ reglaId: "id-1", motivo: "modificada" }] : []);
  });

  it("un cambio que no la marca modificada no avisa, aunque esté Incorporada", () => {
    const resultado = comparar(
      [almacenada("id-1", original, { estado: Estado.Incorporada })],
      [{ ...original, tags: ["otro"] }],
    );

    expect(resultado.avisos).toEqual([]);
  });
});

describe("regla deprecada o eliminada en Sonar", () => {
  const regla = deSonar("csharpsquid:S1");

  it("si Sonar la marca DEPRECATED, se marca deprecada", () => {
    const resultado = comparar([almacenada("id-1", regla)], [{ ...regla, estado: "DEPRECATED" }]);

    expect(resultado.deprecadas).toEqual([{ id: "id-1", motivo: "deprecada" }]);
    expect(resultado.modificadas).toEqual([]);
  });

  it("si ya no aparece en Sonar, se marca deprecada como eliminada", () => {
    const otra = deSonar("csharpsquid:S2");

    const resultado = comparar([almacenada("id-1", regla), almacenada("id-2", otra)], [otra]);

    expect(resultado.deprecadas).toEqual([{ id: "id-1", motivo: "eliminada" }]);
  });

  it("una que ya estaba deprecada no se vuelve a marcar", () => {
    const deprecada = { ...regla, estado: "DEPRECATED" };

    expect(vacio(comparar([almacenada("id-1", deprecada)], [deprecada]))).toEqual(SIN_CAMBIOS);
    expect(vacio(comparar([almacenada("id-1", deprecada)], []))).toEqual(SIN_CAMBIOS);
  });

  it.each([
    ["eliminada", [] as ReglaDelOrigen[]],
    ["deprecada", [{ ...regla, estado: "DEPRECATED" }]],
  ] as const)("si estaba Incorporada y queda %s, avisa", (motivo, cambio) => {
    const otra = deSonar("csharpsquid:S2");

    const resultado = comparar(
      [almacenada("id-1", regla, { estado: Estado.Incorporada }), almacenada("id-2", otra)],
      [...cambio, otra],
    );

    expect(resultado.avisos).toEqual([{ reglaId: "id-1", motivo }]);
  });

  it.each([Estado.PendienteDeAnalizar, Estado.EnAnalisis, Estado.EnPrueba, Estado.Descartada])(
    "si estaba %s, no avisa",
    (estado) => {
      const resultado = comparar([almacenada("id-1", regla, { estado })], [{ ...regla, estado: "DEPRECATED" }]);

      expect(resultado.avisos).toEqual([]);
    },
  );

  it("solo se dan por eliminadas las reglas de los lenguajes consultados", () => {
    const deTs = almacenada("id-ts", deSonar("typescript:S1"));

    const resultado = compararCatalogo([deTs], [deSonar("csharpsquid:S1")], ["cs"]);

    expect(resultado.deprecadas).toEqual([]);
  });

  it("si Sonar no devuelve ninguna regla de un lenguaje que tiene reglas guardadas, falla", () => {
    // Más probable un problema de Sonar o de configuración que la eliminación de todo el
    // lenguaje: no se marca nada.
    const guardadas = [almacenada("id-1", deSonar("csharpsquid:S1")), almacenada("id-2", deSonar("typescript:S1"))];

    expect(() => comparar(guardadas, [deSonar("typescript:S1")])).toThrow(/cs/);
  });
});

describe("regla que vuelve en Sonar", () => {
  const regla = deSonar("csharpsquid:S1");

  it("una deprecada que vuelve a estar lista se reactiva", () => {
    const resultado = comparar([almacenada("id-1", { ...regla, estado: "DEPRECATED" })], [regla]);

    expect(resultado.reactivadas.map((r) => r.id)).toEqual(["id-1"]);
    expect(resultado.deprecadas).toEqual([]);
  });

  it("si además cambió, también se marca modificada", () => {
    const resultado = comparar(
      [almacenada("id-1", { ...regla, estado: "DEPRECATED" })],
      [{ ...regla, descripcion: "<p>Nueva</p>" }],
    );

    expect(resultado.reactivadas.map((r) => r.id)).toEqual(["id-1"]);
    expect(resultado.modificadas.map((m) => m.id)).toEqual(["id-1"]);
  });
});

it("una regla repetida en la lista de Sonar es un error", () => {
  expect(() => comparar([], [deSonar("csharpsquid:S1"), deSonar("csharpsquid:S1")])).toThrow(/repetida/);
});
