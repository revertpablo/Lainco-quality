import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { crearRegla } from "../convenciones.js";
import { nombreCalificado, nombreDeClave, palabras } from "../nombres.js";

/** Palabras que, como núcleo del nombre, dicen que el valor es un secreto. */
const PALABRAS_SECRETAS = new Set([
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "secret",
  "token",
  "credential",
  "credentials",
  "apikey",
  "accesskey",
  "privatekey",
  "secretkey",
]);

/** `key` solo es un secreto con uno de estos adelante: `apiKey`, `ACCESS_KEY`... */
const CALIFICADORES_DE_KEY = new Set([
  "api",
  "access",
  "private",
  "secret",
  "encryption",
  "signing",
  "master",
  "auth",
]);

/**
 * Un nombre es de un secreto si su núcleo, la última palabra, lo es. `dbPassword` sí;
 * `passwordLabel` o `tokenType` no: nombran algo sobre el secreto, no el secreto.
 */
export function esNombreDeSecreto(nombre: string): boolean {
  const partes = palabras(nombre);
  const ultima = partes.at(-1);
  if (ultima === undefined) {
    return false;
  }
  if (PALABRAS_SECRETAS.has(ultima)) {
    return true;
  }
  const anterior = partes.at(-2);
  return ultima === "key" && anterior !== undefined && CALIFICADORES_DE_KEY.has(anterior);
}

/**
 * El valor es un literal que puede ser un secreto: un texto no vacío y sin espacios. Un
 * texto con espacios es de interfaz (`'Ingrese su contraseña'`), no una credencial.
 */
function esValorSecreto(valor: TSESTree.Node): boolean {
  const texto = textoLiteral(sinAnotaciones(valor));
  return texto !== null && texto.length > 0 && !/\s/.test(texto);
}

function sinAnotaciones(valor: TSESTree.Node): TSESTree.Node {
  let actual = valor;
  while (
    actual.type === AST_NODE_TYPES.TSAsExpression ||
    actual.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    actual.type === AST_NODE_TYPES.TSNonNullExpression
  ) {
    actual = actual.expression;
  }
  return actual;
}

function textoLiteral(valor: TSESTree.Node): string | null {
  if (valor.type === AST_NODE_TYPES.Literal && typeof valor.value === "string") {
    return valor.value;
  }
  if (valor.type === AST_NODE_TYPES.TemplateLiteral && valor.expressions.length === 0) {
    return valor.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  }
  return null;
}

/** `opciones.auth.password` → `["opciones", "auth", "password"]`; `null` si algo se calcula. */
function cadenaDeMiembros(expresion: TSESTree.Expression): string[] | null {
  if (expresion.type === AST_NODE_TYPES.Identifier) {
    return [expresion.name];
  }
  if (expresion.type === AST_NODE_TYPES.MemberExpression && !expresion.computed) {
    const objeto = cadenaDeMiembros(expresion.object);
    const propiedad = nombreDeClave(expresion.property, false);
    return objeto && propiedad ? [...objeto, propiedad] : null;
  }
  return null;
}

function claseQueContiene(nodo: TSESTree.Node): TSESTree.ClassDeclaration | TSESTree.ClassExpression | null {
  for (let actual = nodo.parent; actual; actual = actual.parent) {
    if (actual.type === AST_NODE_TYPES.ClassDeclaration || actual.type === AST_NODE_TYPES.ClassExpression) {
      return actual;
    }
  }
  return null;
}

export const noHardcodedSecrets = crearRegla({
  name: "no-hardcoded-secrets",
  meta: {
    type: "problem",
    docs: {
      description: "No se permiten secretos escritos en el código",
      categoria: "Seguridad",
    },
    messages: {
      secretoHardcodeado: "Secreto hardcodeado en '{{simbolo}}'",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    function revisar(nombre: string | null, valor: TSESTree.Node | null, simbolo: () => string) {
      if (nombre !== null && valor !== null && esNombreDeSecreto(nombre) && esValorSecreto(valor)) {
        context.report({ node: valor, messageId: "secretoHardcodeado", data: { simbolo: simbolo() } });
      }
    }

    return {
      VariableDeclarator(nodo) {
        if (nodo.id.type === AST_NODE_TYPES.Identifier) {
          const nombre = nodo.id.name;
          revisar(nombre, nodo.init, () => nombreCalificado(nodo.parent, nombre));
        }
      },
      PropertyDefinition(nodo) {
        const nombre = nombreDeClave(nodo.key, nodo.computed);
        revisar(nombre, nodo.value, () => nombreCalificado(nodo.parent, nombre ?? ""));
      },
      Property(nodo) {
        // En una desestructuración el valor es el patrón; el default lo mira AssignmentPattern.
        if (nodo.parent.type === AST_NODE_TYPES.ObjectExpression) {
          const nombre = nombreDeClave(nodo.key, nodo.computed);
          revisar(nombre, nodo.value, () => nombreCalificado(nodo.parent, nombre ?? ""));
        }
      },
      AssignmentPattern(nodo) {
        if (nodo.left.type === AST_NODE_TYPES.Identifier) {
          const nombre = nodo.left.name;
          revisar(nombre, nodo.right, () => nombreCalificado(nodo.parent, nombre));
        }
      },
      AssignmentExpression(nodo) {
        if (nodo.operator !== "=") {
          return;
        }
        const izquierda = nodo.left;
        if (izquierda.type === AST_NODE_TYPES.Identifier) {
          revisar(izquierda.name, nodo.right, () => nombreCalificado(nodo.parent, izquierda.name));
          return;
        }
        if (izquierda.type !== AST_NODE_TYPES.MemberExpression) {
          return;
        }
        const nombre = nombreDeClave(izquierda.property, izquierda.computed);
        if (izquierda.object.type === AST_NODE_TYPES.ThisExpression) {
          // `this.password = ...` es la property de la clase: se califica con la clase.
          const clase = claseQueContiene(nodo);
          revisar(nombre, nodo.right, () => nombreCalificado(clase ?? nodo.parent, nombre ?? ""));
          return;
        }
        const cadena = cadenaDeMiembros(izquierda);
        if (cadena !== null) {
          revisar(nombre, nodo.right, () => nombreCalificado(nodo.parent, cadena.join(".")));
        }
      },
    };
  },
});
