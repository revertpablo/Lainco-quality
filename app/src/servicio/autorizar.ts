import "server-only";

import { obtenerDb, type Db } from "@/db/cliente";
import type { AlcanceToken } from "@/dominio/valores";

import { leerTokenDelPedido } from "./token";
import { validarTokenServicio } from "./tokensDeServicio";

/**
 * Control de las rutas de /api/ci/ (entrega 6.5, paso 1, decisión E5): las llama un job de
 * CI con un token de servicio en `Authorization: Bearer lqs_...`. No piden sesión (el proxy
 * las deja pasar), como las de /api/cron/.
 *
 * Devuelve quién es, o la respuesta de rechazo. El rechazo es siempre el mismo 401, sin
 * decir si el token no existe, venció o se dio de baja: no da pistas sobre qué tokens hay.
 * El motivo queda en el log del servidor.
 */
export async function autorizarServicio(
  pedido: Request,
  alcance: AlcanceToken,
  { db = obtenerDb(), ahora = new Date() }: { db?: Db; ahora?: Date } = {},
): Promise<{ autorizado: true; tokenId: string; nombre: string } | Response> {
  const token = leerTokenDelPedido(pedido);
  const validacion = token ? await validarTokenServicio(db, token, alcance, ahora) : ({ valido: false, motivo: "sinToken" } as const);
  if (!validacion.valido) {
    console.warn(`Pedido a ${new URL(pedido.url).pathname} rechazado: token ${validacion.motivo}.`);
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  return { autorizado: true, tokenId: validacion.id, nombre: validacion.nombre };
}
