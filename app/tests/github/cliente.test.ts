import { describe, expect, it } from "vitest";

import { crearClienteGitHub, ErrorDeGitHub } from "@/github/cliente";
import { clienteGitHubDesdeEntorno } from "@/github/configuracion";

/**
 * El cliente de la API de GitHub (entrega 6.4, paso 3), con respuestas armadas con la
 * forma de la documentación de la API (releases y release assets).
 */

const TOKEN = "github_pat_secreto_de_prueba";

interface Pedido {
  url: string;
  headers: Headers;
}

function fetchFalso(responder: (pedido: Pedido, numero: number) => unknown) {
  const pedidos: Pedido[] = [];
  const fn = async (entrada: string | URL | Request, init?: RequestInit) => {
    const pedido = { url: String(entrada), headers: new Headers(init?.headers) };
    pedidos.push(pedido);
    const respuesta = await responder(pedido, pedidos.length);
    return respuesta instanceof Response ? respuesta : Response.json(respuesta);
  };
  return { fetch: fn as typeof globalThis.fetch, pedidos };
}

function cliente(fetch: typeof globalThis.fetch) {
  return crearClienteGitHub({
    url: "https://api.github.com/",
    repositorio: "revertpablo/Lainco-quality",
    token: TOKEN,
    fetch,
    esperar: async () => {},
  });
}

const releaseDeLaApi = {
  url: "https://api.github.com/repos/revertpablo/Lainco-quality/releases/1",
  html_url: "https://github.com/revertpablo/Lainco-quality/releases/tag/v0.1.0",
  id: 1,
  tag_name: "v0.1.0",
  name: "Lainco.Analyzers 0.1.0",
  draft: false,
  prerelease: false,
  published_at: "2026-10-28T18:45:00Z",
  assets: [
    {
      url: "https://api.github.com/repos/revertpablo/Lainco-quality/releases/assets/10",
      browser_download_url: "https://github.com/revertpablo/Lainco-quality/releases/download/v0.1.0/Lainco.Analyzers.0.1.0.nupkg",
      name: "Lainco.Analyzers.0.1.0.nupkg",
    },
    {
      url: "https://api.github.com/repos/revertpablo/Lainco-quality/releases/assets/11",
      browser_download_url: "https://github.com/revertpablo/Lainco-quality/releases/download/v0.1.0/reglas-roslyn.json",
      name: "reglas-roslyn.json",
    },
  ],
};

const conEstado = (status: number, cuerpo: unknown = { message: "x" }, headers: Record<string, string> = {}) =>
  Response.json(cuerpo, { status, headers });

async function error(promesa: Promise<unknown>): Promise<ErrorDeGitHub> {
  try {
    await promesa;
  } catch (e) {
    if (e instanceof ErrorDeGitHub) return e;
    throw e;
  }
  throw new Error("No falló.");
}

describe("cliente de GitHub", () => {
  it("trae el último release con sus assets, autenticado y con la versión de la API", async () => {
    const { fetch, pedidos } = fetchFalso(() => releaseDeLaApi);

    const release = await cliente(fetch).ultimoRelease();

    expect(release).toEqual({
      tag: "v0.1.0",
      nombre: "Lainco.Analyzers 0.1.0",
      publicadoEn: new Date("2026-10-28T18:45:00Z"),
      url: "https://github.com/revertpablo/Lainco-quality/releases/tag/v0.1.0",
      assets: [
        { nombre: "Lainco.Analyzers.0.1.0.nupkg", url: "https://api.github.com/repos/revertpablo/Lainco-quality/releases/assets/10" },
        { nombre: "reglas-roslyn.json", url: "https://api.github.com/repos/revertpablo/Lainco-quality/releases/assets/11" },
      ],
    });
    expect(pedidos[0].url).toBe("https://api.github.com/repos/revertpablo/Lainco-quality/releases/latest");
    expect(pedidos[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(pedidos[0].headers.get("accept")).toBe("application/vnd.github+json");
    expect(pedidos[0].headers.get("x-github-api-version")).toBe("2022-11-28");
  });

  it("sin releases (404), devuelve null", async () => {
    const { fetch } = fetchFalso(() => conEstado(404, { message: "Not Found" }));

    expect(await cliente(fetch).ultimoRelease()).toBeNull();
  });

  it("baja un asset de su URL de la API, como binario", async () => {
    const { fetch, pedidos } = fetchFalso(() => new Response('{"formato":1}'));

    const contenido = await cliente(fetch).descargarAsset({ nombre: "reglas-roslyn.json", url: releaseDeLaApi.assets[1].url });

    expect(contenido).toBe('{"formato":1}');
    expect(pedidos[0].url).toBe(releaseDeLaApi.assets[1].url);
    expect(pedidos[0].headers.get("accept")).toBe("application/octet-stream");
  });

  it("un asset que no está (404) es un error, no un null", async () => {
    const { fetch } = fetchFalso(() => conEstado(404));

    expect((await error(cliente(fetch).descargarAsset({ nombre: "x.json", url: "https://api.github.com/x" }))).tipo).toBe("noEncontrado");
  });

  it("reintenta las fallas de red y los 5xx", async () => {
    const { fetch, pedidos } = fetchFalso((_p, n) => {
      if (n === 1) throw new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ECONNRESET" }) });
      if (n === 2) return conEstado(502);
      return releaseDeLaApi;
    });

    expect((await cliente(fetch).ultimoRelease())?.tag).toBe("v0.1.0");
    expect(pedidos).toHaveLength(3);
  });

  it("después de tres fallas de red, dice la causa", async () => {
    const { fetch } = fetchFalso(() => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ETIMEDOUT" }) });
    });

    const e = await error(cliente(fetch).ultimoRelease());
    expect(e.tipo).toBe("red");
    expect(e.message).toBe("No se pudo conectar con GitHub para traer el último release: fetch failed (ETIMEDOUT)");
  });

  it.each([
    [401, {}, "autenticacion", "El token de GitHub no es válido o venció. (HTTP 401: x)"],
    [403, {}, "permisos", "El token de GitHub no tiene permiso para leer revertpablo/Lainco-quality. (HTTP 403: x)"],
    [403, { "x-ratelimit-remaining": "0" }, "limite", "Se agotó el límite de pedidos a GitHub de esta hora. (HTTP 403: x)"],
    [422, {}, "pedidoInvalido", "GitHub rechazó el pedido de el último release. (HTTP 422: x)"],
  ])("HTTP %i → %s, sin reintentar", async (estado, headers, tipo, mensaje) => {
    const { fetch, pedidos } = fetchFalso(() => conEstado(estado, { message: "x" }, headers));

    const e = await error(cliente(fetch).ultimoRelease());
    expect([e.tipo, e.message]).toEqual([tipo, mensaje]);
    expect(pedidos).toHaveLength(1);
  });

  it("ningún mensaje de error incluye el token", async () => {
    const { fetch } = fetchFalso(() => conEstado(401, { message: `token ${TOKEN} inválido` }));

    expect((await error(cliente(fetch).ultimoRelease())).message).not.toContain(TOKEN);
  });

  it("una respuesta sin la forma de un release es un error", async () => {
    const { fetch } = fetchFalso(() => ({ tag_name: "v0.1.0" }));

    expect((await error(cliente(fetch).ultimoRelease())).tipo).toBe("respuestaInvalida");
  });
});

describe("configuración de GitHub desde el entorno", () => {
  it("pide el repositorio y el token, sin mostrar el token", () => {
    expect(() => clienteGitHubDesdeEntorno({})).toThrow(
      "Faltan variables de entorno para GitHub: GITHUB_REPOSITORIO, LAINCO_GITHUB_TOKEN. Ver app/README.md.",
    );
  });

  it("rechaza un repositorio que no es dueño/repositorio", () => {
    expect(() => clienteGitHubDesdeEntorno({ GITHUB_REPOSITORIO: "Lainco-quality", LAINCO_GITHUB_TOKEN: TOKEN })).toThrow(
      "El repositorio de GitHub tiene que tener la forma dueño/repositorio: 'Lainco-quality'.",
    );
  });

  it("con las dos, arma el cliente", () => {
    expect(clienteGitHubDesdeEntorno({ GITHUB_REPOSITORIO: "revertpablo/Lainco-quality", LAINCO_GITHUB_TOKEN: TOKEN })).toBeDefined();
  });
});
