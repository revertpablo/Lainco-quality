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
  ARevisar: "aRevisar",
  EnPrueba: "enPrueba",
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
