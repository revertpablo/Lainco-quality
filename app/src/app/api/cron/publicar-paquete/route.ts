import { connection } from "next/server";

import { autorizarCron } from "@/app/api/cron/autorizar";
import { obtenerDb } from "@/db/cliente";
import { clienteGitHubDesdeEntorno } from "@/github/configuracion";
import { baseDelPr } from "@/paquete/configuracion";
import { publicarPaquete } from "@/paquete/publicar";

/**
 * Reintento diario de lo pendiente de pasar al PR de configuración (entrega 6.4, paso 6),
 * disparado por Vercel Cron (vercel.json). Lo normal es que cada decisión lo actualice al
 * tomarla; esto levanta lo que quedó pendiente porque GitHub falló.
 *
 * Mismo control que los otros crons: sin `Authorization: Bearer <CRON_SECRET>`, 401.
 * Responde 200 con el resumen, aunque haya fallado (queda en cada publicación), y 500 si no
 * se pudo ni empezar.
 */

export const maxDuration = 60;

export async function GET(pedido: Request) {
  await connection();

  const rechazo = autorizarCron(pedido);
  if (rechazo) {
    return rechazo;
  }

  let github;
  try {
    github = clienteGitHubDesdeEntorno();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  return Response.json(await publicarPaquete({ db: obtenerDb(), github, base: baseDelPr() }));
}
