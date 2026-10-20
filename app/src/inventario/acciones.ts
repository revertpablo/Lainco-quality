"use server";

import { refresh } from "next/cache";

import { exigirUsuario } from "@/auth/sesion";
import { MENSAJES_DE_RECHAZO } from "@/dominio/transiciones";
import { aplicarYPublicar } from "@/transiciones/aplicarYPublicar";
import { pedidoMasivo } from "@/transiciones/pedidos";

export interface ResultadoDeOperacion {
  ok: boolean;
  mensaje: string;
  /** Por qué no se aplicó, regla por regla (id → motivos). */
  rechazos?: { reglaId: string; motivos: string[] }[];
}

/**
 * Operación masiva desde la tabla del inventario. Valida el pedido igual que la API
 * (src/app/api/reglas/transiciones) y pasa por `aplicarTransicion`: mismas reglas, mismo
 * todo o nada.
 */
export async function aplicarOperacionMasiva(entrada: unknown): Promise<ResultadoDeOperacion> {
  const usuario = await exigirUsuario();

  const pedido = pedidoMasivo.safeParse(entrada);
  if (!pedido.success) {
    return { ok: false, mensaje: pedido.error.issues.map((i) => i.message).join(" ") };
  }

  const resultado = await aplicarYPublicar(usuario, { ...pedido.data, masiva: true });

  if (resultado.ok) {
    refresh();
    const n = resultado.decisiones.length;
    return { ok: true, mensaje: n === 1 ? "Se cambió 1 regla." : `Se cambiaron ${n} reglas.` };
  }

  switch (resultado.tipo) {
    case "noEncontradas":
      refresh();
      return { ok: false, mensaje: "Alguna de las reglas ya no existe. Se actualizó la lista." };
    case "estadoCambio":
      refresh();
      return {
        ok: false,
        mensaje: `${resultado.reglas.length === 1 ? "Una regla cambió" : `${resultado.reglas.length} reglas cambiaron`} de estado mientras tanto. No se aplicó ningún cambio; se actualizó la lista.`,
      };
    case "rechazada":
      return {
        ok: false,
        mensaje: "No se aplicó ningún cambio.",
        rechazos: resultado.rechazos.map((r) => ({
          reglaId: r.reglaId,
          motivos: r.motivos.map((m) => MENSAJES_DE_RECHAZO[m]),
        })),
      };
  }
}
