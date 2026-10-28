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
  metodo: string;
  headers: Headers;
  cuerpo: unknown;
}

function fetchFalso(responder: (pedido: Pedido, numero: number) => unknown) {
  const pedidos: Pedido[] = [];
  const fn = async (entrada: string | URL | Request, init?: RequestInit) => {
    const pedido = {
      url: String(entrada),
      metodo: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
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
    [422, {}, "pedidoInvalido", "GitHub rechazó el pedido sobre el último release. (HTTP 422: x)"],
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

describe("cliente de GitHub: lo que usa el PR de configuración (paso 6)", () => {
  const REPO = "https://api.github.com/repos/revertpablo/Lainco-quality";

  it("el commit de una rama, o null si no existe", async () => {
    const { fetch, pedidos } = fetchFalso((p) =>
      p.url.endsWith("/main") ? { ref: "refs/heads/main", object: { sha: "abc", type: "commit" } } : conEstado(404),
    );

    expect(await cliente(fetch).commitDeRama("main")).toBe("abc");
    expect(await cliente(fetch).commitDeRama("catalogo/globalconfig")).toBeNull();
    expect(pedidos.map((p) => p.url)).toEqual([`${REPO}/git/ref/heads/main`, `${REPO}/git/ref/heads/catalogo/globalconfig`]);
  });

  it("lee un archivo crudo de un commit, o null si no existe", async () => {
    const { fetch, pedidos } = fetchFalso((p) => (p.url.includes("Shipped") ? new Response("; publicadas\n") : conEstado(404)));

    expect(await cliente(fetch).leerArchivo("src/dotnet/Lainco.Analyzers/AnalyzerReleases.Shipped.md", "abc")).toBe("; publicadas\n");
    expect(await cliente(fetch).leerArchivo("no/existe.md", "abc")).toBeNull();
    expect(pedidos[0].url).toBe(`${REPO}/contents/src/dotnet/Lainco.Analyzers/AnalyzerReleases.Shipped.md?ref=abc`);
    expect(pedidos[0].headers.get("accept")).toBe("application/vnd.github.raw+json");
  });

  it("crea un commit sobre la base: árbol con los archivos sobre el de la base, y el commit con ese árbol", async () => {
    const { fetch, pedidos } = fetchFalso((p) => {
      if (p.url.endsWith("/git/commits/base1")) return { sha: "base1", tree: { sha: "arbol-base" } };
      if (p.url.endsWith("/git/trees")) return { sha: "arbol-nuevo" };
      if (p.url.endsWith("/git/commits")) return { sha: "commit-nuevo" };
      return conEstado(404);
    });

    const commit = await cliente(fetch).crearCommit({
      base: "base1",
      mensaje: "Lainco.Analyzers 0.1.1",
      archivos: [{ ruta: "a/b.globalconfig", contenido: "is_global = true\n" }],
    });

    expect(commit).toBe("commit-nuevo");
    expect(pedidos.map((p) => [p.metodo, p.url.replace(REPO, "")])).toEqual([
      ["GET", "/git/commits/base1"],
      ["POST", "/git/trees"],
      ["POST", "/git/commits"],
    ]);
    expect(pedidos[1].cuerpo).toEqual({
      base_tree: "arbol-base",
      tree: [{ path: "a/b.globalconfig", mode: "100644", type: "blob", content: "is_global = true\n" }],
    });
    expect(pedidos[2].cuerpo).toEqual({ message: "Lainco.Analyzers 0.1.1", tree: "arbol-nuevo", parents: ["base1"] });
  });

  it("crea una rama y la mueve, forzando", async () => {
    const { fetch, pedidos } = fetchFalso(() => ({}));

    await cliente(fetch).crearRama("catalogo/globalconfig", "c1");
    await cliente(fetch).moverRama("catalogo/globalconfig", "c2");

    expect(pedidos.map((p) => [p.metodo, p.url.replace(REPO, ""), p.cuerpo])).toEqual([
      ["POST", "/git/refs", { ref: "refs/heads/catalogo/globalconfig", sha: "c1" }],
      ["PATCH", "/git/refs/heads/catalogo/globalconfig", { sha: "c2", force: true }],
    ]);
  });

  it("busca el PR abierto de la rama, lo crea y lo actualiza", async () => {
    const pr = { number: 7, html_url: "https://github.com/revertpablo/Lainco-quality/pull/7" };
    const { fetch, pedidos } = fetchFalso((p, n) => (n === 1 ? [] : n === 2 ? [pr] : pr));
    const github = cliente(fetch);

    expect(await github.prAbierto("catalogo/globalconfig")).toBeNull();
    expect(await github.prAbierto("catalogo/globalconfig")).toEqual({ numero: 7, url: pr.html_url });
    expect(await github.crearPr({ titulo: "T", cuerpo: "C", rama: "catalogo/globalconfig", base: "main" })).toEqual({ numero: 7, url: pr.html_url });
    await github.actualizarPr(7, { titulo: "T2", cuerpo: "C2" });
    await github.actualizarPr(7, { cerrar: true });

    expect(pedidos[0].url).toBe(`${REPO}/pulls?state=open&head=revertpablo%3Acatalogo%2Fglobalconfig`);
    expect(pedidos.slice(2).map((p) => [p.metodo, p.url.replace(REPO, ""), p.cuerpo])).toEqual([
      ["POST", "/pulls", { title: "T", body: "C", head: "catalogo/globalconfig", base: "main" }],
      ["PATCH", "/pulls/7", { title: "T2", body: "C2" }],
      ["PATCH", "/pulls/7", { state: "closed" }],
    ]);
  });

  it("el estado de un PR: abierto, mergeado o cerrado sin mergear; null si no existe", async () => {
    const { fetch } = fetchFalso((p) =>
      p.url.endsWith("/pulls/1")
        ? { number: 1, state: "open", merged_at: null, closed_at: null }
        : p.url.endsWith("/pulls/2")
          ? { number: 2, state: "closed", merged_at: "2026-10-28T22:40:00Z", closed_at: "2026-10-28T22:40:00Z" }
          : p.url.endsWith("/pulls/3")
            ? { number: 3, state: "closed", merged_at: null, closed_at: "2026-10-28T23:00:00Z" }
            : conEstado(404),
    );
    const github = cliente(fetch);

    expect(await github.estadoDePr(1)).toEqual({ estado: "abierto", mergeadoEn: null, cerradoEn: null });
    expect(await github.estadoDePr(2)).toEqual({ estado: "mergeado", mergeadoEn: new Date("2026-10-28T22:40:00Z"), cerradoEn: new Date("2026-10-28T22:40:00Z") });
    expect(await github.estadoDePr(3)).toEqual({ estado: "cerrado", mergeadoEn: null, cerradoEn: new Date("2026-10-28T23:00:00Z") });
    expect(await github.estadoDePr(4)).toBeNull();
  });

  it("sin permiso de escritura, lo dice", async () => {
    const { fetch } = fetchFalso(() => conEstado(403, { message: "Resource not accessible by personal access token" }));

    const e = await error(cliente(fetch).crearRama("x", "c"));
    expect([e.tipo, e.message]).toEqual([
      "permisos",
      "El token de GitHub no tiene permiso para escribir en revertpablo/Lainco-quality. (HTTP 403: Resource not accessible by personal access token)",
    ]);
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
