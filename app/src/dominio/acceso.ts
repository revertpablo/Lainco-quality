import { Rol } from "./valores";

/**
 * Quién entra a la app (docs/FASE-6-APP.md, sección 5).
 *
 * El proveedor de identidad dice *quién sos*; la tabla `usuario` dice *qué podés hacer*.
 * Este módulo decide, con los datos del proveedor y el usuario encontrado en la tabla, si
 * la persona entra. No hace I/O: la búsqueda y el alta están en src/auth/.
 *
 * - **Google**: solo cuentas del Google Workspace de Lainco con el email verificado. Si
 *   no está en la tabla, se da de alta como analista (D6.1: los decisores se cargan
 *   aparte; los demás entran como analistas).
 * - **GitHub**: solo usuarios ya dados de alta por login (decisión del 2026-10-15).
 *   GitHub no tiene un dominio que acote quién es de Lainco.
 * - Un usuario dado de baja (`activo = false`) no entra por ninguno de los dos.
 */

/** Dominio del Google Workspace de Lainco. */
export const DOMINIO_DE_LAINCO = "laincosoftware.com";

export interface IdentidadGoogle {
  proveedor: "google";
  nombre?: string | null;
  email?: string | null;
  emailVerificado: boolean;
  /** Dominio del Workspace de la cuenta (`hd` del perfil). No viene en cuentas personales. */
  dominio?: string | null;
}

export interface IdentidadGithub {
  proveedor: "github";
  nombre?: string | null;
  login?: string | null;
}

export type Identidad = IdentidadGoogle | IdentidadGithub;

/** Lo que importa del usuario encontrado en la tabla. */
export interface UsuarioRegistrado {
  id: string;
  rol: Rol;
  activo: boolean;
}

/** Con qué columna de `usuario` se busca a la persona. */
export type ClaveDeBusqueda = { email: string } | { githubLogin: string };

export type MotivoDeIngresoRechazado = "fueraDelDominio" | "emailSinVerificar" | "noRegistrado" | "usuarioInactivo";

export type DecisionDeIngreso =
  | { permitido: true; usuarioId: string }
  | { permitido: true; alta: { nombre: string; email: string; rol: Rol } }
  | { permitido: false; motivo: MotivoDeIngresoRechazado };

/** Texto para la pantalla de ingreso de cada motivo de rechazo. */
export const MENSAJES_DE_INGRESO: Readonly<Record<MotivoDeIngresoRechazado, string>> = {
  fueraDelDominio: `Solo pueden entrar con Google las cuentas de ${DOMINIO_DE_LAINCO}.`,
  emailSinVerificar: "Google no confirmó el email de esta cuenta.",
  noRegistrado:
    "Esta cuenta de GitHub no está dada de alta en la app. Pedile a un decisor que la cargue, o entrá con tu cuenta de Google de Lainco.",
  usuarioInactivo: "Este usuario está dado de baja en la app.",
};

/**
 * La columna con la que se busca a la persona en `usuario`, en minúsculas como se
 * guardan. `undefined` si el proveedor no mandó el dato.
 */
export function claveDeBusqueda(identidad: Identidad): ClaveDeBusqueda | undefined {
  if (identidad.proveedor === "google") {
    const email = normalizar(identidad.email);
    return email ? { email } : undefined;
  }

  const githubLogin = normalizar(identidad.login);
  return githubLogin ? { githubLogin } : undefined;
}

/**
 * Decide si la persona entra.
 *
 * @param registrado el usuario encontrado con `claveDeBusqueda`, o `undefined` si no está.
 */
export function decidirIngreso(identidad: Identidad, registrado: UsuarioRegistrado | undefined): DecisionDeIngreso {
  if (identidad.proveedor === "google") {
    const email = normalizar(identidad.email);

    // El dominio va primero: a alguien de afuera no le importa si su email está verificado.
    if (!email || !esDelDominio(email, identidad.dominio)) {
      return { permitido: false, motivo: "fueraDelDominio" };
    }
    if (!identidad.emailVerificado) {
      return { permitido: false, motivo: "emailSinVerificar" };
    }
    if (!registrado) {
      const nombre = identidad.nombre?.trim() || email;
      return { permitido: true, alta: { nombre, email, rol: Rol.Analista } };
    }
  } else if (!registrado) {
    return { permitido: false, motivo: "noRegistrado" };
  }

  if (!registrado.activo) {
    return { permitido: false, motivo: "usuarioInactivo" };
  }

  return { permitido: true, usuarioId: registrado.id };
}

/**
 * La cuenta es del Workspace de Lainco: lo dicen el dominio del Workspace (`hd`) y el del
 * email, los dos. `hd` solo lo manda Google para cuentas de Workspace, así que descarta
 * las cuentas personales; el email cubre el caso de un `hd` faltante o raro.
 */
function esDelDominio(email: string, dominio: string | null | undefined): boolean {
  return normalizar(dominio) === DOMINIO_DE_LAINCO && email.endsWith(`@${DOMINIO_DE_LAINCO}`);
}

function normalizar(valor: string | null | undefined): string | undefined {
  const limpio = valor?.trim().toLowerCase();
  return limpio || undefined;
}
