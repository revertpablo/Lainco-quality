import { and, asc, eq, inArray, lte, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db } from "@/db/cliente";
import { estadoRegla, publicacion, regla } from "@/db/esquema";
import { accionEnSonar, despuesDeFallar, type TipoDeFalla } from "@/dominio/publicacion";
import { impactosParaPublicar } from "@/dominio/severidad";
import { AccionPublicacion, EstadoPublicacion, type Lenguaje } from "@/dominio/valores";
import type { ClienteSonar } from "@/sonar/cliente";
import { ErrorDeSonar } from "@/sonar/http";
import type { PerfilDeSonar } from "@/sonar/perfiles";

/**
 * Publicar en Sonar lo que quedó pendiente (entrega 6.2, paso 4; FASE-6-APP.md, sección
 * 8 bis).
 *
 * Cada publicación se toma en su propia transacción, con la fila bloqueada
 * (`FOR UPDATE SKIP LOCKED`): dos corridas a la vez (el cron y el botón, o dos decisiones
 * seguidas) no publican la misma dos veces. Mientras se publica, una decisión nueva sobre
 * la misma regla espera, y después encola otra publicación.
 *
 * Qué se publica se decide en ese momento, leyendo `estadoRegla`: Incorporada se activa
 * con la severidad elegida traducida a impactos (src/dominio/severidad.ts) y los
 * parámetros elegidos; cualquier otro estado se desactiva.
 *
 * Si Sonar falla, la publicación se reprograma con una espera creciente o queda fallida
 * (src/dominio/publicacion.ts). Nunca lanza por una publicación: el resumen dice qué pasó.
 */

export interface OpcionesDePublicacion {
  db: Db;
  sonar: Pick<ClienteSonar, "buscarPerfil" | "activarRegla" | "desactivarRegla">;
  /** Nombre del perfil gestionado de cada lenguaje (src/sonar/configuracion.ts). */
  perfiles: Record<Lenguaje, string>;
  /** Solo estas publicaciones: las que acaba de encolar una decisión. Sin valor, todas las pendientes. */
  ids?: readonly string[];
  /** Publicar también las que esperan para reintentar (el botón). */
  sinEsperar?: boolean;
  /** Tope por corrida, para no pasarse del tiempo de una función. */
  maximo?: number;
}

export interface ResumenDePublicacion {
  publicadas: number;
  /** Fallaron y se van a reintentar. */
  reprogramadas: number;
  /** Fallaron y no se reintentan solas. */
  fallidas: number;
  /** Lo que dijo Sonar en cada falla, por regla. */
  errores: { regla: string; mensaje: string }[];
}

const MAXIMO_POR_CORRIDA = 200;

export async function publicarPendientes(opciones: OpcionesDePublicacion): Promise<ResumenDePublicacion> {
  const { db, sonar, perfiles } = opciones;
  const resumen: ResumenDePublicacion = { publicadas: 0, reprogramadas: 0, fallidas: 0, errores: [] };

  const candidatas = await db
    .select({ id: publicacion.id })
    .from(publicacion)
    .where(
      and(
        eq(publicacion.estado, EstadoPublicacion.Pendiente),
        opciones.ids ? inArray(publicacion.id, [...opciones.ids]) : undefined,
        opciones.sinEsperar ? undefined : lte(publicacion.proximoIntentoEn, sql`now()`),
      ),
    )
    .orderBy(asc(publicacion.proximoIntentoEn), asc(publicacion.creadaEn))
    .limit(opciones.maximo ?? MAXIMO_POR_CORRIDA);
  if (candidatas.length === 0) {
    return resumen;
  }

  // El perfil de cada lenguaje se busca una vez por corrida, y solo si hace falta.
  const perfilesBuscados = new Map<Lenguaje, Promise<PerfilDeSonar>>();
  const perfilDe = (lenguaje: Lenguaje) => {
    if (!perfilesBuscados.has(lenguaje)) {
      const buscado = sonar.buscarPerfil(lenguaje, perfiles[lenguaje]);
      // Se observa acá para que un rechazo no quede "sin manejar" antes de que lo espere alguien.
      buscado.catch(() => {});
      perfilesBuscados.set(lenguaje, buscado);
    }
    return perfilesBuscados.get(lenguaje)!;
  };

  for (const { id } of candidatas) {
    await db.transaction(async (tx) => {
      const [fila] = await tx
        .select({
          intentos: publicacion.intentos,
          clave: regla.clave,
          lenguaje: regla.lenguaje,
          impactos: regla.impactos,
          estado: estadoRegla.estado,
          severidad: estadoRegla.severidadAsignada,
          parametros: estadoRegla.parametros,
        })
        .from(publicacion)
        .innerJoin(regla, eq(regla.id, publicacion.reglaId))
        .innerJoin(estadoRegla, eq(estadoRegla.reglaId, publicacion.reglaId))
        .where(and(eq(publicacion.id, id), eq(publicacion.estado, EstadoPublicacion.Pendiente)))
        .for("update", { of: publicacion, skipLocked: true });
      // La tomó otra corrida, o ya no está pendiente.
      if (!fila) return;

      const accion = accionEnSonar(fila.estado);
      const activa = accion === AccionPublicacion.Activar;
      const parametros = activa ? (fila.parametros ?? {}) : null;
      const intentos = fila.intentos + 1;
      const intento = { intentos, accion, severidad: activa ? fila.severidad : null, parametros };

      try {
        const perfil = await perfilDe(fila.lenguaje).catch((e: unknown) => {
          throw new FallaDelPerfil(e);
        });
        if (activa) {
          await sonar.activarRegla(perfil.clave, fila.clave, {
            impactos: impactosParaPublicar(fila.severidad, fila.impactos ?? []),
            parametros: parametros ?? {},
          });
        } else {
          await sonar.desactivarRegla(perfil.clave, fila.clave);
        }
      } catch (e) {
        const { falla, mensaje } = clasificar(e);
        const siguiente = despuesDeFallar(intentos, falla);
        await tx
          .update(publicacion)
          .set({
            ...intento,
            ultimoError: mensaje,
            ...(siguiente.fallida
              ? { estado: EstadoPublicacion.Fallida }
              : { proximoIntentoEn: sql`now() + make_interval(mins => ${siguiente.esperaEnMinutos})` }),
          })
          .where(eq(publicacion.id, id));
        resumen[siguiente.fallida ? "fallidas" : "reprogramadas"]++;
        resumen.errores.push({ regla: fila.clave, mensaje });
        return;
      }

      await tx
        .update(publicacion)
        .set({ ...intento, estado: EstadoPublicacion.Publicada, publicadaEn: sql`now()`, ultimoError: null })
        .where(eq(publicacion.id, id));
      resumen.publicadas++;
    });
  }

  return resumen;
}

/**
 * Vuelve a poner pendientes las publicaciones fallidas (el botón "Reintentar"), sin
 * esperas ni intentos acumulados. Solo las que siguen siendo la última palabra sobre su
 * regla: si después hubo otra publicación (pendiente o publicada), la fallida ya no
 * importa y no se toca. Devuelve los ids que quedaron pendientes.
 */
export async function reintentarFallidas(db: Db, ids?: readonly string[]): Promise<string[]> {
  const posterior = alias(publicacion, "posterior");
  const reactivadas = await db
    .update(publicacion)
    .set({ estado: EstadoPublicacion.Pendiente, intentos: 0, proximoIntentoEn: sql`now()` })
    .where(
      and(
        eq(publicacion.estado, EstadoPublicacion.Fallida),
        ids ? inArray(publicacion.id, [...ids]) : undefined,
        notExists(
          db
            .select({ uno: sql`1` })
            .from(posterior)
            .where(
              and(
                eq(posterior.reglaId, publicacion.reglaId),
                sql`${posterior.creadaEn} > ${publicacion.creadaEn}`,
                inArray(posterior.estado, [EstadoPublicacion.Pendiente, EstadoPublicacion.Publicada]),
              ),
            ),
        ),
      ),
    )
    .returning({ id: publicacion.id });
  return reactivadas.map((r) => r.id);
}

/** No se pudo buscar el perfil: es un problema de la configuración, no de la regla. */
class FallaDelPerfil extends Error {
  constructor(readonly causa: unknown) {
    super(causa instanceof Error ? causa.message : String(causa));
  }
}

function clasificar(e: unknown): { falla: TipoDeFalla; mensaje: string } {
  if (e instanceof FallaDelPerfil) {
    const transitorio = e.causa instanceof ErrorDeSonar && ["red", "servidor"].includes(e.causa.tipo);
    return { falla: transitorio ? "transitorio" : "configuracion", mensaje: e.message };
  }
  if (e instanceof ErrorDeSonar) {
    switch (e.tipo) {
      case "autenticacion":
      case "permisos":
        return { falla: "configuracion", mensaje: e.message };
      case "pedidoInvalido":
      case "noEncontrado":
        // Sonar rechazó esta regla en particular (un parámetro inválido, una regla que ya
        // no existe): reintentar daría lo mismo.
        return { falla: "permanente", mensaje: e.message };
      default:
        return { falla: "transitorio", mensaje: e.message };
    }
  }
  // Un error del cliente antes de llamar a Sonar (por ejemplo, un parámetro con ';').
  return { falla: "permanente", mensaje: e instanceof Error ? e.message : String(e) };
}
