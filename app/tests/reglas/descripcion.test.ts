import { describe, expect, it } from "vitest";

import { prepararDescripcion, resaltarCodigo, sanearDescripcion } from "@/reglas/descripcion";

/**
 * La descripción de una regla es HTML de Sonar: se muestra después de sanearla, con una
 * lista cerrada de etiquetas (las que aparecen en el catálogo real).
 */

describe("descripción de Sonar", () => {
  it("conserva el formato que usa Sonar", () => {
    const html =
      '<h3>Why is this an issue?</h3><p>Use <code>static</code> <strong>when</strong> <em>possible</em>.</p>' +
      "<ul><li>uno</li></ul><ol><li>dos</li></ol>" +
      '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';

    expect(sanearDescripcion(html)).toBe(html);
  });

  it("conserva si un bloque de código es el que cumple o el que no", () => {
    const html = '<pre data-diff-id="1" data-diff-type="noncompliant">int x = 0;</pre>';

    expect(sanearDescripcion(html)).toBe(html);
  });

  it("los links se abren aparte y sin dar acceso a la página", () => {
    expect(sanearDescripcion('<a href="https://cwe.mitre.org/data/definitions/1.html">CWE</a>')).toBe(
      '<a href="https://cwe.mitre.org/data/definitions/1.html" target="_blank" rel="noopener noreferrer">CWE</a>',
    );
  });

  it.each([
    ["un script", '<p>a</p><script>alert(1)</script>', "<p>a</p>"],
    ["un manejador de eventos", '<p onclick="alert(1)">a</p>', "<p>a</p>"],
    ["un link javascript:", '<a href="javascript:alert(1)">a</a>', '<a target="_blank" rel="noopener noreferrer">a</a>'],
    ["un iframe", '<iframe src="https://x"></iframe><p>a</p>', "<p>a</p>"],
    ["estilos", '<p style="position:fixed">a</p>', "<p>a</p>"],
    ["una imagen", '<img src="https://x/y.png" onerror="alert(1)">', ""],
  ])("saca %s", (_caso, html, esperado) => {
    expect(sanearDescripcion(html)).toBe(esperado);
  });

  it("vacía queda vacía", () => {
    expect(sanearDescripcion("")).toBe("");
  });
});

describe("ejemplos de código coloreados", () => {
  it("colorea el código con la gramática del lenguaje de la regla", () => {
    const html = resaltarCodigo('<pre>public static int X() =&gt; 1; // Noncompliant</pre>', "cs");

    expect(html).toMatch(/^<pre><code class="hljs language-csharp">/);
    expect(html).toContain('<span class="hljs-keyword">public</span>');
    expect(html).toContain('<span class="hljs-comment">// Noncompliant</span>');
    // El texto vuelve a quedar escapado.
    expect(html).toContain("=&gt;");
  });

  it("TypeScript usa su propia gramática", () => {
    expect(resaltarCodigo("<pre>const x: number = 1;</pre>", "ts")).toContain(
      '<code class="hljs language-typescript"><span class="hljs-keyword">const</span>',
    );
  });

  it("conserva la marca de Sonar de si el ejemplo cumple o no", () => {
    const html = resaltarCodigo('<pre data-diff-id="1" data-diff-type="noncompliant">var a = 1;</pre>', "cs");

    expect(html).toMatch(/^<pre data-diff-id="1" data-diff-type="noncompliant"><code class="hljs language-csharp">/);
  });

  it("lo que en el ejemplo parece HTML sigue siendo texto", () => {
    const html = prepararDescripcion("<pre>&lt;img src=x onerror=alert(1)&gt; &amp;&amp; a</pre>", "ts");

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;&amp;");
  });

  it("saca las líneas en blanco de los bordes, pero no la sangría", () => {
    expect(resaltarCodigo("<pre>\n\n    x = 1;\n  \n</pre>", "cs")).toMatch(/<code class="hljs language-csharp">    x = /);
    expect(resaltarCodigo("<pre>\n\n    x = 1;\n  \n</pre>", "cs")).toMatch(/;<\/code><\/pre>$/);
  });

  it("no toca el código en línea ni el resto del texto", () => {
    const html = "<p>Use <code>static</code> here.</p>";

    expect(resaltarCodigo(html, "cs")).toBe(html);
  });
});
