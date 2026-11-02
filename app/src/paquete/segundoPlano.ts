import "server-only";

import { after } from "next/server";

import { obtenerDb } from "@/db/cliente";
import { clienteGitHubDesdeEntorno } from "@/github/configuracion";

import { baseDelPr } from "./configuracion";
import { PAQUETES } from "./paquetes";
import { publicarPaquete } from "./publicar";

/**
 * Lleva al PR de configuración lo que acaba de decidirse sobre una regla propia, **después
 * de responder** (`after()` de Next), como la publicación en Sonar: quien decide no espera
 * a GitHub. Si falla, queda pendiente y lo retoma el cron o el botón.
 *
 * Nunca lanza: un error acá no tiene a quién mostrárselo, así que va al log. Lo que haya
 * quedado sin publicar se ve en el detalle de la regla.
 */
export function publicarPaqueteDespuesDeResponder(): void {
  after(async () => {
    try {
      for (const paquete of PAQUETES) {
        const resumen = await publicarPaquete({ db: obtenerDb(), github: clienteGitHubDesdeEntorno(), base: baseDelPr(), paquete });
        if (resumen.error) {
          console.error(`Publicación en ${paquete.nombre} con errores:`, JSON.stringify(resumen));
        }
      }
    } catch (e) {
      console.error("No se pudo publicar en el paquete:", e instanceof Error ? e.message : e);
    }
  });
}
