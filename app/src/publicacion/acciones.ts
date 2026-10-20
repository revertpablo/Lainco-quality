"use server";

import { refresh } from "next/cache";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { clienteSonarDesdeEntorno, perfilesDesdeEntorno } from "@/sonar/configuracion";

import { publicarPendientes, reintentarFallidas } from "./publicar";
import { describirPublicacion } from "./resumen";

export interface ResultadoDePublicar {
  ok: boolean;
  mensaje: string;
}

/**
 * Botón "Publicar pendientes" (entrega 6.2, paso 4; la pantalla, paso 6): vuelve a poner
 * pendientes las fallidas que siguen siendo la última palabra sobre su regla y publica
 * todo lo pendiente ya, sin esperar los reintentos programados.
 *
 * Lo puede usar cualquier usuario con sesión: no decide nada, publica lo que ya se decidió.
 */
export async function publicarPendientesAhora(): Promise<ResultadoDePublicar> {
  await exigirUsuario();

  let configuracion;
  try {
    configuracion = { sonar: clienteSonarDesdeEntorno(), perfiles: perfilesDesdeEntorno() };
  } catch (e) {
    return { ok: false, mensaje: (e as Error).message };
  }

  const db = obtenerDb();
  await reintentarFallidas(db);
  const resumen = await publicarPendientes({ db, ...configuracion, sinEsperar: true });
  refresh();
  return { ok: resumen.errores.length === 0, mensaje: describirPublicacion(resumen) };
}
