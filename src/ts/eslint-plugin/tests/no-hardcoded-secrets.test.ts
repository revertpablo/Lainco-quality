import { RuleTester } from "@typescript-eslint/rule-tester";
import * as vitest from "vitest";
import { noHardcodedSecrets } from "../src/reglas/no-hardcoded-secrets.js";

RuleTester.afterAll = vitest.afterAll;
RuleTester.describe = vitest.describe;
RuleTester.it = vitest.it;
RuleTester.itOnly = vitest.it.only;

const ruleTester = new RuleTester();

function error(simbolo: string) {
  return { messageId: "secretoHardcodeado" as const, data: { simbolo } };
}

ruleTester.run("no-hardcoded-secrets", noHardcodedSecrets, {
  valid: [
    // El valor sale de afuera del código.
    "const password = process.env.DB_PASSWORD;",
    "const apiKey = leerSecreto('api-key');",
    "const token = `${prefijo}abc`;",
    // Literales vacíos o con espacios: textos de interfaz, no secretos.
    "const password = '';",
    "const passwordLabel = 'Contraseña';",
    "const password = 'Ingrese su contraseña';",
    // El nombre secreto no es el último: describe otra cosa (T: núcleo del nombre).
    "const passwordMinLength = '8';",
    "const tokenType = 'Bearer';",
    "const secretName = 'db-password';",
    "const tokenUrl = 'https://auth.lainco.com/token';",
    "const PASSWORD_FIELD = 'password';",
    // 'key' solo no es un secreto: tiene demasiados usos legítimos.
    "const key = 'id';",
    "const sortKey = 'nombre';",
    "const cacheKey = 'usuarios';",
    // Nombres que contienen la palabra pero no la tienen como palabra propia.
    "const tokenizer = 'espacios';",
    "const keyboard = 'es';",
    // Tipos literales: describen la forma, no asignan un valor.
    "interface Config { password: 'x' }",
    "type Modo = { token: 'jwt' };",
    // Números y booleanos.
    "const tokenTtl = 3600;",
    "const passwordRequired = true;",
    // Comparar contra un literal no lo asigna.
    "if (password === 'admin') {}",
    // Desestructuración con valor por defecto vacío.
    "const { password = '' } = opciones;",
  ],
  invalid: [
    {
      code: "const password = 'hunter2';",
      errors: [error("password")],
    },
    {
      code: "export const API_KEY = 'clave-de-ejemplo';",
      errors: [error("API_KEY")],
    },
    {
      code: "let githubToken = `ghp_abc123`;",
      errors: [error("githubToken")],
    },
    {
      code: "const db_password = '1234';",
      errors: [error("db_password")],
    },
    {
      code: "const clientSecret = 'abc';",
      errors: [error("clientSecret")],
    },
    {
      code: "const awsAccessKey = 'AKIAIOSFODNN7EXAMPLE';",
      errors: [error("awsAccessKey")],
    },
    {
      code: "const privateKey = '-----BEGIN';",
      errors: [error("privateKey")],
    },
    {
      code: "const credentials = 'usuario:clave';",
      errors: [error("credentials")],
    },
    {
      code: "const passwd = 'x1';",
      errors: [error("passwd")],
    },
    {
      code: "class DbConfig { password = 'hunter2'; }",
      errors: [error("DbConfig.password")],
    },
    {
      code: "class DbConfig { private readonly apiKey: string = 'abc'; }",
      errors: [error("DbConfig.apiKey")],
    },
    {
      code: "class DbConfig { static token = 'abc'; }",
      errors: [error("DbConfig.token")],
    },
    {
      code: "const config = { db: { password: 'hunter2' } };",
      errors: [error("config.db.password")],
    },
    {
      code: "const config = { 'api-key': 'abc' };",
      errors: [error("config.api-key")],
    },
    {
      code: "export default { authToken: 'abc' };",
      errors: [error("default.authToken")],
    },
    {
      code: "class Conexion { abrir() { const token = 'abc'; } }",
      errors: [error("Conexion.abrir.token")],
    },
    {
      code: "function conectar() { const password = 'abc'; }",
      errors: [error("conectar.password")],
    },
    {
      code: "const conectar = () => { const password = 'abc'; };",
      errors: [error("conectar.password")],
    },
    {
      code: "class DbConfig { constructor() { this.password = 'abc'; } }",
      errors: [error("DbConfig.password")],
    },
    {
      code: "opciones.auth.password = 'abc';",
      errors: [error("opciones.auth.password")],
    },
    {
      code: "function conectar(password = 'abc') {}",
      errors: [error("conectar.password")],
    },
    {
      code: "const { password = 'abc' } = opciones;",
      errors: [error("password")],
    },
    {
      code: "conectar({ usuario: 'admin', password: 'abc' });",
      errors: [error("password")],
    },
    {
      code: "const a = 'x', secret = 'abc';",
      errors: [error("secret")],
    },
    {
      code: "const servicio = { conectar() { const token = 'abc'; } };",
      errors: [error("servicio.conectar.token")],
    },
    {
      code: "const password: string = 'abc' as string;",
      errors: [error("password")],
    },
  ],
});
