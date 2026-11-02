import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

/**
 * El nombre calificado de un símbolo dentro de su módulo (decisión T5 de docs/FASE-5.md):
 * la cadena de nombres desde el nivel del módulo hasta el símbolo, separada por puntos.
 * Es lo que va en el mensaje de cada diagnóstico.
 *
 * `desde` es el primer nodo que se mira hacia arriba; `nombre`, el del símbolo mismo.
 */
export function nombreCalificado(desde: TSESTree.Node | undefined, nombre: string): string {
  const partes = [nombre];
  for (let nodo = desde; nodo; nodo = nodo.parent) {
    const parte = nombreDelAmbito(nodo);
    if (parte !== null) {
      partes.push(parte);
    }
  }
  return partes.reverse().join(".");
}

/** El nombre que aporta un nodo a la cadena, o `null` si no aporta ninguno. */
function nombreDelAmbito(nodo: TSESTree.Node): string | null {
  switch (nodo.type) {
    case AST_NODE_TYPES.ClassDeclaration:
    case AST_NODE_TYPES.ClassExpression:
    case AST_NODE_TYPES.FunctionDeclaration:
    case AST_NODE_TYPES.FunctionExpression:
      return nodo.id?.name ?? null;
    case AST_NODE_TYPES.VariableDeclarator:
      return nodo.id.type === AST_NODE_TYPES.Identifier ? nodo.id.name : null;
    case AST_NODE_TYPES.MethodDefinition:
    case AST_NODE_TYPES.PropertyDefinition:
      return nombreDeClave(nodo.key, nodo.computed);
    case AST_NODE_TYPES.Property:
      // Una property de una desestructuración no es un ámbito: no declara nada con ese nombre.
      return nodo.parent.type === AST_NODE_TYPES.ObjectPattern
        ? null
        : nombreDeClave(nodo.key, nodo.computed);
    case AST_NODE_TYPES.ExportDefaultDeclaration:
      // `export default class Foo` ya aporta `Foo`; `export default { ... }` no tiene nombre.
      return "id" in nodo.declaration && nodo.declaration.id ? null : "default";
    default:
      return null;
  }
}

/** El nombre de la clave de una property, o `null` si se calcula en ejecución. */
export function nombreDeClave(clave: TSESTree.Node, calculada: boolean): string | null {
  if (calculada) {
    return null;
  }
  switch (clave.type) {
    case AST_NODE_TYPES.Identifier:
      return clave.name;
    case AST_NODE_TYPES.PrivateIdentifier:
      return `#${clave.name}`;
    case AST_NODE_TYPES.Literal:
      return String(clave.value);
    default:
      return null;
  }
}

/**
 * Las palabras de un identificador, en minúsculas: separa camelCase, PascalCase,
 * snake_case, SCREAMING_CASE y kebab-case. `githubAPIToken` → `github`, `api`, `token`.
 */
export function palabras(identificador: string): string[] {
  return identificador
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((palabra) => palabra.length > 0)
    .map((palabra) => palabra.toLowerCase());
}
