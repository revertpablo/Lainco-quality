import { EstadoCorrida, EvaluacionMuestra, Origen } from "./valores";

/**
 * El estado En prueba (entrega 6.5, parte C#) sin base ni red: el `.globalconfig` con el que
 * el job compila los repositorios, la traducción entre los IDs de los diagnósticos y las
 * reglas del inventario, cuándo dos muestras son la misma (decisión E6), el link a una
 * muestra (E1), la tasa de falsos positivos y las corridas que cuentan para el mínimo (E3).
 *
 * Ver docs/FASE-6-APP.md, sección 8 quater, y docs/FASE-6.md, sección 8.
 */

export class ErrorDePrueba extends Error {}

/** Una regla de Sonar para C# (`csharpsquid:S2325`): su ID en SonarAnalyzer.CSharp es el mismo. */
const SONAR_CS = /^csharpsquid:(S\d+)$/;
const ID_SONAR = /^S\d+$/;
/** Una regla Roslyn propia: la clave es el ID del diagnóstico. */
const LAIN = /^LAIN\d{3}$/;

interface ReglaAProbar {
  origen: Origen;
  clave: string;
}

/** El ID con el que el compilador reporta la regla. Solo hay de C# (alcance de la 6.5). */
export function idDeDiagnostico({ origen, clave }: ReglaAProbar): string {
  if (origen === Origen.Sonar) {
    const id = SONAR_CS.exec(clave)?.[1];
    if (id) {
      return id;
    }
  }
  if (origen === Origen.Roslyn && LAIN.test(clave)) {
    return clave;
  }
  throw new ErrorDePrueba(`La regla ${clave} (${origen}) no se prueba con el job de C#.`);
}

/** La regla del inventario de un `ruleId` del SARIF, o null si no es de una regla que la app conoce. */
export function claveDeDiagnostico(ruleId: string): ReglaAProbar | null {
  if (ID_SONAR.test(ruleId)) {
    return { origen: Origen.Sonar, clave: `csharpsquid:${ruleId}` };
  }
  if (LAIN.test(ruleId)) {
    return { origen: Origen.Roslyn, clave: ruleId };
  }
  return null;
}

/**
 * El `.globalconfig` con el que el job compila cada repositorio: enciende como `warning` las
 * reglas en prueba y apaga todos los demás analyzers, así la compilación es más rápida y el
 * SARIF trae lo que importa.
 *
 * `global_level` alto porque convive con otros `.globalconfig`: el del paquete
 * `Lainco.Analyzers` pone `none` en las reglas propias que no están Incorporadas, y si dos
 * archivos del mismo nivel le dan valores distintos a una clave, el compilador la descarta.
 * Con un nivel mayor, este gana.
 */
export function generarGlobalconfigDePrueba(reglas: readonly ReglaAProbar[]): string {
  const ids = [...new Set(reglas.map(idDeDiagnostico))].sort();
  return [
    "# Configuración de prueba de reglas, generada por la app de catálogo (entrega 6.5).",
    "# La usa el job de prueba al compilar cada repositorio. No se edita a mano.",
    "is_global = true",
    "global_level = 1000",
    "",
    "# Todo analyzer apagado, salvo las reglas En prueba.",
    "dotnet_analyzer_diagnostic.severity = none",
    ...ids.map((id) => `dotnet_diagnostic.${id}.severity = warning`),
    "",
  ].join("\n");
}

/**
 * La ruta de un archivo dentro del repositorio, con `/`. El job la manda relativa a la raíz;
 * una ruta absoluta o que sale del repositorio es un error del job.
 */
export function normalizarArchivo(ruta: string): string {
  const conBarras = ruta.replaceAll("\\", "/");
  if (conBarras === "" || conBarras.startsWith("/") || /^[A-Za-z]:/.test(conBarras) || conBarras.includes("://")) {
    throw new ErrorDePrueba(`"${ruta}" no es una ruta relativa al repositorio.`);
  }
  const partes = conBarras.split("/").filter((p) => p !== "" && p !== ".");
  if (partes.length === 0 || partes.includes("..")) {
    throw new ErrorDePrueba(`"${ruta}" no es una ruta dentro del repositorio.`);
  }
  return partes.join("/");
}

interface DatosDeIdentidad {
  reglaId: string;
  repositorio: string;
  archivo: string;
  mensaje: string;
}

/**
 * Lo que identifica a una muestra entre corridas (E6): regla, repositorio, archivo y
 * mensaje, sin la línea, que se mueve con cualquier cambio del archivo. Funciona porque los
 * mensajes llevan el símbolo (convención de CLAUDE.md; los de Sonar casi siempre lo nombran).
 */
export function identidadDeMuestra({ reglaId, repositorio, archivo, mensaje }: DatosDeIdentidad): string {
  return JSON.stringify([reglaId, repositorio.toLowerCase(), normalizarArchivo(archivo), mensaje.trim()]);
}

/** El código de la muestra en GitHub, en el commit analizado (E1: la app no guarda código). */
export function linkDeMuestra({ repositorio, commit, archivo, linea }: { repositorio: string; commit: string; archivo: string; linea: number }): string {
  const ruta = normalizarArchivo(archivo).split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repositorio}/blob/${encodeURIComponent(commit)}/${ruta}#L${linea}`;
}

export interface TasaDeFalsosPositivos {
  evaluadas: number;
  validas: number;
  falsosPositivos: number;
  sinEvaluar: number;
  /** Falsos positivos sobre evaluadas, de 0 a 1; null si no hay ninguna evaluada. */
  tasa: number | null;
}

export function tasaDeFalsosPositivos(evaluaciones: readonly EvaluacionMuestra[]): TasaDeFalsosPositivos {
  const validas = evaluaciones.filter((e) => e === EvaluacionMuestra.Valida).length;
  const falsosPositivos = evaluaciones.filter((e) => e === EvaluacionMuestra.FalsoPositivo).length;
  const evaluadas = validas + falsosPositivos;
  return {
    evaluadas,
    validas,
    falsosPositivos,
    sinEvaluar: evaluaciones.length - evaluadas,
    tasa: evaluadas === 0 ? null : falsosPositivos / evaluadas,
  };
}

export interface CorridaDeLaRegla {
  iniciadaEn: Date;
  estado: EstadoCorrida;
  /** Algún repositorio compiló y dio resultados de la regla (aunque sean cero issues). */
  conResultados: boolean;
}

/**
 * Las corridas que cuentan para el mínimo (E3): terminadas, con resultados de la regla, y
 * que arrancaron desde la última vez que la regla entró a En prueba. Una vuelta anterior por
 * En prueba no cuenta: la regla pudo cambiar desde entonces.
 */
export function corridasQueCuentan(corridas: readonly CorridaDeLaRegla[], entroEnPrueba: Date): number {
  return corridas.filter(
    (c) => c.estado === EstadoCorrida.Terminada && c.conResultados && c.iniciadaEn.getTime() >= entroEnPrueba.getTime(),
  ).length;
}

export function corridasQueFaltan(minimo: number, cuentan: number): number {
  return Math.max(0, minimo - cuentan);
}
