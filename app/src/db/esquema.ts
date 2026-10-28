import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  AccionPublicacion,
  DestinoPublicacion,
  Estado,
  EstadoPr,
  EstadoPublicacion,
  EstadoSincronizacion,
  Lenguaje,
  MotivoAviso,
  Origen,
  Rol,
  TipoDesvio,
} from "@/dominio/valores";

/**
 * Esquema de la base de la app de catálogo (entregas 6.1 y 6.2).
 *
 * Traduce el modelo de la sección 11 de docs/FASE-6.md según la sección 3 de
 * docs/FASE-6-APP.md.
 *
 * Convenciones:
 * - Tablas, columnas, índices y restricciones en **camelCase**, igual que en TypeScript.
 *   En SQL escrito a mano hay que ponerlos entre comillas: `select "reglaId" from
 *   "estadoRegla"`.
 * - Los conjuntos cerrados de valores (estados, orígenes, roles...) son **tablas de
 *   referencia** con `codigo` (fijo, lo usa el programa; ver src/dominio/valores.ts) y
 *   `descripcion` (el texto que ve el usuario). Las columnas que los usan son claves
 *   foráneas a `codigo`.
 *
 * Están las tablas de la entrega 6.1 (con `aviso`, agregada en el paso 6) y las de la
 * publicación a Sonar de la 6.2 (`publicacion` y `desvio`). Las de las entregas
 * siguientes (sugerencias de IA, relaciones, grupos de equivalencia, pruebas, tokens de
 * servicio) se agregan con su propia migración cuando se implementan.
 */

const fechaDeAlta = () => timestamp({ withTimezone: true }).notNull().defaultNow();

// ------------------------------------------------------------ tablas de referencia

/**
 * Tabla de referencia: código fijo + texto para mostrar + orden en los listados.
 * Sus filas se cargan en la migración `valores_de_referencia`.
 */
function tablaDeReferencia<T extends string>(nombre: string) {
  return pgTable(
    nombre,
    {
      codigo: text().$type<T>().notNull(),
      descripcion: text().notNull(),
      orden: integer().notNull(),
    },
    (t) => [primaryKey({ name: `${nombre}Pk`, columns: [t.codigo] })],
  );
}

export const estado = tablaDeReferencia<Estado>("estado");
export const origen = tablaDeReferencia<Origen>("origen");
export const lenguaje = tablaDeReferencia<Lenguaje>("lenguaje");
export const rol = tablaDeReferencia<Rol>("rol");
export const estadoSincronizacion = tablaDeReferencia<EstadoSincronizacion>("estadoSincronizacion");
export const motivoAviso = tablaDeReferencia<MotivoAviso>("motivoAviso");
export const estadoPublicacion = tablaDeReferencia<EstadoPublicacion>("estadoPublicacion");
export const accionPublicacion = tablaDeReferencia<AccionPublicacion>("accionPublicacion");
export const destinoPublicacion = tablaDeReferencia<DestinoPublicacion>("destinoPublicacion");
export const tipoDesvio = tablaDeReferencia<TipoDesvio>("tipoDesvio");
export const estadoPr = tablaDeReferencia<EstadoPr>("estadoPr");

// ---------------------------------------------------------------------- usuario

/**
 * Quién puede entrar y con qué rol.
 *
 * Se entra con Google (cuenta del dominio de Lainco: se identifica por `email`) o con
 * GitHub (solo usuarios dados de alta: se identifica por `githubLogin`). Al menos uno de
 * los dos tiene que estar.
 */
export const usuario = pgTable(
  "usuario",
  {
    id: uuid().notNull().defaultRandom(),
    nombre: text().notNull(),
    email: text(),
    githubLogin: text(),
    rol: text().$type<Rol>().notNull().default("analista"),
    activo: boolean().notNull().default(true),
    creadoEn: fechaDeAlta(),
  },
  (t) => [
    primaryKey({ name: "usuarioPk", columns: [t.id] }),
    foreignKey({ name: "usuarioRol", columns: [t.rol], foreignColumns: [rol.codigo] }),
    unique("usuarioEmail").on(t.email),
    unique("usuarioGithubLogin").on(t.githubLogin),
    check("usuarioConIdentidad", sql`${t.email} is not null or ${t.githubLogin} is not null`),
    // Email y login de GitHub en minúsculas: ninguno de los dos distingue mayúsculas, y
    // así la búsqueda al iniciar sesión es una comparación exacta.
    check("usuarioEmailEnMinusculas", sql`${t.email} = lower(${t.email})`),
    check("usuarioGithubLoginEnMinusculas", sql`${t.githubLogin} = lower(${t.githubLogin})`),
  ],
);

// ---------------------------------------------------------------- sincronizacion

/** Log de cada corrida del job de sincronización con Sonar (FASE-6.md, sección 3). */
export const sincronizacion = pgTable("sincronizacion", {
  id: uuid().notNull().defaultRandom(),
  origen: text().$type<Origen>().notNull(),
  iniciadaEn: fechaDeAlta(),
  terminadaEn: timestamp({ withTimezone: true }),
  estado: text().$type<EstadoSincronizacion>().notNull().default("enCurso"),
  nuevas: integer().notNull().default(0),
  modificadas: integer().notNull().default(0),
  deprecadas: integer().notNull().default(0),
  error: text(),
  /** Quién la disparó desde la app. Null si la disparó el cron. */
  disparadaPorId: uuid(),
  /**
   * Qué se sincronizó, en los orígenes con paquete propio: `Lainco.Analyzers 0.1.0`
   * (entrega 6.4). Null en Sonar, y si la corrida falló antes de leer el catálogo.
   */
  version: text(),
}, (t) => [
  primaryKey({ name: "sincronizacionPk", columns: [t.id] }),
    foreignKey({ name: "sincronizacionOrigen", columns: [t.origen], foreignColumns: [origen.codigo] }),
    foreignKey({ name: "sincronizacionEstado", columns: [t.estado], foreignColumns: [estadoSincronizacion.codigo] }),
    foreignKey({ name: "sincronizacionDisparadaPor", columns: [t.disparadaPorId], foreignColumns: [usuario.id] }),
]);

// ------------------------------------------------------------------------- regla

/** Una regla del inventario, de cualquier origen. Clave natural: (origen, clave). */
export const regla = pgTable(
  "regla",
  {
    id: uuid().notNull().defaultRandom(),
    origen: text().$type<Origen>().notNull(),
    /** Clave del origen: `csharpsquid:S2325`, `LAIN005`, `lainco/no-...`. */
    clave: text().notNull(),
    lenguaje: text().$type<Lenguaje>().notNull(),
    nombre: text().notNull(),
    descripcion: text().notNull().default(""),
    /** Tipo del origen (en Sonar: BUG, VULNERABILITY, CODE_SMELL, SECURITY_HOTSPOT). */
    tipo: text(),
    severidadDefault: text(),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    /** Atributo de clean code de Sonar (CONVENTIONAL, CLEAR, ...). */
    atributoCleanCode: text(),
    /** Impactos de Sonar: [{ calidad, severidad }]. */
    impactos: jsonb().$type<{ calidad: string; severidad: string }[]>(),
    /** Definición de los parámetros, si la regla tiene. */
    parametros: jsonb().$type<{ clave: string; descripcion?: string; tipo?: string; valorDefault?: string }[]>(),
    /** Hash de lo que importa para detectar que la regla cambió en el origen. */
    hashDescripcion: text().notNull(),
    deprecadaEn: timestamp({ withTimezone: true }),
    /** Se puede correr fuera de Sonar (entrega 6.5). Null: todavía no se sabe. */
    probableLocalmente: boolean(),
    primeraSincronizacion: fechaDeAlta(),
    ultimaModificacion: fechaDeAlta(),
    /** Sincronización que la trajo por primera vez: filtro "nuevas". */
    altaEnSincronizacionId: uuid(),
    /** Última sincronización que la modificó: filtro "modificadas". */
    modificadaEnSincronizacionId: uuid(),
  },
  (t) => [
    primaryKey({ name: "reglaPk", columns: [t.id] }),
    foreignKey({ name: "reglaOrigen", columns: [t.origen], foreignColumns: [origen.codigo] }),
    foreignKey({ name: "reglaLenguaje", columns: [t.lenguaje], foreignColumns: [lenguaje.codigo] }),
    foreignKey({ name: "reglaAltaEnSincronizacion", columns: [t.altaEnSincronizacionId], foreignColumns: [sincronizacion.id] }),
    foreignKey({ name: "reglaModificadaEnSincronizacion", columns: [t.modificadaEnSincronizacionId], foreignColumns: [sincronizacion.id] }),
    unique("reglaOrigenClave").on(t.origen, t.clave),
    index("reglaLenguajeTipo").on(t.lenguaje, t.tipo),
    // Descarte masivo por tag, la primera operación del triage (FASE-6.md, sección 5).
    index("reglaTags").using("gin", t.tags),
  ],
);

// ---------------------------------------------------------------- estadoRegla

/**
 * Estado actual de cada regla (1:1 con `regla`). Es lo que consulta el generador de
 * configuración. Solo lo modifica la función de dominio `aplicarTransicion`, en la misma
 * transacción que escribe la `decision`.
 */
export const estadoRegla = pgTable(
  "estadoRegla",
  {
    reglaId: uuid().notNull(),
    estado: text().$type<Estado>().notNull().default("pendienteDeAnalizar"),
    severidadAsignada: text(),
    /** Valores elegidos para los parámetros al incorporar. */
    parametros: jsonb().$type<Record<string, string>>(),
    actualizadoEn: fechaDeAlta(),
  },
  (t) => [
    primaryKey({ name: "estadoReglaPk", columns: [t.reglaId] }),
    foreignKey({ name: "estadoReglaRegla", columns: [t.reglaId], foreignColumns: [regla.id] }).onDelete("cascade"),
    foreignKey({ name: "estadoReglaEstado", columns: [t.estado], foreignColumns: [estado.codigo] }),
    index("estadoReglaPorEstado").on(t.estado),
  ],
);

// --------------------------------------------------------------------- decision

/**
 * Historial de decisiones. **Append-only**: nunca se actualiza ni se borra. Una decisión
 * equivocada se revierte con otra decisión. Lo respeta el código: la función de dominio
 * `aplicarTransicion` solo inserta.
 */
export const decision = pgTable(
  "decision",
  {
    id: uuid().notNull().defaultRandom(),
    reglaId: uuid().notNull(),
    estadoAnterior: text().$type<Estado>().notNull(),
    estadoNuevo: text().$type<Estado>().notNull(),
    autorId: uuid().notNull(),
    fecha: fechaDeAlta(),
    justificacion: text(),
    /** Severidad con la que se incorporó, si corresponde. */
    severidad: text(),
    parametros: jsonb().$type<Record<string, string>>(),
    basadaEnSugerencia: boolean().notNull().default(false),
    /** Agrupa las decisiones de una misma operación masiva. */
    loteId: uuid(),
  },
  (t) => [
    primaryKey({ name: "decisionPk", columns: [t.id] }),
    foreignKey({ name: "decisionRegla", columns: [t.reglaId], foreignColumns: [regla.id] }),
    foreignKey({ name: "decisionEstadoAnterior", columns: [t.estadoAnterior], foreignColumns: [estado.codigo] }),
    foreignKey({ name: "decisionEstadoNuevo", columns: [t.estadoNuevo], foreignColumns: [estado.codigo] }),
    foreignKey({ name: "decisionAutor", columns: [t.autorId], foreignColumns: [usuario.id] }),
    index("decisionReglaFecha").on(t.reglaId, t.fecha),
    index("decisionLote").on(t.loteId),
    check("decisionCambiaDeEstado", sql`${t.estadoAnterior} <> ${t.estadoNuevo}`),
  ],
);

// --------------------------------------------------------------- vistaGuardada

/** Conjunto de filtros del inventario guardado con un nombre (FASE-6.md, sección 5). */
export const vistaGuardada = pgTable(
  "vistaGuardada",
  {
    id: uuid().notNull().defaultRandom(),
    nombre: text().notNull(),
    usuarioId: uuid().notNull(),
    /** Los parámetros de la URL del inventario, valor por valor (src/vistas/vistas.ts). */
    filtros: jsonb().notNull().$type<Record<string, string[]>>(),
    compartida: boolean().notNull().default(false),
    creadaEn: fechaDeAlta(),
  },
  (t) => [
    primaryKey({ name: "vistaGuardadaPk", columns: [t.id] }),
    foreignKey({ name: "vistaGuardadaUsuario", columns: [t.usuarioId], foreignColumns: [usuario.id] }).onDelete("cascade"),
    unique("vistaGuardadaUsuarioNombre").on(t.usuarioId, t.nombre),
  ],
);

// ------------------------------------------------------------------------------ aviso

/**
 * Algo que cambió en el origen y obliga a revisar una decisión (FASE-6.md, sección 3):
 * una regla Incorporada o En prueba que cambió en Sonar, o una Incorporada que Sonar
 * deprecó o eliminó. Lo crea la sincronización; queda pendiente hasta que alguien lo da
 * por resuelto.
 */
export const aviso = pgTable(
  "aviso",
  {
    id: uuid().notNull().defaultRandom(),
    reglaId: uuid().notNull(),
    motivo: text().$type<MotivoAviso>().notNull(),
    /** Sincronización que lo generó. */
    sincronizacionId: uuid().notNull(),
    creadoEn: fechaDeAlta(),
    resueltoEn: timestamp({ withTimezone: true }),
    resueltoPorId: uuid(),
  },
  (t) => [
    primaryKey({ name: "avisoPk", columns: [t.id] }),
    foreignKey({ name: "avisoRegla", columns: [t.reglaId], foreignColumns: [regla.id] }).onDelete("cascade"),
    foreignKey({ name: "avisoMotivo", columns: [t.motivo], foreignColumns: [motivoAviso.codigo] }),
    foreignKey({ name: "avisoSincronizacion", columns: [t.sincronizacionId], foreignColumns: [sincronizacion.id] }),
    foreignKey({ name: "avisoResueltoPor", columns: [t.resueltoPorId], foreignColumns: [usuario.id] }),
    index("avisoPorRegla").on(t.reglaId),
    check("avisoResueltoConAutor", sql`(${t.resueltoEn} is null) = (${t.resueltoPorId} is null)`),
  ],
);

// ------------------------------------------------------------------------- desvio

/**
 * Una diferencia entre lo que dice la app y lo que hay en el perfil de Sonar
 * (FASE-6.md, sección 10). La registra la reconciliación (entrega 6.2, paso 5).
 *
 * La app no corrige sola (decisión P1): el desvío queda abierto hasta que desaparece de
 * Sonar, sea porque un decisor lo corrigió desde la app (una `publicacion`) o porque
 * alguien lo arregló en Sonar. Mientras está abierto, cada reconciliación que lo vuelve a
 * ver actualiza `vistoEn`.
 */
export const desvio = pgTable(
  "desvio",
  {
    id: uuid().notNull().defaultRandom(),
    tipo: text().$type<TipoDesvio>().notNull(),
    /** Lenguaje del perfil donde está la diferencia. */
    lenguaje: text().$type<Lenguaje>().notNull(),
    /**
     * Qué tiene la diferencia, tal como lo nombra Sonar: la clave de la regla
     * (`csharpsquid:S2325`), la del proyecto o el nombre del perfil. Una regla activa a
     * mano puede no estar en el inventario, por eso no alcanza con `reglaId`.
     */
    clave: text().notNull(),
    /** La regla del inventario, si la diferencia es sobre una regla que está en él. */
    reglaId: uuid(),
    /** Lo que dice la app y lo que hay en Sonar, para mostrar. */
    detalle: jsonb().$type<{ esperado?: unknown; encontrado?: unknown }>(),
    detectadoEn: fechaDeAlta(),
    /** Última reconciliación que lo vio. */
    vistoEn: fechaDeAlta(),
    /** Cuándo dejó de verse. Null: sigue abierto. */
    resueltoEn: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "desvioPk", columns: [t.id] }),
    foreignKey({ name: "desvioTipo", columns: [t.tipo], foreignColumns: [tipoDesvio.codigo] }),
    foreignKey({ name: "desvioLenguaje", columns: [t.lenguaje], foreignColumns: [lenguaje.codigo] }),
    foreignKey({ name: "desvioRegla", columns: [t.reglaId], foreignColumns: [regla.id] }).onDelete("cascade"),
    // Un mismo desvío abierto una sola vez: la reconciliación lo actualiza en lugar de
    // duplicarlo. Uno resuelto no impide que el mismo desvío vuelva a abrirse.
    uniqueIndex("desvioAbiertoUnico")
      .on(t.tipo, t.lenguaje, t.clave)
      .where(sql`${t.resueltoEn} is null`),
    index("desvioPorRegla").on(t.reglaId),
    check("desvioVistoDespuesDeDetectado", sql`${t.vistoEn} >= ${t.detectadoEn}`),
  ],
);

// -------------------------------------------------------------------- publicacion

/**
 * Outbox de la publicación a Sonar (entrega 6.2; FASE-6-APP.md, secciones 4 y 8 bis).
 *
 * Una fila dice "llevar esta regla, en el perfil de su lenguaje, a lo que dice la app".
 * Qué se publica (activar con tal severidad y parámetros, o desactivar) se decide al
 * publicar, leyendo `estadoRegla`: así, si la regla cambió dos veces antes de publicarse,
 * se publica una sola vez, lo último. `accion`, `severidad` y `parametros` registran lo
 * que se mandó en el último intento.
 *
 * La pide una decisión (`decisionId`) o un decisor que corrige un desvío (`desvioId`):
 * siempre una de las dos.
 */
export const publicacion = pgTable(
  "publicacion",
  {
    id: uuid().notNull().defaultRandom(),
    reglaId: uuid().notNull(),
    /**
     * Dónde se publica: el perfil de Sonar o el PR de configuración del paquete de reglas
     * propias (entrega 6.4, paso 4). Lo decide el origen de la regla.
     */
    destino: text().$type<DestinoPublicacion>().notNull().default("perfilSonar"),
    estado: text().$type<EstadoPublicacion>().notNull().default("pendiente"),
    decisionId: uuid(),
    desvioId: uuid(),
    pedidaPorId: uuid().notNull(),
    creadaEn: fechaDeAlta(),
    intentos: integer().notNull().default(0),
    /** Cuándo se puede volver a intentar (espera creciente entre fallos). */
    proximoIntentoEn: fechaDeAlta(),
    ultimoError: text(),
    accion: text().$type<AccionPublicacion>(),
    severidad: text(),
    parametros: jsonb().$type<Record<string, string>>(),
    publicadaEn: timestamp({ withTimezone: true }),
    /**
     * El PR de configuración que la llevó al paquete (entrega 6.4, paso 6). Null en las del
     * perfil de Sonar, y en una del paquete que no necesitó PR (main ya estaba así).
     */
    prNumero: integer(),
    prUrl: text(),
  },
  (t) => [
    primaryKey({ name: "publicacionPk", columns: [t.id] }),
    foreignKey({ name: "publicacionRegla", columns: [t.reglaId], foreignColumns: [regla.id] }).onDelete("cascade"),
    foreignKey({ name: "publicacionEstado", columns: [t.estado], foreignColumns: [estadoPublicacion.codigo] }),
    foreignKey({ name: "publicacionDecision", columns: [t.decisionId], foreignColumns: [decision.id] }),
    foreignKey({ name: "publicacionDesvio", columns: [t.desvioId], foreignColumns: [desvio.id] }),
    foreignKey({ name: "publicacionPedidaPor", columns: [t.pedidaPorId], foreignColumns: [usuario.id] }),
    foreignKey({ name: "publicacionAccion", columns: [t.accion], foreignColumns: [accionPublicacion.codigo] }),
    foreignKey({ name: "publicacionDestino", columns: [t.destino], foreignColumns: [destinoPublicacion.codigo] }),
    // Una sola pendiente por regla: encolar otra vez la misma regla no duplica.
    uniqueIndex("publicacionPendienteUnica")
      .on(t.reglaId)
      .where(sql`${t.estado} = 'pendiente'`),
    // Lo que busca quien publica: las pendientes cuyo próximo intento ya llegó.
    index("publicacionPorEstado").on(t.estado, t.proximoIntentoEn),
    check("publicacionPorDecisionODesvio", sql`(${t.decisionId} is null) <> (${t.desvioId} is null)`),
    check("publicacionPublicadaConFecha", sql`(${t.estado} = 'publicada') = (${t.publicadaEn} is not null)`),
    check("publicacionPublicadaConAccion", sql`${t.estado} <> 'publicada' or ${t.accion} is not null`),
    check("publicacionIntentosNoNegativos", sql`${t.intentos} >= 0`),
    check("publicacionPrSoloDelPaquete", sql`${t.destino} = 'prConfiguracion' or ${t.prNumero} is null`),
  ],
);

// ---------------------------------------------------------------- reconciliacion

/**
 * Log de cada corrida de la reconciliación con Sonar (entrega 6.2, paso 5): cuándo, cómo
 * terminó y qué encontró. Los desvíos en sí están en `desvio`.
 */
export const reconciliacion = pgTable(
  "reconciliacion",
  {
    id: uuid().notNull().defaultRandom(),
    iniciadaEn: fechaDeAlta(),
    terminadaEn: timestamp({ withTimezone: true }),
    estado: text().$type<EstadoSincronizacion>().notNull().default("enCurso"),
    /** Desvíos abiertos al terminar. */
    abiertos: integer().notNull().default(0),
    /** Desvíos que aparecieron en esta corrida. */
    nuevos: integer().notNull().default(0),
    /** Desvíos que dejaron de verse en esta corrida. */
    resueltos: integer().notNull().default(0),
    /** Lo raro que no es un desvío (por ejemplo, cuentas de Sonar que no coinciden). */
    advertencias: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    error: text(),
    /** Quién la disparó desde la app. Null si la disparó el cron. */
    disparadaPorId: uuid(),
  },
  (t) => [
    primaryKey({ name: "reconciliacionPk", columns: [t.id] }),
    foreignKey({ name: "reconciliacionEstado", columns: [t.estado], foreignColumns: [estadoSincronizacion.codigo] }),
    foreignKey({ name: "reconciliacionDisparadaPor", columns: [t.disparadaPorId], foreignColumns: [usuario.id] }),
  ],
);

// ------------------------------------------------------------ paquete (entrega 6.4)

/**
 * Los PRs de configuración que abrió la app (entrega 6.4, pasos 6 y 7). Los crea y
 * actualiza la publicación en el paquete; su estado lo trae de GitHub la revisión del
 * paquete.
 */
export const prConfiguracion = pgTable(
  "prConfiguracion",
  {
    numero: integer().notNull(),
    url: text().notNull(),
    /** La versión que propone. Null en uno que la app conoció por sus publicaciones, antes del paso 7. */
    version: text(),
    estado: text().$type<EstadoPr>().notNull().default("abierto"),
    creadoEn: fechaDeAlta(),
    /** La última vez que la app le cambió el contenido. */
    actualizadoEn: fechaDeAlta(),
    /** La última vez que se miró su estado en GitHub. */
    revisadoEn: timestamp({ withTimezone: true }),
    mergeadoEn: timestamp({ withTimezone: true }),
    cerradoEn: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "prConfiguracionPk", columns: [t.numero] }),
    foreignKey({ name: "prConfiguracionEstado", columns: [t.estado], foreignColumns: [estadoPr.codigo] }),
    check("prConfiguracionMergeadoConFecha", sql`(${t.estado} = 'mergeado') = (${t.mergeadoEn} is not null)`),
  ],
);

/** Cada revisión del paquete (entrega 6.4, paso 7): el estado de los PRs y si main coincide con la app. */
export const revisionPaquete = pgTable(
  "revisionPaquete",
  {
    id: uuid().notNull().defaultRandom(),
    iniciadaEn: fechaDeAlta(),
    terminadaEn: timestamp({ withTimezone: true }),
    estado: text().$type<EstadoSincronizacion>().notNull().default("enCurso"),
    /** La versión del paquete en main. */
    versionEnMain: text(),
    /** El .globalconfig de main coincide con el que genera la app. */
    coincide: boolean(),
    error: text(),
    /** Quién la disparó desde la app. Null si la disparó el cron. */
    disparadaPorId: uuid(),
  },
  (t) => [
    primaryKey({ name: "revisionPaquetePk", columns: [t.id] }),
    foreignKey({ name: "revisionPaqueteEstado", columns: [t.estado], foreignColumns: [estadoSincronizacion.codigo] }),
    foreignKey({ name: "revisionPaqueteDisparadaPor", columns: [t.disparadaPorId], foreignColumns: [usuario.id] }),
  ],
);
