import { connection } from "next/server";

import { autorizarCron } from "@/app/api/cron/autorizar";
import { obtenerDb } from "@/db/cliente";
import { sincronizarSonar } from "@/sincronizacion/sincronizarSonar";
import { clienteSonarDesdeEntorno } from "@/sonar/configuracion";

/**
 * Sincronización diaria con Sonar, disparada por Vercel Cron (vercel.json).
 *
 * Vercel manda `Authorization: Bearer <CRON_SECRET>`. Sin ese encabezado, o con otro
 * valor, responde 401: la ruta no pide sesión (proxy la deja pasar) y nadie más la puede
 * disparar. Responde 200 con el resumen si la corrida terminó bien y 500 si no.
 */

// Por las dudas: la sincronización completa tarda segundos, pero depende de Sonar.
export const maxDuration = 300;

export async function GET(pedido: Request) {
  await connection();

  const rechazo = autorizarCron(pedido);
  if (rechazo) {
    return rechazo;
  }

  let sonar;
  try {
    sonar = clienteSonarDesdeEntorno();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const resumen = await sincronizarSonar({ db: obtenerDb(), sonar });
  return Response.json(resumen, { status: resumen.estado === "ok" ? 200 : 500 });
}
