import "server-only";

import { sql } from "drizzle-orm";

import { obtenerDb } from "./cliente";

export type EstadoDeLaBase =
  | { ok: true; version: string; latenciaMs: number }
  | { ok: false; error: string };

/**
 * Verifica que la base responda. Es lo que mira el paso 1 de la entrega 6.1 ("la app
 * levanta y se conecta a la base"), y queda como chequeo de salud del despliegue.
 *
 * Nunca lanza: un error de conexión se devuelve como dato, para mostrarlo.
 */
export async function verificarBase(): Promise<EstadoDeLaBase> {
  const inicio = performance.now();

  try {
    const resultado = await obtenerDb().execute<{ version: string }>(sql`select version()`);
    const version = resultado.rows[0]?.version ?? "desconocida";

    return { ok: true, version, latenciaMs: Math.round(performance.now() - inicio) };
  } catch (error) {
    return { ok: false, error: describir(error) };
  }
}

/**
 * Drizzle envuelve los errores del driver en "Failed query: ..."; la causa real (conexión
 * rechazada, credenciales, SSL) viene en `cause`.
 */
function describir(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const causa = error.cause instanceof Error ? error.cause : undefined;
  return causa ? `${causa.message} (${error.message.split("\n")[0]})` : error.message;
}
