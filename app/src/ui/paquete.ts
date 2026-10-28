import { EstadoPr } from "@/dominio/valores";

/**
 * Textos de la pantalla Paquete (entrega 6.4, paso 7). Las frases que terminan en una
 * fecha no llevan punto: la hora ya termina en "a. m.".
 */

export interface PrParaDescribir {
  numero: number;
  version: string | null;
  estado: EstadoPr;
  mergeadoEn: Date | null;
  cerradoEn: Date | null;
}

export interface DescripcionDePr {
  texto: string;
  tono: "normal" | "alerta" | "error";
}

/**
 * En qué está un PR de configuración. Mergeado, lo compara con la versión publicada (la de
 * la última sincronización de Roslyn): hasta que el workflow publica la versión y la app
 * la sincroniza, el cambio todavía no llegó a los repositorios.
 */
export function describirPr(pr: PrParaDescribir, versionPublicada: string | null, fecha: (d: Date) => string): DescripcionDePr {
  const propone = pr.version ? ` la ${pr.version}` : "";
  switch (pr.estado) {
    case EstadoPr.Abierto:
      return { texto: `Abierto: propone${propone || " una versión nueva"}. Al mergearlo, se publica.`, tono: "alerta" };
    case EstadoPr.Mergeado: {
      const mergeado = `Mergeado el ${fecha(pr.mergeadoEn!)}`;
      if (!pr.version || (versionPublicada !== null && compararVersiones(versionPublicada, pr.version) >= 0)) {
        return { texto: pr.version ? `${mergeado}: la ${pr.version} ya está publicada.` : `${mergeado}.`, tono: "normal" };
      }
      return { texto: `${mergeado}: falta que se publique la ${pr.version} y se sincronice.`, tono: "alerta" };
    }
    default:
      return { texto: `Cerrado sin mergear${pr.cerradoEn ? ` el ${fecha(pr.cerradoEn)}` : "."}`, tono: "error" };
  }
}

/** Compara dos versiones X.Y.Z: negativo si `a` es anterior, 0 si son iguales, positivo si es posterior. */
export function compararVersiones(a: string, b: string): number {
  const partes = (v: string) => v.split("-")[0].split(".").map((n) => Number(n) || 0);
  const [pa, pb] = [partes(a), partes(b)];
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** "Lainco.Analyzers 0.1.1" → "0.1.1". */
export function numeroDeVersion(version: string | null): string | null {
  return version?.split(" ").at(-1) ?? null;
}
