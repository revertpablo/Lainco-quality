import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { crearClienteSonar, ErrorDeSonar } from "@/sonar/cliente";

/**
 * El cliente contra respuestas reales de SonarQube Cloud, grabadas con
 * `npm run sonar:grabar` en tests/fixtures/sonar/ (entrega 6.1, paso 5: "test contra
 * respuestas grabadas").
 *
 * Un fetch falso sirve cada página grabada según el `p` que pide el cliente, y verifica
 * que el resto de los parámetros sean los mismos con los que se grabó. Si no hay
 * grabación, los tests se saltean.
 */

const CARPETA = path.join(__dirname, "..", "fixtures", "sonar");
const hayGrabacion = existsSync(path.join(CARPETA, "grabacion.json"));

/** Una regla conocida de cada lenguaje, que tiene que estar en la grabación. */
const CONOCIDAS: Record<string, string> = {
  cs: "csharpsquid:S2325",
  ts: "typescript:S1854",
};

interface Grabacion {
  url: string;
  organizacion: string;
  tamanoDePagina: number;
  parametros: Record<string, string>;
  lenguajes: Record<string, { total: number; paginas: number }>;
}

function leer<T>(archivo: string): T {
  const contenido = readFileSync(path.join(CARPETA, archivo));
  return JSON.parse((archivo.endsWith(".gz") ? gunzipSync(contenido) : contenido).toString("utf8")) as T;
}

describe.skipIf(!hayGrabacion)("respuestas grabadas de SonarQube Cloud", () => {
  const grabacion = hayGrabacion ? leer<Grabacion>("grabacion.json") : undefined!;

  /** Fetch que reproduce la grabación. `error` reemplaza la respuesta por un error grabado. */
  function reproducir(error?: string) {
    const pedidos: URL[] = [];
    const fetch = (async (entrada: string | URL | Request) => {
      const url = new URL(String(entrada));
      pedidos.push(url);

      if (error) {
        const { estado, cuerpo } = leer<{ estado: number; cuerpo: unknown }>(error);
        return typeof cuerpo === "string"
          ? new Response(cuerpo, { status: estado })
          : Response.json(cuerpo, { status: estado });
      }

      const lenguaje = url.searchParams.get("languages")!;
      for (const [clave, valor] of Object.entries(grabacion.parametros)) {
        expect(url.searchParams.get(clave), `parámetro ${clave}`).toBe(clave === "languages" ? lenguaje : valor);
      }
      return Response.json(leer(`reglas-${lenguaje}-p${url.searchParams.get("p")}.json.gz`));
    }) as typeof globalThis.fetch;
    return { fetch, pedidos };
  }

  function cliente(fetch: typeof globalThis.fetch) {
    return crearClienteSonar({
      url: grabacion.url,
      organizacion: grabacion.organizacion,
      token: "token-de-prueba",
      tamanoDePagina: grabacion.tamanoDePagina,
      fetch,
      esperar: async () => {},
    });
  }

  const lenguajes = hayGrabacion ? Object.keys(grabacion.lenguajes) : [];

  describe.each(lenguajes)("%s", (lenguaje) => {
    const { total, paginas } = hayGrabacion ? grabacion.lenguajes[lenguaje] : { total: 0, paginas: 0 };

    it(`trae las ${total} reglas, recorriendo las ${paginas} páginas`, async () => {
      const sonar = reproducir();

      const reglas = await cliente(sonar.fetch).buscarReglas(lenguaje);

      expect(reglas).toHaveLength(total);
      expect(new Set(reglas.map((r) => r.clave)).size).toBe(total);
      expect(sonar.pedidos.map((p) => p.searchParams.get("p"))).toEqual(
        Array.from({ length: paginas }, (_, i) => String(i + 1)),
      );
    });

    it("todas son del lenguaje, con nombre, estado y descripción", async () => {
      const reglas = await cliente(reproducir().fetch).buscarReglas(lenguaje);

      for (const regla of reglas) {
        expect(regla.lenguaje, regla.clave).toBe(lenguaje);
        expect(regla.nombre, regla.clave).not.toBe("");
        expect(["READY", "BETA", "DEPRECATED"], regla.clave).toContain(regla.estado);
        // Vacía querría decir que Sonar la ocultó: token faltante o sin permiso.
        expect(regla.descripcion, regla.clave).not.toBe("");
      }
    });

    it("ninguna es externa (external_...)", async () => {
      const reglas = await cliente(reproducir().fetch).buscarReglas(lenguaje);

      expect(reglas.filter((r) => r.repositorio.startsWith("external_"))).toEqual([]);
    });

    it(`incluye ${CONOCIDAS[lenguaje] ?? "una regla conocida"}`, async () => {
      const reglas = await cliente(reproducir().fetch).buscarReglas(lenguaje);

      if (CONOCIDAS[lenguaje]) {
        expect(reglas.map((r) => r.clave)).toContain(CONOCIDAS[lenguaje]);
      }
    });

    it("trae los datos que necesita la sincronización", async () => {
      // FASE-6.md, sección 3: tipo, severidad, tags, clean code, impactos y parámetros.
      // No todas las reglas tienen todos, pero sí alguna de cada lenguaje.
      const reglas = await cliente(reproducir().fetch).buscarReglas(lenguaje);

      expect(reglas.some((r) => r.tipo)).toBe(true);
      expect(reglas.some((r) => r.severidad)).toBe(true);
      expect(reglas.some((r) => r.tags.length > 0)).toBe(true);
      expect(reglas.some((r) => r.atributoCleanCode)).toBe(true);
      expect(reglas.some((r) => r.impactos.length > 0)).toBe(true);
      expect(reglas.some((r) => r.parametros.length > 0)).toBe(true);
      // Las deprecadas tienen que venir: la sincronización las marca.
      expect(reglas.some((r) => r.estado === "DEPRECATED")).toBe(true);
    });
  });

  it("un token inválido se informa como error de autenticación", async () => {
    const e = await cliente(reproducir("error-token-invalido.json").fetch)
      .buscarReglas("cs")
      .catch((error: unknown) => error);

    expect(e).toBeInstanceOf(ErrorDeSonar);
    expect((e as ErrorDeSonar).tipo).toBe("autenticacion");
  });

  it("una organización que no existe se informa con lo que dice Sonar", async () => {
    const { estado } = leer<{ estado: number }>("error-organizacion-inexistente.json");
    const e = await cliente(reproducir("error-organizacion-inexistente.json").fetch)
      .buscarReglas("cs")
      .catch((error: unknown) => error);

    expect(e).toBeInstanceOf(ErrorDeSonar);
    expect((e as ErrorDeSonar).estadoHttp).toBe(estado);
    expect((e as ErrorDeSonar).message).toMatch(/HTTP \d{3}: \S/);
  });
});
