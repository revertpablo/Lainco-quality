"use server";

import { refresh } from "next/cache";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { clienteSonarDesdeEntorno } from "@/sonar/configuracion";

import { describirResumen } from "./resumen";
import { sincronizarSonar } from "./sincronizarSonar";

export interface ResultadoDelBoton {
  ok: boolean;
  mensaje: string;
}

/**
 * Botón "Sincronizar ahora" (FASE-6.md, sección 3: "ejecutable a demanda desde la app").
 * Lo puede usar cualquier usuario con sesión: no cambia el estado de ninguna regla.
 */
export async function sincronizarAhora(): Promise<ResultadoDelBoton> {
  const usuario = await exigirUsuario();

  let sonar;
  try {
    sonar = clienteSonarDesdeEntorno();
  } catch (e) {
    return { ok: false, mensaje: (e as Error).message };
  }

  const resumen = await sincronizarSonar({ db: obtenerDb(), sonar, disparadaPorId: usuario.id });
  refresh();
  return { ok: resumen.estado === "ok", mensaje: describirResumen(resumen) };
}
