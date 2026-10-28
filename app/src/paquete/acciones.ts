"use server";

import { refresh } from "next/cache";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { clienteGitHubDesdeEntorno } from "@/github/configuracion";

import { baseDelPr } from "./configuracion";
import { publicarPaquete, reintentarFallidasDelPaquete } from "./publicar";
import { describirPublicacionDelPaquete } from "./resumen";

/**
 * Botón "Publicar en el paquete" (entrega 6.4, paso 6): vuelve a poner pendientes las
 * publicaciones al paquete que fallaron y arma o actualiza el PR de configuración ya, sin
 * esperar los reintentos programados. Cualquier usuario con sesión: no decide nada.
 */
export async function publicarPaqueteAhora(): Promise<{ ok: boolean; mensaje: string }> {
  await exigirUsuario();

  let github;
  try {
    github = clienteGitHubDesdeEntorno();
  } catch (e) {
    return { ok: false, mensaje: (e as Error).message };
  }

  const db = obtenerDb();
  await reintentarFallidasDelPaquete(db);
  const resumen = await publicarPaquete({ db, github, base: baseDelPr(), sinEsperar: true });
  refresh();
  return { ok: resumen.error === null, mensaje: describirPublicacionDelPaquete(resumen) };
}
