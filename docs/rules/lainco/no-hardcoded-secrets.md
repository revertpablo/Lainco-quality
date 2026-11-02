# lainco/no-hardcoded-secrets — No se permiten secretos escritos en el código

| | |
|---|---|
| **Categoría** | Seguridad |
| **Severidad por defecto** | Warning |
| **Lenguaje** | TypeScript / JavaScript |
| **Origen** | Regla propia (ESLint) |

## Qué detecta

Un texto literal asignado a algo cuyo nombre dice que es un secreto: una contraseña, un
token, una API key, una clave privada.

```ts
const dbPassword = "hunter2";
```

## Por qué

Un secreto en el código queda en el historial de git para siempre, en cada clon, en cada
build y en cada bundle que llega al navegador. Borrarlo después no alcanza: hay que
rotarlo. Es una de las causas más comunes de filtraciones (OWASP Top 10, A07:
*Identification and Authentication Failures*), y ninguno de los presets habituales
(`eslint:recommended`, typescript-eslint, React) la controla.

El valor tiene que venir de afuera del código: variables de entorno, un gestor de secretos
o la configuración del entorno de ejecución.

## Cuándo un nombre es de un secreto

Se mira el **núcleo** del nombre, su última palabra (separando camelCase, snake_case,
SCREAMING_CASE y kebab-case):

| Núcleo | Ejemplos que disparan |
|---|---|
| `password`, `passwd`, `pwd`, `passphrase` | `password`, `dbPassword`, `DB_PASSWORD` |
| `secret` | `clientSecret`, `JWT_SECRET` |
| `token` | `githubToken`, `accessToken` |
| `credential`, `credentials` | `credentials` |
| `key` precedida de `api`, `access`, `private`, `secret`, `encryption`, `signing`, `master` o `auth` | `apiKey`, `AWS_ACCESS_KEY`, `privateKey` |

Un nombre que **habla de** un secreto pero no lo es no dispara: `passwordLabel`,
`tokenType`, `secretName`, `tokenUrl`, `PASSWORD_FIELD`. Tampoco `key` sola (`sortKey`,
`cacheKey`): tiene demasiados usos legítimos.

## Cuándo un valor puede ser un secreto

Un texto literal (comillas o template literal sin `${}`) **no vacío y sin espacios**. Un
texto con espacios es de interfaz (`"Ingrese su contraseña"`), no una credencial. Las
anotaciones de tipo (`as`, `satisfies`, `!`) no cambian nada.

## Dónde mira

| Caso | Ejemplo | Símbolo del mensaje |
|---|---|---|
| Variable | `const apiKey = "abc";` | `apiKey` |
| Property de clase | `class DbConfig { password = "abc"; }` | `DbConfig.password` |
| `this.` en una clase | `this.password = "abc";` | `DbConfig.password` |
| Objeto literal | `const config = { db: { password: "abc" } };` | `config.db.password` |
| Asignación a un miembro | `opciones.auth.password = "abc";` | `opciones.auth.password` |
| Parámetro con valor por defecto | `function conectar(password = "abc") {}` | `conectar.password` |
| Desestructuración con valor por defecto | `const { password = "abc" } = opciones;` | `password` |
| Variable dentro de un método | `class Conexion { abrir() { const token = "abc"; } }` | `Conexion.abrir.token` |

## Ejemplos

### Incorrecto

```ts
export const API_KEY = "clave-de-ejemplo";

class DbConfig {
  password = "hunter2";
}
```

### Correcto

```ts
export const API_KEY = process.env.API_KEY;

class DbConfig {
  constructor(readonly password: string) {}
}
```

## Qué no detecta

| Caso | Ejemplo |
|---|---|
| Valores que no son literales. | `const token = leerSecreto("token");` |
| Tipos literales: describen una forma, no asignan. | `interface Config { password: "x" }` |
| Comparaciones. | `if (password === "admin") {}` |
| Números y booleanos. | `const tokenTtl = 3600;` |
| Secretos en un nombre que no lo dice. | `const valor = "sk_live_...";` |

El último caso es deliberado: detectar secretos por la forma del valor (entropía,
prefijos de proveedores) es trabajo de un escáner de secretos sobre el repositorio, no de
una regla de lint.

## Mensaje

```
Secreto hardcodeado en 'DbConfig.password'
```

El mensaje lleva el nombre calificado del símbolo dentro de su módulo (decisión T5 de
`docs/FASE-5.md`). Es lo que permite a SonarQube reconocer un issue ya aceptado aunque el
código se mueva de línea.

## Excepciones

No hay excepciones en la regla. Un secreto de prueba en un test, o un valor que no es un
secreto aunque su nombre lo parezca, se acepta en SonarQube con la justificación del
revisor. **No** se usa `// eslint-disable` (ver CLAUDE.md, "Gobernanza").

## Implementación

- Regla: `src/ts/eslint-plugin/src/reglas/no-hardcoded-secrets.ts`
- Tests: `src/ts/eslint-plugin/tests/no-hardcoded-secrets.test.ts`
