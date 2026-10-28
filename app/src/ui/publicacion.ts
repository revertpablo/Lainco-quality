import { Estado, EstadoPublicacion, type Estado as TipoEstado } from "@/dominio/valores";

import { textoDeSeveridad } from "./etiquetas";

/**
 * En qué está una regla en Sonar, en una frase, para el detalle de la regla (entrega 6.2,
 * paso 6). Sale de su última publicación y de su estado en la app. Las frases que terminan
 * en una fecha no llevan punto: la hora ya termina en "a. m.".
 */

export interface UltimaPublicacion {
  estado: string;
  accion: string | null;
  intentos: number;
  ultimoError: string | null;
  proximoIntentoEn: Date;
  publicadaEn: Date | null;
}

export interface EstadoEnSonar {
  texto: string;
  tono: "normal" | "alerta" | "error";
  /** El último error de Sonar, si viene al caso. */
  error: string | null;
}

export function describirEstadoEnSonar(
  ultima: UltimaPublicacion | null,
  estado: TipoEstado,
  fecha: (d: Date) => string,
): EstadoEnSonar {
  if (!ultima) {
    return estado === Estado.Incorporada
      ? { texto: "Nunca se publicó en Sonar.", tono: "alerta", error: null }
      : { texto: "La app nunca la publicó: no tendría que estar activa en Sonar.", tono: "normal", error: null };
  }

  switch (ultima.estado) {
    case EstadoPublicacion.Publicada:
      return {
        // Lo que hizo la app, no lo que hay hoy en Sonar: eso lo dicen los desvíos.
        texto: `La app la publicó ${ultima.accion === "activar" ? "activa" : "inactiva"} el ${fecha(ultima.publicadaEn!)}`,
        tono: "normal",
        error: null,
      };
    case EstadoPublicacion.Pendiente:
      return ultima.intentos === 0
        ? { texto: "Pendiente de publicar en Sonar.", tono: "alerta", error: null }
        : {
            texto: `Pendiente de publicar en Sonar: ${ultima.intentos === 1 ? "falló 1 vez" : `falló ${ultima.intentos} veces`}, se reintenta el ${fecha(ultima.proximoIntentoEn)}`,
            tono: "alerta",
            error: ultima.ultimoError,
          };
    default:
      return {
        texto: `No se pudo publicar en Sonar (${ultima.intentos === 1 ? "1 intento" : `${ultima.intentos} intentos`}).`,
        tono: "error",
        error: ultima.ultimoError,
      };
  }
}

export interface EstadoEnElPaquete {
  /** Cómo queda la regla en el `.globalconfig` que genera la app (decisión R3). */
  enElArchivo: string;
  /** En qué está el cambio pedido, o null si nunca se pidió uno. */
  pedido: string | null;
  tono: "normal" | "alerta" | "error";
  /** El último error, si viene al caso. */
  error: string | null;
}

/**
 * En qué está una regla propia en su paquete, para el detalle (entrega 6.4, paso 4): cómo
 * va en el `.globalconfig` según su estado en la app, y en qué está el PR de
 * configuración que lo lleva al paquete. El seguimiento del PR (abierto, mergeado,
 * versión publicada) llega en el paso 7.
 */
export function describirEstadoEnPaquete(
  ultima: UltimaPublicacion | null,
  estado: TipoEstado,
  severidad: string | null,
  fecha: (d: Date) => string,
): EstadoEnElPaquete {
  const enElArchivo =
    estado === Estado.Incorporada && severidad
      ? `En el .globalconfig va con severidad ${textoDeSeveridad(severidad)}.`
      : "En el .globalconfig va apagada (none).";

  if (!ultima) {
    return { enElArchivo, pedido: null, tono: "normal", error: null };
  }
  switch (ultima.estado) {
    case EstadoPublicacion.Publicada:
      return { enElArchivo, pedido: `Incluida en el PR de configuración el ${fecha(ultima.publicadaEn!)}`, tono: "normal", error: null };
    case EstadoPublicacion.Pendiente:
      return { enElArchivo, pedido: "Pendiente de pasar al PR de configuración.", tono: "alerta", error: ultima.ultimoError };
    default:
      return {
        enElArchivo,
        pedido: `No se pudo actualizar el PR de configuración (${ultima.intentos === 1 ? "1 intento" : `${ultima.intentos} intentos`}).`,
        tono: "error",
        error: ultima.ultimoError,
      };
  }
}
