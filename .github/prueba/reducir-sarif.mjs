// Reduce los SARIF de un repositorio al resultado que el job de prueba le manda a la app
// (entrega 6.5, paso 4, decisión E4). Sin dependencias: corre con el Node del runner.
//
//   node reducir-sarif.mjs --sarif <carpeta> --raiz <repositorio clonado> \
//        --repositorio <owner/repo> --commit <sha> --diagnosticos LAIN001,S1118 \
//        [--maximo 200] [--salida resultado.json]
//
// Lee todos los .sarif de la carpeta (uno por proyecto y target framework, los que deja
// Prueba.targets) y escribe:
//
//   { "repositorio": "owner/repo", "commit": "sha", "estado": "ok",
//     "diagnosticosDisponibles": ["LAIN001", "S100", ...],
//     "reglas": [{ "diagnostico": "S1118", "cantidad": 3,
//                  "ubicaciones": [{ "archivo": "src/A.cs", "linea": 18, "columna": 14, "mensaje": "..." }] }] }
//
// - Una entrada por cada regla de la corrida, cero incluido: la app distingue "sin issues" de
//   "no se probó".
// - Solo referencias al código, nunca código (decisión E1). Rutas relativas a la raíz, con "/".
// - Un issue que aparece en varios proyectos o target frameworks cuenta una vez.
// - No cuenta lo suprimido en el código (Sonar tampoco lo ve) ni lo que está fuera del
//   repositorio (paquetes, código generado en otra carpeta).
// - Hasta --maximo ubicaciones por regla (200), en orden de archivo y línea; la cantidad es
//   la real. La app elige de ahí las muestras, las ya evaluadas primero (decisión E6).
// - diagnosticosDisponibles: las reglas de Sonar (S####) y propias (LAIN###) que trae el
//   compilador. El SARIF las lista todas, hayan disparado o no: con eso la app sabe qué
//   reglas de Sonar se pueden probar (decisión E7).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export class ErrorDeReduccion extends Error {}

const DISPONIBLE = /^(S\d+|LAIN\d{3})$/;
const MAXIMO_POR_DEFECTO = 200;

/** La ruta del resultado relativa a la raíz, con "/", o null si está fuera del repositorio. */
function rutaRelativa(uri, raiz) {
  let absoluta;
  try {
    absoluta = uri.startsWith("file:") ? fileURLToPath(uri) : path.resolve(raiz, decodeURIComponent(uri));
  } catch {
    return null;
  }
  const relativa = path.relative(raiz, absoluta);
  if (relativa === "" || relativa.startsWith("..") || path.isAbsolute(relativa)) {
    return null;
  }
  return relativa.split(path.sep).join("/");
}

/**
 * @param {{ sarifs: object[], raiz: string, repositorio: string, commit: string,
 *           diagnosticos: string[], maximo?: number }} opciones
 */
export function reducir({ sarifs, raiz, repositorio, commit, diagnosticos, maximo = MAXIMO_POR_DEFECTO }) {
  if (sarifs.length === 0) {
    throw new ErrorDeReduccion("No hay SARIF: no se compiló ningún proyecto C#.");
  }

  const pedidos = new Set(diagnosticos);
  const disponibles = new Set();
  const porRegla = new Map(diagnosticos.map((d) => [d, new Map()]));
  const descartados = { suprimidos: 0, fueraDelRepositorio: 0, sinUbicacion: 0 };

  for (const sarif of sarifs) {
    if (!Array.isArray(sarif?.runs)) {
      throw new ErrorDeReduccion("Un archivo no es un SARIF: le falta \"runs\".");
    }
    for (const run of sarif.runs) {
      for (const regla of run.tool?.driver?.rules ?? []) {
        if (DISPONIBLE.test(regla.id)) {
          disponibles.add(regla.id);
        }
      }
      for (const r of run.results ?? []) {
        if (!pedidos.has(r.ruleId)) {
          continue;
        }
        if ((r.suppressions ?? []).length > 0) {
          descartados.suprimidos++;
          continue;
        }
        const fisica = r.locations?.[0]?.physicalLocation;
        if (!fisica?.artifactLocation?.uri) {
          descartados.sinUbicacion++;
          continue;
        }
        const archivo = rutaRelativa(fisica.artifactLocation.uri, raiz);
        if (archivo === null) {
          descartados.fueraDelRepositorio++;
          continue;
        }
        const ubicacion = {
          archivo,
          linea: fisica.region?.startLine ?? 1,
          columna: fisica.region?.startColumn ?? 1,
          mensaje: (r.message?.text ?? "").trim(),
        };
        // El mismo issue en otro proyecto o target framework es el mismo.
        porRegla.get(r.ruleId).set(JSON.stringify(ubicacion), ubicacion);
      }
    }
  }

  const comparar = (a, b) => (a.archivo < b.archivo ? -1 : a.archivo > b.archivo ? 1 : a.linea - b.linea || a.columna - b.columna);
  const reglas = [...porRegla.keys()].sort().map((diagnostico) => {
    const ubicaciones = [...porRegla.get(diagnostico).values()].sort(comparar);
    return { diagnostico, cantidad: ubicaciones.length, ubicaciones: ubicaciones.slice(0, maximo) };
  });

  return {
    cuerpo: { repositorio, commit, estado: "ok", diagnosticosDisponibles: [...disponibles].sort(), reglas },
    descartados,
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      sarif: { type: "string" },
      raiz: { type: "string" },
      repositorio: { type: "string" },
      commit: { type: "string" },
      diagnosticos: { type: "string" },
      maximo: { type: "string" },
      salida: { type: "string" },
    },
  });
  for (const requerido of ["sarif", "raiz", "repositorio", "commit", "diagnosticos"]) {
    if (!values[requerido]) {
      throw new ErrorDeReduccion(`Falta --${requerido}.`);
    }
  }

  let archivos = [];
  try {
    archivos = readdirSync(values.sarif).filter((a) => a.endsWith(".sarif"));
  } catch {
    // Sin carpeta es lo mismo que sin SARIF.
  }
  const { cuerpo, descartados } = reducir({
    sarifs: archivos.map((a) => JSON.parse(readFileSync(path.join(values.sarif, a), "utf8"))),
    raiz: path.resolve(values.raiz),
    repositorio: values.repositorio,
    commit: values.commit,
    diagnosticos: values.diagnosticos.split(",").filter(Boolean),
    maximo: values.maximo ? Number(values.maximo) : undefined,
  });

  const texto = JSON.stringify(cuerpo);
  if (values.salida) {
    writeFileSync(values.salida, texto);
  } else {
    process.stdout.write(texto + "\n");
  }
  const total = cuerpo.reglas.reduce((n, r) => n + r.cantidad, 0);
  console.error(
    `${values.repositorio}: ${archivos.length} SARIF, ${total} issues de ${cuerpo.reglas.length} reglas` +
      ` (descartados: ${descartados.suprimidos} suprimidos, ${descartados.fueraDelRepositorio} fuera del repositorio, ${descartados.sinUbicacion} sin ubicación).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof ErrorDeReduccion ? error.message : error);
    process.exitCode = 1;
  }
}
