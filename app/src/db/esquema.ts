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
  uuid,
} from "drizzle-orm/pg-core";

import type { Estado, EstadoSincronizacion, Lenguaje, Origen, Rol } from "@/dominio/valores";

/**
 * Esquema de la base de la app de catálogo (entrega 6.1).
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
 * Solo están las tablas de la entrega 6.1. Las de las entregas siguientes (publicación,
 * sugerencias de IA, relaciones, grupos de equivalencia, pruebas, tokens de servicio)
 * se agregan con su propia migración cuando se implementan.
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
    filtros: jsonb().notNull().$type<Record<string, unknown>>(),
    compartida: boolean().notNull().default(false),
    creadaEn: fechaDeAlta(),
  },
  (t) => [
    primaryKey({ name: "vistaGuardadaPk", columns: [t.id] }),
    foreignKey({ name: "vistaGuardadaUsuario", columns: [t.usuarioId], foreignColumns: [usuario.id] }).onDelete("cascade"),
    unique("vistaGuardadaUsuarioNombre").on(t.usuarioId, t.nombre),
  ],
);
