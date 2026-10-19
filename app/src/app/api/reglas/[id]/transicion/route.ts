import { z } from "zod";

import { obtenerDb } from "@/db/cliente";
import { aplicarTransicion } from "@/transiciones/aplicarTransicion";
import { prepararPedido } from "@/transiciones/http";
import { pedidoIndividual } from "@/transiciones/pedidos";
import { error, responder } from "@/transiciones/respuestas";

/**
 * Cambia el estado de una regla (transición individual). Cuerpo:
 *
 *   { "desde": "aRevisar", "hacia": "incorporada", "justificacion": "...",
 *     "severidad": "MAJOR", "parametros": { "max": "5" } }
 *
 * `desde` es el estado en que el usuario vio la regla. Respuestas: src/transiciones/respuestas.ts.
 */
export async function POST(pedido: Request, ctx: RouteContext<"/api/reglas/[id]/transicion">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return error(404, "noEncontradas", "Alguna de las reglas no existe.", { reglaIds: [id] });
  }

  const preparado = await prepararPedido(pedido, pedidoIndividual);
  if ("respuesta" in preparado) {
    return preparado.respuesta;
  }
  const { usuario, cuerpo } = preparado;

  const resultado = await aplicarTransicion(obtenerDb(), usuario, {
    reglas: [{ id, desde: cuerpo.desde }],
    hacia: cuerpo.hacia,
    justificacion: cuerpo.justificacion,
    severidad: cuerpo.severidad,
    parametros: cuerpo.parametros,
    masiva: false,
  });
  return responder(resultado);
}
