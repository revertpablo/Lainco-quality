import { Estado, type Lenguaje, type Origen } from "./valores";

/**
 * Tablero de progreso del triage (entrega 6.1, paso 11; FASE-6.md, sección 5).
 *
 * Una regla está **triageada** cuando salió de Pendiente de analizar: alguien ya la miró y
 * decidió qué hacer con ella, aunque todavía esté En análisis, En prueba o En duda. Cuántas
 * llegaron a una decisión final (Incorporada o Descartada) se ve en el detalle por estado.
 *
 * Una regla está **estancada** cuando lleva más de N días En análisis, En prueba o En duda:
 * son los estados en los que alguien tiene que hacer algo para que la regla avance.
 */

/** Cuántas reglas hay en un estado, para una combinación de lenguaje, tipo y origen. */
export interface ConteoPorEstado {
  lenguaje: Lenguaje;
  tipo: string | null;
  origen: Origen;
  estado: Estado;
  cantidad: number;
}

export interface Avance {
  total: number;
  porEstado: Record<Estado, number>;
  /** Las que salieron de Pendiente de analizar. */
  triageadas: number;
  /** Porcentaje triageado, redondeado para abajo: 100 solo si no queda ninguna pendiente. */
  porcentaje: number;
}

export interface ResumenDeProgreso {
  total: Avance;
  porLenguaje: { lenguaje: Lenguaje; avance: Avance; porTipo: { tipo: string | null; avance: Avance }[] }[];
  porOrigen: { origen: Origen; avance: Avance }[];
}

/** Los estados en los que una regla espera que alguien la haga avanzar. */
export const ESTADOS_QUE_SE_ESTANCAN = [Estado.EnAnalisis, Estado.EnPrueba, Estado.EnDuda] as const;

/** Orden de los tipos de Sonar: primero los de mayor valor (orden sugerido del triage). */
const ORDEN_DE_TIPOS = ["BUG", "VULNERABILITY", "SECURITY_HOTSPOT", "CODE_SMELL"];

export function avanceDe(conteos: readonly ConteoPorEstado[]): Avance {
  const porEstado = Object.fromEntries(Object.values(Estado).map((e) => [e, 0])) as Record<Estado, number>;
  for (const c of conteos) {
    porEstado[c.estado] += c.cantidad;
  }
  const total = Object.values(porEstado).reduce((a, b) => a + b, 0);
  const triageadas = total - porEstado[Estado.PendienteDeAnalizar];
  return {
    total,
    porEstado,
    triageadas,
    porcentaje: total === 0 ? 0 : Math.floor((triageadas * 100) / total),
  };
}

/**
 * Arma el tablero a partir de los conteos. `lenguajes` y `origenes` dan el orden (el de
 * sus tablas de referencia); los que no tienen reglas no aparecen.
 */
export function resumirProgreso(
  conteos: readonly ConteoPorEstado[],
  lenguajes: readonly Lenguaje[],
  origenes: readonly Origen[],
): ResumenDeProgreso {
  const porLenguaje = lenguajes
    .map((lenguaje) => {
      const delLenguaje = conteos.filter((c) => c.lenguaje === lenguaje);
      const tipos = [...new Set(delLenguaje.map((c) => c.tipo))].sort(compararTipos);
      return {
        lenguaje,
        avance: avanceDe(delLenguaje),
        porTipo: tipos.map((tipo) => ({ tipo, avance: avanceDe(delLenguaje.filter((c) => c.tipo === tipo)) })),
      };
    })
    .filter((l) => l.avance.total > 0);

  const porOrigen = origenes
    .map((origen) => ({ origen, avance: avanceDe(conteos.filter((c) => c.origen === origen)) }))
    .filter((o) => o.avance.total > 0);

  return { total: avanceDe(conteos), porLenguaje, porOrigen };
}

function compararTipos(a: string | null, b: string | null): number {
  // Sin tipo, al final; los desconocidos, después de los conocidos y por nombre.
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const ia = ORDEN_DE_TIPOS.indexOf(a);
  const ib = ORDEN_DE_TIPOS.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  }
  return a.localeCompare(b);
}

export const DIAS_PARA_ESTANCADA_POR_DEFECTO = 14;
export const DIAS_PARA_ESTANCADA_MAXIMO = 365;

/** Lee el N de "estancadas hace más de N días" de la URL: un entero entre 1 y 365. */
export function leerDias(valor: string | string[] | undefined): number {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  if (!texto || !/^\d{1,3}$/.test(texto)) {
    return DIAS_PARA_ESTANCADA_POR_DEFECTO;
  }
  const dias = Number(texto);
  return dias >= 1 && dias <= DIAS_PARA_ESTANCADA_MAXIMO ? dias : DIAS_PARA_ESTANCADA_POR_DEFECTO;
}
