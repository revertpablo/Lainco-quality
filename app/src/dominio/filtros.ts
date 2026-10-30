import { Estado, Lenguaje, Origen } from "./valores";

/**
 * Filtros y orden del inventario de reglas (FASE-6.md, sección 5). Viven en la URL: así una
 * búsqueda se comparte con un link, el botón "atrás" funciona y una vista guardada (paso 9)
 * es solo la URL con un nombre.
 *
 * Leer nunca falla: un valor que no existe se ignora, para que una URL vieja o editada a
 * mano no rompa la pantalla.
 */

export const CAMPOS_DE_ORDEN = ["clave", "nombre", "lenguaje", "tipo", "severidad", "estado", "modificada"] as const;
export type CampoDeOrden = (typeof CAMPOS_DE_ORDEN)[number];

export const NOVEDADES = ["nuevas", "modificadas"] as const;
export type Novedad = (typeof NOVEDADES)[number];

/** Qué hacer con las reglas que Sonar deprecó o eliminó. */
export const OPCIONES_DE_DEPRECADAS = ["incluir", "excluir", "solo"] as const;
export type OpcionDeDeprecadas = (typeof OPCIONES_DE_DEPRECADAS)[number];

export interface Filtros {
  /** Texto en la clave o el nombre. */
  q: string;
  /** Las listas vacías no filtran. Con varios valores, alcanza con que coincida uno. */
  estados: Estado[];
  lenguajes: Lenguaje[];
  origenes: Origen[];
  tipos: string[];
  severidades: string[];
  tags: string[];
  atributos: string[];
  /** Nuevas o modificadas en la última sincronización. */
  novedad: Novedad | null;
  deprecadas: OpcionDeDeprecadas;
  orden: CampoDeOrden;
  sentido: "asc" | "desc";
}

export const FILTROS_POR_DEFECTO: Readonly<Filtros> = {
  q: "",
  estados: [],
  lenguajes: [],
  origenes: [],
  tipos: [],
  severidades: [],
  tags: [],
  atributos: [],
  novedad: null,
  deprecadas: "incluir",
  orden: "clave",
  sentido: "asc",
};

const MAXIMO_DE_VALORES = 50;
const LARGO_MAXIMO = 100;

type Entrada = URLSearchParams | Record<string, string | string[] | undefined>;

/**
 * Códigos de estado que cambiaron de nombre, para que los links guardados sigan filtrando
 * igual: "A revisar" pasó a "En análisis" (2026-10-30, migración 0013).
 */
const CODIGOS_VIEJOS_DE_ESTADO: Readonly<Record<string, Estado>> = { aRevisar: Estado.EnAnalisis };

export function leerFiltros(entrada: Entrada): Filtros {
  const todos = (nombre: string): string[] => {
    const crudo = entrada instanceof URLSearchParams ? entrada.getAll(nombre) : entrada[nombre];
    const lista = crudo === undefined ? [] : Array.isArray(crudo) ? crudo : [crudo];
    const limpios = lista.map((v) => v.trim().slice(0, LARGO_MAXIMO)).filter(Boolean);
    return [...new Set(limpios)].slice(0, MAXIMO_DE_VALORES);
  };
  const uno = (nombre: string) => todos(nombre)[0];
  const de = <T extends string>(valores: readonly T[], nombre: string): T[] =>
    todos(nombre).filter((v): v is T => (valores as readonly string[]).includes(v));
  const unoDe = <T extends string>(valores: readonly T[], nombre: string): T | undefined => de(valores, nombre)[0];

  return {
    q: uno("q") ?? "",
    estados: [...new Set(todos("estado").map((v) => CODIGOS_VIEJOS_DE_ESTADO[v] ?? v))].filter((v): v is Estado =>
      (Object.values(Estado) as string[]).includes(v),
    ),
    lenguajes: de(Object.values(Lenguaje), "lenguaje"),
    origenes: de(Object.values(Origen), "origen"),
    tipos: todos("tipo"),
    severidades: todos("severidad"),
    tags: todos("tag"),
    atributos: todos("atributo"),
    novedad: unoDe(NOVEDADES, "novedad") ?? null,
    deprecadas: unoDe(OPCIONES_DE_DEPRECADAS, "deprecadas") ?? FILTROS_POR_DEFECTO.deprecadas,
    orden: unoDe(CAMPOS_DE_ORDEN, "orden") ?? FILTROS_POR_DEFECTO.orden,
    sentido: unoDe(["asc", "desc"] as const, "sentido") ?? FILTROS_POR_DEFECTO.sentido,
  };
}

/** La parte de la URL después del `?`, sin los valores por defecto y siempre en el mismo orden. */
export function aParametros(filtros: Filtros): string {
  const parametros = new URLSearchParams();
  const poner = (nombre: string, valores: readonly string[]) => valores.forEach((v) => parametros.append(nombre, v));

  if (filtros.q) parametros.set("q", filtros.q);
  poner("estado", filtros.estados);
  poner("lenguaje", filtros.lenguajes);
  poner("origen", filtros.origenes);
  poner("tipo", filtros.tipos);
  poner("severidad", filtros.severidades);
  poner("tag", filtros.tags);
  poner("atributo", filtros.atributos);
  if (filtros.novedad) parametros.set("novedad", filtros.novedad);
  if (filtros.deprecadas !== FILTROS_POR_DEFECTO.deprecadas) parametros.set("deprecadas", filtros.deprecadas);
  if (filtros.orden !== FILTROS_POR_DEFECTO.orden) parametros.set("orden", filtros.orden);
  if (filtros.sentido !== FILTROS_POR_DEFECTO.sentido) parametros.set("sentido", filtros.sentido);

  return parametros.toString();
}

/**
 * Los filtros como parámetros de la URL, valor por valor: la forma en que se guardan en
 * una vista (`vistaGuardada.filtros`). Al leerlos de vuelta pasan por `leerFiltros`.
 */
export function aRegistro(filtros: Filtros): Record<string, string[]> {
  const registro: Record<string, string[]> = {};
  for (const [clave, valor] of new URLSearchParams(aParametros(filtros))) {
    (registro[clave] ??= []).push(valor);
  }
  return registro;
}
