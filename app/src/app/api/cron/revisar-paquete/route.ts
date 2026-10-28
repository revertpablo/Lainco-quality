import { connection } from "next/server";

import { autorizarCron } from "@/app/api/cron/autorizar";
import { obtenerDb } from "@/db/cliente";
import { clienteGitHubDesdeEntorno } from "@/github/configuracion";
import { baseDelPr } from "@/paquete/configuracion";
import { revisarPaquete } from "@/paquete/revisar";

/**
 * Revisión diaria del paquete (entrega 6.4, paso 7), disparada por Vercel Cron
 * (vercel.json): el estado de los PRs de configuración y si main coincide con la app.
 *
 * Mismo control que los otros crons: sin `Authorization: Bearer <CRON_SECRET>`, 401.
 * Responde 200 con el resumen si la revisión terminó bien y 500 si no.
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

  const resumen = await revisarPaquete({ db: obtenerDb(), github, base: baseDelPr() });
  return Response.json(resumen, { status: resumen.estado === "ok" ? 200 : 500 });
}
