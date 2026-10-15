import { connection } from "next/server";

import { verificarBase } from "@/db/salud";

/**
 * GET /api/salud — estado de la app y de su conexión a la base.
 *
 * 200 si la base responde, 503 si no. Sirve para verificar un despliegue sin tener que
 * iniciar sesión, así que no expone datos: solo si la base contesta y cuánto tarda.
 */
export async function GET() {
  // Con Cache Components, sin esto Next intentaría prerenderizar la respuesta en el build.
  await connection();

  const base = await verificarBase();

  return Response.json(
    base.ok
      ? { estado: "ok", base: { ok: true, latenciaMs: base.latenciaMs } }
      : { estado: "error", base: { ok: false } },
    { status: base.ok ? 200 : 503 },
  );
}
