import { timingSafeEqual } from "node:crypto";

import { connection } from "next/server";

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

  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    return Response.json({ error: "Falta la variable de entorno CRON_SECRET." }, { status: 500 });
  }
  if (!autorizado(pedido.headers.get("authorization"), `Bearer ${secreto}`)) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
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

/** Compara en tiempo constante, para no dar pistas del secreto por lo que tarda. */
function autorizado(recibido: string | null, esperado: string): boolean {
  const a = Buffer.from(recibido ?? "");
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
