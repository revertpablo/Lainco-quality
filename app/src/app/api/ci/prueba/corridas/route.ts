import { manejarAbrirCorrida } from "@/prueba/http";

/**
 * El job de prueba abre una corrida y recibe qué probar (entrega 6.5, paso 3). Con un token
 * de servicio de alcance `prueba`; detalle en src/prueba/http.ts.
 */
export async function POST(pedido: Request) {
  return manejarAbrirCorrida(pedido);
}
