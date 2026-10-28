import { describe, expect, it } from "vitest";

import { Estado } from "@/dominio/valores";
import { describirEstadoEnSonar, type UltimaPublicacion } from "@/ui/publicacion";

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
