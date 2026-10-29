import { eq } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { muestraPrueba } from "@/db/esquema";
import { EvaluacionMuestra } from "@/dominio/valores";

/**
 * Evaluar una muestra de una regla en prueba (entrega 6.5, paso 6): válida o falso positivo,
 * con quién y cuándo; o volver a sin evaluar, que lo borra. La evaluación se conserva entre
 * corridas mientras la muestra siga apareciendo (decisión E6). Devuelve false si la muestra
 * no existe.
 */
export async function evaluarMuestra(
  db: Db,
  { muestraId, evaluacion, usuarioId, ahora = new Date() }: { muestraId: string; evaluacion: EvaluacionMuestra; usuarioId: string; ahora?: Date },
): Promise<boolean> {
  const sinEvaluar = evaluacion === EvaluacionMuestra.SinEvaluar;
  const cambiadas = await db
    .update(muestraPrueba)
    .set({ evaluacion, evaluadaPorId: sinEvaluar ? null : usuarioId, evaluadaEn: sinEvaluar ? null : ahora })
    .where(eq(muestraPrueba.id, muestraId))
    .returning({ id: muestraPrueba.id });
  return cambiadas.length > 0;
}
