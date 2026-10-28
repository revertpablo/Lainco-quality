/**
 * Lo que propone el PR de configuración del paquete Lainco.Analyzers (entrega 6.4,
 * paso 6; decisiones R4 y R5), sin red ni base. A partir de lo que hay en `main` y del
 * `.globalconfig` que genera la app (./globalconfig.ts):
 *
 * - si el `.globalconfig` de `main` ya es el de la app, no hay nada que proponer;
 * - si no, el PR cambia el `.globalconfig`, sube el parche de la versión del paquete (al
 *   mergearse, el workflow publicar-analyzers.yml publica esa versión) y, si hay reglas en
 *   `AnalyzerReleases.Unshipped.md`, las mueve a Shipped bajo la versión nueva (el
 *   workflow no publica si quedan).
 *
 * El PR siempre se arma sobre el `main` del momento, con un solo commit: no hay conflictos
 * que resolver, y lo que propone es exactamente la diferencia con `main`.
 */

/** Los archivos que toca el PR, relativos a la raíz del repositorio. */
export const RUTAS = {
  globalconfig: "src/dotnet/Lainco.Analyzers.Package/build/Lainco.Analyzers.globalconfig",
  csproj: "src/dotnet/Lainco.Analyzers.Package/Lainco.Analyzers.Package.csproj",
  shipped: "src/dotnet/Lainco.Analyzers/AnalyzerReleases.Shipped.md",
  unshipped: "src/dotnet/Lainco.Analyzers/AnalyzerReleases.Unshipped.md",
} as const;

/** Lo que hay en `main` no permite armar el PR: lo tiene que mirar una persona. */
export class ErrorDelPr extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDelPr";
  }
}

const sinRetornos = (texto: string) => texto.replace(/\r\n/g, "\n");

// ------------------------------------------------------------------------- versión

/** Sube el parche del `<Version>` del proyecto del paquete: 0.1.0 → 0.1.1. */
export function subirParche(csproj: string): { anterior: string; nueva: string; texto: string } {
  const versiones = [...csproj.matchAll(/<Version>([^<]*)<\/Version>/g)];
  if (versiones.length !== 1) {
    throw new ErrorDelPr(`${RUTAS.csproj} tiene que tener exactamente un <Version>, y tiene ${versiones.length}.`);
  }
  const anterior = versiones[0][1].trim();
  const partes = /^(\d+)\.(\d+)\.(\d+)$/.exec(anterior);
  if (!partes) {
    throw new ErrorDelPr(`La versión del paquete en main es '${anterior}': para subirla sola tiene que ser X.Y.Z, sin sufijo.`);
  }
  const nueva = `${partes[1]}.${partes[2]}.${Number(partes[3]) + 1}`;
  return { anterior, nueva, texto: csproj.replace(versiones[0][0], `<Version>${nueva}</Version>`) };
}

// ----------------------------------------------------------------- AnalyzerReleases

/**
 * Mueve las secciones de reglas de `AnalyzerReleases.Unshipped.md` a
 * `AnalyzerReleases.Shipped.md`, bajo `## Release <version>`. En Unshipped quedan los
 * comentarios del principio. Devuelve null si Unshipped no tiene reglas.
 */
export function moverAShipped(shipped: string, unshipped: string, version: string): { shipped: string; unshipped: string } | null {
  const lineas = sinRetornos(unshipped).split("\n");
  const inicio = lineas.findIndex((l) => l.trim() !== "" && !l.trim().startsWith(";"));
  if (inicio < 0) {
    return null;
  }
  const secciones = lineas.slice(inicio).join("\n").trim();
  if (!secciones.split("\n").some((l) => /^\s*[A-Za-z]+[0-9]+\s*\|/.test(l))) {
    return null;
  }

  const enShipped = sinRetornos(shipped);
  const escapada = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^##\\s+Release\\s+${escapada}\\s*$`, "m").test(enShipped)) {
    throw new ErrorDelPr(`AnalyzerReleases.Shipped.md ya tiene la versión ${version}.`);
  }

  const comentarios = lineas.slice(0, inicio);
  while (comentarios.length > 0 && comentarios[comentarios.length - 1].trim() === "") {
    comentarios.pop();
  }

  return {
    shipped: `${enShipped.trimEnd()}\n\n## Release ${version}\n\n${secciones}\n`,
    unshipped: comentarios.length > 0 ? `${comentarios.join("\n")}\n` : "",
  };
}

// --------------------------------------------------------------------------- plan

/** La severidad de cada regla en un `.globalconfig`. */
export function severidadesDelGlobalconfig(texto: string): Map<string, string> {
  const severidades = new Map<string, string>();
  for (const [, clave, severidad] of sinRetornos(texto).matchAll(/^\s*dotnet_diagnostic\.([^.\s]+)\.severity\s*=\s*(\S+)\s*$/gm)) {
    severidades.set(clave, severidad);
  }
  return severidades;
}

export interface ArchivosDeMain {
  globalconfig: string;
  csproj: string;
  shipped: string;
  unshipped: string;
}

export interface CambioDeRegla {
  clave: string;
  /** Null si la regla no está en el `.globalconfig` de main. */
  enMain: string | null;
  /** Null si el PR la saca: la regla ya no está en el paquete. */
  conElPr: string | null;
}

export interface PlanDelPr {
  versionAnterior: string;
  version: string;
  archivos: { ruta: string; contenido: string }[];
  cambios: CambioDeRegla[];
  releasesMovidas: boolean;
}

/** Qué propone el PR, o null si `main` ya tiene el `.globalconfig` de la app. */
export function planDelPr({ main, globalconfig }: { main: ArchivosDeMain; globalconfig: string }): PlanDelPr | null {
  if (sinRetornos(main.globalconfig) === sinRetornos(globalconfig)) {
    return null;
  }

  const version = subirParche(main.csproj);
  const movidas = moverAShipped(main.shipped, main.unshipped, version.nueva);

  const enMain = severidadesDelGlobalconfig(main.globalconfig);
  const conElPr = severidadesDelGlobalconfig(globalconfig);
  const claves = [...new Set([...enMain.keys(), ...conElPr.keys()])].sort();
  const cambios = claves
    .filter((clave) => enMain.get(clave) !== conElPr.get(clave))
    .map((clave) => ({ clave, enMain: enMain.get(clave) ?? null, conElPr: conElPr.get(clave) ?? null }));

  return {
    versionAnterior: version.anterior,
    version: version.nueva,
    archivos: [
      { ruta: RUTAS.globalconfig, contenido: globalconfig },
      { ruta: RUTAS.csproj, contenido: version.texto },
      ...(movidas
        ? [
            { ruta: RUTAS.shipped, contenido: movidas.shipped },
            { ruta: RUTAS.unshipped, contenido: movidas.unshipped },
          ]
        : []),
    ],
    cambios,
    releasesMovidas: movidas !== null,
  };
}

// ------------------------------------------------------------- título y descripción

export function tituloDelPr(version: string): string {
  return `Lainco.Analyzers ${version}: severidades decididas en el catálogo de reglas`;
}

/** La última decisión sobre una regla: la que explica en qué estado está. */
export interface DecisionDeRegla {
  titulo: string;
  /** El estado al que la llevó, para leer: "Incorporada". */
  estado: string;
  autor: string;
  fecha: Date;
  justificacion: string | null;
}

const fechaLarga = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});

const enLinea = (texto: string) => texto.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");

export function cuerpoDelPr({
  versionAnterior,
  version,
  cambios,
  decisiones,
  releasesMovidas,
}: {
  versionAnterior: string;
  version: string;
  cambios: CambioDeRegla[];
  decisiones: ReadonlyMap<string, DecisionDeRegla>;
  releasesMovidas: boolean;
}): string {
  const filas = cambios.map((c) => {
    const decision = decisiones.get(c.clave);
    const regla = decision ? `${c.clave} — ${enLinea(decision.titulo)}` : c.clave;
    const antes = c.enMain ? `\`${c.enMain}\`` : "(no está)";
    const despues = c.conElPr ? `\`${c.conElPr}\`` : "(se quita)";
    const motivo = !c.conElPr
      ? "La regla ya no está en el paquete."
      : decision
        ? `${decision.estado} por ${enLinea(decision.autor)} el ${fechaLarga.format(decision.fecha)}${decision.justificacion ? `: ${enLinea(decision.justificacion)}` : "."}`
        : "No se decidió nada: la regla está en el paquete y nadie la eligió.";
    return `| ${regla} | ${antes} | ${despues} | ${motivo} |`;
  });

  return [
    `Lleva al paquete las decisiones del catálogo de reglas: actualiza el \`.globalconfig\` de \`Lainco.Analyzers\` y sube la versión de ${versionAnterior} a ${version}. **Al mergearlo, el workflow publica la versión nueva.**`,
    "",
    "| Regla | En main | Con este PR | Decisión |",
    "|---|---|---|---|",
    ...filas,
    "",
    ...(releasesMovidas
      ? [`Además mueve las reglas de \`AnalyzerReleases.Unshipped.md\` a \`AnalyzerReleases.Shipped.md\`, bajo la ${version}.`, ""]
      : []),
    "---",
    "Lo genera la app de catálogo de reglas: no editarlo a mano. Si cambia una decisión antes del merge, la app actualiza este mismo PR.",
    "",
  ].join("\n");
}
