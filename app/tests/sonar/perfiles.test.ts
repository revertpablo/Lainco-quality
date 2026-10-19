import { describe, expect, it } from "vitest";

import { crearClienteSonar, ErrorDeSonar } from "@/sonar/cliente";

/**
 * Quality Profiles en la Web API de Sonar (entrega 6.2, paso 2), con respuestas armadas a
 * mano con la forma de la documentación de la API. Las grabadas de SonarQube Cloud están
 * en perfiles-grabados.test.ts.
 */

const TOKEN = "token-secreto-de-prueba";
const PERFIL = "AYx-perfil-cs";

interface Pedido {
  metodo: string;
  url: URL;
  headers: Headers;
  /** Los parámetros del formulario de un POST. */
  cuerpo: URLSearchParams | null;
}

/** Un fetch falso: `responder` devuelve un objeto (200 con ese JSON), una Response o lanza. */
function fetchFalso(responder: (pedido: Pedido, numero: number) => unknown) {
  const pedidos: Pedido[] = [];
  const fn = async (entrada: string | URL | Request, init?: RequestInit) => {
    const pedido: Pedido = {
      metodo: init?.method ?? "GET",
      url: new URL(String(entrada)),
      headers: new Headers(init?.headers),
      cuerpo: init?.body instanceof URLSearchParams ? init.body : null,
    };
    pedidos.push(pedido);
    const respuesta = await responder(pedido, pedidos.length);
    return respuesta instanceof Response ? respuesta : Response.json(respuesta);
  };
  return { fetch: fn as typeof globalThis.fetch, pedidos };
}

const sinContenido = () => new Response(null, { status: 204 });

function cliente(fetch: typeof globalThis.fetch, tamanoDePagina = 500) {
  return crearClienteSonar({
    url: "https://sonarcloud.io/",
    organizacion: "revertpablo",
    token: TOKEN,
    tamanoDePagina,
    fetch,
    esperar: async () => {},
  });
}

function perfilDeLaApi(nombre: string, cambios: Record<string, unknown> = {}) {
  return {
    key: `clave-${nombre}`,
    name: nombre,
    language: "cs",
    languageName: "C#",
    isInherited: false,
    isDefault: false,
    isBuiltIn: false,
    activeRuleCount: 3,
    ...cambios,
  };
}

async function error(promesa: Promise<unknown>): Promise<ErrorDeSonar> {
  try {
    await promesa;
  } catch (e) {
    if (e instanceof ErrorDeSonar) return e;
    throw e;
  }
  throw new Error("No falló");
}

describe("buscar el perfil gestionado", () => {
  it("pide los perfiles del lenguaje con ese nombre, en la organización", async () => {
    const { fetch, pedidos } = fetchFalso(() => ({ profiles: [perfilDeLaApi("Lainco C#", { isDefault: true })] }));

    const perfil = await cliente(fetch).buscarPerfil("cs", "Lainco C#");

    expect(pedidos).toHaveLength(1);
    const [{ metodo, url, headers }] = pedidos;
    expect(metodo).toBe("GET");
    expect(`${url.origin}${url.pathname}`).toBe("https://sonarcloud.io/api/qualityprofiles/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      organization: "revertpablo",
      language: "cs",
      qualityProfile: "Lainco C#",
    });
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(perfil).toEqual({
      clave: "clave-Lainco C#",
      nombre: "Lainco C#",
      lenguaje: "cs",
      esDefault: true,
      heredaDe: null,
      esDeSonar: false,
      reglasActivas: 3,
    });
  });

  it("se queda con el de nombre exacto, aunque la API traiga otros", async () => {
    const { fetch } = fetchFalso(() => ({
      profiles: [perfilDeLaApi("Lainco C# viejo"), perfilDeLaApi("lainco c#"), perfilDeLaApi("Lainco C#")],
    }));

    expect((await cliente(fetch).buscarPerfil("cs", "Lainco C#")).clave).toBe("clave-Lainco C#");
  });

  it("informa de quién hereda", async () => {
    const { fetch } = fetchFalso(() => ({
      profiles: [perfilDeLaApi("Lainco C#", { isInherited: true, parentKey: "clave-sonar-way", parentName: "Sonar way" })],
    }));

    expect((await cliente(fetch).buscarPerfil("cs", "Lainco C#")).heredaDe).toEqual({ clave: "clave-sonar-way", nombre: "Sonar way" });
  });

  it("si no existe, falla diciendo cuál falta", async () => {
    const { fetch } = fetchFalso(() => ({ profiles: [perfilDeLaApi("Sonar way", { isBuiltIn: true })] }));

    const e = await error(cliente(fetch).buscarPerfil("cs", "Lainco C#"));
    expect(e.tipo).toBe("noEncontrado");
    expect(e.message).toContain("'Lainco C#' de 'cs'");
  });

  it("si es de otro lenguaje, no es el perfil", async () => {
    const { fetch } = fetchFalso(() => ({ profiles: [perfilDeLaApi("Lainco C#", { language: "ts" })] }));

    expect((await error(cliente(fetch).buscarPerfil("cs", "Lainco C#"))).tipo).toBe("noEncontrado");
  });

  it.each([
    ["sin lista de perfiles", {}],
    ["un perfil sin clave", { profiles: [{ name: "Lainco C#", language: "cs" }] }],
  ])("rechaza una respuesta %s", async (_caso, respuesta) => {
    const { fetch } = fetchFalso(() => respuesta);

    expect((await error(cliente(fetch).buscarPerfil("cs", "Lainco C#"))).tipo).toBe("respuestaInvalida");
  });
});

describe("reglas activas de un perfil", () => {
  /** Una página de reglas activas, con su activación en el perfil y en otro. */
  function pagina(claves: string[], p: number, total: number, cambios: Record<string, unknown> = {}) {
    return {
      total,
      p,
      ps: 2,
      rules: claves.map((key) => ({ key })),
      actives: Object.fromEntries(
        claves.map((key) => [
          key,
          [
            { qProfile: "otro-perfil", inherit: "NONE", severity: "INFO", params: [] },
            { qProfile: PERFIL, inherit: "NONE", severity: "MAJOR", params: [], ...cambios },
          ],
        ]),
      ),
    };
  }

  it("recorre todas las páginas pidiendo las activaciones del perfil", async () => {
    const { fetch, pedidos } = fetchFalso((p) => {
      const n = Number(p.url.searchParams.get("p"));
      return n === 1 ? pagina(["cs:S1", "cs:S2"], 1, 3) : pagina(["cs:S3"], 2, 3);
    });

    const activas = await cliente(fetch, 2).reglasActivas(PERFIL);

    expect(activas.map((r) => r.clave)).toEqual(["cs:S1", "cs:S2", "cs:S3"]);
    expect(pedidos.map((p) => `${p.url.pathname}?${p.url.searchParams}`)).toEqual([
      `/api/rules/search?organization=revertpablo&qprofile=${PERFIL}&activation=true&f=actives&ps=2&p=1`,
      `/api/rules/search?organization=revertpablo&qprofile=${PERFIL}&activation=true&f=actives&ps=2&p=2`,
    ]);
  });

  it("toma la severidad, los impactos y los parámetros de la activación en este perfil", async () => {
    const { fetch } = fetchFalso(() =>
      pagina(["cs:S1"], 1, 1, {
        severity: "CRITICAL",
        impacts: [{ softwareQuality: "MAINTAINABILITY", severity: "HIGH" }],
        params: [
          { key: "max", value: "3" },
          { key: "formato", value: "^[a-z]+=x;?$" },
        ],
      }),
    );

    expect(await cliente(fetch).reglasActivas(PERFIL)).toEqual([
      {
        clave: "cs:S1",
        severidad: "CRITICAL",
        impactos: [{ calidad: "MAINTAINABILITY", severidad: "HIGH" }],
        parametros: { max: "3", formato: "^[a-z]+=x;?$" },
        heredada: false,
      },
    ]);
  });

  it.each([
    ["NONE", false],
    ["INHERITED", true],
    ["OVERRIDES", true],
  ])("una activación %s es heredada: %s", async (inherit, heredada) => {
    const { fetch } = fetchFalso(() => pagina(["cs:S1"], 1, 1, { inherit }));

    expect((await cliente(fetch).reglasActivas(PERFIL))[0].heredada).toBe(heredada);
  });

  it("un perfil vacío no tiene reglas activas", async () => {
    const { fetch } = fetchFalso(() => ({ total: 0, p: 1, ps: 500, rules: [], actives: {} }));

    expect(await cliente(fetch).reglasActivas(PERFIL)).toEqual([]);
  });

  it("una regla sin su activación en este perfil es una respuesta inválida", async () => {
    const { fetch } = fetchFalso(() => ({ total: 1, rules: [{ key: "cs:S1" }], actives: { "cs:S1": [{ qProfile: "otro" }] } }));

    expect((await error(cliente(fetch).reglasActivas(PERFIL))).tipo).toBe("respuestaInvalida");
  });

  it.each<[string, (n: number) => unknown]>([
    ["si el total cambia entre páginas", (n) => (n === 1 ? pagina(["cs:S1", "cs:S2"], 1, 3) : pagina(["cs:S3"], 2, 4))],
    ["si una regla viene repetida", (n) => (n === 1 ? pagina(["cs:S1", "cs:S2"], 1, 3) : pagina(["cs:S2"], 2, 3))],
    ["si una página viene vacía antes de terminar", (n) => (n === 1 ? pagina(["cs:S1", "cs:S2"], 1, 3) : pagina([], 2, 3))],
  ])("falla en vez de devolver una lista a medias %s", async (_caso, responder) => {
    const { fetch } = fetchFalso((p) => responder(Number(p.url.searchParams.get("p"))));

    expect((await error(cliente(fetch, 2).reglasActivas(PERFIL))).tipo).toBe("inconsistente");
  });
});

describe("proyectos y sus perfiles", () => {
  it("lista los proyectos de la organización", async () => {
    const { fetch, pedidos } = fetchFalso(() => ({
      paging: { pageIndex: 1, pageSize: 500, total: 2 },
      components: [
        { key: "revertpablo_Lainco-quality", name: "Lainco-quality", qualifier: "TRK" },
        { key: "revertpablo_otro", qualifier: "TRK" },
      ],
    }));

    expect(await cliente(fetch).proyectos()).toEqual([
      { clave: "revertpablo_Lainco-quality", nombre: "Lainco-quality" },
      { clave: "revertpablo_otro", nombre: "revertpablo_otro" },
    ]);
    // SonarQube Cloud no acepta `qualifiers` en api/components/search.
    expect(Object.fromEntries(pedidos[0].url.searchParams)).toEqual({ organization: "revertpablo", ps: "500", p: "1" });
  });

  it("descarta lo que no sea un proyecto, sin romper la cuenta de las páginas", async () => {
    const { fetch } = fetchFalso(() => ({
      paging: { pageIndex: 1, pageSize: 500, total: 2 },
      components: [
        { key: "revertpablo_Lainco-quality", qualifier: "TRK" },
        { key: "revertpablo_Lainco-quality:src/a.cs", qualifier: "FIL" },
      ],
    }));

    expect((await cliente(fetch).proyectos()).map((p) => p.clave)).toEqual(["revertpablo_Lainco-quality"]);
  });

  it("los perfiles que usa un proyecto, uno por lenguaje", async () => {
    const { fetch, pedidos } = fetchFalso(() => ({
      profiles: [perfilDeLaApi("Lainco C#", { isDefault: true }), perfilDeLaApi("Otro TS", { language: "ts" })],
    }));

    const perfiles = await cliente(fetch).perfilesDelProyecto("revertpablo_Lainco-quality");

    expect(perfiles.map((p) => [p.lenguaje, p.nombre])).toEqual([
      ["cs", "Lainco C#"],
      ["ts", "Otro TS"],
    ]);
    expect(Object.fromEntries(pedidos[0].url.searchParams)).toEqual({
      organization: "revertpablo",
      project: "revertpablo_Lainco-quality",
    });
  });
});

describe("activar y desactivar", () => {
  it("activa con un POST de formulario: perfil, regla, impactos y parámetros", async () => {
    const { fetch, pedidos } = fetchFalso(sinContenido);

    await cliente(fetch).activarRegla(PERFIL, "csharpsquid:S107", {
      impactos: [
        { calidad: "MAINTAINABILITY", severidad: "HIGH" },
        { calidad: "RELIABILITY", severidad: "HIGH" },
      ],
      parametros: { max: "7", formato: "a=b" },
    });

    expect(pedidos).toHaveLength(1);
    const [{ metodo, url, cuerpo, headers }] = pedidos;
    expect(metodo).toBe("POST");
    expect(url.pathname).toBe("/api/qualityprofiles/activate_rule");
    // Nada en la URL: va todo en el formulario.
    expect(url.search).toBe("");
    // La clave del perfil ya identifica a la organización.
    expect(Object.fromEntries(cuerpo!)).toEqual({
      key: PERFIL,
      rule: "csharpsquid:S107",
      impacts: "MAINTAINABILITY=HIGH;RELIABILITY=HIGH",
      params: "max=7;formato=a=b",
    });
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("nunca manda 'severity': Sonar lo deprecó y no se puede usar junto con 'impacts'", async () => {
    const { fetch, pedidos } = fetchFalso(sinContenido);

    await cliente(fetch).activarRegla(PERFIL, "csharpsquid:S107", { impactos: [{ calidad: "SECURITY", severidad: "LOW" }] });

    expect(pedidos[0].cuerpo!.has("severity")).toBe(false);
  });

  it.each([
    ["un impacto repetido", [{ calidad: "SECURITY", severidad: "LOW" }, { calidad: "SECURITY", severidad: "HIGH" }], "dos veces"],
    ["un impacto con separadores", [{ calidad: "SECURITY;X", severidad: "LOW" }], "formato"],
  ])("rechaza %s sin llamar a Sonar", async (_caso, impactos, mensaje) => {
    const { fetch, pedidos } = fetchFalso(sinContenido);

    await expect(cliente(fetch).activarRegla(PERFIL, "csharpsquid:S107", { impactos })).rejects.toThrow(mensaje);
    expect(pedidos).toHaveLength(0);
  });

  it("sin impactos ni parámetros manda solo el perfil y la regla", async () => {
    const { fetch, pedidos } = fetchFalso(sinContenido);

    await cliente(fetch).activarRegla(PERFIL, "csharpsquid:S107", { impactos: [], parametros: {} });

    expect(Object.fromEntries(pedidos[0].cuerpo!)).toEqual({ key: PERFIL, rule: "csharpsquid:S107" });
  });

  it("un valor con ';' se rechaza sin llamar a Sonar: se publicaría partido", async () => {
    const { fetch, pedidos } = fetchFalso(sinContenido);

    await expect(
      cliente(fetch).activarRegla(PERFIL, "csharpsquid:S107", { parametros: { formato: "a;b" } }),
    ).rejects.toThrow("tiene ';'");
    expect(pedidos).toHaveLength(0);
  });

  it("desactiva con un POST de formulario: perfil y regla", async () => {
    const { fetch, pedidos } = fetchFalso(sinContenido);

    await cliente(fetch).desactivarRegla(PERFIL, "csharpsquid:S107");

    expect(pedidos[0].metodo).toBe("POST");
    expect(pedidos[0].url.pathname).toBe("/api/qualityprofiles/deactivate_rule");
    expect(Object.fromEntries(pedidos[0].cuerpo!)).toEqual({ key: PERFIL, rule: "csharpsquid:S107" });
  });

  it("acepta también una respuesta 200 con cuerpo", async () => {
    const { fetch } = fetchFalso(() => ({}));

    await expect(cliente(fetch).desactivarRegla(PERFIL, "csharpsquid:S107")).resolves.toBeUndefined();
  });

  it("sin permiso de administrar perfiles lo dice, sin mostrar el token", async () => {
    const { fetch } = fetchFalso(() => Response.json({ errors: [{ msg: `Insufficient privileges for ${TOKEN}` }] }, { status: 403 }));

    const e = await error(cliente(fetch).activarRegla(PERFIL, "csharpsquid:S107", {}));
    expect(e.tipo).toBe("permisos");
    expect(e.message).toContain("administrar Quality Profiles");
    expect(e.message).toContain("Insufficient privileges");
    expect(`${e.message} ${e.stack}`).not.toContain(TOKEN);
  });

  it("un pedido rechazado trae el motivo de Sonar y no se reintenta", async () => {
    const { fetch, pedidos } = fetchFalso(() =>
      Response.json({ errors: [{ msg: "Value 'x' must be an integer." }] }, { status: 400 }),
    );

    const e = await error(cliente(fetch).activarRegla(PERFIL, "csharpsquid:S107", { parametros: { max: "x" } }));
    expect(e.tipo).toBe("pedidoInvalido");
    expect(e.message).toContain("activar csharpsquid:S107");
    expect(e.message).toContain("must be an integer");
    expect(pedidos).toHaveLength(1);
  });

  it("si Sonar falla o se corta la red, reintenta: activar dos veces deja lo mismo", async () => {
    const { fetch, pedidos } = fetchFalso((_p, n) => {
      if (n === 1) throw new TypeError("fetch failed");
      if (n === 2) return new Response(null, { status: 503 });
      return sinContenido();
    });

    await cliente(fetch).activarRegla(PERFIL, "csharpsquid:S107", { impactos: [{ calidad: "MAINTAINABILITY", severidad: "MEDIUM" }] });

    expect(pedidos).toHaveLength(3);
    expect(pedidos.every((p) => p.cuerpo?.get("impacts") === "MAINTAINABILITY=MEDIUM")).toBe(true);
  });

  it("si Sonar sigue fallando, se rinde después de 3 intentos", async () => {
    const { fetch, pedidos } = fetchFalso(() => new Response(null, { status: 502 }));

    expect((await error(cliente(fetch).desactivarRegla(PERFIL, "csharpsquid:S107"))).tipo).toBe("servidor");
    expect(pedidos).toHaveLength(3);
  });
});
