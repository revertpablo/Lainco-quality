import "server-only";

import type { Account, Profile } from "next-auth";
import NextAuth from "next-auth";

import type { Identidad } from "@/dominio/acceso";

import { configuracionBase } from "./config";
import { resolverIngreso } from "./usuarios";

/**
 * Auth.js con el control de quién entra (docs/FASE-6-APP.md, sección 5).
 *
 * - `signIn`: decide si la persona entra. Si no, la manda a /ingresar con el motivo.
 * - `jwt`: al entrar, guarda en la cookie el id de la tabla `usuario`. Es lo único que
 *   guarda: el rol se lee de la base en cada pedido.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...configuracionBase,
  callbacks: {
    ...configuracionBase.callbacks,

    async signIn({ account, profile }) {
      const identidad = aIdentidad(account, profile);
      if (!identidad) {
        return false;
      }

      const resultado = await resolverIngreso(identidad);
      return resultado.permitido ? true : `/ingresar?error=${resultado.motivo}`;
    },

    async jwt({ token, account, profile }) {
      // account y profile solo vienen en el pedido en que la persona entra, después de
      // que signIn la aceptó. Se vuelve a resolver para obtener el id: si era nueva, ya
      // quedó dada de alta y esta vez solo se busca.
      if (account && profile) {
        const identidad = aIdentidad(account, profile);
        const resultado = identidad ? await resolverIngreso(identidad) : undefined;
        token.usuarioId = resultado?.permitido ? resultado.usuarioId : undefined;
      }
      return token;
    },
  },
});

/** Traduce el perfil de cada proveedor a lo que necesita src/dominio/acceso.ts. */
function aIdentidad(account: Account | null | undefined, profile: Profile | undefined): Identidad | undefined {
  if (!account || !profile) {
    return undefined;
  }

  switch (account.provider) {
    case "google":
      return {
        proveedor: "google",
        nombre: texto(profile.name),
        email: texto(profile.email),
        emailVerificado: profile.email_verified === true,
        dominio: texto(profile.hd),
      };
    case "github":
      return { proveedor: "github", nombre: texto(profile.name), login: texto(profile.login) };
    default:
      return undefined;
  }
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined;
}
