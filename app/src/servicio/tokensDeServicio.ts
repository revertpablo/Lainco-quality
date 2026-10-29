import { and, asc, eq, isNull } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { tokenServicio } from "@/db/esquema";
import type { AlcanceToken } from "@/dominio/valores";

import { generarToken, hashDeToken } from "./token";

/**
 * Los tokens de servicio en la base (entrega 6.5, paso 1, decisión E5): crearlos,
 * darlos de baja, listarlos y validarlos.
 *
 * Reciben la base por parámetro y no importan "server-only": los usa también el script
 * scripts/token-servicio.ts, que corre fuera de Next.
 */

/** El máximo de días de vigencia, como los tokens de GitHub de la decisión R2. */
export const DIAS_MAXIMOS = 365;

export class ErrorDeTokenServicio extends Error {}

export interface TokenCreado {
  /** El token: se muestra una sola vez y no se guarda. */
  token: string;
  nombre: string;
  prefijo: string;
  expiraEn: Date;
}

export async function crearTokenServicio(
  db: Db,
  { nombre, alcance, dias, ahora = new Date() }: { nombre: string; alcance: AlcanceToken; dias: number; ahora?: Date },
): Promise<TokenCreado> {
  const limpio = nombre.trim();
  if (limpio === "") {
    throw new ErrorDeTokenServicio("El token necesita un nombre que diga para qué es.");
  }
  if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_MAXIMOS) {
    throw new ErrorDeTokenServicio(`El token tiene que vencer entre 1 y ${DIAS_MAXIMOS} días después de crearlo.`);
  }

  const [existente] = await db.select({ id: tokenServicio.id }).from(tokenServicio).where(eq(tokenServicio.nombre, limpio));
  if (existente) {
    throw new ErrorDeTokenServicio(`Ya existe un token llamado "${limpio}". Para reemplazarlo, dalo de baja y creá otro con otro nombre.`);
  }

  const { token, hash, prefijo } = generarToken();
  const expiraEn = new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1000);
  await db.insert(tokenServicio).values({ nombre: limpio, alcance, hash, prefijo, creadoEn: ahora, expiraEn });
  return { token, nombre: limpio, prefijo, expiraEn };
}

/** Lo da de baja. Devuelve false si no existe o ya estaba dado de baja. */
export async function revocarTokenServicio(db: Db, nombre: string, ahora = new Date()): Promise<boolean> {
  const dados = await db
    .update(tokenServicio)
    .set({ revocadoEn: ahora })
    .where(and(eq(tokenServicio.nombre, nombre.trim()), isNull(tokenServicio.revocadoEn)))
    .returning({ id: tokenServicio.id });
  return dados.length > 0;
}

export type EstadoDeToken = "vigente" | "vencido" | "revocado";

export interface TokenListado {
  nombre: string;
  alcance: AlcanceToken;
  prefijo: string;
  estado: EstadoDeToken;
  creadoEn: Date;
  expiraEn: Date;
  ultimoUsoEn: Date | null;
  revocadoEn: Date | null;
}

/** Todos los tokens, por nombre, sin el hash. */
export async function listarTokensServicio(db: Db, ahora = new Date()): Promise<TokenListado[]> {
  const filas = await db
    .select({
      nombre: tokenServicio.nombre,
      alcance: tokenServicio.alcance,
      prefijo: tokenServicio.prefijo,
      creadoEn: tokenServicio.creadoEn,
      expiraEn: tokenServicio.expiraEn,
      ultimoUsoEn: tokenServicio.ultimoUsoEn,
      revocadoEn: tokenServicio.revocadoEn,
    })
    .from(tokenServicio)
    .orderBy(asc(tokenServicio.nombre));
  return filas.map((f) => ({ ...f, estado: estadoDeToken(f, ahora) }));
}

function estadoDeToken(token: { expiraEn: Date; revocadoEn: Date | null }, ahora: Date): EstadoDeToken {
  if (token.revocadoEn) {
    return "revocado";
  }
  return token.expiraEn.getTime() <= ahora.getTime() ? "vencido" : "vigente";
}

export type ValidacionDeToken =
  | { valido: true; id: string; nombre: string }
  | { valido: false; motivo: "desconocido" | "vencido" | "revocado" | "otroAlcance" };

/**
 * Si el token sirve para el alcance pedido. Cuando sirve, registra el uso: así el listado
 * muestra si el job lo sigue usando.
 */
export async function validarTokenServicio(db: Db, token: string, alcance: AlcanceToken, ahora = new Date()): Promise<ValidacionDeToken> {
  const [fila] = await db.select().from(tokenServicio).where(eq(tokenServicio.hash, hashDeToken(token)));
  if (!fila) {
    return { valido: false, motivo: "desconocido" };
  }
  const estado = estadoDeToken(fila, ahora);
  if (estado !== "vigente") {
    return { valido: false, motivo: estado };
  }
  if (fila.alcance !== alcance) {
    return { valido: false, motivo: "otroAlcance" };
  }
  await db.update(tokenServicio).set({ ultimoUsoEn: ahora }).where(eq(tokenServicio.id, fila.id));
  return { valido: true, id: fila.id, nombre: fila.nombre };
}
