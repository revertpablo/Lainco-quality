import "server-only";

import { obtenerDb } from "@/db/cliente";
import { publicarDespuesDeResponder } from "@/publicacion/segundoPlano";

import { aplicarTransicion, type Autor, type PedidoDeTransicion, type ResultadoDeTransicion } from "./aplicarTransicion";

/**
 * Lo que usan la API y las Server Actions para cambiar estados: `aplicarTransicion` y,
 * si encoló publicaciones en Sonar, publicarlas después de responder (entrega 6.2,
 * paso 4). `aplicarTransicion` queda sin Next, para poder probarla contra la base.
 */
export async function aplicarYPublicar(autor: Autor, pedido: PedidoDeTransicion): Promise<ResultadoDeTransicion> {
  const resultado = await aplicarTransicion(obtenerDb(), autor, pedido);
  if (resultado.ok) {
    publicarDespuesDeResponder(resultado.publicaciones);
  }
  return resultado;
}
