import "server-only";

import { after } from "next/server";

import { obtenerDb } from "@/db/cliente";
import { clienteSonarDesdeEntorno, perfilesDesdeEntorno } from "@/sonar/configuracion";

import { publicarPendientes } from "./publicar";

/**
 * Publica en Sonar lo que acaba de encolar una decisión, **después de responder**
 * (`after()` de Next; decisión P2): quien decide no espera a Sonar. Si Sonar falla, la
 * publicación queda pendiente y la retoma el cron o el botón.
 *
 * Nunca lanza: un error acá no tiene a quién mostrárselo, así que va al log. Lo que haya
 * quedado sin publicar se ve en la app (paso 6).
 */
export function publicarDespuesDeResponder(ids: readonly string[]): void {
  if (ids.length === 0) {
    return;
  }
  after(async () => {
    try {
      const resumen = await publicarPendientes({
        db: obtenerDb(),
        sonar: clienteSonarDesdeEntorno(),
        perfiles: perfilesDesdeEntorno(),
        ids,
      });
      if (resumen.errores.length > 0) {
        console.error("Publicación en Sonar con errores:", JSON.stringify(resumen));
      }
    } catch (e) {
      console.error("No se pudo publicar en Sonar:", e instanceof Error ? e.message : e);
    }
  });
}
