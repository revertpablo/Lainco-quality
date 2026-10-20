"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { exigirUsuario } from "@/auth/sesion";
import { MENSAJES_DE_RECHAZO } from "@/dominio/transiciones";
import { aplicarYPublicar } from "@/transiciones/aplicarYPublicar";
import { pedidoIndividual } from "@/transiciones/pedidos";

export interface ResultadoDeCambio {
  ok: boolean;
  mensaje: string;
  motivos?: string[];
}

/**
 * Cambio de estado de una regla desde su detalle. Es la única forma de incorporar: hacia
 * Incorporada no hay operación masiva. Valida igual que `POST /api/reglas/{id}/transicion`
 * y pasa por `aplicarTransicion`.
 *
 * Los parámetros llegan como campos `parametro.<clave>`; los vacíos no se mandan (la regla
 * usa su valor por defecto).
 */
export async function cambiarEstadoDeRegla(_anterior: ResultadoDeCambio | null, datos: FormData): Promise<ResultadoDeCambio> {
  const usuario = await exigirUsuario();

  const reglaId = z.uuid().safeParse(datos.get("reglaId"));
  if (!reglaId.success) {
    return { ok: false, mensaje: "La regla no existe." };
  }

  const texto = (nombre: string) => {
    const valor = datos.get(nombre);
    return typeof valor === "string" && valor.trim() !== "" ? valor : undefined;
  };
  const parametros = Object.fromEntries(
    [...datos.entries()]
      .filter(([clave, valor]) => clave.startsWith("parametro.") && typeof valor === "string" && valor.trim() !== "")
      .map(([clave, valor]) => [clave.slice("parametro.".length), (valor as string).trim()]),
  );

  const pedido = pedidoIndividual.safeParse({
    desde: datos.get("desde"),
    hacia: datos.get("hacia"),
    justificacion: texto("justificacion"),
    severidad: texto("severidad"),
    parametros: Object.keys(parametros).length > 0 ? parametros : undefined,
  });
  if (!pedido.success) {
    return { ok: false, mensaje: pedido.error.issues.map((i) => i.message).join(" ") };
  }

  const resultado = await aplicarYPublicar(usuario, {
    reglas: [{ id: reglaId.data, desde: pedido.data.desde }],
    hacia: pedido.data.hacia,
    justificacion: pedido.data.justificacion,
    severidad: pedido.data.severidad,
    parametros: pedido.data.parametros,
    masiva: false,
  });

  if (resultado.ok) {
    refresh();
    return { ok: true, mensaje: "Se cambió el estado." };
  }
  switch (resultado.tipo) {
    case "noEncontradas":
      return { ok: false, mensaje: "La regla no existe." };
    case "estadoCambio":
      refresh();
      return { ok: false, mensaje: "Alguien cambió el estado de la regla mientras tanto. Se actualizó la página: revisá el historial." };
    case "rechazada":
      return {
        ok: false,
        mensaje: "No se cambió el estado.",
        motivos: resultado.rechazos[0].motivos.map((m) => MENSAJES_DE_RECHAZO[m]),
      };
  }
}
