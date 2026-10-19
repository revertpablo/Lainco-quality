import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { configuracionBase } from "@/auth/config";
import { aParametros, leerFiltros } from "@/dominio/filtros";

/**
 * Antes de cada pedido: sin sesión, a la pantalla de ingreso (o 401 en la API).
 *
 * Es un filtro grueso: solo mira que haya una cookie de sesión válida, sin ir a la base.
 * Quién es y qué rol tiene lo verifican las páginas y los handlers con
 * src/auth/sesion.ts, al lado de los datos.
 *
 * Quedan afuera (ver `matcher`): la pantalla de ingreso, las rutas de Auth.js, el chequeo
 * de salud, los jobs de cron (se autentican con CRON_SECRET) y los archivos estáticos.
 */
const { auth } = NextAuth(configuracionBase);

export const proxy = auth((pedido) => {
  if (pedido.auth) {
    return urlCanonicaDelInventario(pedido.nextUrl) ?? NextResponse.next();
  }

  if (pedido.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "sinSesion", mensaje: "Hace falta iniciar sesión." }, { status: 401 });
  }

  const ingresar = new URL("/ingresar", pedido.nextUrl);
  const destino = pedido.nextUrl.pathname + pedido.nextUrl.search;
  if (destino !== "/") {
    ingresar.searchParams.set("desde", destino);
  }
  return NextResponse.redirect(ingresar);
});

/**
 * El inventario tiene una sola URL por búsqueda: sin campos vacíos, sin valores inválidos
 * y siempre en el mismo orden (src/dominio/filtros.ts). Así un link compartido o una
 * vista guardada se ven iguales. Se corrige acá, antes de renderizar, con un 307.
 */
function urlCanonicaDelInventario(url: URL): NextResponse | undefined {
  if (url.pathname !== "/reglas" || url.search === "") {
    return undefined;
  }
  const canonica = aParametros(leerFiltros(url.searchParams));
  if (canonica === url.searchParams.toString()) {
    return undefined;
  }
  const destino = new URL(url);
  destino.search = canonica;
  return NextResponse.redirect(destino, 307);
}

export const config = {
  matcher: ["/((?!ingresar|api/auth|api/salud|api/cron|_next/static|_next/image|favicon\\.ico).*)"],
};
