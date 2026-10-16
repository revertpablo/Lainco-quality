import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { DOMINIO_DE_LAINCO } from "@/dominio/acceso";

/**
 * Configuración de Auth.js que no toca la base. La usa `proxy` (src/proxy.ts), que solo
 * mira si hay sesión; la configuración completa, con el control de quién entra, está en
 * src/auth/index.ts.
 *
 * Credenciales, por variables de entorno (Auth.js las toma solas por el nombre):
 *   AUTH_SECRET                             firma de la cookie de sesión
 *   AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET     cliente OAuth de Google Cloud
 *   AUTH_GITHUB_ID / AUTH_GITHUB_SECRET     OAuth App de GitHub
 */
export const configuracionBase = {
  providers: [
    Google({
      authorization: {
        params: {
          // Sugerencia para el selector de cuentas de Google. No es un control: quién
          // entra lo decide src/dominio/acceso.ts.
          hd: DOMINIO_DE_LAINCO,
          prompt: "select_account",
        },
      },
    }),
    GitHub,
  ],

  // Sin adapter: la sesión es un JWT en una cookie cifrada. El rol no va en la cookie:
  // se lee de la tabla `usuario` en cada pedido (src/auth/sesion.ts), así que un cambio
  // de rol o una baja rigen en el próximo pedido, no cuando vence la sesión.
  session: { strategy: "jwt" },

  pages: {
    signIn: "/ingresar",
    error: "/ingresar",
  },

  callbacks: {
    session({ session, token }) {
      session.usuarioId = typeof token.usuarioId === "string" ? token.usuarioId : undefined;
      return session;
    },
  },
} satisfies NextAuthConfig;

declare module "next-auth" {
  interface Session {
    /** Id en la tabla `usuario`. */
    usuarioId?: string;
  }
}
