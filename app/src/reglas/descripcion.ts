import hljs from "highlight.js/lib/core";
import csharp from "highlight.js/lib/languages/csharp";
import typescript from "highlight.js/lib/languages/typescript";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

import { Origen, type Lenguaje } from "@/dominio/valores";

hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("typescript", typescript);

/**
 * La descripción de una regla de Sonar viene como HTML; la de una regla propia (Roslyn,
 * ESLint) es su documentación de `docs/rules/`, en markdown (entrega 6.4), y se convierte
 * a HTML. Antes de mostrarla se sanea con una lista cerrada: las etiquetas que aparecen en
 * el catálogo real de C# y TypeScript (relevado el 2026-10-19 sobre la grabación de
 * tests/fixtures/sonar/) y las que produce el markdown de las reglas propias. Nada de
 * scripts, estilos, imágenes ni manejadores de eventos; los links, solo http(s), y se
 * abren aparte.
 */
const OPCIONES: sanitizeHtml.IOptions = {
  allowedTags: [
    "h2", "h3", "h4", "h5", "p", "br", "hr", "strong", "em", "sup", "code", "pre", "blockquote",
    "ul", "ol", "li", "dl", "dt", "dd", "a", "span",
    "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    // Sonar marca los ejemplos de código que cumplen y los que no.
    pre: ["data-diff-id", "data-diff-type"],
  },
  allowedSchemes: ["http", "https"],
  disallowedTagsMode: "discard",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
  },
};

export function sanearDescripcion(html: string): string {
  return sanitizeHtml(html, OPCIONES);
}

/** Con qué gramática de highlight.js se colorean los ejemplos de cada lenguaje del catálogo. */
const GRAMATICA: Record<Lenguaje, string> = { cs: "csharp", ts: "typescript" };

/**
 * Un `<pre>` del HTML ya saneado que tiene solo texto (en el catálogo real de Sonar, todos:
 * 3.338 bloques), o un `<code>` con solo texto (los bloques de código del markdown). Si
 * alguno trajera otras etiquetas adentro, no se toca.
 */
const BLOQUE_DE_CODIGO = /<pre([^>]*)>(?:<code>)?([^<]*)(?:<\/code>)?<\/pre>/g;

/**
 * Colorea los ejemplos de código de una descripción ya saneada, con la gramática del
 * lenguaje de la regla. highlight.js escapa el texto y solo agrega `<span class="hljs-…">`,
 * así que el resultado sigue siendo seguro.
 */
export function resaltarCodigo(htmlSaneado: string, lenguaje: Lenguaje): string {
  const gramatica = GRAMATICA[lenguaje];
  if (!gramatica) return htmlSaneado;
  return htmlSaneado.replace(BLOQUE_DE_CODIGO, (_, atributos: string, texto: string) => {
    // Sonar suele dejar una línea en blanco al principio y al final del ejemplo.
    const codigo = decodificarEntidades(texto).replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
    const coloreado = hljs.highlight(codigo, { language: gramatica, ignoreIllegals: true }).value;
    return `<pre${atributos}><code class="hljs language-${gramatica}">${coloreado}</code></pre>`;
  });
}

/** Orígenes cuya descripción es markdown: la documentación de las reglas propias. */
const DESCRIPCION_EN_MARKDOWN: readonly Origen[] = [Origen.Roslyn, Origen.Eslint];

// Una instancia propia, para no depender de la configuración global de `marked`.
const markdown = new Marked({ gfm: true, async: false });

/**
 * La documentación de una regla propia, en HTML. Sin el título del principio (`# LAIN004 —
 * ...`): el detalle ya lo muestra. El resultado todavía no está saneado.
 */
export function markdownAHtml(texto: string): string {
  const sinTitulo = texto.replace(/^\s*# [^\n]*\n/, "");
  return markdown.parse(sinTitulo) as string;
}

/** La descripción lista para mostrar: en HTML, saneada y con el código coloreado. */
export function prepararDescripcion(descripcion: string, lenguaje: Lenguaje, origen: Origen = Origen.Sonar): string {
  const html = DESCRIPCION_EN_MARKDOWN.includes(origen) ? markdownAHtml(descripcion) : descripcion;
  return resaltarCodigo(sanearDescripcion(html), lenguaje);
}

function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&amp;/g, "&");
}
