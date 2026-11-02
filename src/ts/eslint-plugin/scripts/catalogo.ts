/**
 * Catálogo `reglas-eslint.json` del plugin (paso 2 de docs/FASE-5.md), con el formato
 * común a Roslyn y ESLint de docs/catalogo-de-reglas.md. Lo lee la app de catálogo para
 * sumar las reglas al inventario sin carga manual.
 *
 * Verifica las convenciones de CLAUDE.md y junta todos los incumplimientos, para que el
 * build falle una sola vez con la lista completa.
 */

import { urlDeAyuda } from "../src/convenciones.js";

export const FORMATO = 1;

/** Lo que el generador necesita de una regla: su `meta` de ESLint. */
export interface ReglaDelPlugin {
  meta: {
    docs?: { description?: string; url?: string; categoria?: string; recommended?: unknown };
    messages: Record<string, string>;
  };
}

export interface ReglaDelCatalogo {
  clave: string;
  titulo: string;
  descripcion: string | null;
  categoria: string;
  severidadPorDefecto: "warning";
  habilitadaPorDefecto: false;
  ayuda: string;
  documentacion: string;
}

export interface Catalogo {
  formato: number;
  origen: "eslint";
  paquete: string;
  version: string;
  lenguaje: "ts";
  reglas: ReglaDelCatalogo[];
}

export type Resultado = { ok: true; catalogo: Catalogo } | { ok: false; errores: string[] };

const NOMBRE_KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Arma el catálogo. `leerDocumentacion` devuelve el markdown de `docs/rules/lainco/<nombre>.md`,
 * o `null` si no existe.
 */
export function generarCatalogo(
  paquete: string,
  version: string,
  reglas: Record<string, ReglaDelPlugin>,
  leerDocumentacion: (nombre: string) => string | null,
): Resultado {
  const errores: string[] = [];
  const salida: ReglaDelCatalogo[] = [];

  for (const nombre of Object.keys(reglas).sort()) {
    const clave = `lainco/${nombre}`;
    const { docs, messages } = reglas[nombre]!.meta;
    const erroresDeLaRegla: string[] = [];

    if (!NOMBRE_KEBAB.test(nombre)) {
      erroresDeLaRegla.push("el ID no tiene la forma lainco/<nombre-kebab>");
    }
    const documentacion = leerDocumentacion(nombre);
    if (documentacion === null) {
      erroresDeLaRegla.push(`falta docs/rules/${clave}.md`);
    }
    if (docs?.url !== urlDeAyuda(nombre)) {
      erroresDeLaRegla.push(`meta.docs.url no lleva a docs/rules/${clave}.md`);
    }
    if (!docs?.description) {
      erroresDeLaRegla.push("no tiene título (meta.docs.description)");
    }
    if (!docs?.categoria) {
      erroresDeLaRegla.push("no tiene categoría (meta.docs.categoria)");
    }
    if (docs?.recommended !== undefined) {
      // Una regla "recomendada" sugiere encenderse sola; nacen apagadas (decisión T7).
      erroresDeLaRegla.push("declara meta.docs.recommended: las reglas propias nacen apagadas");
    }
    for (const [id, mensaje] of Object.entries(messages)) {
      if (!mensaje.includes("{{simbolo}}")) {
        erroresDeLaRegla.push(`el mensaje '${id}' no incluye el símbolo calificado ({{simbolo}})`);
      }
    }

    if (erroresDeLaRegla.length > 0) {
      errores.push(...erroresDeLaRegla.map((error) => `${clave}: ${error}`));
      continue;
    }
    salida.push({
      clave,
      titulo: docs!.description!,
      descripcion: null,
      categoria: docs!.categoria!,
      severidadPorDefecto: "warning",
      habilitadaPorDefecto: false,
      ayuda: docs!.url!,
      documentacion: documentacion!.replace(/\r\n/g, "\n"),
    });
  }

  if (errores.length > 0) {
    return { ok: false, errores };
  }
  return {
    ok: true,
    catalogo: { formato: FORMATO, origen: "eslint", paquete, version, lenguaje: "ts", reglas: salida },
  };
}

/** UTF-8 sin escapar acentos, sangría de dos espacios, `\n` y salto final. */
export function serializar(catalogo: Catalogo): string {
  return `${JSON.stringify(catalogo, null, 2)}\n`;
}
