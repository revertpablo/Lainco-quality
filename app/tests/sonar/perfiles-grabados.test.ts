import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { crearClienteSonar, ErrorDeSonar } from "@/sonar/cliente";

/**
 * El cliente de perfiles contra respuestas reales de SonarQube Cloud (entrega 6.2,
 * paso 2), grabadas con `npm run sonar:grabar-perfiles` en tests/fixtures/sonar-perfiles/.
 * Sin grabación, se saltean.
 */

const CARPETA = path.join(__dirname, "..", "fixtures", "sonar-perfiles");
const hayGrabacion = existsSync(path.join(CARPETA, "grabacion.json"));

interface Grabacion {
  url: string;
  organizacion: string;
  tamanoDePagina: number;
  lenguajes: Record<
    string,
    {
      perfil: { clave: string; nombre: string };
      activas: { total: number; paginas: number };
      /** El perfil de Sonar por defecto del lenguaje, que tiene reglas activas aunque el nuestro esté vacío. */
      deSonar: { clave: string; nombre: string; activas: { total: number; paginas: number } } | null;
    }
  >;
  proyectos: number;
}

interface Accion {
  key: string;
  deprecatedSince?: string;
  params?: { key: string; deprecatedSince?: string; required?: boolean; description?: string }[];
}

const leer = <T,>(archivo: string): T => JSON.parse(readFileSync(path.join(CARPETA, archivo), "utf8")) as T;

describe.skipIf(!hayGrabacion)("perfiles contra la grabación de SonarQube Cloud", () => {
  const grabacion = hayGrabacion ? leer<Grabacion>("grabacion.json") : ({} as Grabacion);
  const lenguajes = Object.keys(grabacion.lenguajes ?? {});

  /** Un fetch que contesta con la grabación, según qué se pide. */
  const fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const q = url.searchParams;
    const archivo = (() => {
      switch (url.pathname) {
        case "/api/qualityprofiles/search": {
          if (q.get("project")) {
            for (let i = 1; i <= grabacion.proyectos; i++) {
              const nombre = `perfiles-proyecto-${i}.json`;
              if (leer<{ proyecto: string }>(nombre).proyecto === q.get("project")) return nombre;
            }
            return null;
          }
          return `perfil-${q.get("language")}.json`;
        }
        case "/api/rules/search": {
          for (const [l, g] of Object.entries(grabacion.lenguajes)) {
            if (g.perfil.clave === q.get("qprofile")) return `activas-${l}-p${q.get("p")}.json`;
            if (g.deSonar?.clave === q.get("qprofile")) return `activas-de-sonar-${l}-p${q.get("p")}.json`;
          }
          return null;
        }
        case "/api/components/search":
          return "proyectos.json";
        case "/api/qualityprofiles/activate_rule": {
          const { estado, cuerpo } = leer<{ estado: number; cuerpo: unknown }>("permiso-activar.json");
          expect(init?.method).toBe("POST");
          return { estado, cuerpo };
        }
      }
      return null;
    })();
    if (archivo === null) return Response.json({ errors: [{ msg: "No grabado" }] }, { status: 404 });
    if (typeof archivo === "object") {
      return archivo.cuerpo === null ? new Response(null, { status: archivo.estado }) : Response.json(archivo.cuerpo, { status: archivo.estado });
    }
    return Response.json(leer(archivo));
  }) as typeof globalThis.fetch;

  const cliente = () =>
    crearClienteSonar({
      url: grabacion.url,
      organizacion: grabacion.organizacion,
      token: "token-de-prueba",
      tamanoDePagina: grabacion.tamanoDePagina,
      fetch,
      esperar: async () => {},
    });

  describe("lo que manda la app existe en la API, sin deprecar", () => {
    const acciones = hayGrabacion
      ? leer<{ webServices: { path: string; actions: Accion[] }[] }>("webservices.json").webServices.flatMap((ws) =>
          ws.actions.map((a) => ({ ...a, ruta: `${ws.path}/${a.key}` })),
        )
      : [];

    it.each([
      ["api/qualityprofiles/search", ["organization", "language", "qualityProfile", "project"]],
      ["api/rules/search", ["organization", "qprofile", "activation", "f", "ps", "p"]],
      ["api/components/search", ["organization", "ps", "p"]],
      ["api/qualityprofiles/activate_rule", ["key", "rule", "impacts", "params"]],
      ["api/qualityprofiles/deactivate_rule", ["key", "rule"]],
    ])("%s acepta %j", (ruta, parametros) => {
      const accion = acciones.find((a) => a.ruta === ruta);
      expect(accion, `${ruta} no está en la API`).toBeDefined();
      expect(accion!.deprecatedSince, `${ruta} está deprecada`).toBeUndefined();
      for (const nombre of parametros) {
        const parametro = accion!.params?.find((p) => p.key === nombre);
        expect(parametro, `${ruta} no acepta '${nombre}'`).toBeDefined();
        expect(parametro!.deprecatedSince, `'${nombre}' de ${ruta} está deprecado desde ${parametro!.deprecatedSince}`).toBeUndefined();
      }
    });

    it("activate_rule deprecó 'severity': por eso se publica con impactos (src/dominio/severidad.ts)", () => {
      const parametros = acciones.find((a) => a.ruta === "api/qualityprofiles/activate_rule")!.params!;

      expect(parametros.find((p) => p.key === "severity")?.deprecatedSince).toBeDefined();
      expect(parametros.find((p) => p.key === "impacts")?.description).toContain("Cannot be used with 'severity'");
    });
  });

  it.each(lenguajes)("encuentra el perfil gestionado de '%s'", async (lenguaje) => {
    const { perfil } = grabacion.lenguajes[lenguaje];

    const encontrado = await cliente().buscarPerfil(lenguaje, perfil.nombre);

    expect(encontrado).toMatchObject({ clave: perfil.clave, nombre: perfil.nombre, lenguaje, esDeSonar: false });
  });

  it.each(lenguajes)("trae todas las reglas activas del perfil gestionado de '%s'", async (lenguaje) => {
    const { perfil, activas } = grabacion.lenguajes[lenguaje];

    expect(await cliente().reglasActivas(perfil.clave)).toHaveLength(activas.total);
  });

  it.each(lenguajes)("lee las activaciones del perfil de Sonar de '%s', con varias páginas", async (lenguaje) => {
    const { deSonar } = grabacion.lenguajes[lenguaje];
    expect(deSonar, "la grabación no tiene el perfil de Sonar: volver a grabar con npm run sonar:grabar-perfiles").toBeTruthy();

    const activas = await cliente().reglasActivas(deSonar!.clave);

    expect(activas).toHaveLength(deSonar!.activas.total);
    expect(deSonar!.activas.paginas).toBeGreaterThan(1);
    expect(new Set(activas.map((r) => r.clave)).size).toBe(activas.length);
    // Ninguna heredada (los perfiles de Sonar no heredan); cada una con su severidad clásica
    // y sus impactos en el perfil, y algunas con parámetros (el 2026-10-19: 12 de C# y 13 de
    // TypeScript, como `credentialWords` de S2068).
    expect(activas.every((r) => !r.heredada && r.severidad !== null && r.impactos.length > 0)).toBe(true);
    const conParametros = activas.filter((r) => Object.keys(r.parametros).length > 0);
    expect(conParametros.length).toBeGreaterThan(0);
    expect(conParametros.every((r) => Object.values(r.parametros).every((v) => typeof v === "string"))).toBe(true);
  });

  it("lista los proyectos y el perfil de cada lenguaje que usa cada uno", async () => {
    const proyectos = await cliente().proyectos();
    expect(proyectos).toHaveLength(grabacion.proyectos);

    for (const proyecto of proyectos) {
      const perfiles = await cliente().perfilesDelProyecto(proyecto.clave);
      // Un perfil por lenguaje.
      expect(new Set(perfiles.map((p) => p.lenguaje)).size).toBe(perfiles.length);
    }
  });

  it("entiende la respuesta de Sonar al probar el permiso de administrar el perfil", async () => {
    const { regla, estado } = leer<{ regla: string; estado: number }>("permiso-activar.json");
    const perfil = grabacion.lenguajes.cs.perfil.clave;

    const resultado = await cliente()
      .activarRegla(perfil, regla, {})
      .then(
        () => "activó",
        (e: unknown) => (e instanceof ErrorDeSonar ? e.tipo : String(e)),
      );

    // Sin permiso, 403; con permiso, Sonar se queja de la regla inexistente.
    expect(resultado).toBe(estado === 403 ? "permisos" : estado === 404 ? "noEncontrado" : "pedidoInvalido");
  });
});
