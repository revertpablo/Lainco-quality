import hljs from "highlight.js/lib/core";
import csharp from "highlight.js/lib/languages/csharp";
import typescript from "highlight.js/lib/languages/typescript";
import sanitizeHtml from "sanitize-html";

import type { Lenguaje } from "@/dominio/valores";

hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("typescript", typescript);

/**
 * La descripción de una regla viene de Sonar como HTML. Antes de mostrarla se sanea con
 * una lista cerrada: las etiquetas que aparecen en el catálogo real de C# y TypeScript
 * (relevado el 2026-10-19 sobre la grabación de tests/fixtures/sonar/). Nada de scripts,
 * estilos, imágenes ni manejadores de eventos; los links, solo http(s), y se abren aparte.
 */
const OPCIONES: sanitizeHtml.IOptions = {
  allowedTags: [
    "h2", "h3", "h4", "h5", "p", "br", "strong", "em", "sup", "code", "pre", "blockquote",
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
 * Un `<pre>` del HTML ya saneado que tiene solo texto (en el catálogo real, todos: 3.338
 * bloques). Si alguno trajera etiquetas adentro, no se toca.
 */
const BLOQUE_DE_CODIGO = /<pre([^>]*)>([^<]*)<\/pre>/g;

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

/** La descripción lista para mostrar: saneada y con el código coloreado. */
export function prepararDescripcion(html: string, lenguaje: Lenguaje): string {
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
