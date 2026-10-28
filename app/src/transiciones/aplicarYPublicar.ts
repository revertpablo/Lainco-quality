import "server-only";

import { obtenerDb } from "@/db/cliente";
import { DestinoPublicacion } from "@/dominio/valores";
import { publicarPaqueteDespuesDeResponder } from "@/paquete/segundoPlano";
import { publicarDespuesDeResponder } from "@/publicacion/segundoPlano";

import { aplicarTransicion, type Autor, type PedidoDeTransicion, type ResultadoDeTransicion } from "./aplicarTransicion";

/**
 * Lo que usan la API y las Server Actions para cambiar estados: `aplicarTransicion` y,
 * si encoló publicaciones, publicarlas después de responder: en Sonar (entrega 6.2,
 * paso 4) y en el PR de configuración (entrega 6.4, paso 6). `aplicarTransicion` queda sin
 * Next, para poder probarla contra la base.
 */
export async function aplicarYPublicar(autor: Autor, pedido: PedidoDeTransicion): Promise<ResultadoDeTransicion> {
  const resultado = await aplicarTransicion(obtenerDb(), autor, pedido);
  if (resultado.ok) {
    if (resultado.destinos.includes(DestinoPublicacion.PerfilSonar)) {
      publicarDespuesDeResponder(resultado.publicaciones);
    }
    if (resultado.destinos.includes(DestinoPublicacion.PrConfiguracion)) {
      publicarPaqueteDespuesDeResponder();
    }
  }
  return resultado;
}
