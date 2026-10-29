import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generarToken, hashDeToken, LARGO_DEL_PREFIJO, leerTokenDelPedido, PREFIJO_DE_TOKEN } from "@/servicio/token";

/**
 * Tokens de servicio (entrega 6.5, paso 1, decisión E5): el formato del token, su hash y
 * cómo se lee del pedido. Sin base.
 */

describe("generarToken", () => {
  it("da un token con el prefijo de la app y 32 bytes al azar en base64url", () => {
    const { token } = generarToken();

    expect(token.startsWith(PREFIJO_DE_TOKEN)).toBe(true);
    expect(token).toMatch(/^lqs_[A-Za-z0-9_-]{43}$/);
  });

  it("guarda el SHA-256 del token, nunca el token", () => {
    const { token, hash } = generarToken();

    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("el prefijo alcanza para reconocerlo en un listado sin revelarlo", () => {
    const { token, prefijo } = generarToken();

    expect(prefijo).toBe(token.slice(0, LARGO_DEL_PREFIJO));
    expect(prefijo.length).toBeLessThan(token.length / 3);
  });

  it("dos tokens nunca son iguales", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generarToken().token));

    expect(tokens.size).toBe(50);
  });
});

describe("hashDeToken", () => {
  it("es el mismo para el mismo token", () => {
    const { token, hash } = generarToken();

    expect(hashDeToken(token)).toBe(hash);
  });
});

describe("leerTokenDelPedido", () => {
  const pedido = (authorization?: string) =>
    new Request("https://app.test/api/ci/prueba", authorization === undefined ? {} : { headers: { authorization } });

  it("lee el token de un encabezado Bearer", () => {
    const { token } = generarToken();

    expect(leerTokenDelPedido(pedido(`Bearer ${token}`))).toBe(token);
  });

  it("acepta el esquema en cualquier caja", () => {
    const { token } = generarToken();

    expect(leerTokenDelPedido(pedido(`bearer ${token}`))).toBe(token);
  });

  it.each([
    ["sin encabezado", undefined],
    ["vacío", ""],
    ["otro esquema", `Basic ${generarToken().token}`],
    ["sin el prefijo de la app", "Bearer abc"],
    ["el CRON_SECRET u otro secreto", "Bearer un-secreto-cualquiera"],
    ["con un caracter de más", `Bearer ${generarToken().token}x`],
    ["con espacios en el token", `Bearer lqs_ ${"a".repeat(42)}`],
  ])("%s: no hay token", (_caso, authorization) => {
    expect(leerTokenDelPedido(pedido(authorization))).toBeNull();
  });
});
