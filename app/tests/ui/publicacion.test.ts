import { describe, expect, it } from "vitest";

import { Estado } from "@/dominio/valores";
import { describirEstadoEnPaquete, describirEstadoEnSonar, type UltimaPublicacion } from "@/ui/publicacion";

/** En qué está una regla en Sonar, para su detalle (entrega 6.2, paso 6). */

const fecha = (d: Date) => d.toISOString().slice(0, 10);
const publicacion = (cambios: Partial<UltimaPublicacion>): UltimaPublicacion => ({
  estado: "publicada",
  accion: "activar",
  intentos: 1,
  ultimoError: null,
  proximoIntentoEn: new Date("2026-10-21T12:00:00Z"),
  publicadaEn: new Date("2026-10-20T12:00:00Z"),
  ...cambios,
});

describe("estado de una regla en Sonar", () => {
  it.each<[UltimaPublicacion | null, string, string, string, string | null]>([
    [null, Estado.Incorporada, "Nunca se publicó en Sonar.", "alerta", null],
    [null, Estado.PendienteDeAnalizar, "La app nunca la publicó: no tendría que estar activa en Sonar.", "normal", null],
    [publicacion({}), Estado.Incorporada, "La app la publicó activa el 2026-10-20", "normal", null],
    [publicacion({ accion: "desactivar" }), Estado.Descartada, "La app la publicó inactiva el 2026-10-20", "normal", null],
    [publicacion({ estado: "pendiente", intentos: 0, publicadaEn: null }), Estado.Incorporada, "Pendiente de publicar en Sonar.", "alerta", null],
    [
      publicacion({ estado: "pendiente", intentos: 2, ultimoError: "HTTP 503", publicadaEn: null }),
      Estado.Incorporada,
      "Pendiente de publicar en Sonar: falló 2 veces, se reintenta el 2026-10-21",
      "alerta",
      "HTTP 503",
    ],
    [
      publicacion({ estado: "fallida", intentos: 5, ultimoError: "Valor inválido", publicadaEn: null }),
      Estado.Incorporada,
      "No se pudo publicar en Sonar (5 intentos).",
      "error",
      "Valor inválido",
    ],
  ])("%#", (ultima, estado, texto, tono, error) => {
    expect(describirEstadoEnSonar(ultima, estado as Estado, fecha)).toEqual({ texto, tono, error });
  });
});

describe("estado de una regla propia en el paquete (entrega 6.4, paso 4)", () => {
  it.each<[UltimaPublicacion | null, Estado, string | null, string, string | null, string]>([
    [null, Estado.Incorporada, "warning", "En el .globalconfig va con severidad Warning.", null, "normal"],
    [null, Estado.ARevisar, null, "En el .globalconfig va apagada (none).", null, "normal"],
    [
      publicacion({ estado: "pendiente", intentos: 0, publicadaEn: null }),
      Estado.Incorporada,
      "warning",
      "En el .globalconfig va con severidad Warning.",
      "Pendiente de pasar al PR de configuración.",
      "alerta",
    ],
    [
      publicacion({ accion: "desactivar" }),
      Estado.Descartada,
      null,
      "En el .globalconfig va apagada (none).",
      "Sin PR: main ya la tenía así (2026-10-20)",
      "normal",
    ],
    [
      publicacion({ estado: "pendiente", intentos: 2, publicadaEn: null }),
      Estado.Incorporada,
      "warning",
      "En el .globalconfig va con severidad Warning.",
      "Pendiente de pasar al PR de configuración: falló 2 veces, se reintenta el 2026-10-21",
      "alerta",
    ],
    [
      publicacion({ estado: "fallida", intentos: 5, publicadaEn: null }),
      Estado.Incorporada,
      "warning",
      "En el .globalconfig va con severidad Warning.",
      "No se pudo actualizar el PR de configuración (5 intentos).",
      "error",
    ],
  ])("%#", (ultima, estado, severidad, enElArchivo, pedido, tono) => {
    expect(describirEstadoEnPaquete(ultima, estado, severidad, fecha)).toEqual({ enElArchivo, pedido, tono, error: null, pr: null });
  });

  it.each([
    ["abierto", "Incluida en el PR #3 (abierto) el 2026-10-20", "normal"],
    ["mergeado", "Incluida en el PR #3 (mergeado) el 2026-10-20", "normal"],
    ["cerrado", "Incluida en el PR #3 (cerrado sin mergear) el 2026-10-20", "alerta"],
  ])("dice en qué está el PR: %s (paso 7)", (prEstado, pedido, tono) => {
    const ultima = publicacion({ prNumero: 3, prUrl: "https://github.com/x/y/pull/3", prEstado });

    expect(describirEstadoEnPaquete(ultima, Estado.Incorporada, "warning", fecha)).toMatchObject({ pedido, tono });
  });

  it("incluida en un PR, lo nombra y da su link", () => {
    const pr = { prNumero: 3, prUrl: "https://github.com/revertpablo/Lainco-quality/pull/3" };

    expect(describirEstadoEnPaquete(publicacion(pr), Estado.Incorporada, "warning", fecha)).toEqual({
      enElArchivo: "En el .globalconfig va con severidad Warning.",
      pedido: "Incluida en el PR #3 el 2026-10-20",
      tono: "normal",
      error: null,
      pr: { numero: 3, url: pr.prUrl },
    });
  });
});
