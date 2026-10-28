"use server";

import { refresh } from "next/cache";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { clienteGitHubDesdeEntorno } from "@/github/configuracion";
import { clienteSonarDesdeEntorno } from "@/sonar/configuracion";

import type { ResumenDeSincronizacion } from "./corrida";
import { describirResumenes } from "./resumen";
import { sincronizarRoslyn } from "./sincronizarRoslyn";
import { sincronizarSonar } from "./sincronizarSonar";

export interface ResultadoDelBoton {
  ok: boolean;
  mensaje: string;
}

/**
 * Botón "Sincronizar ahora" (FASE-6.md, sección 3: "ejecutable a demanda desde la app"):
 * sincroniza todos los orígenes, Sonar y Roslyn (entrega 6.4), a la vez. Lo puede usar
 * cualquier usuario con sesión: no cambia el estado de ninguna regla.
 *
 * Si falta la configuración de un origen, ese origen dice por qué y el otro se sincroniza
 * igual.
 */
export async function sincronizarAhora(): Promise<ResultadoDelBoton> {
  const usuario = await exigirUsuario();
  const db = obtenerDb();

  const corridas = await Promise.all([
    corridaDe("Sonar", () => sincronizarSonar({ db, sonar: clienteSonarDesdeEntorno(), disparadaPorId: usuario.id })),
    corridaDe("Roslyn", () => sincronizarRoslyn({ db, github: clienteGitHubDesdeEntorno(), disparadaPorId: usuario.id })),
  ]);

  refresh();
  return {
    ok: corridas.every((c) => c.resumen.estado === "ok"),
    mensaje: describirResumenes(corridas),
  };
}

/** Corre la sincronización de un origen; un error de configuración cuenta como corrida fallida. */
async function corridaDe(
  origen: string,
  correr: () => Promise<ResumenDeSincronizacion>,
): Promise<{ origen: string; resumen: Pick<ResumenDeSincronizacion, "estado" | "nuevas" | "modificadas" | "deprecadas" | "error"> }> {
  try {
    return { origen, resumen: await correr() };
  } catch (e) {
    return { origen, resumen: { estado: "error", nuevas: 0, modificadas: 0, deprecadas: 0, error: (e as Error).message } };
  }
}
