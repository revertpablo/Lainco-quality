import { describe, expect, it } from "vitest";

import {
  DOMINIO_DE_LAINCO,
  MENSAJES_DE_INGRESO,
  claveDeBusqueda,
  decidirIngreso,
  type IdentidadGithub,
  type IdentidadGoogle,
  type MotivoDeIngresoRechazado,
  type UsuarioRegistrado,
} from "@/dominio/acceso";
import { Rol } from "@/dominio/valores";

/**
 * Quién entra a la app (entrega 6.1, paso 4; docs/FASE-6-APP.md, sección 5).
 *
 * - Google: solo cuentas del dominio de Lainco con el email verificado. Si no está en la
 *   tabla `usuario`, se da de alta como analista (D6.1).
 * - GitHub: solo usuarios ya dados de alta (decisión del 2026-10-15).
 * - Un usuario dado de baja (`activo = false`) no entra por ninguno de los dos.
 */

function google(cambios: Partial<IdentidadGoogle> = {}): IdentidadGoogle {
  return {
    proveedor: "google",
    nombre: "Ana Pérez",
    email: `ana.perez@${DOMINIO_DE_LAINCO}`,
    emailVerificado: true,
    dominio: DOMINIO_DE_LAINCO,
    ...cambios,
  };
}

function github(cambios: Partial<IdentidadGithub> = {}): IdentidadGithub {
  return { proveedor: "github", nombre: "Ana Pérez", login: "anaperez", ...cambios };
}

const activo: UsuarioRegistrado = { id: "u-1", rol: Rol.Analista, activo: true };
const inactivo: UsuarioRegistrado = { id: "u-2", rol: Rol.Decisor, activo: false };

function motivo(decision: ReturnType<typeof decidirIngreso>): MotivoDeIngresoRechazado | undefined {
  return decision.permitido ? undefined : decision.motivo;
}

// ---------------------------------------------------------------------------------

describe("Google", () => {
  it("una cuenta del dominio ya registrada entra con su usuario", () => {
    expect(decidirIngreso(google(), activo)).toEqual({ permitido: true, usuarioId: "u-1" });
  });

  it("una cuenta del dominio que no está registrada se da de alta como analista", () => {
    expect(decidirIngreso(google(), undefined)).toEqual({
      permitido: true,
      alta: { nombre: "Ana Pérez", email: `ana.perez@${DOMINIO_DE_LAINCO}`, rol: Rol.Analista },
    });
  });

  it("el alta guarda el email en minúsculas", () => {
    const decision = decidirIngreso(google({ email: `Ana.Perez@${DOMINIO_DE_LAINCO.toUpperCase()}` }), undefined);

    expect(decision).toMatchObject({ alta: { email: `ana.perez@${DOMINIO_DE_LAINCO}` } });
  });

  it("si Google no manda nombre, el alta usa el email", () => {
    const decision = decidirIngreso(google({ nombre: "  " }), undefined);

    expect(decision).toMatchObject({ alta: { nombre: `ana.perez@${DOMINIO_DE_LAINCO}` } });
  });

  describe("fuera del dominio no entra", () => {
    it.each([
      ["una cuenta personal de Gmail", { email: "ana@gmail.com", dominio: undefined }],
      ["otro Google Workspace", { email: "ana@otraempresa.com", dominio: "otraempresa.com" }],
      ["un subdominio", { email: `ana@ventas.${DOMINIO_DE_LAINCO}`, dominio: `ventas.${DOMINIO_DE_LAINCO}` }],
      ["un dominio que lo contiene", { email: `ana@x${DOMINIO_DE_LAINCO}`, dominio: `x${DOMINIO_DE_LAINCO}` }],
      // El dominio del Workspace (hd) y el del email tienen que coincidir los dos.
      ["dominio de Lainco con email de otro", { email: "ana@gmail.com", dominio: DOMINIO_DE_LAINCO }],
      ["dominio de Lainco con email de un dominio que lo contiene", { email: `ana@x${DOMINIO_DE_LAINCO}` }],
      ["email de Lainco sin dominio de Workspace", { dominio: undefined }],
      ["sin email", { email: undefined }],
    ])("%s", (_caso, cambios: Partial<IdentidadGoogle>) => {
      expect(motivo(decidirIngreso(google(cambios), undefined))).toBe("fueraDelDominio");
    });

    it("aunque el email esté cargado en la tabla", () => {
      // Por ejemplo, alguien que se fue y pasó a usar su cuenta personal.
      expect(motivo(decidirIngreso(google({ email: "ana@gmail.com", dominio: undefined }), activo))).toBe(
        "fueraDelDominio",
      );
    });
  });

  it("una cuenta del dominio con el email sin verificar no entra", () => {
    expect(motivo(decidirIngreso(google({ emailVerificado: false }), undefined))).toBe("emailSinVerificar");
  });

  it("un usuario dado de baja no entra", () => {
    expect(motivo(decidirIngreso(google(), inactivo))).toBe("usuarioInactivo");
  });

  it("el dominio no distingue mayúsculas", () => {
    const decision = decidirIngreso(google({ dominio: DOMINIO_DE_LAINCO.toUpperCase() }), activo);

    expect(decision.permitido).toBe(true);
  });
});

describe("GitHub", () => {
  it("un usuario registrado entra", () => {
    expect(decidirIngreso(github(), activo)).toEqual({ permitido: true, usuarioId: "u-1" });
  });

  it("un usuario que no está registrado no entra, y no se da de alta", () => {
    expect(motivo(decidirIngreso(github(), undefined))).toBe("noRegistrado");
  });

  it("un usuario dado de baja no entra", () => {
    expect(motivo(decidirIngreso(github(), inactivo))).toBe("usuarioInactivo");
  });
});

describe("clave con la que se busca el usuario", () => {
  it("Google busca por email, en minúsculas", () => {
    expect(claveDeBusqueda(google({ email: `Ana.Perez@${DOMINIO_DE_LAINCO}` }))).toEqual({
      email: `ana.perez@${DOMINIO_DE_LAINCO}`,
    });
  });

  it("GitHub busca por login, en minúsculas", () => {
    expect(claveDeBusqueda(github({ login: "AnaPerez" }))).toEqual({ githubLogin: "anaperez" });
  });

  it("sin email o sin login no hay nada que buscar", () => {
    expect(claveDeBusqueda(google({ email: undefined }))).toBeUndefined();
    expect(claveDeBusqueda(github({ login: " " }))).toBeUndefined();
  });
});

it("cada motivo de rechazo tiene un mensaje para el usuario", () => {
  const todos: MotivoDeIngresoRechazado[] = ["fueraDelDominio", "emailSinVerificar", "noRegistrado", "usuarioInactivo"];

  for (const m of todos) {
    expect(MENSAJES_DE_INGRESO[m]).toMatch(/\S/);
  }
});
