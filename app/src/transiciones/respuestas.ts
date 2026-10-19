import type { z } from "zod";

import { MENSAJES_DE_RECHAZO } from "@/dominio/transiciones";

import type { ResultadoDeTransicion } from "./aplicarTransicion";

/**
 * Cómo responde la API de transiciones. Todas las respuestas son JSON con `error` (un
 * código fijo) y `mensaje` (texto para el usuario) cuando algo no se aplicó.
 *
 * | HTTP | `error`           | Cuándo |
 * |------|-------------------|--------|
 * | 200  | —                 | Se aplicó. Devuelve las decisiones escritas y el lote. |
 * | 400  | `pedidoInvalido`  | El cuerpo no tiene la forma esperada. |
 * | 401  | `sinSesion`       | No hay sesión. |
 * | 403  | `otroOrigen`      | El pedido viene de otro sitio. |
 * | 404  | `noEncontradas`   | Alguna regla no existe. |
 * | 409  | `estadoCambio`    | Alguna regla ya no está en el estado que vio el usuario. |
 * | 415  | `noEsJson`        | El cuerpo no es JSON. |
 * | 422  | `rechazada`       | El ciclo de vida no lo permite: dice por qué, regla por regla. |
 */
export function responder(resultado: ResultadoDeTransicion): Response {
  if (resultado.ok) {
    return Response.json({ loteId: resultado.loteId, decisiones: resultado.decisiones });
  }

  switch (resultado.tipo) {
    case "noEncontradas":
      return error(404, "noEncontradas", "Alguna de las reglas no existe.", { reglaIds: resultado.reglaIds });
    case "estadoCambio":
      return error(409, "estadoCambio", "Alguna de las reglas cambió de estado mientras tanto. Volvé a cargarlas.", {
        reglas: resultado.reglas,
      });
    case "rechazada":
      return error(422, "rechazada", "No se aplicó ningún cambio.", {
        rechazos: resultado.rechazos.map((r) => ({
          reglaId: r.reglaId,
          motivos: r.motivos.map((codigo) => ({ codigo, mensaje: MENSAJES_DE_RECHAZO[codigo] })),
        })),
      });
  }
}

export function pedidoInvalido(problema: z.ZodError): Response {
  return error(400, "pedidoInvalido", "El pedido no tiene el formato esperado.", {
    detalles: problema.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message })),
  });
}

export function error(estado: number, codigo: string, mensaje: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: codigo, mensaje, ...extra }, { status: estado });
}
