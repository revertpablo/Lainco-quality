import { connection } from "next/server";

import { autorizarCron } from "@/app/api/cron/autorizar";
import { obtenerDb } from "@/db/cliente";
import { clienteGitHubDesdeEntorno } from "@/github/configuracion";
import { sincronizarEslint } from "@/sincronizacion/sincronizarEslint";

/**
 * Sincronización diaria de las reglas ESLint con el último release eslint-v* de
 * @lainco/eslint-plugin (entrega 6.4, parte ESLint, paso 1), disparada por Vercel Cron
 * (vercel.json).
 *
 * Como /api/cron/sincronizar-sonar: sin `Authorization: Bearer <CRON_SECRET>` responde
 * 401; responde 200 con el resumen si la corrida terminó bien y 500 si no.
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

  const resumen = await sincronizarEslint({ db: obtenerDb(), github });
  return Response.json(resumen, { status: resumen.estado === "ok" ? 200 : 500 });
}
