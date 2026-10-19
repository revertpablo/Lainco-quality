import "server-only";

import { and, asc, eq, or, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { usuario, vistaGuardada } from "@/db/esquema";
import { aParametros, aRegistro, leerFiltros, type Filtros } from "@/dominio/filtros";

/**
 * Vistas guardadas del inventario (FASE-6.md, sección 5; paso 9): un conjunto de filtros y
 * orden con un nombre. Se guardan como los parámetros de la URL (`aRegistro`) y al leerlas
 * pasan por `leerFiltros`, así una vista vieja con un valor que ya no existe no rompe nada.
 *
 * - El nombre es único por usuario. Guardar con un nombre que ya existe actualiza esa vista.
 * - Una vista compartida la ven todos; solo su autor la cambia o la borra.
 */

export const LARGO_MAXIMO_DEL_NOMBRE = 80;

export interface Vista {
  id: string;
  nombre: string;
  filtros: Filtros;
  /** La parte de la URL después del `?`: el link de la vista es `/reglas?{parametros}`. */
  parametros: string;
  compartida: boolean;
  /** Es de quien la está mirando: la puede cambiar y borrar. */
  propia: boolean;
  autor: string;
}

/** Las vistas que ve un usuario: las suyas y las compartidas por otros. Primero las suyas. */
export async function listarVistas(db: Db, usuarioId: string): Promise<Vista[]> {
  const filas = await db
    .select({
      id: vistaGuardada.id,
      nombre: vistaGuardada.nombre,
      filtros: vistaGuardada.filtros,
      compartida: vistaGuardada.compartida,
      usuarioId: vistaGuardada.usuarioId,
      autor: usuario.nombre,
    })
    .from(vistaGuardada)
    .innerJoin(usuario, eq(usuario.id, vistaGuardada.usuarioId))
    .where(or(eq(vistaGuardada.usuarioId, usuarioId), eq(vistaGuardada.compartida, true)))
    .orderBy(
      sql`${vistaGuardada.usuarioId} = ${usuarioId} desc`,
      asc(sql`lower(${vistaGuardada.nombre})`),
      asc(vistaGuardada.nombre),
    );

  return filas.map((f) => {
    const filtros = leerFiltros(f.filtros as Record<string, string[]>);
    return {
      id: f.id,
      nombre: f.nombre,
      filtros,
      parametros: aParametros(filtros),
      compartida: f.compartida,
      propia: f.usuarioId === usuarioId,
      autor: f.autor,
    };
  });
}

export interface VistaParaGuardar {
  nombre: string;
  filtros: Filtros;
  compartida: boolean;
}

/** Crea la vista, o la actualiza si el usuario ya tiene una con ese nombre. */
export async function guardarVista(
  db: Db,
  usuarioId: string,
  vista: VistaParaGuardar,
): Promise<{ id: string; resultado: "creada" | "actualizada" }> {
  const nombre = vista.nombre.trim();
  if (nombre.length === 0 || nombre.length > LARGO_MAXIMO_DEL_NOMBRE) {
    throw new Error(`El nombre de la vista tiene que tener entre 1 y ${LARGO_MAXIMO_DEL_NOMBRE} caracteres.`);
  }

  const [fila] = await db
    .insert(vistaGuardada)
    .values({ nombre, usuarioId, filtros: aRegistro(vista.filtros), compartida: vista.compartida })
    .onConflictDoUpdate({
      target: [vistaGuardada.usuarioId, vistaGuardada.nombre],
      set: { filtros: aRegistro(vista.filtros), compartida: vista.compartida },
    })
    // xmax = 0 solo en una fila recién insertada: distingue alta de actualización.
    .returning({ id: vistaGuardada.id, nueva: sql<boolean>`(xmax = 0)` });

  return { id: fila.id, resultado: fila.nueva ? "creada" : "actualizada" };
}

/** Borra la vista si es del usuario. Devuelve si la borró. */
export async function borrarVista(db: Db, usuarioId: string, vistaId: string): Promise<boolean> {
  const borradas = await db
    .delete(vistaGuardada)
    .where(and(eq(vistaGuardada.id, vistaId), eq(vistaGuardada.usuarioId, usuarioId)))
    .returning({ id: vistaGuardada.id });
  return borradas.length > 0;
}
