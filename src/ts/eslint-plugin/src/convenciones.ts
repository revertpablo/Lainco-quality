import { ESLintUtils } from "@typescript-eslint/utils";

/**
 * Documentación de las reglas: `docs/rules/<ID>.md`, con el ID tal cual
 * (`lainco/<nombre>`, decisión T6 de docs/FASE-5.md).
 *
 * Es la cuenta de prueba: al pasar a la cuenta de Lainco hay que cambiarla, igual que el
 * `BaseUrl` de `Convenciones.cs` (ver docs/ESTADO.md, "Cuentas y accesos").
 */
export const URL_BASE_DOCUMENTACION =
  "https://github.com/revertpablo/Lainco-quality/blob/main/docs/rules/lainco";

export function urlDeAyuda(nombre: string): string {
  return `${URL_BASE_DOCUMENTACION}/${nombre}.md`;
}

/** Lo que toda regla de Lainco declara en `meta.docs`, además de lo de ESLint. */
export interface DocumentacionDeRegla {
  /** La categoría del catálogo (`Diseño`, `Seguridad`...). */
  categoria: string;
}

export const crearRegla = ESLintUtils.RuleCreator<DocumentacionDeRegla>(urlDeAyuda);
