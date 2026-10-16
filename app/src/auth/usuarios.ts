import "server-only";

import { eq } from "drizzle-orm";

import { obtenerDb } from "@/db/cliente";
import { usuario } from "@/db/esquema";
import {
  claveDeBusqueda,
  decidirIngreso,
  type Identidad,
  type MotivoDeIngresoRechazado,
  type UsuarioRegistrado,
} from "@/dominio/acceso";

export type ResultadoDeIngreso =
  | { permitido: true; usuarioId: string }
  | { permitido: false; motivo: MotivoDeIngresoRechazado };

/**
 * Busca a la persona en `usuario`, decide si entra (src/dominio/acceso.ts) y, si es
 * alguien del dominio que entra por primera vez con Google, la da de alta.
 */
export async function resolverIngreso(identidad: Identidad): Promise<ResultadoDeIngreso> {
  const clave = claveDeBusqueda(identidad);
  const registrado = clave ? await buscarUsuario(clave) : undefined;
  const decision = decidirIngreso(identidad, registrado);

  if (!decision.permitido) {
    return decision;
  }
  if ("usuarioId" in decision) {
    return { permitido: true, usuarioId: decision.usuarioId };
  }

  // Si dos ingresos del mismo usuario nuevo llegan a la vez, el segundo no inserta y
  // toma el usuario que creó el primero.
  const [creado] = await obtenerDb()
    .insert(usuario)
    .values(decision.alta)
    .onConflictDoNothing({ target: usuario.email })
    .returning({ id: usuario.id });

  if (creado) {
    return { permitido: true, usuarioId: creado.id };
  }

  const existente = await buscarUsuario({ email: decision.alta.email });
  const final = decidirIngreso(identidad, existente);
  if (final.permitido && !("usuarioId" in final)) {
    throw new Error("No se pudo dar de alta el usuario.");
  }
  return final;
}

async function buscarUsuario(clave: NonNullable<ReturnType<typeof claveDeBusqueda>>) {
  const condicion = "email" in clave ? eq(usuario.email, clave.email) : eq(usuario.githubLogin, clave.githubLogin);

  const [encontrado] = await obtenerDb()
    .select({ id: usuario.id, rol: usuario.rol, activo: usuario.activo })
    .from(usuario)
    .where(condicion)
    .limit(1);

  return encontrado satisfies UsuarioRegistrado | undefined;
}
