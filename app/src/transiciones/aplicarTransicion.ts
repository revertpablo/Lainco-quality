import { randomUUID } from "node:crypto";

import { asc, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { decision, estadoRegla, publicacion, regla } from "@/db/esquema";
import { seProbaConElJob } from "@/dominio/prueba";
import { destinoDeLaDecision } from "@/dominio/publicacion";
import { seEligeLaSeveridad, validarTransicion, type MotivoDeRechazo } from "@/dominio/transiciones";
import { Estado, type DestinoPublicacion, type Rol } from "@/dominio/valores";
import { minimoDeCorridas } from "@/prueba/configuracion";
import { corridasQueCuentanPorRegla } from "@/prueba/consultas";

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
 *    justificación, severidad, operación masiva, parámetros; y lo que sale de la prueba de
 *    reglas (entrega 6.5): de En prueba a Incorporada, el mínimo de corridas (decisión E3),
 *    contado acá; hacia En prueba, que el job la pueda correr (decisión E7). A las reglas
 *    que el job de C# no corre (TypeScript, normas de IA) no se les pide el mínimo: no
 *    tienen cómo juntarlo.
 * 4. Si todas pasan, actualiza `estadoRegla` y escribe una `decision` por regla. En una
 *    operación masiva todas comparten el `loteId` y la justificación.
 * 5. Encola la publicación de las reglas que entran a Incorporada o salen
 *    (src/dominio/publicacion.ts): en el perfil de Sonar (entrega 6.2, paso 3) o en el PR
 *    de configuración, si es una regla propia (entrega 6.4, paso 4). Va en la misma
 *    transacción: no puede quedar una decisión sin su publicación, ni una publicación sin
 *    su decisión.
 *
 * Una regla propia se incorpora con la severidad por defecto de la regla, sin elegirla
 * (decisión R3): queda registrada en la decisión y en el estado, para el historial.
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
  /** Severidad con la que se incorpora. Solo cuenta hacia Incorporada, y no en las reglas propias. */
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
      /** Las publicaciones (en Sonar o en el PR de configuración) que quedaron pendientes por esta decisión. */
      publicaciones: string[];
      /** Dónde hay que publicar: el perfil de Sonar, el PR de configuración, los dos o ninguno. */
      destinos: DestinoPublicacion[];
    }
  | { ok: false; tipo: "noEncontradas"; reglaIds: string[] }
  | { ok: false; tipo: "estadoCambio"; reglas: { id: string; esperado: Estado; actual: Estado }[] }
  | { ok: false; tipo: "rechazada"; rechazos: { reglaId: string; motivos: MotivoDeRechazo[] }[] };

export async function aplicarTransicion(
  db: Db,
  autor: Autor,
  pedido: PedidoDeTransicion,
  { minimoDeCorridas: minimo = minimoDeCorridas().minimo }: { minimoDeCorridas?: number } = {},
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
      .select({
        id: estadoRegla.reglaId,
        estado: estadoRegla.estado,
        parametros: regla.parametros,
        origen: regla.origen,
        clave: regla.clave,
        severidadDefault: regla.severidadDefault,
        probableLocalmente: regla.probableLocalmente,
      })
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

    // El mínimo de corridas, para las que salen de En prueba hacia Incorporada y el job corre.
    const aContar = haciaIncorporada
      ? pedido.reglas.filter((r) => r.desde === Estado.EnPrueba && seProbaConElJob(porId.get(r.id)!)).map((r) => r.id)
      : [];
    const cuentan = aContar.length > 0 ? await corridasQueCuentanPorRegla(tx as unknown as Db, aContar) : new Map<string, number>();

    const rechazos = pedido.reglas.flatMap((r) => {
      const resultado = validarTransicion({
        desde: r.desde,
        hacia: pedido.hacia,
        rol: autor.rol,
        origen: porId.get(r.id)!.origen,
        justificacion,
        severidad,
        masiva: pedido.masiva,
        parametros,
        parametrosDeLaRegla: (porId.get(r.id)!.parametros ?? []).map((p) => p.clave),
        resultadosDePruebaDisponibles: !cuentan.has(r.id) || cuentan.get(r.id)! >= minimo,
        probableLocalmente: porId.get(r.id)!.probableLocalmente,
      });
      return resultado.valida ? [] : [{ reglaId: r.id, motivos: resultado.motivos }];
    });
    if (rechazos.length > 0) {
      return { ok: false, tipo: "rechazada", rechazos };
    }

    const loteId = pedido.masiva ? randomUUID() : null;

    // Con qué severidad queda cada regla: la elegida o, en una regla propia, la suya.
    // Fuera de Incorporada no hay severidad ni parámetros asignados; el historial conserva
    // con cuáles estuvo incorporada.
    const severidadDe = (id: string) => {
      const actual = porId.get(id)!;
      return haciaIncorporada && !seEligeLaSeveridad(actual.origen) ? actual.severidadDefault : severidad;
    };
    const porSeveridad = new Map<string | null, string[]>();
    for (const id of ids) {
      porSeveridad.set(severidadDe(id), [...(porSeveridad.get(severidadDe(id)) ?? []), id]);
    }
    for (const [severidadAsignada, deEsaSeveridad] of porSeveridad) {
      await tx
        .update(estadoRegla)
        .set({ estado: pedido.hacia, severidadAsignada, parametros, actualizadoEn: sql`now()` })
        .where(inArray(estadoRegla.reglaId, deEsaSeveridad));
    }

    const escritas = await tx
      .insert(decision)
      .values(
        pedido.reglas.map((r) => ({
          reglaId: r.id,
          estadoAnterior: r.desde,
          estadoNuevo: pedido.hacia,
          autorId: autor.id,
          justificacion,
          severidad: severidadDe(r.id),
          parametros,
          loteId,
        })),
      )
      .returning({ id: decision.id, reglaId: decision.reglaId });
    const decisionDe = new Map(escritas.map((e) => [e.reglaId, e.id]));

    // Una sola publicación pendiente por regla: si ya había una (la decisión anterior
    // todavía no se publicó), pasa a ser de esta decisión y vuelve a intentarse ya. Igual
    // se publica lo último, porque quien publica lee `estadoRegla` al publicar.
    const aPublicar = pedido.reglas.flatMap((r) => {
      const destino = destinoDeLaDecision(porId.get(r.id)!.origen, r.desde, pedido.hacia);
      return destino ? [{ reglaId: r.id, destino, decisionId: decisionDe.get(r.id)!, pedidaPorId: autor.id }] : [];
    });
    const publicaciones =
      aPublicar.length === 0
        ? []
        : await tx
            .insert(publicacion)
            .values(aPublicar)
            .onConflictDoUpdate({
              target: publicacion.reglaId,
              targetWhere: sql`${publicacion.estado} = 'pendiente'`,
              set: {
                decisionId: sql`excluded."decisionId"`,
                desvioId: null,
                pedidaPorId: sql`excluded."pedidaPorId"`,
                intentos: 0,
                proximoIntentoEn: sql`now()`,
                ultimoError: null,
              },
            })
            .returning({ id: publicacion.id });

    return {
      ok: true,
      loteId,
      decisiones: pedido.reglas.map((r) => ({
        reglaId: r.id,
        decisionId: decisionDe.get(r.id)!,
        desde: r.desde,
        hacia: pedido.hacia,
      })),
      publicaciones: publicaciones.map((p) => p.id),
      destinos: [...new Set(aPublicar.map((p) => p.destino))],
    };
  });
}

function limpio(texto: string | null | undefined): string | null {
  const recortado = texto?.trim();
  return recortado ? recortado : null;
}
