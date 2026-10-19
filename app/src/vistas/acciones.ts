"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { leerFiltros } from "@/dominio/filtros";

import { borrarVista, guardarVista, LARGO_MAXIMO_DEL_NOMBRE } from "./vistas";

export interface ResultadoDeVista {
  ok: boolean;
  mensaje: string;
}

const pedidoDeGuardar = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre de la vista.").max(LARGO_MAXIMO_DEL_NOMBRE),
  parametros: z.string().max(5_000),
  compartida: z.boolean(),
});

/** Guarda la búsqueda actual del inventario con un nombre (o actualiza la vista con ese nombre). */
export async function guardarVistaActual(_anterior: ResultadoDeVista | null, datos: FormData): Promise<ResultadoDeVista> {
  const usuario = await exigirUsuario();

  const pedido = pedidoDeGuardar.safeParse({
    nombre: datos.get("nombre") ?? "",
    parametros: datos.get("parametros") ?? "",
    compartida: datos.get("compartida") === "on",
  });
  if (!pedido.success) {
    return { ok: false, mensaje: pedido.error.issues[0].message };
  }

  const { nombre, parametros, compartida } = pedido.data;
  const { resultado } = await guardarVista(obtenerDb(), usuario.id, {
    nombre,
    filtros: leerFiltros(new URLSearchParams(parametros)),
    compartida,
  });

  refresh();
  return {
    ok: true,
    mensaje: resultado === "creada" ? `Se guardó la vista "${nombre}".` : `Se actualizó la vista "${nombre}".`,
  };
}

/** Borra una vista propia. Una de otro usuario no se borra. */
export async function borrarVistaPropia(datos: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  const id = z.uuid().safeParse(datos.get("id"));
  if (id.success) {
    await borrarVista(obtenerDb(), usuario.id, id.data);
    refresh();
  }
}
