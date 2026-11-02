import { rmSync, utimesSync, writeFileSync } from "node:fs";
import { escribirArchivo, escritoHaceMenosDe, serializar, tomarCandado } from "./archivo.js";
import { buscarAceptados, ErrorDeSonar } from "./cliente.js";
import { ErrorDeOpciones, leerOpciones, USO, VARIABLE_DEL_TOKEN, type Opciones } from "./opciones.js";

/** El archivo se generó (o no hacía falta). */
export const EXITO = 0;
/** Faltan opciones o el token: no se consultó a SonarQube. */
export const ERROR_DE_CONFIGURACION = 1;
/** SonarQube falló o no respondió: el archivo anterior quedó intacto. */
export const ERROR_DE_SONAR = 2;

/**
 * Después de una falla, las corridas automáticas (las que pasan `--vigencia-horas`) no
 * reintentan durante este tiempo: con Sonar caído, cada corrida esperaría el timeout.
 */
export const PAUSA_TRAS_FALLA_MS = 15 * 60_000;

export interface Entorno {
  token: string | undefined;
  fetch: typeof fetch;
  log: (linea: string) => void;
  ahora: () => Date;
}

/**
 * Una corrida completa de `lainco-sonar-sync`, con el mismo comportamiento que la versión
 * .NET (`tools/sonar-sync/README.md`, "Códigos de salida y fallas"). Devuelve el código de
 * salida; quien la invoca decide qué hacer con él: ESLint nunca debe fallar por esto.
 */
export async function ejecutar(argumentos: readonly string[], entorno: Entorno): Promise<number> {
  const { log, ahora } = entorno;
  if (argumentos.length === 1 && ["--ayuda", "-h", "--help"].includes(argumentos[0]!)) {
    log(USO);
    return EXITO;
  }

  let opciones: Opciones;
  try {
    opciones = leerOpciones(argumentos);
  } catch (error) {
    if (!(error instanceof ErrorDeOpciones)) throw error;
    log(`sonar-sync: ${error.message}`);
    log("");
    log(USO);
    return ERROR_DE_CONFIGURACION;
  }

  // El archivo vigente se resuelve antes que el token: con un archivo reciente no hace falta nada más.
  if (vigente(opciones, ahora())) {
    log(`sonar-sync: ${opciones.salida} tiene menos de ${opciones.vigenciaHoras} horas; no se consulta.`);
    return EXITO;
  }

  const token = entorno.token?.trim();
  if (!token) {
    log(
      `sonar-sync: falta el token. Definí la variable de entorno ${VARIABLE_DEL_TOKEN} ` +
        "con un token personal de SonarQube de solo lectura.",
    );
    return ERROR_DE_CONFIGURACION;
  }

  const liberar = tomarCandado(opciones.salida, ahora());
  if (liberar === null) {
    log(`sonar-sync: otra corrida está actualizando ${opciones.salida}; se sigue con el archivo actual.`);
    return EXITO;
  }

  try {
    // Mientras se esperaba el candado, otra corrida pudo haber terminado.
    if (vigente(opciones, ahora())) {
      return EXITO;
    }
    const marcaDeFalla = `${opciones.salida}.falla`;
    if (opciones.vigenciaHoras !== null && escritoHaceMenosDe(marcaDeFalla, PAUSA_TRAS_FALLA_MS, ahora())) {
      return EXITO;
    }

    let issues;
    try {
      issues = await buscarAceptados(opciones, token, entorno.fetch);
    } catch (error) {
      if (!(error instanceof ErrorDeSonar)) throw error;
      writeFileSync(marcaDeFalla, error.message, "utf8");
      utimesSync(marcaDeFalla, ahora(), ahora());
      log(`sonar-sync: ${error.message} No se modificó ${opciones.salida}.`);
      return ERROR_DE_SONAR;
    }

    escribirArchivo(opciones.salida, serializar(opciones.proyecto, opciones.rama, issues, ahora()));
    rmSync(marcaDeFalla, { force: true });
    log(
      `sonar-sync: ${issues.length} ${issues.length === 1 ? "issue aceptado" : "issues aceptados"} ` +
        `de '${opciones.proyecto}' en ${opciones.salida}.`,
    );
    return EXITO;
  } finally {
    liberar();
  }
}

function vigente(opciones: Opciones, ahora: Date): boolean {
  return opciones.vigenciaHoras !== null && escritoHaceMenosDe(opciones.salida, opciones.vigenciaHoras * 3_600_000, ahora);
}
