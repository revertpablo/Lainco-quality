/**
 * Graba respuestas reales de `api/rules/search` de SonarQube Cloud en
 * tests/fixtures/sonar/, para los tests de tests/sonar/grabadas.test.ts.
 *
 * Uso, dentro de app/:   npm run sonar:grabar
 *
 * Lee SONAR_URL, SONAR_ORGANIZACION y LAINCO_SONAR_TOKEN de la consola o de los archivos .env
 * (los mismos que `npm run dev`). El token no se escribe en ningún archivo ni en la
 * consola. Las respuestas solo tienen el catálogo de reglas, que es público.
 *
 * No usa el cliente de src/sonar/: graba lo que devuelve la API tal cual, para que los
 * tests prueben el cliente contra eso.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

import nextEnv from "@next/env";

const LENGUAJES = ["cs", "ts"];
/** Páginas de 100 (no de 500, el máximo) para que la grabación tenga varias páginas. */
const TAMANO_DE_PAGINA = 100;
const DESTINO = path.join(process.cwd(), "tests", "fixtures", "sonar");
/** Se graba acá y recién al final reemplaza a DESTINO: si algo falla, la grabación anterior queda. */
const TEMPORAL = `${DESTINO}.tmp`;

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const url = (process.env.SONAR_URL?.trim() || "https://sonarcloud.io").replace(/\/+$/, "");
const organizacion = process.env.SONAR_ORGANIZACION?.trim();
const token = process.env.LAINCO_SONAR_TOKEN?.trim();

if (!organizacion || !token) {
  console.error("Faltan SONAR_ORGANIZACION o LAINCO_SONAR_TOKEN (ver app/README.md).");
  process.exit(1);
}

/** Termina con error, sin dejar la grabación a medias. */
async function abortar(): Promise<never> {
  await rm(TEMPORAL, { recursive: true, force: true });
  process.exit(1);
}

async function pedido(parametros: Record<string, string>, conToken = token!): Promise<Response> {
  const direccion = new URL(`${url}/api/rules/search`);
  for (const [clave, valor] of Object.entries(parametros)) {
    direccion.searchParams.set(clave, valor);
  }
  try {
    return await fetch(direccion, { headers: { Authorization: `Bearer ${conToken}`, Accept: "application/json" } });
  } catch (e) {
    const causa = (e as { cause?: { code?: string } }).cause;
    console.error(`No se pudo conectar con ${url} (${causa?.code ?? (e as Error).message}).`);
    console.error(
      "Si la red sale a internet por un proxy, Node no lo toma de Windows: ver \"Proxy\" en app/README.md, sección SonarQube.",
    );
    return abortar();
  }
}

function parametrosDe(lenguaje: string, pagina: number, org = organizacion!): Record<string, string> {
  return {
    organization: org,
    languages: lenguaje,
    statuses: "READY,BETA,DEPRECATED",
    include_external: "false",
    ps: String(TAMANO_DE_PAGINA),
    p: String(pagina),
  };
}

async function guardar(nombre: string, contenido: unknown) {
  const texto = JSON.stringify(contenido, null, 2) + "\n";
  // Las páginas de reglas van comprimidas: con las descripciones, la grabación completa
  // pesa unos 12 MB; comprimida, 1 MB.
  if (nombre.endsWith(".gz")) {
    await writeFile(path.join(TEMPORAL, nombre), gzipSync(texto, { level: 9 }));
  } else {
    await writeFile(path.join(TEMPORAL, nombre), texto, "utf8");
  }
}

await rm(TEMPORAL, { recursive: true, force: true });
await mkdir(TEMPORAL, { recursive: true });

const resumen: Record<string, { total: number; paginas: number }> = {};

for (const lenguaje of LENGUAJES) {
  let total = Infinity;
  let pagina = 1;
  for (; (pagina - 1) * TAMANO_DE_PAGINA < total; pagina++) {
    const respuesta = await pedido(parametrosDe(lenguaje, pagina));
    if (!respuesta.ok) {
      console.error(`SonarQube respondió HTTP ${respuesta.status} al pedir '${lenguaje}', página ${pagina}.`);
      console.error((await respuesta.text()).slice(0, 500));
      await abortar();
    }
    const cuerpo = await respuesta.json();
    total = cuerpo.paging?.total ?? cuerpo.total;
    await guardar(`reglas-${lenguaje}-p${pagina}.json.gz`, cuerpo);
    console.log(`${lenguaje}: página ${pagina} (${cuerpo.rules.length} reglas de ${total})`);
  }
  resumen[lenguaje] = { total, paginas: pagina - 1 };
}

// Dos errores, para probar cómo los informa el cliente.
async function grabarError(nombre: string, respuesta: Response) {
  const texto = await respuesta.text();
  let cuerpo: unknown = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    // Se guarda como texto.
  }
  await guardar(nombre, { estado: respuesta.status, cuerpo });
  console.log(`${nombre}: HTTP ${respuesta.status}`);
}

await grabarError("error-token-invalido.json", await pedido(parametrosDe("cs", 1), "token-invalido-de-prueba"));
await grabarError(
  "error-organizacion-inexistente.json",
  await pedido(parametrosDe("cs", 1, "organizacion-que-no-existe-lainco-0000")),
);

await guardar("grabacion.json", {
  fecha: new Date().toISOString(),
  url,
  organizacion,
  tamanoDePagina: TAMANO_DE_PAGINA,
  parametros: Object.fromEntries(Object.entries(parametrosDe("<lenguaje>", 1)).filter(([clave]) => clave !== "p")),
  lenguajes: resumen,
});

await rm(DESTINO, { recursive: true, force: true });
await rename(TEMPORAL, DESTINO);

console.log(`Listo: ${DESTINO}`);
