import "server-only";

import type { z } from "zod";

import { usuarioActual, type UsuarioActual } from "@/auth/sesion";

import { error, pedidoInvalido } from "./respuestas";

/**
 * Lo común de los Route Handlers de transiciones: sesión, origen, JSON y forma del cuerpo.
 * Devuelve el usuario y el cuerpo validado, o la respuesta de error.
 *
 * El chequeo de origen y de JSON protege contra CSRF: la sesión va en una cookie, y un
 * formulario de otro sitio no puede mandar `application/json` sin que el navegador lo
 * frene antes.
 */
export async function prepararPedido<T>(
  pedido: Request,
  esquema: z.ZodType<T>,
): Promise<{ usuario: UsuarioActual; cuerpo: T } | { respuesta: Response }> {
  const usuario = await usuarioActual();
  if (!usuario) {
    return { respuesta: error(401, "sinSesion", "Hace falta iniciar sesión.") };
  }

  const origen = pedido.headers.get("origin");
  if (origen && new URL(origen).host !== new URL(pedido.url).host) {
    return { respuesta: error(403, "otroOrigen", "El pedido viene de otro sitio.") };
  }

  if (!pedido.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { respuesta: error(415, "noEsJson", "El cuerpo tiene que ser JSON.") };
  }

  let json: unknown;
  try {
    json = await pedido.json();
  } catch {
    return { respuesta: error(400, "pedidoInvalido", "El cuerpo no es un JSON válido.") };
  }

  const resultado = esquema.safeParse(json);
  if (!resultado.success) {
    return { respuesta: pedidoInvalido(resultado.error) };
  }

  return { usuario, cuerpo: resultado.data };
}
