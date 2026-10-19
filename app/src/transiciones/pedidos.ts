import { z } from "zod";

import { Estado } from "@/dominio/valores";

/**
 * Forma de los pedidos de la API de transiciones (Zod). Valida el formato; las reglas del
 * ciclo de vida (qué transición existe, quién la puede hacer, qué exige) las valida
 * `aplicarTransicion` con src/dominio/transiciones.ts.
 */

z.config(z.locales.es());

/** Severidades de Sonar con las que se puede incorporar una regla. */
export const SEVERIDADES = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"] as const;

/** Máximo de reglas en una operación masiva. Alcanza para todo el catálogo de un lenguaje. */
export const MAXIMO_DE_REGLAS_POR_LOTE = 2_000;

const estado = z.enum(Object.values(Estado) as [Estado, ...Estado[]]);
const justificacion = z.string().max(2_000).optional();

/** POST /api/reglas/[id]/transicion */
export const pedidoIndividual = z
  .strictObject({
    desde: estado,
    hacia: estado,
    justificacion,
    severidad: z.enum(SEVERIDADES).optional(),
    parametros: z.record(z.string().min(1).max(100), z.string().max(500)).optional(),
  })
  .refine((p) => p.hacia === Estado.Incorporada || (p.severidad === undefined && p.parametros === undefined), {
    message: "La severidad y los parámetros solo se eligen al incorporar.",
    path: ["severidad"],
  });

/** POST /api/reglas/transiciones (operación masiva) */
export const pedidoMasivo = z
  .strictObject({
    reglas: z
      .array(z.strictObject({ id: z.uuid(), desde: estado }))
      .min(1)
      .max(MAXIMO_DE_REGLAS_POR_LOTE),
    hacia: estado,
    justificacion,
  })
  .refine((p) => new Set(p.reglas.map((r) => r.id)).size === p.reglas.length, {
    message: "Hay reglas repetidas.",
    path: ["reglas"],
  });

export type PedidoIndividual = z.infer<typeof pedidoIndividual>;
export type PedidoMasivo = z.infer<typeof pedidoMasivo>;
