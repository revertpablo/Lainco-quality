import { aplicarYPublicar } from "@/transiciones/aplicarYPublicar";
import { prepararPedido } from "@/transiciones/http";
import { pedidoMasivo } from "@/transiciones/pedidos";
import { responder } from "@/transiciones/respuestas";

/**
 * Operación masiva: el mismo cambio de estado sobre varias reglas, con una justificación
 * común que queda en cada decisión. Nunca hacia Incorporada (FASE-6.md, sección 5). Cuerpo:
 *
 *   { "reglas": [{ "id": "...", "desde": "pendienteDeAnalizar" }, ...],
 *     "hacia": "descartada", "justificacion": "..." }
 *
 * Todo o nada: si una regla no puede, no cambia ninguna. Respuestas:
 * src/transiciones/respuestas.ts.
 */
export async function POST(pedido: Request) {
  const preparado = await prepararPedido(pedido, pedidoMasivo);
  if ("respuesta" in preparado) {
    return preparado.respuesta;
  }
  const { usuario, cuerpo } = preparado;

  const resultado = await aplicarYPublicar(usuario, {
    reglas: cuerpo.reglas,
    hacia: cuerpo.hacia,
    justificacion: cuerpo.justificacion,
    masiva: true,
  });
  return responder(resultado);
}
