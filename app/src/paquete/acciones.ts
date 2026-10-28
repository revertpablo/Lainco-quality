"use server";

import { refresh } from "next/cache";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { Rol } from "@/dominio/valores";
import { clienteGitHubDesdeEntorno } from "@/github/configuracion";

import { baseDelPr } from "./configuracion";
import { publicarPaquete, reintentarFallidasDelPaquete } from "./publicar";
import { describirPublicacionDelPaquete, describirRevision } from "./resumen";
import { revisarPaquete } from "./revisar";

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

/**
 * Botón "Revisar ahora" de la pantalla Paquete (entrega 6.4, paso 7): trae el estado de los
 * PRs y compara main con la app. Cualquier usuario con sesión: solo mira y anota.
 */
export async function revisarPaqueteAhora(): Promise<{ ok: boolean; mensaje: string }> {
  const usuario = await exigirUsuario();

  let github;
  try {
    github = clienteGitHubDesdeEntorno();
  } catch (e) {
    return { ok: false, mensaje: (e as Error).message };
  }

  const resumen = await revisarPaquete({ db: obtenerDb(), github, base: baseDelPr(), disparadaPorId: usuario.id });
  refresh();
  return { ok: resumen.estado === "ok", mensaje: describirRevision(resumen) };
}

/**
 * Botón "Abrir el PR" del desvío del paquete: lleva main a lo que dice la app con un PR de
 * configuración, aunque no haya nada pendiente, y vuelve a revisar. Solo un decisor: el PR
 * puede apagar reglas que alguien encendió a mano en main.
 */
export async function corregirDesvioDelPaqueteAhora(): Promise<{ ok: boolean; mensaje: string }> {
  const usuario = await exigirUsuario();
  if (usuario.rol !== Rol.Decisor) {
    return { ok: false, mensaje: "Solo un decisor puede corregir un desvío." };
  }

  let github;
  try {
    github = clienteGitHubDesdeEntorno();
  } catch (e) {
    return { ok: false, mensaje: (e as Error).message };
  }

  const db = obtenerDb();
  const publicado = await publicarPaquete({ db, github, base: baseDelPr(), sinEsperar: true, forzar: true });
  if (publicado.error) {
    refresh();
    return { ok: false, mensaje: `No se pudo abrir el PR: ${publicado.error}` };
  }
  await revisarPaquete({ db, github, base: baseDelPr(), disparadaPorId: usuario.id });
  refresh();
  return {
    ok: true,
    mensaje: publicado.pr ? `PR #${publicado.pr.numero} abierto (Lainco.Analyzers ${publicado.version}).` : "main ya tenía el .globalconfig de la app.",
  };
}
