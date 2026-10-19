import "server-only";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { obtenerDb } from "@/db/cliente";
import { rol, usuario } from "@/db/esquema";
import type { Rol } from "@/dominio/valores";

import { auth } from ".";

export interface UsuarioActual {
  id: string;
  nombre: string;
  rol: Rol;
  /** Texto del rol para mostrar (tabla de referencia `rol`). */
  rolDescripcion: string;
}

/**
 * El usuario de la sesión, leído de la base: así el rol y la baja rigen en cada pedido.
 * `null` si no hay sesión o si el usuario ya no está activo.
 *
 * Es el único lugar donde se lee la sesión. Lee cookies, así que el componente que lo
 * use va dentro de un `<Suspense>` (Cache Components). `cache` evita repetir la consulta
 * dentro de un mismo pedido.
 */
export const usuarioActual = cache(async (): Promise<UsuarioActual | null> => {
  // Auth.js usa crypto.getRandomValues al leer la sesión; sin esto, Next lo marca como un
  // valor inestable al prerenderizar ("Issue" en el overlay de `npm run dev`).
  await connection();
  const sesion = await auth();
  const id = sesion?.usuarioId;
  if (!id) {
    return null;
  }

  const [encontrado] = await obtenerDb()
    .select({ id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, rolDescripcion: rol.descripcion })
    .from(usuario)
    .innerJoin(rol, eq(rol.codigo, usuario.rol))
    .where(and(eq(usuario.id, id), eq(usuario.activo, true)))
    .limit(1);

  return encontrado ?? null;
});

/**
 * Como `usuarioActual`, pero sin sesión manda a /ingresar. Lo usan las páginas, las
 * Server Actions y los Route Handlers: `proxy` solo filtra lo obvio, la verificación
 * real va al lado de los datos.
 */
export async function exigirUsuario(): Promise<UsuarioActual> {
  const actual = await usuarioActual();
  if (!actual) {
    redirect("/ingresar");
  }
  return actual;
}
