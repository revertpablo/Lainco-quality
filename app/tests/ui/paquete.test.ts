import { describe, expect, it } from "vitest";

import { describirRevision } from "@/paquete/resumen";
import { compararVersiones, describirPr, numeroDeVersion, type PrParaDescribir } from "@/ui/paquete";

/** Textos de la pantalla Paquete (entrega 6.4, paso 7). */

const fecha = (d: Date) => d.toISOString().slice(0, 10);
const pr = (cambios: Partial<PrParaDescribir>): PrParaDescribir => ({
  numero: 2,
  version: "0.1.1",
  estado: "abierto",
  mergeadoEn: null,
  cerradoEn: null,
  ...cambios,
});

describe("en qué está un PR de configuración", () => {
  it.each<[Partial<PrParaDescribir>, string | null, string, string]>([
    [{}, "0.1.0", "Abierto: propone la 0.1.1. Al mergearlo, se publica.", "alerta"],
    [{ version: null }, null, "Abierto: propone una versión nueva. Al mergearlo, se publica.", "alerta"],
    [{ estado: "mergeado", mergeadoEn: new Date("2026-10-28T22:40:00Z") }, "0.1.1", "Mergeado el 2026-10-28: la 0.1.1 ya está publicada.", "normal"],
    [
      { estado: "mergeado", mergeadoEn: new Date("2026-10-28T22:40:00Z") },
      "0.1.0",
      "Mergeado el 2026-10-28: falta que se publique la 0.1.1 y se sincronice.",
      "alerta",
    ],
    [{ estado: "mergeado", mergeadoEn: new Date("2026-10-28T22:40:00Z") }, "0.1.10", "Mergeado el 2026-10-28: la 0.1.1 ya está publicada.", "normal"],
    [{ estado: "mergeado", version: null, mergeadoEn: new Date("2026-10-28T22:40:00Z") }, "0.1.1", "Mergeado el 2026-10-28.", "normal"],
    [{ estado: "cerrado", cerradoEn: new Date("2026-10-29T10:00:00Z") }, "0.1.0", "Cerrado sin mergear el 2026-10-29", "error"],
  ])("%o, con la %s publicada", (cambios, publicada, texto, tono) => {
    expect(describirPr(pr(cambios), publicada, fecha)).toEqual({ texto, tono });
  });

  it("compara versiones por número, no como texto", () => {
    expect(compararVersiones("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compararVersiones("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compararVersiones("0.1.1", "0.1.1")).toBe(0);
  });

  it("la versión publicada sale de lo que guarda la sincronización", () => {
    expect(numeroDeVersion("Lainco.Analyzers 0.1.1")).toBe("0.1.1");
    expect(numeroDeVersion(null)).toBeNull();
  });
});

describe("resumen de una revisión del paquete", () => {
  const ok = { estado: "ok", versionEnMain: "0.1.1", coincide: true, error: null };

  it.each<[Record<string, unknown>, string]>([
    [{}, "El .globalconfig de main es el de la app (versión 0.1.1)."],
    [{ coincide: false, desvio: "nuevo" }, "El .globalconfig de main no es el de la app (versión 0.1.1); hay un desvío."],
    [{ prsCambiados: [{ numero: 2, estado: "mergeado" }], desvio: "resuelto" }, "El .globalconfig de main es el de la app (versión 0.1.1); el PR #2 quedó mergeado; se cerró el desvío."],
    [{ prsCambiados: [{ numero: 3, estado: "cerrado" }] }, "El .globalconfig de main es el de la app (versión 0.1.1); el PR #3 quedó cerrado sin mergear."],
    [{ estado: "error", error: "Sin red." }, "La revisión falló: Sin red."],
  ])("%o → %s", (cambios, texto) => {
    expect(describirRevision({ ...ok, ...cambios } as Parameters<typeof describirRevision>[0])).toBe(texto);
  });
});
