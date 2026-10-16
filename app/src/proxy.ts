import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { configuracionBase } from "@/auth/config";

/**
 * Antes de cada pedido: sin sesión, a la pantalla de ingreso (o 401 en la API).
 *
 * Es un filtro grueso: solo mira que haya una cookie de sesión válida, sin ir a la base.
 * Quién es y qué rol tiene lo verifican las páginas y los handlers con
 * src/auth/sesion.ts, al lado de los datos.
 *
 * Quedan afuera (ver `matcher`): la pantalla de ingreso, las rutas de Auth.js, el chequeo
 * de salud y los archivos estáticos.
 */
const { auth } = NextAuth(configuracionBase);

export const proxy = auth((pedido) => {
  if (pedido.auth) {
    return NextResponse.next();
  }

  if (pedido.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  }

  const ingresar = new URL("/ingresar", pedido.nextUrl);
  const destino = pedido.nextUrl.pathname + pedido.nextUrl.search;
  if (destino !== "/") {
    ingresar.searchParams.set("desde", destino);
  }
  return NextResponse.redirect(ingresar);
});

export const config = {
  matcher: ["/((?!ingresar|api/auth|api/salud|_next/static|_next/image|favicon\\.ico).*)"],
};
