import { AccionPublicacion, Estado, Origen } from "./valores";

/**
 * Qué decisiones se publican en el Quality Profile de Sonar (entrega 6.2; FASE-6-APP.md,
 * sección 8 bis).
 *
 * Solo Incorporada está activa en Sonar: En prueba no aparece ahí (entrega 6.5). Entonces
 * se publica cuando una regla **entra** a Incorporada (se activa) o **sale** de Incorporada
 * (se desactiva). Una transición entre dos estados que no son Incorporada no cambia nada en
 * Sonar.
 *
 * Y solo las reglas de Sonar: las propias (Roslyn, ESLint) se publican con un PR de
 * configuración (entrega 6.4), no en el perfil.
 */

/** Orígenes cuyas reglas viven en el Quality Profile de Sonar. */
export const ORIGENES_EN_EL_PERFIL: readonly Origen[] = [Origen.Sonar];

/** Si la decisión cambia lo que tiene que estar activo en el perfil de Sonar. */
export function cambiaElPerfil(origen: Origen, desde: Estado, hacia: Estado): boolean {
  return ORIGENES_EN_EL_PERFIL.includes(origen) && (desde === Estado.Incorporada) !== (hacia === Estado.Incorporada);
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
