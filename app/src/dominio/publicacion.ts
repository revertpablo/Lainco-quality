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
