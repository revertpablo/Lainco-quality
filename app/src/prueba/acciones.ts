"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { EvaluacionMuestra } from "@/dominio/valores";

import { evaluarMuestra } from "./evaluar";

/**
 * Evaluar una muestra desde el detalle de una regla en prueba (entrega 6.5, paso 6).
 * Cualquier usuario con sesión: la evalúa el equipo (FASE-6.md, sección 8); la decisión de
 * incorporar sigue siendo de un decisor.
 */
export async function evaluarMuestraAhora(muestraId: string, evaluacion: EvaluacionMuestra): Promise<{ ok: boolean; mensaje: string }> {
  const usuario = await exigirUsuario();
  if (!z.uuid().safeParse(muestraId).success || !Object.values(EvaluacionMuestra).includes(evaluacion)) {
    return { ok: false, mensaje: "Evaluación inválida." };
  }
  const evaluada = await evaluarMuestra(obtenerDb(), { muestraId, evaluacion, usuarioId: usuario.id });
  refresh();
  return evaluada ? { ok: true, mensaje: "Guardado." } : { ok: false, mensaje: "La muestra ya no existe." };
}
