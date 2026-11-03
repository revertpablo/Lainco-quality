"use server";

import { refresh } from "next/cache";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { Rol, type OrigenDePaquete } from "@/dominio/valores";
import { clienteGitHubDesdeEntorno } from "@/github/configuracion";

import { baseDelPr } from "./configuracion";
import { PAQUETES, paqueteDe } from "./paquetes";
import { publicarPaquete, reintentarFallidasDelPaquete } from "./publicar";
import { describirPublicacionDelPaquete, describirRevision } from "./resumen";
import { revisarPaquete } from "./revisar";

/**
 * Botón "Publicar en el paquete" (entrega 6.4, paso 6): vuelve a poner pendientes las
 * publicaciones al paquete que fallaron y arma o actualiza el PR de configuración ya, sin
 * esperar los reintentos programados. Cualquier usuario con sesión: no decide nada.
 * Publica los dos paquetes, cada uno con su PR (entrega 6.4, parte ESLint).
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
  const resultados = [];
  for (const paquete of PAQUETES) {
    const resumen = await publicarPaquete({ db, github, base: baseDelPr(), sinEsperar: true, paquete });
    resultados.push({ resumen, texto: `${paquete.nombre}: ${describirPublicacionDelPaquete(resumen, paquete)}` });
  }
  refresh();
  return { ok: resultados.every((r) => r.resumen.error === null), mensaje: resultados.map((r) => r.texto).join(" ") };
}

/**
 * Botón "Revisar ahora" de la pantalla Paquete (entrega 6.4, paso 7): trae el estado de los
 * PRs y compara main con la app, en los dos paquetes. Cualquier usuario con sesión: solo
 * mira y anota.
 */
export async function revisarPaqueteAhora(): Promise<{ ok: boolean; mensaje: string }> {
  const usuario = await exigirUsuario();

  let github;
  try {
    github = clienteGitHubDesdeEntorno();
  } catch (e) {
    return { ok: false, mensaje: (e as Error).message };
  }

  const resultados = [];
  for (const paquete of PAQUETES) {
    const resumen = await revisarPaquete({ db: obtenerDb(), github, base: baseDelPr(), disparadaPorId: usuario.id, paquete });
    resultados.push({ resumen, texto: `${paquete.nombre}: ${describirRevision(resumen, paquete.archivo)}` });
  }
  refresh();
  return { ok: resultados.every((r) => r.resumen.estado === "ok"), mensaje: resultados.map((r) => r.texto).join(" ") };
}

/**
 * Botón "Abrir el PR" del desvío del paquete: lleva main a lo que dice la app con un PR de
 * configuración, aunque no haya nada pendiente, y vuelve a revisar. Solo un decisor: el PR
 * puede apagar reglas que alguien encendió a mano en main. Recibe de qué paquete es el desvío.
 */
export async function corregirDesvioDelPaqueteAhora(origen: OrigenDePaquete): Promise<{ ok: boolean; mensaje: string }> {
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
  const paquete = paqueteDe(origen);
  const publicado = await publicarPaquete({ db, github, base: baseDelPr(), sinEsperar: true, forzar: true, paquete });
  if (publicado.error) {
    refresh();
    return { ok: false, mensaje: `No se pudo abrir el PR: ${publicado.error}` };
  }
  await revisarPaquete({ db, github, base: baseDelPr(), disparadaPorId: usuario.id, paquete });
  refresh();
  return {
    ok: true,
    mensaje: publicado.pr
      ? `PR #${publicado.pr.numero} abierto (${paquete.nombre} ${publicado.version}).`
      : `main ya tenía el ${paquete.archivo} de la app.`,
  };
}
