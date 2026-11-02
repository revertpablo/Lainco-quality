import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generarCatalogo, serializar, type ReglaDelPlugin } from "../scripts/catalogo.js";
import { urlDeAyuda } from "../src/convenciones.js";
import plugin from "../src/index.js";

function regla(nombre: string, cambios: Partial<NonNullable<ReglaDelPlugin["meta"]["docs"]>> = {}): ReglaDelPlugin {
  return {
    meta: {
      docs: { description: "Título", categoria: "Diseño", url: urlDeAyuda(nombre), ...cambios },
      messages: { principal: "Algo mal en '{{simbolo}}'" },
    },
  };
}

const conDocumentacion = (nombre: string) => `# lainco/${nombre}\r\n\r\nTexto`;

describe("generarCatalogo", () => {
  it("arma el catálogo con el formato común y las reglas ordenadas por clave", () => {
    const resultado = generarCatalogo(
      "@lainco/eslint-plugin",
      "0.1.0",
      { "zeta-regla": regla("zeta-regla"), "alfa-regla": regla("alfa-regla") },
      conDocumentacion,
    );

    expect(resultado).toEqual({
      ok: true,
      catalogo: {
        formato: 1,
        origen: "eslint",
        paquete: "@lainco/eslint-plugin",
        version: "0.1.0",
        lenguaje: "ts",
        reglas: [
          {
            clave: "lainco/alfa-regla",
            titulo: "Título",
            descripcion: null,
            categoria: "Diseño",
            severidadPorDefecto: "warning",
            habilitadaPorDefecto: false,
            ayuda: urlDeAyuda("alfa-regla"),
            documentacion: "# lainco/alfa-regla\n\nTexto",
          },
          expect.objectContaining({ clave: "lainco/zeta-regla" }),
        ],
      },
    });
  });

  it.each([
    ["sin documentación", "regla", regla("regla"), () => null, "lainco/regla: falta docs/rules/lainco/regla.md"],
    ["ID que no es kebab", "Regla_Mala", regla("Regla_Mala"), conDocumentacion, "lainco/Regla_Mala: el ID no tiene la forma lainco/<nombre-kebab>"],
    ["url que no lleva a su documentación", "regla", regla("regla", { url: "https://otro" }), conDocumentacion, "lainco/regla: meta.docs.url no lleva a docs/rules/lainco/regla.md"],
    ["sin título", "regla", regla("regla", { description: "" }), conDocumentacion, "lainco/regla: no tiene título (meta.docs.description)"],
    ["sin categoría", "regla", regla("regla", { categoria: undefined }), conDocumentacion, "lainco/regla: no tiene categoría (meta.docs.categoria)"],
    ["recomendada", "regla", regla("regla", { recommended: "recommended" }), conDocumentacion, "lainco/regla: declara meta.docs.recommended: las reglas propias nacen apagadas"],
  ])("falla con una regla %s", (_caso, nombre, definicion, leer, error) => {
    const resultado = generarCatalogo("@lainco/eslint-plugin", "0.1.0", { [nombre]: definicion }, leer);

    expect(resultado).toEqual({ ok: false, errores: [error] });
  });

  it("falla con un mensaje sin el símbolo calificado", () => {
    const definicion = regla("regla");
    definicion.meta.messages = { principal: "Algo mal" };

    const resultado = generarCatalogo("@lainco/eslint-plugin", "0.1.0", { regla: definicion }, conDocumentacion);

    expect(resultado).toEqual({
      ok: false,
      errores: ["lainco/regla: el mensaje 'principal' no incluye el símbolo calificado ({{simbolo}})"],
    });
  });

  it("junta los errores de todas las reglas", () => {
    const resultado = generarCatalogo(
      "@lainco/eslint-plugin",
      "0.1.0",
      { uno: regla("uno"), dos: regla("dos") },
      () => null,
    );

    expect(resultado).toEqual({
      ok: false,
      errores: ["lainco/dos: falta docs/rules/lainco/dos.md", "lainco/uno: falta docs/rules/lainco/uno.md"],
    });
  });

  it("serializa sin escapar acentos, con dos espacios y salto final", () => {
    const resultado = generarCatalogo("@lainco/eslint-plugin", "0.1.0", { regla: regla("regla", { categoria: "Diseño" }) }, conDocumentacion);
    if (!resultado.ok) throw new Error("debería generar");

    const texto = serializar(resultado.catalogo);

    expect(texto).toContain('    "categoria": "Diseño",');
    expect(texto.endsWith("}\n")).toBe(true);
  });
});

describe("las reglas del plugin", () => {
  it("cumplen todas las convenciones", () => {
    const documentacion = join(import.meta.dirname, "..", "..", "..", "..", "docs", "rules", "lainco");

    const resultado = generarCatalogo("@lainco/eslint-plugin", "0.1.0", plugin.rules, (nombre) => {
      const archivo = join(documentacion, `${nombre}.md`);
      return existsSync(archivo) ? readFileSync(archivo, "utf8") : null;
    });

    expect(resultado.ok ? [] : resultado.errores).toEqual([]);
  });
});
