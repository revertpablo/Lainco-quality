import { Estado, EstadoPublicacion, type Estado as TipoEstado } from "@/dominio/valores";

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
