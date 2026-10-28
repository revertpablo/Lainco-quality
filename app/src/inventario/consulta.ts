import "server-only";

import {
  and,
  arrayOverlaps,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { desvio, estado, estadoRegla, lenguaje, origen, publicacion, regla, sincronizacion } from "@/db/esquema";
import type { Filtros } from "@/dominio/filtros";
import { EstadoSincronizacion, Origen, type Estado, type Lenguaje, type Origen as TipoOrigen } from "@/dominio/valores";

/**
 * Consultas del inventario de reglas (paso 8). Se traen todas las reglas que cumplen los
 * filtros, sin paginar: el catálogo completo son unas 1.100 filas livianas (sin la
 * descripción), y así "seleccionar todas" selecciona de verdad todas las filtradas.
 */

export interface FilaDeInventario {
  id: string;
  clave: string;
  nombre: string;
  origen: TipoOrigen;
  lenguaje: Lenguaje;
  tipo: string | null;
  severidad: string | null;
  tags: string[];
  atributoCleanCode: string | null;
  estado: Estado;
  deprecada: boolean;
  /** Llegó en la última sincronización. */
  nueva: boolean;
  /** Cambió en la última sincronización. */
  modificada: boolean;
  /** Su última publicación en Sonar no salió (pendiente o fallida). */
  sinPublicar: boolean;
  /** Tiene un desvío abierto con Sonar. */
  conDesvio: boolean;
}

/** Severidades de Sonar de mayor a menor, para ordenar. */
const SEVERIDADES_EN_ORDEN = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];

/** La última sincronización con Sonar que terminó bien: define qué es "nueva" y "modificada". */
export async function ultimaSincronizacionOk(db: Db): Promise<string | null> {
  const [ultima] = await db
    .select({ id: sincronizacion.id })
    .from(sincronizacion)
    .where(and(eq(sincronizacion.origen, Origen.Sonar), eq(sincronizacion.estado, EstadoSincronizacion.Ok)))
    .orderBy(desc(sincronizacion.iniciadaEn))
    .limit(1);
  return ultima?.id ?? null;
}

export async function buscarReglas(
  db: Db,
  filtros: Filtros,
  ultimaSincronizacionId: string | null,
): Promise<FilaDeInventario[]> {
  const nueva = ultimaSincronizacionId
    ? sql<boolean>`coalesce(${regla.altaEnSincronizacionId} = ${ultimaSincronizacionId}, false)`
    : sql<boolean>`false`;
  const modificada = ultimaSincronizacionId
    ? sql<boolean>`coalesce(${regla.modificadaEnSincronizacionId} = ${ultimaSincronizacionId}, false)`
    : sql<boolean>`false`;

  const condiciones: (SQL | undefined)[] = [];

  if (filtros.q) {
    const patron = `%${filtros.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    condiciones.push(or(ilike(regla.clave, patron), ilike(regla.nombre, patron)));
  }
  if (filtros.estados.length > 0) condiciones.push(inArray(estadoRegla.estado, filtros.estados));
  if (filtros.lenguajes.length > 0) condiciones.push(inArray(regla.lenguaje, filtros.lenguajes));
  if (filtros.origenes.length > 0) condiciones.push(inArray(regla.origen, filtros.origenes));
  if (filtros.tipos.length > 0) condiciones.push(inArray(regla.tipo, filtros.tipos));
  if (filtros.severidades.length > 0) condiciones.push(inArray(regla.severidadDefault, filtros.severidades));
  if (filtros.atributos.length > 0) condiciones.push(inArray(regla.atributoCleanCode, filtros.atributos));
  // Con varios tags, alcanza con que la regla tenga uno.
  if (filtros.tags.length > 0) condiciones.push(arrayOverlaps(regla.tags, filtros.tags));
  if (filtros.novedad === "nuevas") condiciones.push(nueva);
  if (filtros.novedad === "modificadas") condiciones.push(modificada);
  if (filtros.deprecadas === "excluir") condiciones.push(isNull(regla.deprecadaEn));
  if (filtros.deprecadas === "solo") condiciones.push(isNotNull(regla.deprecadaEn));

  const columna = {
    clave: regla.clave,
    nombre: regla.nombre,
    lenguaje: regla.lenguaje,
    tipo: regla.tipo,
    severidad: sql`array_position(${sql.raw(`ARRAY[${SEVERIDADES_EN_ORDEN.map((s) => `'${s}'`).join(",")}]`)}::text[], ${regla.severidadDefault})`,
    estado: estado.orden,
    modificada: regla.ultimaModificacion,
  }[filtros.orden];
  const sentido = filtros.sentido === "asc" ? asc : desc;
  // Los vacíos van al final en cualquier sentido; a igual valor, por clave.
  const orden =
    filtros.sentido === "asc" ? sql`${columna} asc nulls last` : sql`${columna} desc nulls last`;

  return db
    .select({
      id: regla.id,
      clave: regla.clave,
      nombre: regla.nombre,
      origen: regla.origen,
      lenguaje: regla.lenguaje,
      tipo: regla.tipo,
      severidad: regla.severidadDefault,
      tags: regla.tags,
      atributoCleanCode: regla.atributoCleanCode,
      estado: estadoRegla.estado,
      deprecada: sql<boolean>`${regla.deprecadaEn} is not null`,
      nueva,
      modificada,
      // La última publicación decide: una fallida vieja con una publicada después ya no cuenta.
      sinPublicar: sql<boolean>`coalesce((
        select ${publicacion.estado} <> 'publicada' from ${publicacion}
        where ${publicacion.reglaId} = ${regla.id}
        order by ${publicacion.creadaEn} desc limit 1
      ), false)`,
      conDesvio: sql<boolean>`exists (
        select 1 from ${desvio} where ${desvio.reglaId} = ${regla.id} and ${desvio.resueltoEn} is null
      )`,
    })
    .from(regla)
    .innerJoin(estadoRegla, eq(estadoRegla.reglaId, regla.id))
    .innerJoin(estado, eq(estado.codigo, estadoRegla.estado))
    .where(and(...condiciones))
    .orderBy(orden, sentido(regla.clave));
}

export interface OpcionesDeFiltro {
  estados: { codigo: Estado; descripcion: string }[];
  lenguajes: { codigo: Lenguaje; descripcion: string }[];
  origenes: { codigo: TipoOrigen; descripcion: string }[];
  tipos: string[];
  severidades: string[];
  atributos: string[];
  /** Todos los tags del catálogo, con cuántas reglas tienen cada uno, de más a menos. */
  tags: { tag: string; cantidad: number }[];
  /** Reglas en el catálogo, sin filtrar. */
  total: number;
}

/** Los valores posibles de cada filtro, sacados del catálogo. */
export async function opcionesDeFiltro(db: Db): Promise<OpcionesDeFiltro> {
  const distintos = async (columna: typeof regla.tipo | typeof regla.severidadDefault | typeof regla.atributoCleanCode) =>
    (await db.selectDistinct({ valor: columna }).from(regla).where(isNotNull(columna)).orderBy(asc(columna))).map(
      (f) => f.valor!,
    );

  const tag = sql<string>`unnest(${regla.tags})`;
  const [estados, lenguajes, origenes, tipos, severidades, atributos, tags, [{ total }]] = await Promise.all([
    db.select({ codigo: estado.codigo, descripcion: estado.descripcion }).from(estado).orderBy(asc(estado.orden)),
    db.select({ codigo: lenguaje.codigo, descripcion: lenguaje.descripcion }).from(lenguaje).orderBy(asc(lenguaje.orden)),
    db.select({ codigo: origen.codigo, descripcion: origen.descripcion }).from(origen).orderBy(asc(origen.orden)),
    distintos(regla.tipo),
    distintos(regla.severidadDefault),
    distintos(regla.atributoCleanCode),
    db
      .select({ tag: tag.as("tag"), cantidad: count() })
      .from(regla)
      .groupBy(sql`1`)
      .orderBy(desc(count()), asc(sql`1`)),
    db.select({ total: count() }).from(regla),
  ]);

  return {
    estados,
    lenguajes,
    origenes,
    tipos,
    severidades: SEVERIDADES_EN_ORDEN.filter((s) => severidades.includes(s)).concat(
      severidades.filter((s) => !SEVERIDADES_EN_ORDEN.includes(s)),
    ),
    atributos,
    tags,
    total,
  };
}
