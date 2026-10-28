import { AccionPublicacion, DestinoPublicacion, Estado, Origen } from "./valores";

/**
 * Qué decisiones se publican y dónde (entregas 6.2 y 6.4; FASE-6-APP.md, secciones 8 bis
 * y 8 ter).
 *
 * Solo Incorporada está activa: En prueba no se publica (entrega 6.5). Entonces se publica
 * cuando una regla **entra** a Incorporada (se activa) o **sale** de Incorporada (se
 * desactiva). Una transición entre dos estados que no son Incorporada no cambia nada.
 *
 * Dónde, según el origen:
 * - las reglas de Sonar, en el Quality Profile del lenguaje;
 * - las propias (Roslyn, ESLint), en el PR que actualiza el `.globalconfig` del paquete
 *   (decisiones R4 y R5);
 * - las normas de IA, en ningún lado: las aplica el revisor IA (Fase 7).
 */

const DESTINO_DE_CADA_ORIGEN: Record<Origen, DestinoPublicacion | null> = {
  [Origen.Sonar]: DestinoPublicacion.PerfilSonar,
  [Origen.Roslyn]: DestinoPublicacion.PrConfiguracion,
  [Origen.Eslint]: DestinoPublicacion.PrConfiguracion,
  [Origen.NormaIa]: null,
};

/** Dónde se publican las reglas de un origen, o null si no se publican. */
export function destinoDePublicacion(origen: Origen): DestinoPublicacion | null {
  return DESTINO_DE_CADA_ORIGEN[origen];
}

/** Dónde hay que publicar esta decisión, o null si no cambia nada publicado. */
export function destinoDeLaDecision(origen: Origen, desde: Estado, hacia: Estado): DestinoPublicacion | null {
  return (desde === Estado.Incorporada) !== (hacia === Estado.Incorporada) ? destinoDePublicacion(origen) : null;
}

/** Qué hay que pedirle a Sonar para que la regla quede como dice la app. */
export function accionEnSonar(estado: Estado): AccionPublicacion {
  return estado === Estado.Incorporada ? AccionPublicacion.Activar : AccionPublicacion.Desactivar;
}

// ------------------------------------------------------------------ reintentos

/** Intentos antes de dar una publicación por fallida. Después se reintenta a mano. */
export const MAXIMO_DE_INTENTOS = 5;

/**
 * Espera antes de cada reintento, en minutos: después del primer fallo, del segundo... Con
 * el plan Hobby de Vercel el cron corre una vez por día, así que estas esperas cuentan
 * sobre todo para el botón y para las publicaciones que dispara cada decisión.
 */
export const ESPERAS_EN_MINUTOS = [1, 5, 30, 120] as const;

/**
 * Por qué falló un intento:
 * - `transitorio`: Sonar no respondió, se cortó la red. Vale la pena reintentar.
 * - `permanente`: Sonar rechazó el pedido o no encuentra la regla. Reintentar daría lo
 *   mismo; hace falta que alguien lo mire.
 * - `configuracion`: el token no sirve o no tiene permiso, el perfil no existe. Se
 *   reintenta, porque se arregla sin tocar la publicación.
 */
export type TipoDeFalla = "transitorio" | "permanente" | "configuracion";

export type DespuesDeFallar =
  | { fallida: false; esperaEnMinutos: number }
  | { fallida: true };

/** Qué pasa con una publicación después de su intento número `intentos` fallido. */
export function despuesDeFallar(intentos: number, falla: TipoDeFalla): DespuesDeFallar {
  if (falla === "permanente" || intentos >= MAXIMO_DE_INTENTOS) {
    return { fallida: true };
  }
  return { fallida: false, esperaEnMinutos: ESPERAS_EN_MINUTOS[Math.min(intentos, ESPERAS_EN_MINUTOS.length) - 1] };
}
