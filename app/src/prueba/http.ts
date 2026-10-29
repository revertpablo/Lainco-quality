import "server-only";

import { z } from "zod";

import { obtenerDb, type Db } from "@/db/cliente";
import { AlcanceToken } from "@/dominio/valores";
import { autorizarServicio } from "@/servicio/autorizar";
import { error, pedidoInvalido } from "@/transiciones/respuestas";

import { abrirCorrida } from "./abrir";
import { ErrorDeConfiguracionDePrueba, repositoriosDesdeEntorno, type RepositorioAProbar } from "./configuracion";

/**
 * Las rutas del job de prueba en /api/ci/prueba/ (entrega 6.5), sin la parte de Next: así
 * se prueban con una base en transacción. Entran con un token de servicio de alcance
 * `prueba` (decisión E5).
 */

const versionDeAnalyzer = z.string().trim().min(1).max(50);

/** Cuerpo de POST /api/ci/prueba/corridas. Todo opcional: con `{}` alcanza. */
export const cuerpoDeApertura = z.strictObject({
  /** La corrida del workflow, para ir de la app a sus logs. */
  workflowUrl: z
    .url()
    .refine((u) => u.startsWith("https://github.com/"), "Tiene que ser una URL de github.com.")
    .optional(),
  /** Con qué versiones compila el job. */
  versiones: z.strictObject({ sonarAnalyzer: versionDeAnalyzer.optional(), laincoAnalyzers: versionDeAnalyzer.optional() }).optional(),
});

interface Opciones {
  db?: Db;
  ahora?: Date;
  entorno?: Record<string, string | undefined>;
}

/** Lee el cuerpo JSON y lo valida, o devuelve la respuesta de error. */
async function leerCuerpo<T>(pedido: Request, esquema: z.ZodType<T>): Promise<{ cuerpo: T } | { respuesta: Response }> {
  if (!pedido.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { respuesta: error(415, "noEsJson", "El cuerpo tiene que ser JSON.") };
  }
  let json: unknown;
  try {
    json = await pedido.json();
  } catch {
    return { respuesta: error(400, "pedidoInvalido", "El cuerpo no es un JSON válido.") };
  }
  const resultado = esquema.safeParse(json);
  return resultado.success ? { cuerpo: resultado.data } : { respuesta: pedidoInvalido(resultado.error) };
}

/**
 * POST /api/ci/prueba/corridas: abre una corrida y devuelve lo que necesita el job:
 *
 *   201 { corrida: { id, iniciadaEn }, repositorios: [{ repositorio, solucion }],
 *         reglas: [{ clave, diagnostico }], globalconfig: "..." }
 *   200 { corrida: null, mensaje }   sin reglas En prueba que el job pueda correr
 */
export async function manejarAbrirCorrida(pedido: Request, { db = obtenerDb(), ahora = new Date(), entorno = process.env }: Opciones = {}): Promise<Response> {
  const autorizado = await autorizarServicio(pedido, AlcanceToken.Prueba, { db, ahora });
  if (autorizado instanceof Response) {
    return autorizado;
  }

  const leido = await leerCuerpo(pedido, cuerpoDeApertura);
  if ("respuesta" in leido) {
    return leido.respuesta;
  }

  let repositorios: RepositorioAProbar[];
  try {
    repositorios = repositoriosDesdeEntorno(entorno);
  } catch (e) {
    if (e instanceof ErrorDeConfiguracionDePrueba) {
      return error(500, "configuracion", e.message);
    }
    throw e;
  }

  const abierta = await abrirCorrida({
    db,
    tokenId: autorizado.tokenId,
    repositorios,
    workflowUrl: leido.cuerpo.workflowUrl,
    versiones: leido.cuerpo.versiones,
    ahora,
  });
  if (!abierta.corrida) {
    return Response.json({ corrida: null, mensaje: "No hay reglas En prueba que el job pueda probar." }, { status: 200 });
  }
  return Response.json(
    {
      corrida: abierta.corrida,
      repositorios: abierta.repositorios,
      reglas: abierta.reglas.map(({ clave, diagnostico }) => ({ clave, diagnostico })),
      globalconfig: abierta.globalconfig,
    },
    { status: 201 },
  );
}
