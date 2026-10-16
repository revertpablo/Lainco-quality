import { Estado, Rol } from "./valores";

/**
 * Máquina de estados del ciclo de vida de una regla (docs/FASE-6.md, sección 4).
 *
 * TRANSICIONES es la única definición de qué cambios de estado existen y qué exige cada
 * uno. Para cambiar una regla del ciclo de vida (por ejemplo, que una transición admita
 * o no operación masiva) se toca **solo su fila**.
 *
 * Este módulo no hace I/O: valida. La función que escribe el estado y la decisión en la
 * base (`aplicarTransicion`, paso 7) se apoya en `validarTransicion`.
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
  | "noAdmiteOperacionMasiva";

/** Texto para el usuario de cada motivo de rechazo. */
export const MENSAJES_DE_RECHAZO: Readonly<Record<MotivoDeRechazo, string>> = {
  transicionNoPermitida: "Ese cambio de estado no está permitido.",
  requiereRolDecisor: "Este cambio de estado solo lo puede hacer alguien con rol decisor.",
  faltaJustificacion: "Falta la justificación.",
  faltaSeveridad: "Falta elegir la severidad con la que se incorpora la regla.",
  faltanResultadosDePrueba: "La regla todavía no tiene resultados de prueba.",
  noAdmiteOperacionMasiva: "Este cambio de estado se hace de a una regla, no en una operación masiva.",
};

export interface SolicitudDeTransicion {
  desde: Estado;
  hacia: Estado;
  /** Rol de quien pide el cambio. */
  rol: Rol;
  justificacion?: string | null;
  severidad?: string | null;
  /** Es parte de una operación masiva. */
  masiva?: boolean;
  resultadosDePruebaDisponibles?: boolean;
}

export type ResultadoDeValidacion =
  | { valida: true; transicion: Transicion }
  | { valida: false; motivos: MotivoDeRechazo[] };

export function buscarTransicion(desde: Estado, hacia: Estado): Transicion | undefined {
  return TRANSICIONES.find((t) => t.desde === desde && t.hacia === hacia);
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

  if (transicion.requiereDecisor && solicitud.rol !== Rol.Decisor) {
    motivos.push("requiereRolDecisor");
  }

  if (transicion.requiereJustificacion && !tieneTexto(solicitud.justificacion)) {
    motivos.push("faltaJustificacion");
  }

  if (transicion.requiereSeveridad && !tieneTexto(solicitud.severidad)) {
    motivos.push("faltaSeveridad");
  }

  if (transicion.requiereResultadosDePrueba && !solicitud.resultadosDePruebaDisponibles) {
    motivos.push("faltanResultadosDePrueba");
  }

  if (solicitud.masiva && !transicion.admiteMasiva) {
    motivos.push("noAdmiteOperacionMasiva");
  }

  return motivos.length === 0 ? { valida: true, transicion } : { valida: false, motivos };
}

function tieneTexto(valor: string | null | undefined): boolean {
  return typeof valor === "string" && valor.trim().length > 0;
}
