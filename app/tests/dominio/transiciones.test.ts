import { describe, expect, it } from "vitest";

import {
  MENSAJES_DE_RECHAZO,
  TRANSICIONES,
  validarTransicion,
  type MotivoDeRechazo,
  type SolicitudDeTransicion,
} from "@/dominio/transiciones";
import { Estado, Origen, Rol } from "@/dominio/valores";

/**
 * Máquina de estados del ciclo de vida de una regla (entrega 6.1, paso 3).
 *
 * La especificación de abajo es una copia de la tabla "Transiciones permitidas" de
 * docs/FASE-6.md (sección 4): los tests comparan el código contra el diseño, no contra
 * sí mismo. Si el diseño cambia, se cambia acá y en src/dominio/transiciones.ts.
 *
 * La excepción son las operaciones masivas: cuáles las admiten se decide en un único
 * lugar, el campo `admiteMasiva` de cada fila de TRANSICIONES (pedido del 2026-10-16).
 * Los tests no repiten esa lista: verifican que la validación respete el campo y que
 * ninguna transición hacia Incorporada lo tenga (FASE-6.md, sección 5).
 */

const { PendienteDeAnalizar, EnAnalisis, EnPrueba, EnDuda, Incorporada, Descartada } = Estado;

interface Especificacion {
  desde: Estado;
  hacia: Estado;
  justificacion: boolean;
  severidad: boolean;
  decisor: boolean;
}

const ESPECIFICACION: Especificacion[] = [
  { desde: PendienteDeAnalizar, hacia: EnAnalisis, justificacion: false, severidad: false, decisor: false },
  { desde: PendienteDeAnalizar, hacia: Descartada, justificacion: true, severidad: false, decisor: false },
  { desde: PendienteDeAnalizar, hacia: EnPrueba, justificacion: false, severidad: false, decisor: false },
  { desde: EnAnalisis, hacia: EnPrueba, justificacion: false, severidad: false, decisor: false },
  { desde: EnAnalisis, hacia: Incorporada, justificacion: true, severidad: true, decisor: true },
  { desde: EnAnalisis, hacia: Descartada, justificacion: true, severidad: false, decisor: true },
  { desde: EnPrueba, hacia: Incorporada, justificacion: true, severidad: true, decisor: true },
  { desde: EnPrueba, hacia: Descartada, justificacion: true, severidad: false, decisor: true },
  { desde: EnPrueba, hacia: EnAnalisis, justificacion: false, severidad: false, decisor: false },
  { desde: Incorporada, hacia: Descartada, justificacion: true, severidad: false, decisor: true },
  { desde: Incorporada, hacia: EnPrueba, justificacion: true, severidad: false, decisor: true },
  { desde: Descartada, hacia: EnAnalisis, justificacion: true, severidad: false, decisor: false },
  // En duda (2026-10-30): sin acuerdo, o los resultados de la prueba no convencen.
  { desde: EnAnalisis, hacia: EnDuda, justificacion: true, severidad: false, decisor: false },
  { desde: EnPrueba, hacia: EnDuda, justificacion: true, severidad: false, decisor: false },
  { desde: EnDuda, hacia: EnAnalisis, justificacion: false, severidad: false, decisor: false },
  { desde: EnDuda, hacia: EnPrueba, justificacion: false, severidad: false, decisor: false },
  { desde: EnDuda, hacia: Incorporada, justificacion: true, severidad: true, decisor: true },
  { desde: EnDuda, hacia: Descartada, justificacion: true, severidad: false, decisor: true },
];

const ESTADOS = Object.values(Estado);

const nombre = (desde: Estado, hacia: Estado) => `${desde} → ${hacia}`;

const especificada = (desde: Estado, hacia: Estado) =>
  ESPECIFICACION.find((e) => e.desde === desde && e.hacia === hacia);

/** Una solicitud que cumple todos los requisitos posibles. */
function completa(desde: Estado, hacia: Estado, cambios: Partial<SolicitudDeTransicion> = {}) {
  return validarTransicion({
    desde,
    hacia,
    rol: Rol.Decisor,
    justificacion: "Justificación de prueba",
    severidad: "MAJOR",
    masiva: false,
    resultadosDePruebaDisponibles: true,
    ...cambios,
  });
}

function motivos(resultado: ReturnType<typeof validarTransicion>): MotivoDeRechazo[] {
  return resultado.valida ? [] : resultado.motivos;
}

// ---------------------------------------------------------------------------------

describe("la tabla de transiciones", () => {
  it("tiene exactamente las transiciones de FASE-6.md, sin repetidas", () => {
    const enCodigo = TRANSICIONES.map((t) => nombre(t.desde, t.hacia)).sort();
    const enDiseno = ESPECIFICACION.map((e) => nombre(e.desde, e.hacia)).sort();

    expect(enCodigo).toEqual(enDiseno);
    expect(new Set(enCodigo).size).toBe(enCodigo.length);
  });

  it("no tiene ninguna transición hacia Incorporada que admita operación masiva", () => {
    // FASE-6.md, sección 5: cada regla que entra al gate se decide individualmente.
    const masivasHaciaIncorporada = TRANSICIONES.filter(
      (t) => t.hacia === Incorporada && t.admiteMasiva,
    ).map((t) => nombre(t.desde, t.hacia));

    expect(masivasHaciaIncorporada).toEqual([]);
  });
});

describe("todas las combinaciones de estados", () => {
  // El resultado esperado sale de la especificación y va en el título del test.
  const combinaciones = ESTADOS.flatMap((desde) =>
    ESTADOS.map((hacia) => {
      const permitida = especificada(desde, hacia) !== undefined;
      return { desde, hacia, permitida, esperado: permitida ? "está permitida" : "no está permitida" };
    }),
  );

  it.each(combinaciones)("$desde → $hacia $esperado", ({ desde, hacia, permitida }) => {
    // Con todos los requisitos cumplidos, solo pasan las transiciones del diseño.
    const resultado = completa(desde, hacia);

    if (permitida) {
      expect(resultado.valida).toBe(true);
    } else {
      expect(motivos(resultado)).toEqual(["transicionNoPermitida"]);
    }
  });
});

describe("Pendiente de analizar → Incorporada", () => {
  const casos = [Rol.Analista, Rol.Decisor].flatMap((rol) =>
    [false, true].map((masiva) => ({ rol, masiva })),
  );

  it.each(casos)("se rechaza siempre (rol $rol, masiva $masiva)", ({ rol, masiva }) => {
    // FASE-6.md, sección 4: toda regla que entra al gate pasa antes por revisión o prueba.
    const resultado = completa(PendienteDeAnalizar, Incorporada, { rol, masiva });

    expect(motivos(resultado)).toEqual(["transicionNoPermitida"]);
  });
});

describe.each(ESPECIFICACION)("$desde → $hacia", (e) => {
  if (e.justificacion) {
    it("exige justificación", () => {
      expect(motivos(completa(e.desde, e.hacia, { justificacion: undefined }))).toContain("faltaJustificacion");
      expect(motivos(completa(e.desde, e.hacia, { justificacion: "" }))).toContain("faltaJustificacion");
      expect(motivos(completa(e.desde, e.hacia, { justificacion: "   \n\t " }))).toContain("faltaJustificacion");
    });
  } else {
    it("no exige justificación", () => {
      expect(completa(e.desde, e.hacia, { justificacion: undefined }).valida).toBe(true);
    });
  }

  if (e.severidad) {
    it("exige severidad", () => {
      expect(motivos(completa(e.desde, e.hacia, { severidad: undefined }))).toContain("faltaSeveridad");
      expect(motivos(completa(e.desde, e.hacia, { severidad: "  " }))).toContain("faltaSeveridad");
    });
  } else {
    it("no exige severidad", () => {
      expect(completa(e.desde, e.hacia, { severidad: undefined }).valida).toBe(true);
    });
  }

  if (e.decisor) {
    it("exige rol decisor", () => {
      expect(motivos(completa(e.desde, e.hacia, { rol: Rol.Analista }))).toContain("requiereRolDecisor");
      expect(completa(e.desde, e.hacia, { rol: Rol.Decisor }).valida).toBe(true);
    });
  } else {
    it("la puede hacer un analista", () => {
      expect(completa(e.desde, e.hacia, { rol: Rol.Analista }).valida).toBe(true);
    });
  }

  const fila = TRANSICIONES.find((t) => t.desde === e.desde && t.hacia === e.hacia);

  if (fila?.admiteMasiva) {
    it("se puede hacer en operación masiva, con los mismos requisitos", () => {
      expect(completa(e.desde, e.hacia, { masiva: true }).valida).toBe(true);

      if (e.justificacion) {
        expect(motivos(completa(e.desde, e.hacia, { masiva: true, justificacion: undefined }))).toContain(
          "faltaJustificacion",
        );
      }
      if (e.decisor) {
        expect(motivos(completa(e.desde, e.hacia, { masiva: true, rol: Rol.Analista }))).toContain(
          "requiereRolDecisor",
        );
      }
    });
  } else {
    it("no se puede hacer en operación masiva", () => {
      expect(motivos(completa(e.desde, e.hacia, { masiva: true }))).toContain("noAdmiteOperacionMasiva");
    });
  }
});

describe("operaciones masivas", () => {
  it("descartar en masa desde Pendiente lo puede hacer un analista", () => {
    // FASE-6.md, sección 4: el analista puede "descartar masivamente desde Pendiente".
    const resultado = completa(PendienteDeAnalizar, Descartada, { rol: Rol.Analista, masiva: true });

    expect(resultado.valida).toBe(true);
  });

  it("nunca llevan a Incorporada", () => {
    for (const desde of [EnAnalisis, EnPrueba]) {
      expect(motivos(completa(desde, Incorporada, { masiva: true }))).toContain("noAdmiteOperacionMasiva");
    }
  });
});

describe("En prueba → Incorporada (entrega 6.5, decisión E3)", () => {
  it("exige haber cumplido el mínimo de corridas de prueba", () => {
    expect(motivos(completa(EnPrueba, Incorporada, { resultadosDePruebaDisponibles: false }))).toEqual(["faltanResultadosDePrueba"]);
    expect(completa(EnPrueba, Incorporada, { resultadosDePruebaDisponibles: true }).valida).toBe(true);
  });

  it("es la única transición que lo exige: desde En análisis se incorpora sin prueba", () => {
    const exigen = TRANSICIONES.filter((t) => t.requiereResultadosDePrueba).map((t) => nombre(t.desde, t.hacia));

    expect(exigen).toEqual([nombre(EnPrueba, Incorporada)]);
    expect(completa(EnAnalisis, Incorporada, { resultadosDePruebaDisponibles: false }).valida).toBe(true);
    expect(completa(EnDuda, Incorporada, { resultadosDePruebaDisponibles: false }).valida).toBe(true);
  });
});

describe("hacia En prueba, una regla que no se puede probar (entrega 6.5, decisión E7)", () => {
  const haciaEnPrueba = TRANSICIONES.filter((t) => t.hacia === EnPrueba);

  it("se rechaza desde cualquier estado, también en una operación masiva", () => {
    expect(haciaEnPrueba.length).toBeGreaterThan(0);
    for (const t of haciaEnPrueba) {
      expect(motivos(completa(t.desde, EnPrueba, { probableLocalmente: false })), nombre(t.desde, EnPrueba)).toEqual(["noSePuedeProbar"]);
      expect(motivos(completa(t.desde, EnPrueba, { probableLocalmente: false, masiva: true }))).toContain("noSePuedeProbar");
    }
  });

  it("si se puede, o todavía no se sabe, pasa", () => {
    for (const t of haciaEnPrueba) {
      expect(completa(t.desde, EnPrueba, { probableLocalmente: true }).valida).toBe(true);
      expect(completa(t.desde, EnPrueba, { probableLocalmente: null }).valida).toBe(true);
    }
  });

  it("no afecta a las demás transiciones", () => {
    expect(completa(EnAnalisis, Incorporada, { probableLocalmente: false }).valida).toBe(true);
    expect(completa(EnPrueba, EnAnalisis, { probableLocalmente: false }).valida).toBe(true);
  });
});

describe("parámetros", () => {
  // Al incorporar se pueden elegir valores para los parámetros de la regla. Solo los que
  // la regla tiene.
  it("los parámetros que la regla tiene se aceptan", () => {
    const resultado = completa(EnAnalisis, Incorporada, { parametros: { max: "5" }, parametrosDeLaRegla: ["max", "min"] });

    expect(resultado.valida).toBe(true);
  });

  it("un parámetro que la regla no tiene se rechaza", () => {
    const resultado = completa(EnAnalisis, Incorporada, { parametros: { maximo: "5" }, parametrosDeLaRegla: ["max"] });

    expect(motivos(resultado)).toEqual(["parametroDesconocido"]);
  });

  it("una regla sin parámetros no acepta ninguno", () => {
    const resultado = completa(EnAnalisis, Incorporada, { parametros: { max: "5" } });

    expect(motivos(resultado)).toEqual(["parametroDesconocido"]);
  });

  it("sin parámetros elegidos no hay nada que validar", () => {
    expect(completa(EnAnalisis, Incorporada, { parametros: {} }).valida).toBe(true);
  });
});

describe("reglas propias: la severidad la dice la regla (entrega 6.4, decisión R3)", () => {
  it.each([Origen.Roslyn, Origen.Eslint])("una regla de %s se incorpora sin elegir severidad", (origen) => {
    expect(completa(EnAnalisis, Incorporada, { origen, severidad: null }).valida).toBe(true);
  });

  it.each([Origen.Roslyn, Origen.Eslint])("en una regla de %s no se puede elegir severidad", (origen) => {
    expect(motivos(completa(EnAnalisis, Incorporada, { origen, severidad: "MAJOR" }))).toEqual(["severidadNoSeElige"]);
  });

  it("una regla de Sonar sigue necesitando la severidad", () => {
    expect(motivos(completa(EnAnalisis, Incorporada, { origen: Origen.Sonar, severidad: null }))).toEqual(["faltaSeveridad"]);
  });

  it("fuera de Incorporada la severidad no cuenta", () => {
    expect(completa(EnAnalisis, Descartada, { origen: Origen.Roslyn, severidad: null }).valida).toBe(true);
  });
});

describe("rechazos", () => {
  it("informan todos los motivos juntos, no solo el primero", () => {
    const resultado = validarTransicion({
      desde: EnAnalisis,
      hacia: Incorporada,
      rol: Rol.Analista,
      masiva: true,
    });

    expect(motivos(resultado).sort()).toEqual(
      ["faltaJustificacion", "faltaSeveridad", "noAdmiteOperacionMasiva", "requiereRolDecisor"].sort(),
    );
  });

  it("una transición que no existe no informa otros motivos", () => {
    const resultado = validarTransicion({ desde: PendienteDeAnalizar, hacia: Incorporada, rol: Rol.Analista });

    expect(motivos(resultado)).toEqual(["transicionNoPermitida"]);
  });

  it("cada motivo tiene un mensaje para el usuario", () => {
    const todos: MotivoDeRechazo[] = [
      "transicionNoPermitida",
      "requiereRolDecisor",
      "faltaJustificacion",
      "faltaSeveridad",
      "faltanResultadosDePrueba",
      "noAdmiteOperacionMasiva",
      "parametroDesconocido",
      "severidadNoSeElige",
      "noSePuedeProbar",
    ];

    for (const motivo of todos) {
      expect(MENSAJES_DE_RECHAZO[motivo]).toMatch(/\S/);
    }
  });
});
