import { Estado, Origen, Rol } from "./valores";

/**
 * Máquina de estados del ciclo de vida de una regla (docs/FASE-6.md, sección 4).
 *
 * TRANSICIONES es la única definición de qué cambios de estado existen y qué exige cada
 * uno. Para cambiar una regla del ciclo de vida (por ejemplo, que una transición admita
 * o no operación masiva) se toca **solo su fila**.
 *
 * Este módulo no hace I/O: valida. La función que escribe el estado y la decisión en la
 * base (src/transiciones/aplicarTransicion.ts) se apoya en `validarTransicion`.
 */

export interface Transicion {
  readonly desde: Estado;
  readonly hacia: Estado;
  /** Hace falta una justificación escrita. */
  readonly requiereJustificacion: boolean;
  /** Hace falta elegir la severidad con la que se incorpora. */
  readonly requiereSeveridad: boolean;
  /** Solo la puede hacer alguien con rol decisor. */
  readonly requiereDecisor: boolean;
  /** Hacen falta resultados de la prueba (entrega 6.5). */
  readonly requiereResultadosDePrueba: boolean;
  /** Se puede aplicar a varias reglas a la vez, con una justificación común. */
  readonly admiteMasiva: boolean;
}

const { PendienteDeAnalizar, ARevisar, EnPrueba, Incorporada, Descartada } = Estado;

/**
 * Las transiciones permitidas. Cualquier par (desde, hacia) que no esté acá se rechaza;
 * en particular, Pendiente de analizar → Incorporada no existe.
 *
 * Operaciones masivas (decisión del 2026-10-16): toda transición hacia A revisar, En
 * prueba o Descartada; nunca hacia Incorporada (FASE-6.md, sección 5). Un test falla si
 * alguna transición hacia Incorporada se marca como masiva.
 */
export const TRANSICIONES: readonly Transicion[] = [
  {
    desde: PendienteDeAnalizar,
    hacia: ARevisar,
    requiereJustificacion: false,
    requiereSeveridad: false,
    requiereDecisor: false,
    requiereResultadosDePrueba: false,
    admiteMasiva: true,
  },
  {
    desde: PendienteDeAnalizar,
    hacia: Descartada,
    requiereJustificacion: true,
    requiereSeveridad: false,
    requiereDecisor: false,
    requiereResultadosDePrueba: false,
    admiteMasiva: true,
  },
  {
    desde: PendienteDeAnalizar,
    hacia: EnPrueba,
    requiereJustificacion: false,
    requiereSeveridad: false,
    requiereDecisor: false,
    requiereResultadosDePrueba: false,
    admiteMasiva: true,
  },
  {
    desde: ARevisar,
    hacia: EnPrueba,
    requiereJustificacion: false,
    requiereSeveridad: false,
    requiereDecisor: false,
    requiereResultadosDePrueba: false,
    admiteMasiva: true,
  },
  {
    desde: ARevisar,
    hacia: Incorporada,
    requiereJustificacion: true,
    requiereSeveridad: true,
    requiereDecisor: true,
    requiereResultadosDePrueba: false,
    admiteMasiva: false,
  },
  {
    desde: ARevisar,
    hacia: Descartada,
    requiereJustificacion: true,
    requiereSeveridad: false,
    requiereDecisor: true,
    requiereResultadosDePrueba: false,
    admiteMasiva: true,
  },
  {
    desde: EnPrueba,
    hacia: Incorporada,
    requiereJustificacion: true,
    requiereSeveridad: true,
    requiereDecisor: true,
    // FASE-6.md pide resultados de prueba disponibles, pero los resultados existen
    // recién con la entrega 6.5. Hasta entonces no se verifica (decisión del
    // 2026-10-16); en 6.5 se pasa a true.
    requiereResultadosDePrueba: false,
    admiteMasiva: false,
  },
  {
    desde: EnPrueba,
    hacia: Descartada,
    requiereJustificacion: true,
    requiereSeveridad: false,
    requiereDecisor: true,
    requiereResultadosDePrueba: false,
    admiteMasiva: true,
  },
  {
    desde: EnPrueba,
    hacia: ARevisar,
    requiereJustificacion: false,
    requiereSeveridad: false,
    requiereDecisor: false,
    requiereResultadosDePrueba: false,
    admiteMasiva: true,
  },
  {
    // Retiro de una regla activa.
    desde: Incorporada,
    hacia: Descartada,
    requiereJustificacion: true,
    requiereSeveridad: false,
    requiereDecisor: true,
    requiereResultadosDePrueba: false,
    admiteMasiva: true,
  },
  {
    // Por ejemplo, tras un cambio de la regla en Sonar.
    desde: Incorporada,
    hacia: EnPrueba,
    requiereJustificacion: true,
    requiereSeveridad: false,
    requiereDecisor: true,
    requiereResultadosDePrueba: false,
    admiteMasiva: true,
  },
  {
    // Reabrir una decisión.
    desde: Descartada,
    hacia: ARevisar,
    requiereJustificacion: true,
    requiereSeveridad: false,
    requiereDecisor: false,
    requiereResultadosDePrueba: false,
    admiteMasiva: true,
  },
];

export type MotivoDeRechazo =
  | "transicionNoPermitida"
  | "requiereRolDecisor"
  | "faltaJustificacion"
  | "faltaSeveridad"
  | "faltanResultadosDePrueba"
  | "noAdmiteOperacionMasiva"
  | "parametroDesconocido"
  | "severidadNoSeElige";

/** Texto para el usuario de cada motivo de rechazo. */
export const MENSAJES_DE_RECHAZO: Readonly<Record<MotivoDeRechazo, string>> = {
  transicionNoPermitida: "Ese cambio de estado no está permitido.",
  requiereRolDecisor: "Este cambio de estado solo lo puede hacer alguien con rol decisor.",
  faltaJustificacion: "Falta la justificación.",
  faltaSeveridad: "Falta elegir la severidad con la que se incorpora la regla.",
  faltanResultadosDePrueba: "La regla todavía no tiene resultados de prueba.",
  noAdmiteOperacionMasiva: "Este cambio de estado se hace de a una regla, no en una operación masiva.",
  parametroDesconocido: "Se eligió un valor para un parámetro que la regla no tiene.",
  severidadNoSeElige: "La severidad de una regla propia la fija la regla: no se elige al incorporarla.",
};

/**
 * Orígenes cuyas reglas traen su severidad (entrega 6.4, decisión R3): las reglas propias
 * se incorporan con la severidad por defecto de su descriptor, sin elegirla.
 */
export const ORIGENES_CON_SEVERIDAD_DE_LA_REGLA: readonly Origen[] = [Origen.Roslyn, Origen.Eslint];

/** Al incorporar una regla de este origen, ¿se elige la severidad? */
export function seEligeLaSeveridad(origen: Origen): boolean {
  return !ORIGENES_CON_SEVERIDAD_DE_LA_REGLA.includes(origen);
}

export interface SolicitudDeTransicion {
  desde: Estado;
  hacia: Estado;
  /** Rol de quien pide el cambio. */
  rol: Rol;
  /** Origen de la regla. Sin valor, se valida como una de Sonar. */
  origen?: Origen;
  justificacion?: string | null;
  severidad?: string | null;
  /** Es parte de una operación masiva. */
  masiva?: boolean;
  resultadosDePruebaDisponibles?: boolean;
  /** Valores elegidos para los parámetros de la regla (al incorporar). */
  parametros?: Readonly<Record<string, string>> | null;
  /** Claves de los parámetros que tiene la regla. */
  parametrosDeLaRegla?: readonly string[];
}

export type ResultadoDeValidacion =
  | { valida: true; transicion: Transicion }
  | { valida: false; motivos: MotivoDeRechazo[] };

export function buscarTransicion(desde: Estado, hacia: Estado): Transicion | undefined {
  return TRANSICIONES.find((t) => t.desde === desde && t.hacia === hacia);
}

/**
 * El rol alcanza para hacer la transición, sin mirar sus demás requisitos. Es la única
 * regla de permisos sobre transiciones: la usan la validación y la pantalla.
 */
export function rolPuedeHacer(transicion: Transicion, rol: Rol): boolean {
  return !transicion.requiereDecisor || rol === Rol.Decisor;
}

/**
 * Las transiciones que alguien con este rol puede hacer desde un estado: las acciones que
 * se le muestran sobre una regla. Un analista no ve las que requieren decisor.
 */
export function transicionesDisponibles(desde: Estado, rol: Rol): Transicion[] {
  return TRANSICIONES.filter((t) => t.desde === desde && rolPuedeHacer(t, rol));
}

export interface DestinoMasivo {
  hacia: Estado;
  /** Alguna de las reglas exige justificación para ir ahí. */
  requiereJustificacion: boolean;
}

/**
 * Los estados a los que se puede mandar, en una operación masiva, un grupo de reglas que
 * están en `estados`, con el rol dado: los destinos válidos para **todas**. Es lo que
 * ofrece la barra de selección del inventario. Nunca incluye Incorporada.
 */
export function destinosMasivos(estados: readonly Estado[], rol: Rol): DestinoMasivo[] {
  const desde = [...new Set(estados)];
  if (desde.length === 0) {
    return [];
  }

  return Object.values(Estado).flatMap((hacia) => {
    const transiciones = desde.map((d) => buscarTransicion(d, hacia));
    const todasValen = transiciones.every((t) => t !== undefined && t.admiteMasiva && rolPuedeHacer(t, rol));
    return todasValen
      ? [{ hacia, requiereJustificacion: transiciones.some((t) => t!.requiereJustificacion) }]
      : [];
  });
}

/**
 * Valida un cambio de estado contra la tabla de transiciones.
 *
 * Si el cambio no existe, devuelve solo `transicionNoPermitida`. Si existe pero no
 * cumple sus requisitos, devuelve todos los motivos juntos, para que el usuario los
 * corrija de una vez.
 */
export function validarTransicion(solicitud: SolicitudDeTransicion): ResultadoDeValidacion {
  const transicion = buscarTransicion(solicitud.desde, solicitud.hacia);

  if (!transicion) {
    return { valida: false, motivos: ["transicionNoPermitida"] };
  }

  const motivos: MotivoDeRechazo[] = [];

  if (!rolPuedeHacer(transicion, solicitud.rol)) {
    motivos.push("requiereRolDecisor");
  }

  if (transicion.requiereJustificacion && !tieneTexto(solicitud.justificacion)) {
    motivos.push("faltaJustificacion");
  }

  if (transicion.requiereSeveridad) {
    const seElige = seEligeLaSeveridad(solicitud.origen ?? Origen.Sonar);
    if (seElige && !tieneTexto(solicitud.severidad)) {
      motivos.push("faltaSeveridad");
    } else if (!seElige && tieneTexto(solicitud.severidad)) {
      motivos.push("severidadNoSeElige");
    }
  }

  if (transicion.requiereResultadosDePrueba && !solicitud.resultadosDePruebaDisponibles) {
    motivos.push("faltanResultadosDePrueba");
  }

  if (solicitud.masiva && !transicion.admiteMasiva) {
    motivos.push("noAdmiteOperacionMasiva");
  }

  const definidos = solicitud.parametrosDeLaRegla ?? [];
  if (Object.keys(solicitud.parametros ?? {}).some((clave) => !definidos.includes(clave))) {
    motivos.push("parametroDesconocido");
  }

  return motivos.length === 0 ? { valida: true, transicion } : { valida: false, motivos };
}

function tieneTexto(valor: string | null | undefined): boolean {
  return typeof valor === "string" && valor.trim().length > 0;
}
