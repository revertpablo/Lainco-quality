import { createHash, randomBytes } from "node:crypto";

/**
 * El formato de los tokens de servicio (entrega 6.5, paso 1, decisión E5), sin base ni
 * red: generar uno, su hash y leerlo de un pedido.
 *
 * Un token es "lqs_" seguido de 32 bytes al azar en base64url. El prefijo fijo lo hace
 * reconocible (en un log, en un secret mal pegado) y permite descartar sin ir a la base lo
 * que no es un token de la app. Por tener 256 bits al azar alcanza con un SHA-256 para
 * guardarlo: no hace falta un hash lento como el de una contraseña.
 */

export const PREFIJO_DE_TOKEN = "lqs_";

/** Cuántos caracteres del comienzo se guardan para reconocer el token en un listado. */
export const LARGO_DEL_PREFIJO = 10;

const FORMA_DEL_TOKEN = /^lqs_[A-Za-z0-9_-]{43}$/;

export interface TokenGenerado {
  /** El token: se muestra una sola vez y no se guarda. */
  token: string;
  hash: string;
  prefijo: string;
}

export function generarToken(): TokenGenerado {
  const token = PREFIJO_DE_TOKEN + randomBytes(32).toString("base64url");
  return { token, hash: hashDeToken(token), prefijo: token.slice(0, LARGO_DEL_PREFIJO) };
}

export function hashDeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** El token del encabezado `Authorization: Bearer lqs_...`, o null si no hay uno con esa forma. */
export function leerTokenDelPedido(pedido: Request): string | null {
  const encabezado = pedido.headers.get("authorization");
  const partes = /^Bearer (\S+)$/i.exec(encabezado ?? "");
  const token = partes?.[1];
  return token && FORMA_DEL_TOKEN.test(token) ? token : null;
}
