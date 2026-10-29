import { manejarResultados } from "@/prueba/http";

/**
 * El job de prueba manda el resultado de un repositorio (entrega 6.5, paso 5). Con un token
 * de servicio de alcance `prueba`; detalle en src/prueba/http.ts y src/prueba/ingesta.ts.
 */

// Un resultado con muchas reglas y ubicaciones se guarda en una transacción: hasta 1 minuto.
export const maxDuration = 60;

export async function POST(pedido: Request, ctx: RouteContext<"/api/ci/prueba/corridas/[id]/resultados">) {
  const { id } = await ctx.params;
  return manejarResultados(pedido, id);
}
