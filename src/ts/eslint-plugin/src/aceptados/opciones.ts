/**
 * Opciones de `lainco-sonar-sync`: las mismas que la versión .NET
 * (`tools/sonar-sync/README.md`), para que se usen igual desde los dos motores.
 */

export const URL_POR_DEFECTO = "https://sonarcloud.io";
export const SALIDA_POR_DEFECTO = "sonar-accepted.json";
export const VARIABLE_DEL_TOKEN = "LAINCO_SONAR_TOKEN";

export interface Opciones {
  proyecto: string;
  organizacion: string | null;
  rama: string | null;
  url: string;
  salida: string;
  /** Si el archivo tiene menos de estas horas, no se consulta. `null`: consulta siempre. */
  vigenciaHoras: number | null;
}

export const USO = `Uso: lainco-sonar-sync --proyecto <clave> [--organizacion <clave>] [--rama <nombre>]
                         [--url <url>] [--salida <ruta>] [--vigencia-horas <n>]

  --proyecto        Clave del proyecto en SonarQube (obligatorio).
  --organizacion    Clave de la organización en SonarQube Cloud.
  --rama            Rama de la que se leen los issues. Por defecto, la principal.
  --url             URL del servidor. Por defecto, ${URL_POR_DEFECTO}.
  --salida          Archivo a generar. Por defecto, ${SALIDA_POR_DEFECTO}.
  --vigencia-horas  Si el archivo tiene menos de n horas, no se consulta. Sin esta
                    opción, consulta siempre. Con ella, hace una pausa tras una falla.
  --ayuda           Muestra esta ayuda.

El token se lee de la variable de entorno ${VARIABLE_DEL_TOKEN}.`;

export class ErrorDeOpciones extends Error {}

const NOMBRES = ["--proyecto", "--organizacion", "--rama", "--url", "--salida", "--vigencia-horas"];

export function leerOpciones(argumentos: readonly string[]): Opciones {
  const valores = new Map<string, string>();
  for (let i = 0; i < argumentos.length; i += 2) {
    const nombre = argumentos[i]!;
    if (!NOMBRES.includes(nombre)) {
      throw new ErrorDeOpciones(`Opción desconocida: ${nombre}.`);
    }
    const valor = argumentos[i + 1];
    if (valor === undefined || valor.startsWith("--")) {
      throw new ErrorDeOpciones(`Falta el valor de ${nombre}.`);
    }
    valores.set(nombre, valor);
  }

  const proyecto = valores.get("--proyecto");
  if (proyecto === undefined) {
    throw new ErrorDeOpciones("Falta --proyecto: la clave del proyecto en SonarQube.");
  }

  let vigenciaHoras: number | null = null;
  const vigencia = valores.get("--vigencia-horas");
  if (vigencia !== undefined) {
    if (!/^\d+$/.test(vigencia)) {
      throw new ErrorDeOpciones(`--vigencia-horas debe ser un número entero de horas, 0 o más: '${vigencia}'.`);
    }
    vigenciaHoras = Number(vigencia);
  }

  return {
    proyecto,
    organizacion: valores.get("--organizacion") ?? null,
    rama: valores.get("--rama") ?? null,
    url: (valores.get("--url") ?? URL_POR_DEFECTO).replace(/\/+$/, ""),
    salida: valores.get("--salida") ?? SALIDA_POR_DEFECTO,
    vigenciaHoras,
  };
}
