import { randomUUID } from "node:crypto";

import { asc, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { decision, estadoRegla, regla } from "@/db/esquema";
import { validarTransicion, type MotivoDeRechazo } from "@/dominio/transiciones";
import { Estado, type Rol } from "@/dominio/valores";

/**
 * `aplicarTransicion`: **la única función que cambia el estado de una regla**
 * (docs/FASE-6-APP.md, sección 3). Ni la UI ni la API escriben `estadoRegla` por su cuenta.
 *
 * En una transacción:
 * 1. Bloquea las filas de `estadoRegla` de las reglas pedidas (SELECT ... FOR UPDATE), así
 *    dos cambios simultáneos sobre la misma regla se hacen uno después del otro.
 * 2. Verifica que cada regla siga en el estado que vio quien pide el cambio (`desde`). Si
 *    alguien la cambió mientras tanto, no se aplica nada.
 * 3. Valida cada regla con src/dominio/transiciones.ts: transición permitida, rol,
 *    justificación, severidad, operación masiva, parámetros.
 * 4. Si todas pasan, actualiza `estadoRegla` y escribe una `decision` por regla. En una
 *    operación masiva todas comparten el `loteId` y la justificación.
 *
 * **Todo o nada**: si una sola regla no puede, no cambia ninguna, y la respuesta dice cuál
 * y por qué.
 */

export interface Autor {
  id: string;
  /** El rol leído de la base para este pedido (src/auth/sesion.ts), no el que diga el cliente. */
  rol: Rol;
}

export interface PedidoDeTransicion {
  /** Cada regla con el estado en que la vio quien pide el cambio. */
  reglas: readonly { id: string; desde: Estado }[];
  hacia: Estado;
  justificacion?: string | null;
  /** Severidad con la que se incorpora. Solo cuenta hacia Incorporada. */
  severidad?: string | null;
  /** Valores de los parámetros de la regla. Solo cuentan hacia Incorporada. */
  parametros?: Readonly<Record<string, string>> | null;
  /** Operación masiva: comparte justificación y lote, y no puede ir hacia Incorporada. */
  masiva: boolean;
}

export type ResultadoDeTransicion =
  | {
      ok: true;
      /** Agrupa las decisiones de una operación masiva. `null` en una individual. */
      loteId: string | null;
      decisiones: { reglaId: string; decisionId: string; desde: Estado; hacia: Estado }[];
    }
  | { ok: false; tipo: "noEncontradas"; reglaIds: string[] }
  | { ok: false; tipo: "estadoCambio"; reglas: { id: string; esperado: Estado; actual: Estado }[] }
  | { ok: false; tipo: "rechazada"; rechazos: { reglaId: string; motivos: MotivoDeRechazo[] }[] };

export async function aplicarTransicion(
  db: Db,
  autor: Autor,
  pedido: PedidoDeTransicion,
): Promise<ResultadoDeTransicion> {
  const ids = pedido.reglas.map((r) => r.id);
  if (ids.length === 0) {
    throw new Error("El pedido no tiene reglas.");
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("El pedido tiene reglas repetidas.");
  }

  const haciaIncorporada = pedido.hacia === Estado.Incorporada;
  const justificacion = limpio(pedido.justificacion);
  const severidad = haciaIncorporada ? limpio(pedido.severidad) : null;
  const parametros = haciaIncorporada && pedido.parametros && Object.keys(pedido.parametros).length > 0
    ? { ...pedido.parametros }
    : null;

  return db.transaction(async (tx) => {
    // Bloqueo en orden de id: dos lotes que se superponen no se trancan entre sí.
    const actuales = await tx
      .select({ id: estadoRegla.reglaId, estado: estadoRegla.estado, parametros: regla.parametros })
      .from(estadoRegla)
      .innerJoin(regla, eq(regla.id, estadoRegla.reglaId))
      .where(inArray(estadoRegla.reglaId, ids))
      .orderBy(asc(estadoRegla.reglaId))
      .for("update", { of: estadoRegla });
    const porId = new Map(actuales.map((a) => [a.id, a]));

    const noEncontradas = ids.filter((id) => !porId.has(id));
    if (noEncontradas.length > 0) {
      return { ok: false, tipo: "noEncontradas", reglaIds: noEncontradas };
    }

    const cambiadas = pedido.reglas
      .filter((r) => porId.get(r.id)!.estado !== r.desde)
      .map((r) => ({ id: r.id, esperado: r.desde, actual: porId.get(r.id)!.estado }));
    if (cambiadas.length > 0) {
      return { ok: false, tipo: "estadoCambio", reglas: cambiadas };
    }

    const rechazos = pedido.reglas.flatMap((r) => {
      const resultado = validarTransicion({
        desde: r.desde,
        hacia: pedido.hacia,
        rol: autor.rol,
        justificacion,
        severidad,
        masiva: pedido.masiva,
        parametros,
        parametrosDeLaRegla: (porId.get(r.id)!.parametros ?? []).map((p) => p.clave),
      });
      return resultado.valida ? [] : [{ reglaId: r.id, motivos: resultado.motivos }];
    });
    if (rechazos.length > 0) {
      return { ok: false, tipo: "rechazada", rechazos };
    }

    const loteId = pedido.masiva ? randomUUID() : null;

    // Fuera de Incorporada no hay severidad ni parámetros asignados; el historial conserva
    // con cuáles estuvo incorporada.
    await tx
      .update(estadoRegla)
      .set({ estado: pedido.hacia, severidadAsignada: severidad, parametros, actualizadoEn: sql`now()` })
      .where(inArray(estadoRegla.reglaId, ids));

    const escritas = await tx
      .insert(decision)
      .values(
        pedido.reglas.map((r) => ({
          reglaId: r.id,
          estadoAnterior: r.desde,
          estadoNuevo: pedido.hacia,
          autorId: autor.id,
          justificacion,
          severidad,
          parametros,
          loteId,
        })),
      )
      .returning({ id: decision.id, reglaId: decision.reglaId });
    const decisionDe = new Map(escritas.map((e) => [e.reglaId, e.id]));

    return {
      ok: true,
      loteId,
      decisiones: pedido.reglas.map((r) => ({
        reglaId: r.id,
        decisionId: decisionDe.get(r.id)!,
        desde: r.desde,
        hacia: pedido.hacia,
      })),
    };
  });
}

function limpio(texto: string | null | undefined): string | null {
  const recortado = texto?.trim();
  return recortado ? recortado : null;
}
