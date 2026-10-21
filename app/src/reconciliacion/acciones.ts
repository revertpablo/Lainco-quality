"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { publicarDespuesDeResponder } from "@/publicacion/segundoPlano";
import { clienteSonarDesdeEntorno, perfilesDesdeEntorno } from "@/sonar/configuracion";

import { corregirDesvio, MENSAJES_DE_CORRECCION } from "./corregir";
import { reconciliar } from "./reconciliar";
import { describirReconciliacion } from "./resumen";

export interface ResultadoDeAccion {
  ok: boolean;
  mensaje: string;
}

/**
 * Botón "Reconciliar ahora" (entrega 6.2, paso 5; la pantalla, paso 6). Lo puede usar
 * cualquier usuario con sesión: solo mira Sonar y anota diferencias.
 */
export async function reconciliarAhora(): Promise<ResultadoDeAccion> {
  const usuario = await exigirUsuario();

  let configuracion;
  try {
    configuracion = { sonar: clienteSonarDesdeEntorno(), perfiles: perfilesDesdeEntorno() };
  } catch (e) {
    return { ok: false, mensaje: (e as Error).message };
  }

  const resumen = await reconciliar({ db: obtenerDb(), ...configuracion, disparadaPorId: usuario.id });
  refresh();
  return { ok: resumen.estado === "ok", mensaje: describirReconciliacion(resumen) };
}

/** Botón "Corregir" de un desvío: solo un decisor (src/reconciliacion/corregir.ts). */
export async function corregirDesvioAhora(desvioId: unknown): Promise<ResultadoDeAccion> {
  const usuario = await exigirUsuario();
  const id = z.uuid().safeParse(desvioId);
  if (!id.success) {
    return { ok: false, mensaje: MENSAJES_DE_CORRECCION.noEncontrado };
  }

  const resultado = await corregirDesvio(obtenerDb(), usuario, id.data);
  if (!resultado.ok) {
    return { ok: false, mensaje: MENSAJES_DE_CORRECCION[resultado.motivo] };
  }
  publicarDespuesDeResponder([resultado.publicacionId]);
  refresh();
  return { ok: true, mensaje: "Se va a publicar en Sonar lo que dice la app." };
}
