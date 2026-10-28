"use client";

import type { ResultadoDelBoton } from "@/sincronizacion/acciones";

import { BotonAccion } from "./BotonAccion";

/** Botón que dispara la sincronización con Sonar y muestra el resultado al lado. */
export function BotonSincronizar({ accion }: { accion: () => Promise<ResultadoDelBoton> }) {
  return <BotonAccion accion={accion} texto="Sincronizar ahora" enCurso="Sincronizando…" />;
}
