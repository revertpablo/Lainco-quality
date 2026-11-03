// La parte TypeScript del job de prueba (entrega 6.5, parte TypeScript, decisiones E8 a E11):
// corre ESLint sobre un repositorio con las reglas de TypeScript En prueba y reduce el
// resultado a lo que el job le manda a la app, con la misma forma que reducir-sarif.mjs.
//
//   node prueba-eslint.mjs --corrida corrida.json --raiz <repositorio clonado> \
//        [--maximo 200] [--salida parcial.json]
//
// Escribe { "diagnosticosDisponibles": [...], "reglas": [...] } con las reglas de TypeScript
// de la corrida (`ts:S####` y `lainco/...`); el script del job lo junta con lo de C#.
//
// - Las reglas de Sonar para TypeScript se corren con eslint-plugin-sonarjs: cada regla del
//   plugin trae su clave de Sonar en la URL de la documentación (E9), así que el mapeo sale
//   solo. Las que no están en el plugin no se pueden probar localmente.
// - Las propias, con @lainco/eslint-plugin compilado desde este repositorio (E11).
// - ESLint corre con esta configuración, no con la del repositorio: solo las reglas en
//   prueba, en `warn`. Con un tsconfig.json en la raíz, las reglas que necesitan tipos los
//   tienen (projectService); sin él, esas reglas no reportan nada.
// - Lo suprimido en el código (`// eslint-disable`) no cuenta: ESLint lo deja aparte, y Sonar
//   tampoco lo ve.
// - Solo referencias al código, nunca código (E1).
//
// Las funciones puras no tienen dependencias; la CLI carga ESLint y los plugins de
// .github/prueba/eslint/node_modules (npm ci en esa carpeta).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export class ErrorDePruebaEslint extends Error {}

const MAXIMO_POR_DEFECTO = 200;
const ID_SONAR_TS = /^ts:(S\d+)$/;
const ID_LAINCO = /^lainco\/(.+)$/;
const esDeTypeScript = (diagnostico) => ID_SONAR_TS.test(diagnostico) || ID_LAINCO.test(diagnostico);

/** S#### → `sonarjs/<nombre>`, desde la URL de la documentación de cada regla del plugin. */
export function mapaDeSonarjs(reglas) {
  const mapa = new Map();
  for (const nombre of Object.keys(reglas).sort()) {
    const clave = /\/rspec\/(S\d+)\//.exec(reglas[nombre]?.meta?.docs?.url ?? "")?.[1];
    if (clave && !mapa.has(clave)) {
      mapa.set(clave, `sonarjs/${nombre}`);
    }
  }
  return mapa;
}

/**
 * Las reglas de ESLint que hay que encender para las de TypeScript de la corrida, cómo volver
 * de cada una a su ID de la prueba, y qué IDs de TypeScript se pueden probar (todas las de los
 * plugins: con eso la app sabe cuáles de Sonar para TypeScript son probables, E9).
 */
export function reglasDeEslint(diagnosticos, mapa, propias) {
  const reglas = {};
  const porEslint = new Map();
  for (const diagnostico of diagnosticos) {
    const deSonar = ID_SONAR_TS.exec(diagnostico)?.[1];
    const propia = ID_LAINCO.exec(diagnostico)?.[1];
    const eslint = deSonar ? mapa.get(deSonar) : propia && propias.includes(propia) ? diagnostico : undefined;
    if (eslint) {
      reglas[eslint] = "warn";
      porEslint.set(eslint, diagnostico);
    }
  }
  const disponibles = [...[...mapa.keys()].map((clave) => `ts:${clave}`), ...propias.map((nombre) => `lainco/${nombre}`)].sort();
  return { reglas: Object.fromEntries(Object.entries(reglas).sort()), porEslint, disponibles };
}

/** La ruta relativa a la raíz, con "/", o null si está fuera del repositorio. */
function rutaRelativa(archivo, raiz) {
  const relativa = path.posix.relative(raiz.split(path.sep).join("/"), archivo.split(path.sep).join("/"));
  return relativa === "" || relativa.startsWith("..") || path.posix.isAbsolute(relativa) ? null : relativa;
}

/**
 * Reduce los resultados de ESLint (`LintResult[]`) a las reglas de TypeScript de la corrida:
 * una entrada por regla, cero incluido; un issue repetido cuenta una vez; hasta `maximo`
 * ubicaciones por regla, en orden de archivo y línea.
 */
export function reducirEslint({ resultados, raiz, diagnosticos, porEslint, maximo = MAXIMO_POR_DEFECTO }) {
  const deTypeScript = diagnosticos.filter(esDeTypeScript);
  if (deTypeScript.length === 0) {
    throw new ErrorDePruebaEslint("La corrida no tiene reglas de TypeScript.");
  }
  const porDiagnostico = new Map(deTypeScript.map((d) => [d, new Map()]));
  const descartados = { sinRegla: 0, fueraDelRepositorio: 0 };

  for (const resultado of resultados) {
    const archivo = rutaRelativa(resultado.filePath, raiz);
    for (const m of resultado.messages ?? []) {
      if (!m.ruleId) {
        // Un error de parseo: el archivo no se pudo analizar.
        descartados.sinRegla++;
        continue;
      }
      const diagnostico = porEslint.get(m.ruleId);
      if (!diagnostico || !porDiagnostico.has(diagnostico)) {
        continue;
      }
      if (archivo === null) {
        descartados.fueraDelRepositorio++;
        continue;
      }
      const ubicacion = { archivo, linea: m.line ?? 1, columna: m.column ?? 1, mensaje: (m.message ?? "").trim() };
      porDiagnostico.get(diagnostico).set(JSON.stringify(ubicacion), ubicacion);
    }
  }

  const comparar = (a, b) => (a.archivo < b.archivo ? -1 : a.archivo > b.archivo ? 1 : a.linea - b.linea || a.columna - b.columna);
  const reglas = [...porDiagnostico.keys()].sort().map((diagnostico) => {
    const ubicaciones = [...porDiagnostico.get(diagnostico).values()].sort(comparar);
    return { diagnostico, cantidad: ubicaciones.length, ubicaciones: ubicaciones.slice(0, maximo) };
  });
  return { reglas, descartados };
}

async function main() {
  const { values } = parseArgs({
    options: {
      corrida: { type: "string" },
      raiz: { type: "string" },
      maximo: { type: "string" },
      salida: { type: "string" },
    },
  });
  for (const requerido of ["corrida", "raiz"]) {
    if (!values[requerido]) {
      throw new ErrorDePruebaEslint(`Falta --${requerido}.`);
    }
  }
  const raiz = path.resolve(values.raiz);
  const diagnosticos = JSON.parse(readFileSync(values.corrida, "utf8")).reglas.map((r) => r.diagnostico);

  // ESLint y los plugins, de la carpeta de herramientas del job.
  const herramientas = createRequire(new URL("./eslint/package.json", import.meta.url));
  const cargar = async (nombre) => (await import(pathToFileURL(herramientas.resolve(nombre)).href)).default ?? (await import(pathToFileURL(herramientas.resolve(nombre)).href));
  const { ESLint } = await import(pathToFileURL(herramientas.resolve("eslint")).href);
  const tseslint = await cargar("typescript-eslint");
  const sonarjs = await cargar("eslint-plugin-sonarjs");
  const lainco = await cargar("@lainco/eslint-plugin");

  const mapa = mapaDeSonarjs(sonarjs.rules);
  const { reglas, porEslint, disponibles } = reglasDeEslint(diagnosticos, mapa, Object.keys(lainco.rules));
  const conTipos = existsSync(path.join(raiz, "tsconfig.json"));

  const eslint = new ESLint({
    cwd: raiz,
    overrideConfigFile: true,
    errorOnUnmatchedPattern: false,
    overrideConfig: [
      { ignores: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**", "**/.next/**"] },
      {
        files: ["**/*.{ts,tsx,mts,cts}"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true }, ...(conTipos ? { projectService: true, tsconfigRootDir: raiz } : {}) },
        },
        plugins: { sonarjs, lainco },
        linterOptions: { reportUnusedDisableDirectives: "off" },
        rules: reglas,
      },
    ],
  });
  const resultados = Object.keys(reglas).length > 0 ? await eslint.lintFiles(["**/*.{ts,tsx,mts,cts}"]) : [];
  const { reglas: reducidas, descartados } = reducirEslint({
    resultados,
    raiz,
    diagnosticos,
    porEslint,
    maximo: values.maximo ? Number(values.maximo) : undefined,
  });

  const texto = JSON.stringify({ diagnosticosDisponibles: disponibles, reglas: reducidas });
  if (values.salida) {
    writeFileSync(values.salida, texto);
  } else {
    process.stdout.write(texto + "\n");
  }
  // Del package.json en node_modules: no todos los paquetes lo exportan.
  const carpeta = new URL("./eslint/node_modules/", import.meta.url);
  const version = (nombre) => JSON.parse(readFileSync(new URL(`${nombre}/package.json`, carpeta), "utf8")).version;
  const total = reducidas.reduce((n, r) => n + r.cantidad, 0);
  console.error(
    `ESLint ${version("eslint")}, eslint-plugin-sonarjs ${version("eslint-plugin-sonarjs")}, @lainco/eslint-plugin ${version("@lainco/eslint-plugin")}` +
      `${conTipos ? ", con tipos" : ", sin tsconfig.json (las reglas que necesitan tipos no reportan)"}: ` +
      `${resultados.length} archivos, ${total} issues de ${reducidas.length} reglas` +
      ` (descartados: ${descartados.sinRegla} errores de parseo, ${descartados.fueraDelRepositorio} fuera del repositorio).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof ErrorDePruebaEslint ? error.message : error);
    process.exitCode = 1;
  });
}
