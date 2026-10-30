import { describe, expect, it } from "vitest";

import type { ResultadoDeTransicion } from "@/transiciones/aplicarTransicion";
import { MAXIMO_DE_REGLAS_POR_LOTE, pedidoIndividual, pedidoMasivo } from "@/transiciones/pedidos";
import { responder } from "@/transiciones/respuestas";

/** Forma de los pedidos y de las respuestas de la API de transiciones, sin base. */

const ID = "4a2ae8f4-bb1c-4a56-9c55-f19e55b8e101";
const OTRO = "b48e97fd-c952-4efe-9156-40a5c862bf86";
const TERCERO = "0d3f6a1e-5b8c-4e2a-9f7d-2c1b0a9e8d7c";

describe("pedido individual", () => {
  it("acepta una incorporación con severidad y parámetros", () => {
    const pedido = {
      desde: "enAnalisis",
      hacia: "incorporada",
      justificacion: "x",
      severidad: "MAJOR",
      parametros: { max: "5" },
    };

    expect(pedidoIndividual.safeParse(pedido).success).toBe(true);
  });

  it.each([
    ["un estado que no existe", { desde: "aprobada", hacia: "enAnalisis" }],
    ["sin estado de origen", { hacia: "enAnalisis" }],
    ["una severidad que no es de Sonar", { desde: "enAnalisis", hacia: "incorporada", severidad: "ALTA" }],
    ["severidad en algo que no es incorporar", { desde: "pendienteDeAnalizar", hacia: "descartada", severidad: "MAJOR" }],
    ["parámetros en algo que no es incorporar", { desde: "pendienteDeAnalizar", hacia: "enAnalisis", parametros: { a: "1" } }],
    ["un campo de más", { desde: "pendienteDeAnalizar", hacia: "enAnalisis", masiva: true }],
    ["una justificación de más de 2000 caracteres", { desde: "enAnalisis", hacia: "descartada", justificacion: "x".repeat(2001) }],
  ])("rechaza %s", (_caso, pedido) => {
    expect(pedidoIndividual.safeParse(pedido).success).toBe(false);
  });

  it("los mensajes de error están en español", () => {
    const resultado = pedidoIndividual.safeParse({ desde: "aprobada", hacia: "enAnalisis" });

    expect(resultado.error?.issues[0].message).toMatch(/[Oo]pción|[Ii]nválid|[Ee]sperado/);
  });
});

describe("pedido masivo", () => {
  it("acepta un descarte de varias reglas", () => {
    const pedido = {
      reglas: [
        { id: ID, desde: "pendienteDeAnalizar" },
        { id: OTRO, desde: "enAnalisis" },
      ],
      hacia: "descartada",
      justificacion: "No aplica",
    };

    expect(pedidoMasivo.safeParse(pedido).success).toBe(true);
  });

  it.each([
    ["sin reglas", { reglas: [], hacia: "descartada" }],
    ["reglas repetidas", { reglas: [{ id: ID, desde: "enAnalisis" }, { id: ID, desde: "enAnalisis" }], hacia: "descartada" }],
    ["un id que no es uuid", { reglas: [{ id: "123", desde: "enAnalisis" }], hacia: "descartada" }],
    ["severidad (no se elige en masa)", { reglas: [{ id: ID, desde: "enAnalisis" }], hacia: "descartada", severidad: "MAJOR" }],
    [
      `más de ${MAXIMO_DE_REGLAS_POR_LOTE} reglas`,
      {
        reglas: Array.from({ length: MAXIMO_DE_REGLAS_POR_LOTE + 1 }, (_, i) => ({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          desde: "pendienteDeAnalizar",
        })),
        hacia: "descartada",
      },
    ],
  ])("rechaza %s", (_caso, pedido) => {
    expect(pedidoMasivo.safeParse(pedido).success).toBe(false);
  });

  it("hacia Incorporada pasa la forma: lo rechaza el ciclo de vida, con el motivo", () => {
    // Así la respuesta dice "no se incorpora en masa" en vez de un error de formato.
    const pedido = { reglas: [{ id: ID, desde: "enAnalisis" }], hacia: "incorporada", justificacion: "x" };

    expect(pedidoMasivo.safeParse(pedido).success).toBe(true);
  });
});

describe("respuestas", () => {
  it("200 con las decisiones y las publicaciones pendientes", async () => {
    const respuesta = responder({
      ok: true,
      loteId: null,
      decisiones: [{ reglaId: ID, decisionId: OTRO, desde: "enAnalisis", hacia: "incorporada" }],
      publicaciones: [TERCERO],
      destinos: ["perfilSonar"],
    });

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({
      loteId: null,
      decisiones: [{ reglaId: ID, decisionId: OTRO, desde: "enAnalisis", hacia: "incorporada" }],
      publicaciones: [TERCERO],
    });
  });

  it("422 con cada motivo y su mensaje", async () => {
    const respuesta = responder({
      ok: false,
      tipo: "rechazada",
      rechazos: [{ reglaId: ID, motivos: ["noAdmiteOperacionMasiva"] }],
    });

    expect(respuesta.status).toBe(422);
    expect(await respuesta.json()).toEqual({
      error: "rechazada",
      mensaje: "No se aplicó ningún cambio.",
      rechazos: [
        {
          reglaId: ID,
          motivos: [
            {
              codigo: "noAdmiteOperacionMasiva",
              mensaje: "Este cambio de estado se hace de a una regla, no en una operación masiva.",
            },
          ],
        },
      ],
    });
  });

  it.each<[ResultadoDeTransicion, number, string]>([
    [{ ok: false, tipo: "noEncontradas", reglaIds: [ID] }, 404, "noEncontradas"],
    [{ ok: false, tipo: "estadoCambio", reglas: [{ id: ID, esperado: "enAnalisis", actual: "enPrueba" }] }, 409, "estadoCambio"],
  ])("%o → %i", async (resultado, estado, codigo) => {
    const respuesta = responder(resultado);

    expect(respuesta.status).toBe(estado);
    expect((await respuesta.json()).error).toBe(codigo);
  });
});
