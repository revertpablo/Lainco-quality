import { timingSafeEqual } from "node:crypto";

/**
 * Control de las rutas de cron: Vercel manda `Authorization: Bearer <CRON_SECRET>`. Sin ese
 * encabezado, o con otro valor, 401: las rutas no piden sesión (proxy las deja pasar) y
 * nadie más las puede disparar. Devuelve la respuesta de rechazo, o `null` si está
 * autorizado.
 */
export function autorizarCron(pedido: Request): Response | null {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    return Response.json({ error: "Falta la variable de entorno CRON_SECRET." }, { status: 500 });
  }
  if (!igualesEnTiempoConstante(pedido.headers.get("authorization"), `Bearer ${secreto}`)) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  return null;
}

/** Compara en tiempo constante, para no dar pistas del secreto por lo que tarda. */
function igualesEnTiempoConstante(recibido: string | null, esperado: string): boolean {
  const a = Buffer.from(recibido ?? "");
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
