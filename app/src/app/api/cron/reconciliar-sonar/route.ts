import { connection } from "next/server";

import { autorizarCron } from "@/app/api/cron/autorizar";
import { obtenerDb } from "@/db/cliente";
import { reconciliar } from "@/reconciliacion/reconciliar";
import { clienteSonarDesdeEntorno, perfilesDesdeEntorno } from "@/sonar/configuracion";

/**
 * Reconciliación diaria con Sonar, disparada por Vercel Cron (vercel.json; entrega 6.2,
 * paso 5): compara el perfil real con la app y deja los desvíos al día.
 *
 * Mismo control que los otros crons: sin `Authorization: Bearer <CRON_SECRET>`, 401.
 * Responde 200 con el resumen si la corrida terminó bien y 500 si no.
 */

export const maxDuration = 300;

export async function GET(pedido: Request) {
  await connection();

  const rechazo = autorizarCron(pedido);
  if (rechazo) {
    return rechazo;
  }

  let configuracion;
  try {
    configuracion = { sonar: clienteSonarDesdeEntorno(), perfiles: perfilesDesdeEntorno() };
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const resumen = await reconciliar({ db: obtenerDb(), ...configuracion });
  return Response.json(resumen, { status: resumen.estado === "ok" ? 200 : 500 });
}
