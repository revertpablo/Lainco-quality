import { connection } from "next/server";

import { autorizarCron } from "@/app/api/cron/autorizar";
import { obtenerDb } from "@/db/cliente";
import { publicarPendientes } from "@/publicacion/publicar";
import { clienteSonarDesdeEntorno, perfilesDesdeEntorno } from "@/sonar/configuracion";

/**
 * Reintento diario de las publicaciones pendientes en Sonar, disparado por Vercel Cron
 * (vercel.json; entrega 6.2, paso 4). Lo normal es que cada decisión se publique sola al
 * tomarla; esto levanta lo que quedó pendiente porque Sonar falló.
 *
 * Mismo control que la sincronización: sin `Authorization: Bearer <CRON_SECRET>`, 401.
 * Responde 200 con el resumen, aunque alguna publicación haya fallado (queda registrado en
 * cada una), y 500 si no se pudo ni empezar.
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

  return Response.json(await publicarPendientes({ db: obtenerDb(), ...configuracion }));
}
