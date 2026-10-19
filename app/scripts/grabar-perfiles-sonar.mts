/**
 * Graba respuestas reales de SonarQube Cloud sobre los Quality Profiles en
 * tests/fixtures/sonar-perfiles/, para tests/sonar/perfiles-grabados.test.ts
 * (entrega 6.2, paso 2).
 *
 * Uso, dentro de app/:   npm run sonar:grabar-perfiles
 *
 * Lee SONAR_URL, SONAR_ORGANIZACION, LAINCO_SONAR_TOKEN, SONAR_PERFIL_CS y SONAR_PERFIL_TS
 * de la consola o de los archivos .env (los mismos que `npm run dev`). El token no se
 * escribe en ningún archivo ni en la consola.
 *
 * **No cambia nada en Sonar.** Todo son lecturas, salvo un pedido que prueba si el token
 * puede administrar el perfil: activa una regla que no existe. Sonar revisa el permiso
 * antes que la regla, así que sin permiso responde 403 y con permiso, que la regla no
 * existe; en ningún caso activa nada.
 *
 * Graba:
 * - La definición de la Web API (`api/webservices/list`) de lo que usa la app: dice qué
 *   parámetros acepta activate_rule (severidad clásica o impactos).
 * - Los perfiles de cada lenguaje, y el gestionado buscado por nombre.
 * - Las reglas activas del perfil gestionado y las del perfil de Sonar por defecto del
 *   lenguaje ("Sonar way comprehensive" el 2026-10-19, que tiene reglas activas aunque el
 *   nuestro esté vacío), con su activación.
 * - Los proyectos de la organización y el perfil que usa cada uno.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import nextEnv from "@next/env";

const LENGUAJES = { cs: "SONAR_PERFIL_CS", ts: "SONAR_PERFIL_TS" } as const;
/** Páginas chicas para que la grabación tenga varias. */
const TAMANO_DE_PAGINA = 100;
/** Una regla que no existe, para probar el permiso sin activar nada. */
const REGLA_INEXISTENTE = "csharpsquid:LAINCO_REGLA_QUE_NO_EXISTE";
const DESTINO = path.join(process.cwd(), "tests", "fixtures", "sonar-perfiles");
/** Se graba acá y recién al final reemplaza a DESTINO: si algo falla, la grabación anterior queda. */
const TEMPORAL = `${DESTINO}.tmp`;

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const url = (process.env.SONAR_URL?.trim() || "https://sonarcloud.io").replace(/\/+$/, "");
const organizacion = process.env.SONAR_ORGANIZACION?.trim();
const token = process.env.LAINCO_SONAR_TOKEN?.trim();
const perfiles = Object.fromEntries(
  Object.entries(LENGUAJES).map(([lenguaje, variable]) => [lenguaje, process.env[variable]?.trim()]),
) as Record<keyof typeof LENGUAJES, string | undefined>;

const faltan = [
  !organizacion && "SONAR_ORGANIZACION",
  !token && "LAINCO_SONAR_TOKEN",
  ...Object.entries(LENGUAJES).filter(([l]) => !perfiles[l as keyof typeof LENGUAJES]).map(([, v]) => v),
].filter(Boolean);
if (faltan.length > 0) {
  console.error(`Faltan variables de entorno: ${faltan.join(", ")} (ver app/README.md, "SonarQube").`);
  process.exit(1);
}

async function abortar(): Promise<never> {
  await rm(TEMPORAL, { recursive: true, force: true });
  process.exit(1);
}

interface Respuesta {
  estado: number;
  cuerpo: unknown;
}

async function pedir(metodo: "GET" | "POST", ruta: string, parametros: Record<string, string>): Promise<Respuesta> {
  const direccion = new URL(`${url}/${ruta}`);
  const formulario = new URLSearchParams(parametros);
  if (metodo === "GET") direccion.search = formulario.toString();
  let respuesta: Response;
  try {
    respuesta = await fetch(direccion, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      body: metodo === "POST" ? formulario : undefined,
    });
  } catch (e) {
    const causa = (e as { cause?: { code?: string } }).cause;
    console.error(`No se pudo conectar con ${url} (${causa?.code ?? (e as Error).message}).`);
    console.error("Si la red sale a internet por un proxy, ver \"Proxy\" en app/README.md, sección SonarQube.");
    return abortar();
  }
  const texto = await respuesta.text();
  let cuerpo: unknown = texto;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    // Se guarda como texto.
  }
  return { estado: respuesta.status, cuerpo };
}

/** Un GET que tiene que andar: si no, se aborta mostrando qué dijo Sonar. */
async function leer(ruta: string, parametros: Record<string, string>, que: string): Promise<Record<string, unknown>> {
  const { estado, cuerpo } = await pedir("GET", ruta, parametros);
  if (estado !== 200) {
    console.error(`SonarQube respondió HTTP ${estado} al pedir ${que}.`);
    console.error(JSON.stringify(cuerpo).slice(0, 500));
    return abortar();
  }
  return cuerpo as Record<string, unknown>;
}

async function guardar(nombre: string, contenido: unknown) {
  await writeFile(path.join(TEMPORAL, nombre), JSON.stringify(contenido, null, 2) + "\n", "utf8");
}

/** Todas las páginas de reglas activas de un perfil, una por archivo. */
async function grabarActivas(prefijo: string, perfil: string): Promise<{ total: number; paginas: number }> {
  let total = Infinity;
  for (let pagina = 1; (pagina - 1) * TAMANO_DE_PAGINA < total; pagina++) {
    const cuerpo = await leer(
      "api/rules/search",
      { organization: organizacion!, qprofile: perfil, activation: "true", f: "actives", ps: String(TAMANO_DE_PAGINA), p: String(pagina) },
      `las reglas activas de ${prefijo}, página ${pagina}`,
    );
    total = ((cuerpo.paging as { total?: number } | undefined)?.total ?? cuerpo.total) as number;
    await guardar(`${prefijo}-p${pagina}.json`, cuerpo);
    if (total === 0) break;
  }
  console.log(`${prefijo}: ${total} reglas activas`);
  return { total, paginas: Math.max(1, Math.ceil(total / TAMANO_DE_PAGINA)) };
}

await rm(TEMPORAL, { recursive: true, force: true });
await mkdir(TEMPORAL, { recursive: true });

// Definición de la Web API: solo lo que usa la app.
const definicion = await leer("api/webservices/list", { include_internals: "false" }, "la definición de la Web API");
const usados = ["api/qualityprofiles", "api/rules", "api/components", "api/projects"];
await guardar("webservices.json", {
  webServices: (definicion.webServices as { path: string }[]).filter((ws) => usados.includes(ws.path)),
});
console.log("webservices.json");

const resumen: Record<string, unknown> = {};

for (const lenguaje of Object.keys(LENGUAJES) as (keyof typeof LENGUAJES)[]) {
  const nombre = perfiles[lenguaje]!;
  const todos = await leer("api/qualityprofiles/search", { organization: organizacion!, language: lenguaje }, `los perfiles de '${lenguaje}'`);
  await guardar(`perfiles-${lenguaje}.json`, todos);

  const porNombre = await leer(
    "api/qualityprofiles/search",
    { organization: organizacion!, language: lenguaje, qualityProfile: nombre },
    `el perfil '${nombre}'`,
  );
  await guardar(`perfil-${lenguaje}.json`, porNombre);

  const lista = (porNombre.profiles ?? []) as { key: string; name: string; isBuiltIn?: boolean }[];
  const gestionado = lista.find((p) => p.name === nombre);
  if (!gestionado) {
    console.error(`No hay un perfil '${nombre}' de '${lenguaje}' en la organización. Revisá ${LENGUAJES[lenguaje]}.`);
    await abortar();
  }
  // El de Sonar por defecto; si el default es otro, el de Sonar con más reglas activas.
  const deSonar = ((todos.profiles ?? []) as { key: string; name: string; isBuiltIn?: boolean; isDefault?: boolean; activeRuleCount?: number }[])
    .filter((p) => p.isBuiltIn)
    .sort((a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false) || (b.activeRuleCount ?? 0) - (a.activeRuleCount ?? 0))[0];

  resumen[lenguaje] = {
    perfil: { clave: gestionado!.key, nombre },
    activas: await grabarActivas(`activas-${lenguaje}`, gestionado!.key),
    deSonar: deSonar
      ? { clave: deSonar.key, nombre: deSonar.name, activas: await grabarActivas(`activas-de-sonar-${lenguaje}`, deSonar.key) }
      : null,
  };
}

// Proyectos y el perfil que usa cada uno.
// SonarQube Cloud no acepta `qualifiers` acá: solo devuelve proyectos.
const proyectos = await leer("api/components/search", { organization: organizacion!, ps: "500", p: "1" }, "los proyectos");
await guardar("proyectos.json", proyectos);
const claves = ((proyectos.components ?? []) as { key: string }[]).map((c) => c.key);
console.log(`proyectos: ${claves.length}`);
for (const [i, clave] of claves.entries()) {
  await guardar(`perfiles-proyecto-${i + 1}.json`, {
    proyecto: clave,
    ...(await leer("api/qualityprofiles/search", { organization: organizacion!, project: clave }, `los perfiles de ${clave}`)),
  });
}

// ¿El token puede administrar el perfil? Una regla que no existe: no cambia nada.
const csharp = resumen.cs as { perfil: { clave: string } };
const permiso = await pedir("POST", "api/qualityprofiles/activate_rule", { key: csharp.perfil.clave, rule: REGLA_INEXISTENTE });
await guardar("permiso-activar.json", { regla: REGLA_INEXISTENTE, ...permiso });
console.log(
  permiso.estado === 403
    ? "permiso: el token NO puede administrar el perfil (HTTP 403). Hace falta 'Administer Quality Profiles'."
    : `permiso: el token puede administrar el perfil (Sonar respondió HTTP ${permiso.estado} por la regla inexistente).`,
);

await guardar("grabacion.json", {
  fecha: new Date().toISOString(),
  url,
  organizacion,
  tamanoDePagina: TAMANO_DE_PAGINA,
  lenguajes: resumen,
  proyectos: claves.length,
});

await rm(DESTINO, { recursive: true, force: true });
await rename(TEMPORAL, DESTINO);
console.log(`Listo: ${DESTINO}`);
