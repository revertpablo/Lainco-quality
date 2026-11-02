import { Lenguaje, Origen, TipoDesvio, type OrigenDePaquete } from "@/dominio/valores";

import { generarGlobalconfig, type ReglaDelPaquete } from "./globalconfig";
import { cambiosDeSeveridad, mismoGlobalconfig, planDelPr, RUTAS, tituloDelPr, versionDelProyecto, type CambioDeRegla, type PlanDelPr } from "./pr";
import { cambiosDeReglasJson, mismoReglasJson, planDelPrEslint, RUTAS_ESLINT, versionDelPackageJson } from "./prEslint";
import { generarReglasJson } from "./reglasJson";

/**
 * Los paquetes de reglas propias a los que la app lleva sus decisiones con un PR (entrega
 * 6.4): Lainco.Analyzers, con su `.globalconfig`, y @lainco/eslint-config, con su
 * `reglas.json` (parte ESLint, decisiones L2 a L4). Publicar (./publicar.ts) y revisar
 * (./revisar.ts) hacen lo mismo con los dos; acá está lo que cambia de uno a otro.
 */
export interface DefinicionDelPaquete {
  origen: OrigenDePaquete;
  /** Cómo se llama el paquete que se publica: `Lainco.Analyzers`. */
  nombre: string;
  /** Cómo se llama su archivo de configuración: `.globalconfig`. */
  archivo: string;
  /** La rama del PR de configuración (R5, L3). */
  rama: string;
  /** El desvío de este paquete en la tabla de desvíos. */
  desvio: { tipo: TipoDesvio; lenguaje: Lenguaje; clave: string };
  /** Locks de la publicación y de la revisión (pg_advisory_xact_lock). */
  lockPublicar: number;
  lockRevisar: number;
  /** Los archivos de main que hacen falta: la configuración y de dónde sale la versión primero. */
  rutas: { configuracion: string; version: string; otras: readonly string[] };
  generar(reglas: readonly ReglaDelPaquete[]): string;
  /** Qué propone el PR, o null si main ya está así. Recibe los archivos de main por ruta. */
  plan(main: ReadonlyMap<string, string>, generado: string): PlanDelPr | null;
  versionDe(archivoDeVersion: string): string | null;
  coincide(enMain: string, generado: string): boolean;
  cambios(enMain: string, generado: string): CambioDeRegla[];
  titulo(version: string): string;
}

const de = (main: ReadonlyMap<string, string>, ruta: string) => main.get(ruta) ?? "";

export const PAQUETE_ROSLYN: DefinicionDelPaquete = {
  origen: Origen.Roslyn,
  nombre: "Lainco.Analyzers",
  archivo: ".globalconfig",
  rama: "catalogo/globalconfig",
  desvio: { tipo: TipoDesvio.GlobalconfigDistinto, lenguaje: Lenguaje.CSharp, clave: "Lainco.Analyzers" },
  lockPublicar: 6_400_601,
  lockRevisar: 6_400_701,
  rutas: { configuracion: RUTAS.globalconfig, version: RUTAS.csproj, otras: [RUTAS.shipped, RUTAS.unshipped] },
  generar: generarGlobalconfig,
  plan: (main, generado) =>
    planDelPr({
      main: {
        globalconfig: de(main, RUTAS.globalconfig),
        csproj: de(main, RUTAS.csproj),
        shipped: de(main, RUTAS.shipped),
        unshipped: de(main, RUTAS.unshipped),
      },
      globalconfig: generado,
    }),
  versionDe: versionDelProyecto,
  coincide: mismoGlobalconfig,
  cambios: cambiosDeSeveridad,
  titulo: tituloDelPr,
};

export const PAQUETE_ESLINT: DefinicionDelPaquete = {
  origen: Origen.Eslint,
  nombre: "@lainco/eslint-config",
  archivo: "reglas.json",
  rama: "catalogo/eslint-config",
  desvio: { tipo: TipoDesvio.ReglasEslintDistintas, lenguaje: Lenguaje.TypeScript, clave: "@lainco/eslint-config" },
  lockPublicar: 6_400_602,
  lockRevisar: 6_400_702,
  rutas: { configuracion: RUTAS_ESLINT.reglas, version: RUTAS_ESLINT.paquete, otras: [] },
  generar: generarReglasJson,
  plan: (main, generado) => planDelPrEslint({ main: { reglas: de(main, RUTAS_ESLINT.reglas), paquete: de(main, RUTAS_ESLINT.paquete) }, generado }),
  versionDe: versionDelPackageJson,
  coincide: mismoReglasJson,
  cambios: cambiosDeReglasJson,
  titulo: (version) => `@lainco/eslint-config ${version}: reglas decididas en el catálogo de reglas`,
};

export const PAQUETES: readonly DefinicionDelPaquete[] = [PAQUETE_ROSLYN, PAQUETE_ESLINT];

export function paqueteDe(origen: OrigenDePaquete): DefinicionDelPaquete {
  return origen === Origen.Eslint ? PAQUETE_ESLINT : PAQUETE_ROSLYN;
}
