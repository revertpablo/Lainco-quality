/**
 * Códigos de los conjuntos cerrados de valores del dominio.
 *
 * Cada conjunto tiene su tabla de referencia en la base (`estado`, `origen`, ...), con
 * el mismo `codigo` y una `descripcion`: el texto que se muestra al usuario. El código
 * es fijo y es lo que usa el programa; la descripción se puede cambiar en la base sin
 * tocar código.
 *
 * Los valores de las tablas se cargan en la migración `valores_de_referencia`. Si se
 * agrega un código acá, hay que agregarlo también ahí (con una migración nueva).
 */

/** Estados del ciclo de vida de una regla (FASE-6.md, sección 4). */
export const Estado = {
  PendienteDeAnalizar: "pendienteDeAnalizar",
  EnAnalisis: "enAnalisis",
  EnPrueba: "enPrueba",
  /** Sin acuerdo, o los resultados de la prueba no convencen (2026-10-30). */
  EnDuda: "enDuda",
  Incorporada: "incorporada",
  Descartada: "descartada",
} as const;
export type Estado = (typeof Estado)[keyof typeof Estado];

/** De dónde viene una regla (FASE-6.md, sección 2). */
export const Origen = {
  Sonar: "sonar",
  Roslyn: "roslyn",
  Eslint: "eslint",
  NormaIa: "normaIa",
} as const;
export type Origen = (typeof Origen)[keyof typeof Origen];

export const Lenguaje = {
  CSharp: "cs",
  TypeScript: "ts",
} as const;
export type Lenguaje = (typeof Lenguaje)[keyof typeof Lenguaje];

/** Roles de la app (FASE-6.md, sección 4). Viven en la app, no en el proveedor de identidad. */
export const Rol = {
  Analista: "analista",
  Decisor: "decisor",
} as const;
export type Rol = (typeof Rol)[keyof typeof Rol];

export const EstadoSincronizacion = {
  EnCurso: "enCurso",
  Ok: "ok",
  Error: "error",
} as const;
export type EstadoSincronizacion = (typeof EstadoSincronizacion)[keyof typeof EstadoSincronizacion];

/** Por qué la sincronización avisa sobre una regla (FASE-6.md, sección 3). */
export const MotivoAviso = {
  /** Cambió en el origen (descripción, parámetros o severidad) estando Incorporada o En prueba. */
  Modificada: "modificada",
  /** El origen la marcó deprecada estando Incorporada. */
  Deprecada: "deprecada",
  /** Ya no está en el origen y estaba Incorporada. */
  Eliminada: "eliminada",
} as const;
export type MotivoAviso = (typeof MotivoAviso)[keyof typeof MotivoAviso];

/** En qué está una publicación a Sonar (entrega 6.2; FASE-6-APP.md, sección 8 bis). */
export const EstadoPublicacion = {
  /** Espera a publicarse: recién encolada o con un intento fallido que se va a reintentar. */
  Pendiente: "pendiente",
  Publicada: "publicada",
  /** Agotó los reintentos. Se reintenta a mano. */
  Fallida: "fallida",
} as const;
export type EstadoPublicacion = (typeof EstadoPublicacion)[keyof typeof EstadoPublicacion];

/**
 * Dónde se publica una decisión (entrega 6.4, paso 4). Lo decide el origen de la regla
 * (src/dominio/publicacion.ts).
 */
export const DestinoPublicacion = {
  /** El Quality Profile de Sonar del lenguaje (entrega 6.2). */
  PerfilSonar: "perfilSonar",
  /** El PR que actualiza el `.globalconfig` del paquete de reglas propias (decisiones R4 y R5). */
  PrConfiguracion: "prConfiguracion",
} as const;
export type DestinoPublicacion = (typeof DestinoPublicacion)[keyof typeof DestinoPublicacion];

/** Qué se le pide a Sonar al publicar: la regla queda como dice la app. */
export const AccionPublicacion = {
  /** Incorporada: activa en el perfil, con la severidad y los parámetros decididos. */
  Activar: "activar",
  /** Cualquier otro estado: inactiva en el perfil. */
  Desactivar: "desactivar",
} as const;
export type AccionPublicacion = (typeof AccionPublicacion)[keyof typeof AccionPublicacion];

/** Diferencias entre lo que dice la app y lo que hay en Sonar (FASE-6.md, sección 10). */
export const TipoDesvio = {
  /** Activa en el perfil sin estar Incorporada (alguien la activó a mano). */
  ActivaSinIncorporar: "activaSinIncorporar",
  /** Incorporada en la app e inactiva en el perfil. */
  IncorporadaInactiva: "incorporadaInactiva",
  /** Activa en los dos lados, con otra severidad en Sonar. */
  SeveridadDistinta: "severidadDistinta",
  /** Activa en los dos lados, con otros valores de parámetros en Sonar. */
  ParametrosDistintos: "parametrosDistintos",
  /** El perfil gestionado hereda de otro. */
  PerfilConHerencia: "perfilConHerencia",
  /** Un proyecto de la organización usa otro perfil para el lenguaje. */
  ProyectoConOtroPerfil: "proyectoConOtroPerfil",
  /**
   * El perfil gestionado no es el default del lenguaje: un proyecto nuevo que no se asocie
   * a mano analizaría con otro (decisión del 2026-10-19).
   */
  PerfilNoEsDefault: "perfilNoEsDefault",
  /**
   * El `.globalconfig` de main no es el que genera la app y no hay un PR de configuración
   * abierto que lo corrija (entrega 6.4, paso 7). Alguien lo cambió a mano, o se cerró el PR
   * sin mergear.
   */
  GlobalconfigDistinto: "globalconfigDistinto",
} as const;
export type TipoDesvio = (typeof TipoDesvio)[keyof typeof TipoDesvio];

/**
 * Los desvíos del paquete de reglas propias (entrega 6.4): los detecta la revisión del
 * paquete, no la reconciliación con Sonar, y se ven en la pantalla Paquete.
 */
export const DESVIOS_DEL_PAQUETE: readonly TipoDesvio[] = [TipoDesvio.GlobalconfigDistinto];

/** En qué está un PR de configuración (entrega 6.4, paso 7), según GitHub. */
export const EstadoPr = {
  Abierto: "abierto",
  Mergeado: "mergeado",
  /** Cerrado sin mergear. */
  Cerrado: "cerrado",
} as const;
export type EstadoPr = (typeof EstadoPr)[keyof typeof EstadoPr];

/**
 * Para qué sirve un token de servicio (entrega 6.5, paso 1, decisión E5): cada ruta de
 * /api/ci/ pide un alcance, y un token solo entra a las de su alcance.
 */
export const AlcanceToken = {
  /** El job de prueba: pide la configuración y sube los resultados (entrega 6.5). */
  Prueba: "prueba",
} as const;
export type AlcanceToken = (typeof AlcanceToken)[keyof typeof AlcanceToken];

/** En qué está una corrida del job de prueba (entrega 6.5). */
export const EstadoCorrida = {
  /** La abrió el job al pedir la configuración; faltan resultados de algún repositorio. */
  EnCurso: "enCurso",
  /** Llegaron los resultados de todos sus repositorios (alguno puede no haber compilado). */
  Terminada: "terminada",
  /** No terminó: el job falló o la reemplazó una corrida nueva. */
  Fallida: "fallida",
} as const;
export type EstadoCorrida = (typeof EstadoCorrida)[keyof typeof EstadoCorrida];

/** Cómo le fue a un repositorio en una corrida de prueba (entrega 6.5). */
export const EstadoRepositorioPrueba = {
  Ok: "ok",
  /** No compiló, o el job no pudo analizarlo: el error queda en la corrida. */
  Error: "error",
} as const;
export type EstadoRepositorioPrueba = (typeof EstadoRepositorioPrueba)[keyof typeof EstadoRepositorioPrueba];

/** Lo que dijo el equipo de una muestra de issue de una regla en prueba (entrega 6.5, E6). */
export const EvaluacionMuestra = {
  SinEvaluar: "sinEvaluar",
  Valida: "valida",
  FalsoPositivo: "falsoPositivo",
} as const;
export type EvaluacionMuestra = (typeof EvaluacionMuestra)[keyof typeof EvaluacionMuestra];
