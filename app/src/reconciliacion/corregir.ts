import { and, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { desvio, publicacion } from "@/db/esquema";
import { DESVIOS_QUE_SE_CORRIGEN_PUBLICANDO } from "@/dominio/reconciliacion";
import { Rol, type Rol as TipoRol } from "@/dominio/valores";

/**
 * Corregir un desvío (entrega 6.2, paso 5; decisión P1): llevar Sonar a lo que dice la app.
 *
 * Los desvíos de una regla (activa sin incorporar, incorporada inactiva, otra severidad,
 * otros parámetros) se corrigen publicando la regla otra vez: se encola una publicación
 * ligada al desvío, que publica el estado de la app. Cuando se publica bien, el desvío se
 * cierra (src/publicacion/publicar.ts); si no, la próxima reconciliación lo sigue viendo.
 *
 * Los del perfil o de un proyecto (herencia, default, proyecto con otro perfil) se
 * corrigen en SonarQube: la app no cambia la configuración de Sonar.
 *
 * Solo un decisor: corregir puede desactivar una regla que alguien activó.
 */

export type ResultadoDeCorreccion =
  | { ok: true; publicacionId: string }
  | { ok: false; motivo: "sinPermiso" | "noEncontrado" | "yaResuelto" | "seCorrigeEnSonar" | "fueraDelInventario" };

export const MENSAJES_DE_CORRECCION: Record<Exclude<ResultadoDeCorreccion, { ok: true }>["motivo"], string> = {
  sinPermiso: "Solo un decisor puede corregir un desvío.",
  noEncontrado: "El desvío no existe.",
  yaResuelto: "El desvío ya está resuelto.",
  seCorrigeEnSonar: "Este desvío es de la configuración del perfil o de un proyecto: se corrige en SonarQube.",
  fueraDelInventario: "La regla no está en el inventario: hay que sincronizar antes de corregirla.",
};

export async function corregirDesvio(
  db: Db,
  autor: { id: string; rol: TipoRol },
  desvioId: string,
): Promise<ResultadoDeCorreccion> {
  if (autor.rol !== Rol.Decisor) {
    return { ok: false, motivo: "sinPermiso" };
  }

  return db.transaction(async (tx) => {
    const [encontrado] = await tx
      .select({ tipo: desvio.tipo, reglaId: desvio.reglaId, resueltoEn: desvio.resueltoEn })
      .from(desvio)
      .where(eq(desvio.id, desvioId))
      .for("update");
    if (!encontrado) return { ok: false, motivo: "noEncontrado" };
    if (encontrado.resueltoEn) return { ok: false, motivo: "yaResuelto" };
    if (!DESVIOS_QUE_SE_CORRIGEN_PUBLICANDO.includes(encontrado.tipo)) return { ok: false, motivo: "seCorrigeEnSonar" };
    if (!encontrado.reglaId) return { ok: false, motivo: "fueraDelInventario" };

    // Como al decidir (paso 3): si la regla ya tenía una pendiente, pasa a ser de esta
    // corrección y se intenta enseguida.
    const [encolada] = await tx
      .insert(publicacion)
      .values({ reglaId: encontrado.reglaId, desvioId, pedidaPorId: autor.id })
      .onConflictDoUpdate({
        target: publicacion.reglaId,
        targetWhere: sql`${publicacion.estado} = 'pendiente'`,
        set: {
          desvioId: sql`excluded."desvioId"`,
          decisionId: null,
          pedidaPorId: sql`excluded."pedidaPorId"`,
          intentos: 0,
          proximoIntentoEn: sql`now()`,
          ultimoError: null,
        },
      })
      .returning({ id: publicacion.id });
    return { ok: true, publicacionId: encolada.id };
  });
}

/**
 * Cierra los desvíos abiertos de una regla que se corrigen publicando: después de una
 * publicación exitosa, Sonar tiene la regla como dice la app.
 */
export async function cerrarDesviosDeLaRegla(db: Pick<Db, "update">, reglaId: string): Promise<void> {
  await db
    .update(desvio)
    .set({ resueltoEn: sql`now()` })
    .where(
      and(
        eq(desvio.reglaId, reglaId),
        isNull(desvio.resueltoEn),
        sql`${desvio.tipo} in (${sql.join(
          DESVIOS_QUE_SE_CORRIGEN_PUBLICANDO.map((t) => sql`${t}`),
          sql`, `,
        )})`,
      ),
    );
}
