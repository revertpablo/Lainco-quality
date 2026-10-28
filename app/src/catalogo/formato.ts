import { z } from "zod";

import type { ReglaDelOrigen } from "@/dominio/sincronizacion";

/**
 * El catálogo de reglas propias (docs/catalogo-de-reglas.md; entrega 6.4, decisión R1):
 * el JSON que genera el build de cada paquete de reglas propias y que se adjunta a su
 * release de GitHub. Lo lee el job `sincronizar-roslyn` (y el de ESLint, en la Fase 5).
 *
 * El formato es común a Roslyn y ESLint. Los campos que no se conocen se ignoran (agregar
 * un campo opcional no cambia el número de formato); un formato que no se conoce se
 * rechaza entero.
 */

/** La versión del formato que entiende la app. */
export const FORMATO_DEL_CATALOGO = 1;

/** Los orígenes que tienen catálogo de reglas propias. */
export type OrigenConCatalogo = "roslyn" | "eslint";

/** Cómo es la clave de una regla propia de cada origen (CLAUDE.md, "Convenciones para reglas propias"). */
const FORMA_DE_LA_CLAVE: Record<OrigenConCatalogo, { patron: RegExp; texto: string }> = {
  roslyn: { patron: /^LAIN[0-9]{3}$/, texto: "LAIN###" },
  eslint: { patron: /^lainco\/[a-z0-9]+(-[a-z0-9]+)*$/, texto: "lainco/<nombre-kebab>" },
};

const esquemaDeRegla = z.object({
  clave: z.string().min(1),
  titulo: z.string().min(1),
  descripcion: z.string().nullable(),
  categoria: z.string().min(1),
  // Nunca "error" (CLAUDE.md): el generador ya lo rechaza, y la app también.
  severidadPorDefecto: z.enum(["silent", "suggestion", "warning"]),
  habilitadaPorDefecto: z.boolean(),
  ayuda: z.string(),
  documentacion: z.string().min(1),
});

const esquemaDelCatalogo = z.object({
  formato: z.literal(FORMATO_DEL_CATALOGO),
  origen: z.enum(["roslyn", "eslint"]),
  paquete: z.string().min(1),
  version: z.string().min(1),
  lenguaje: z.enum(["cs", "ts"]),
  reglas: z.array(esquemaDeRegla).min(1),
});

export type CatalogoDeReglas = z.infer<typeof esquemaDelCatalogo>;
export type ReglaDelCatalogo = CatalogoDeReglas["reglas"][number];

/** El catálogo no se puede usar. El mensaje dice por qué. */
export class ErrorDeCatalogo extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeCatalogo";
  }
}

/** Valida el JSON de un catálogo. Lanza {@link ErrorDeCatalogo} si no sirve. */
export function leerCatalogo(contenido: unknown, origenEsperado: OrigenConCatalogo): CatalogoDeReglas {
  const formato = typeof contenido === "object" && contenido !== null ? (contenido as { formato?: unknown }).formato : undefined;
  if (typeof formato === "number" && formato !== FORMATO_DEL_CATALOGO) {
    throw new ErrorDeCatalogo(
      `El catálogo tiene el formato ${formato} y la app conoce el ${FORMATO_DEL_CATALOGO}: hay que actualizar la app.`,
    );
  }

  const leido = esquemaDelCatalogo.safeParse(contenido);
  if (!leido.success) {
    throw new ErrorDeCatalogo(`El catálogo no tiene el formato esperado: ${z.prettifyError(leido.error)}`);
  }
  const catalogo = leido.data;

  if (catalogo.origen !== origenEsperado) {
    throw new ErrorDeCatalogo(`El catálogo es de '${catalogo.origen}' y se esperaba uno de '${origenEsperado}'.`);
  }

  const forma = FORMA_DE_LA_CLAVE[catalogo.origen];
  const vistas = new Set<string>();
  for (const { clave } of catalogo.reglas) {
    if (!forma.patron.test(clave)) {
      throw new ErrorDeCatalogo(`La regla '${clave}' no tiene una clave de ${nombreDelOrigen(catalogo.origen)} (${forma.texto}).`);
    }
    if (vistas.has(clave)) {
      throw new ErrorDeCatalogo(`La regla ${clave} está repetida en el catálogo.`);
    }
    vistas.add(clave);
  }

  return catalogo;
}

/**
 * Las reglas del catálogo en la forma que compara la sincronización
 * (src/dominio/sincronizacion.ts), la misma que las de Sonar:
 *
 * - el título es el nombre, y la documentación completa (markdown) es la descripción: si
 *   cambia, la regla está modificada, como cuando cambia la descripción en Sonar;
 * - la severidad es la del descriptor, con las palabras del `.globalconfig` (R3);
 * - la categoría va como tag, para filtrar y descartar por categoría;
 * - no tienen tipo, atributo de clean code, impactos ni parámetros, que son de Sonar;
 * - no hay deprecación: una regla que deja de estar en el catálogo se eliminó.
 */
export function reglasDelCatalogo(catalogo: CatalogoDeReglas): ReglaDelOrigen[] {
  return catalogo.reglas.map((r) => ({
    clave: r.clave,
    nombre: r.titulo,
    lenguaje: catalogo.lenguaje,
    estado: "READY",
    tipo: null,
    severidad: r.severidadPorDefecto,
    tags: [r.categoria.toLocaleLowerCase("es")],
    atributoCleanCode: null,
    impactos: [],
    parametros: [],
    descripcion: r.documentacion,
  }));
}

function nombreDelOrigen(origen: OrigenConCatalogo): string {
  return origen === "roslyn" ? "Roslyn" : "ESLint";
}
