import "server-only";

import { z } from "zod";

import { obtenerDb, type Db } from "@/db/cliente";
import { ErrorDePrueba, normalizarArchivo } from "@/dominio/prueba";
import { AlcanceToken } from "@/dominio/valores";
import { autorizarServicio } from "@/servicio/autorizar";
import { error, pedidoInvalido } from "@/transiciones/respuestas";

import { abrirCorrida } from "./abrir";
import { ErrorDeConfiguracionDePrueba, repositoriosDesdeEntorno, type RepositorioAProbar } from "./configuracion";
import { registrarResultado } from "./ingesta";

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

// ------------------------------------------------------------------------- resultados

/** Hasta cuántas ubicaciones por regla manda el job (reducir-sarif.mjs). */
export const UBICACIONES_POR_REGLA = 200;

const repositorio = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/, "Tiene que ser owner/repo.");
const commit = z.string().regex(/^[0-9a-f]{7,64}$/i, "Tiene que ser el SHA de un commit.");

const ubicacion = z.strictObject({
  archivo: z.string().transform((ruta, ctx) => {
    try {
      return normalizarArchivo(ruta);
    } catch (e) {
      if (!(e instanceof ErrorDePrueba)) {
        throw e;
      }
      ctx.addIssue({ code: "custom", message: e.message });
      return z.NEVER;
    }
  }),
  linea: z.int().min(1),
  columna: z.int().min(1),
  mensaje: z.string().trim().min(1).max(2000),
});

const resultadoDeRegla = z
  .strictObject({
    diagnostico: z.string().regex(/^(S\d+|LAIN\d{3})$/, "Tiene que ser un ID de Sonar (S####) o propio (LAIN###)."),
    cantidad: z.int().min(0),
    ubicaciones: z.array(ubicacion).max(UBICACIONES_POR_REGLA),
  })
  .refine((r) => r.ubicaciones.length <= r.cantidad, { message: "Hay más ubicaciones que issues.", path: ["cantidad"] });

/** Cuerpo de POST /api/ci/prueba/corridas/{id}/resultados (lo arma .github/prueba/reducir-sarif.mjs). */
export const cuerpoDeResultado = z.discriminatedUnion("estado", [
  z.strictObject({
    repositorio,
    commit,
    estado: z.literal("ok"),
    diagnosticosDisponibles: z.array(z.string().max(100)).max(10_000),
    reglas: z.array(resultadoDeRegla).max(5_000),
  }),
  z.strictObject({
    repositorio,
    commit: commit.optional(),
    estado: z.literal("error"),
    error: z.string().trim().min(1).max(4000),
  }),
]);

/**
 * POST /api/ci/prueba/corridas/{id}/resultados: el resultado de un repositorio
 * (src/prueba/ingesta.ts). Respuestas:
 *
 *   200 { corrida: { id, estado }, repositorio, estado, resultados, muestras, faltan }
 *   404 la corrida no existe · 409 ya terminó o falló
 *   422 el repositorio no es de la corrida, o las reglas no son las de la corrida
 *   400, 415 el cuerpo no es JSON o no tiene la forma esperada · 401 sin token
 */
export async function manejarResultados(pedido: Request, corridaId: string, { db = obtenerDb(), ahora = new Date() }: Opciones = {}): Promise<Response> {
  const autorizado = await autorizarServicio(pedido, AlcanceToken.Prueba, { db, ahora });
  if (autorizado instanceof Response) {
    return autorizado;
  }
  if (!z.uuid().safeParse(corridaId).success) {
    return error(404, "corridaNoEncontrada", "No existe esa corrida.");
  }

  const leido = await leerCuerpo(pedido, cuerpoDeResultado);
  if ("respuesta" in leido) {
    return leido.respuesta;
  }

  const registrado = await registrarResultado({ db, corridaId, resultado: leido.cuerpo, ahora });
  if (!registrado.ok) {
    return error(registrado.status, registrado.error, registrado.mensaje, registrado.extra);
  }
  const { corrida, repositorio: delRepositorio, estado, resultados, muestras, faltan } = registrado;
  return Response.json({ corrida, repositorio: delRepositorio, estado, resultados, muestras, faltan }, { status: 200 });
}
