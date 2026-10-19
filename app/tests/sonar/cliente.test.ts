import { describe, expect, it } from "vitest";

import { crearClienteSonar, ErrorDeSonar, type OpcionesDelCliente } from "@/sonar/cliente";
import { clienteSonarDesdeEntorno } from "@/sonar/configuracion";

/**
 * Cliente de `api/rules/search` (entrega 6.1, paso 5).
 *
 * Estos tests usan respuestas armadas a mano con la forma del ejemplo oficial de la Web
 * API (search-example.json del repo de SonarQube). Los que reproducen respuestas grabadas
 * de SonarQube Cloud están en grabadas.test.ts.
 */

const TOKEN = "token-secreto-de-prueba";

/** Una regla con la forma que devuelve la API. Los cambios pisan los campos. */
function reglaDeLaApi(clave: string, cambios: Record<string, unknown> = {}) {
  const [repo] = clave.split(":");
  return {
    key: clave,
    repo,
    name: `Regla ${clave}`,
    createdAt: "2013-03-27T08:52:40+0100",
    updatedAt: "2024-05-02T10:00:00+0000",
    severity: "MAJOR",
    status: "READY",
    isTemplate: false,
    tags: [],
    sysTags: ["brain-overload"],
    lang: "cs",
    langName: "C#",
    type: "CODE_SMELL",
    cleanCodeAttributeCategory: "INTENTIONAL",
    cleanCodeAttribute: "CLEAR",
    impacts: [{ softwareQuality: "MAINTAINABILITY", severity: "HIGH" }],
    descriptionSections: [{ key: "root_cause", content: `<p>Por qué ${clave}</p>` }],
    params: [],
    ...cambios,
  };
}

function pagina(reglas: unknown[], pageIndex: number, pageSize: number, total: number) {
  return { paging: { pageIndex, pageSize, total }, rules: reglas };
}

interface Pedido {
  url: URL;
  headers: Headers;
}

/**
 * Un fetch falso. `responder` recibe el pedido y devuelve lo que contestaría Sonar: un
 * objeto (200 con ese JSON), una Response, o lanza (falla de red).
 */
function fetchFalso(responder: (pedido: Pedido, numero: number) => unknown) {
  const pedidos: Pedido[] = [];
  const fn = async (entrada: string | URL | Request, init?: RequestInit) => {
    const pedido = { url: new URL(String(entrada)), headers: new Headers(init?.headers) };
    pedidos.push(pedido);
    const respuesta = await responder(pedido, pedidos.length);
    return respuesta instanceof Response ? respuesta : Response.json(respuesta);
  };
  return { fetch: fn as typeof fetch, pedidos };
}

/** Sirve `total` reglas en páginas de `tamano`, como lo haría Sonar. */
function sonarConReglas(total: number, tamano: number) {
  const todas = Array.from({ length: total }, (_, i) => reglaDeLaApi(`csharpsquid:S${1000 + i}`));
  return fetchFalso(({ url }) => {
    const p = Number(url.searchParams.get("p"));
    const ps = Number(url.searchParams.get("ps"));
    expect(ps).toBe(tamano);
    return pagina(todas.slice((p - 1) * ps, p * ps), p, ps, total);
  });
}

function cliente(fetch: typeof globalThis.fetch, cambios: Partial<OpcionesDelCliente> = {}) {
  return crearClienteSonar({
    url: "https://sonarcloud.io",
    organizacion: "revertpablo",
    token: TOKEN,
    fetch,
    esperar: async () => {},
    ...cambios,
  });
}

async function error(promesa: Promise<unknown>): Promise<ErrorDeSonar> {
  try {
    await promesa;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorDeSonar);
    return e as ErrorDeSonar;
  }
  throw new Error("Se esperaba un error.");
}

// ---------------------------------------------------------------------------------

describe("el pedido", () => {
  it("va a api/rules/search con la organización, el lenguaje y el token como Bearer", async () => {
    const sonar = sonarConReglas(1, 500);

    await cliente(sonar.fetch).buscarReglas("cs");

    const [{ url, headers }] = sonar.pedidos;
    expect(url.origin + url.pathname).toBe("https://sonarcloud.io/api/rules/search");
    expect(url.searchParams.get("organization")).toBe("revertpablo");
    expect(url.searchParams.get("languages")).toBe("cs");
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("pide las reglas listas, beta y deprecadas, y no las externas", async () => {
    // Las deprecadas hacen falta para marcarlas (FASE-6.md, sección 3). Las externas
    // (external_roslyn:LAIN005, ...) no son reglas de Sonar: tienen su propio origen.
    const sonar = sonarConReglas(1, 500);

    await cliente(sonar.fetch).buscarReglas("cs");

    const { url } = sonar.pedidos[0];
    expect(url.searchParams.get("statuses")?.split(",").sort()).toEqual(["BETA", "DEPRECATED", "READY"]);
    expect(url.searchParams.get("include_external")).toBe("false");
  });

  it("usa el tamaño de página máximo de la API, 500", async () => {
    const sonar = sonarConReglas(1, 500);

    await cliente(sonar.fetch).buscarReglas("cs");

    expect(sonar.pedidos[0].url.searchParams.get("ps")).toBe("500");
  });

  it("acepta la URL del servidor con barra final", async () => {
    const sonar = sonarConReglas(1, 500);

    await cliente(sonar.fetch, { url: "https://sonarcloud.io/" }).buscarReglas("cs");

    expect(sonar.pedidos[0].url.pathname).toBe("/api/rules/search");
  });

  it("sin organización no manda el parámetro (SonarQube Server)", async () => {
    const sonar = sonarConReglas(1, 500);

    await cliente(sonar.fetch, { organizacion: undefined }).buscarReglas("cs");

    expect(sonar.pedidos[0].url.searchParams.has("organization")).toBe(false);
  });
});

describe("paginación", () => {
  it.each([
    [0, 1],
    [1, 1],
    [3, 1],
    [4, 2],
    [10, 4],
    [12, 4],
  ])("%i reglas en páginas de 3 se traen en %i pedidos", async (total, pedidos) => {
    const sonar = sonarConReglas(total, 3);

    const reglas = await cliente(sonar.fetch, { tamanoDePagina: 3 }).buscarReglas("cs");

    expect(reglas).toHaveLength(total);
    expect(new Set(reglas.map((r) => r.clave)).size).toBe(total);
    expect(sonar.pedidos.map((p) => p.url.searchParams.get("p"))).toEqual(
      Array.from({ length: pedidos }, (_, i) => String(i + 1)),
    );
  });

  it("también entiende el formato viejo, sin `paging` (total, p, ps)", async () => {
    const todas = [reglaDeLaApi("csharpsquid:S1"), reglaDeLaApi("csharpsquid:S2"), reglaDeLaApi("csharpsquid:S3")];
    const sonar = fetchFalso(({ url }) => {
      const p = Number(url.searchParams.get("p"));
      return { total: 3, p, ps: 2, rules: todas.slice((p - 1) * 2, p * 2) };
    });

    const reglas = await cliente(sonar.fetch, { tamanoDePagina: 2 }).buscarReglas("cs");

    expect(reglas.map((r) => r.clave)).toEqual(["csharpsquid:S1", "csharpsquid:S2", "csharpsquid:S3"]);
  });

  it("si hay más de 10.000 reglas, falla en vez de traer una lista incompleta", async () => {
    // La API no devuelve más allá del resultado 10.000. Una lista cortada haría que la
    // sincronización marque como eliminadas reglas que siguen existiendo.
    const sonar = fetchFalso(() => pagina([reglaDeLaApi("csharpsquid:S1")], 1, 500, 10_001));

    const e = await error(cliente(sonar.fetch).buscarReglas("cs"));

    expect(e.tipo).toBe("demasiadosResultados");
    expect(sonar.pedidos).toHaveLength(1);
  });

  it("si el total cambia entre páginas, falla", async () => {
    // Sonar se actualizó en medio de la consulta (acá, se eliminó una regla): la lista
    // puede tener huecos o repetidos aunque la cantidad cierre.
    const sonar = fetchFalso(({ url }) => {
      const p = Number(url.searchParams.get("p"));
      return p === 1
        ? pagina([reglaDeLaApi("csharpsquid:S1"), reglaDeLaApi("csharpsquid:S2")], 1, 2, 4)
        : pagina([reglaDeLaApi("csharpsquid:S3")], 2, 2, 3);
    });

    const e = await error(cliente(sonar.fetch, { tamanoDePagina: 2 }).buscarReglas("cs"));

    expect(e.tipo).toBe("inconsistente");
  });

  it("si una regla aparece repetida, falla", async () => {
    const sonar = fetchFalso(({ url }) => {
      const p = Number(url.searchParams.get("p"));
      return p === 1
        ? pagina([reglaDeLaApi("csharpsquid:S1"), reglaDeLaApi("csharpsquid:S2")], 1, 2, 4)
        : pagina([reglaDeLaApi("csharpsquid:S2"), reglaDeLaApi("csharpsquid:S3")], 2, 2, 4);
    });

    const e = await error(cliente(sonar.fetch, { tamanoDePagina: 2 }).buscarReglas("cs"));

    expect(e.tipo).toBe("inconsistente");
  });

  it("si una página viene vacía antes de llegar al total, falla en vez de seguir pidiendo", async () => {
    const sonar = fetchFalso(({ url }) => {
      const p = Number(url.searchParams.get("p"));
      return p === 1 ? pagina([reglaDeLaApi("csharpsquid:S1")], 1, 1, 3) : pagina([], p, 1, 3);
    });

    const e = await error(cliente(sonar.fetch, { tamanoDePagina: 1 }).buscarReglas("cs"));

    expect(e.tipo).toBe("inconsistente");
    expect(sonar.pedidos).toHaveLength(2);
  });
});

describe("cada regla", () => {
  async function unaRegla(cambios: Record<string, unknown>) {
    const sonar = fetchFalso(() => pagina([reglaDeLaApi("csharpsquid:S2325", cambios)], 1, 500, 1));
    const [regla] = await cliente(sonar.fetch).buscarReglas("cs");
    return regla;
  }

  it("se traduce a los nombres del dominio", async () => {
    const regla = await unaRegla({
      name: "Methods that don't access instance data should be static",
      tags: ["lainco"],
      sysTags: ["pitfall", "brain-overload"],
      params: [{ key: "max", desc: "Máximo permitido", defaultValue: "3", type: "INTEGER" }],
    });

    expect(regla).toEqual({
      clave: "csharpsquid:S2325",
      repositorio: "csharpsquid",
      nombre: "Methods that don't access instance data should be static",
      lenguaje: "cs",
      estado: "READY",
      tipo: "CODE_SMELL",
      severidad: "MAJOR",
      tags: ["brain-overload", "lainco", "pitfall"],
      atributoCleanCode: "CLEAR",
      impactos: [{ calidad: "MAINTAINABILITY", severidad: "HIGH" }],
      parametros: [{ clave: "max", descripcion: "Máximo permitido", tipo: "INTEGER", valorDefault: "3" }],
      descripcion: "<p>Por qué csharpsquid:S2325</p>",
      esPlantilla: false,
      creadaEn: "2013-03-27T08:52:40+0100",
      actualizadaEn: "2024-05-02T10:00:00+0000",
    });
  });

  it("une las secciones de la descripción, con el nombre del contexto cuando lo tienen", async () => {
    const regla = await unaRegla({
      descriptionSections: [
        { key: "root_cause", content: "<p>Causa</p>" },
        { key: "how_to_fix", content: "<p>Con ASP.NET</p>", context: { displayName: "ASP.NET", key: "aspnet" } },
        { key: "resources", content: "<p>Recursos</p>" },
      ],
    });

    expect(regla.descripcion).toBe("<p>Causa</p>\n<h3>ASP.NET</h3>\n<p>Con ASP.NET</p>\n<p>Recursos</p>");
  });

  it("ordena las secciones como las muestra Sonar, venga en el orden que venga", async () => {
    // Sonar Cloud las manda en distinto orden según la regla (2026-10-19: en 152 de 1.123
    // venían primero los recursos). Con un orden fijo, la descripción y su huella no
    // cambian si solo cambia el orden.
    const secciones = [
      { key: "resources", content: "<p>R</p>" },
      { key: "how_to_fix", content: "<p>Con B</p>", context: { displayName: "B", key: "b" } },
      { key: "root_cause", content: "<p>C</p>" },
      { key: "how_to_fix", content: "<p>Con A</p>", context: { displayName: "A", key: "a" } },
      { key: "introduction", content: "<p>I</p>" },
    ];
    const esperado = "<p>I</p>\n<p>C</p>\n<h3>A</h3>\n<p>Con A</p>\n<h3>B</h3>\n<p>Con B</p>\n<p>R</p>";

    expect((await unaRegla({ descriptionSections: secciones })).descripcion).toBe(esperado);
    expect((await unaRegla({ descriptionSections: [...secciones].reverse() })).descripcion).toBe(esperado);
  });

  it("sin secciones, usa htmlDesc (versiones viejas de la API)", async () => {
    const regla = await unaRegla({ descriptionSections: undefined, htmlDesc: "<p>Vieja</p>" });

    expect(regla.descripcion).toBe("<p>Vieja</p>");
  });

  it("sin descripción, queda vacía", async () => {
    const regla = await unaRegla({ descriptionSections: [], htmlDesc: undefined });

    expect(regla.descripcion).toBe("");
  });

  it("los campos opcionales que faltan quedan en null o vacíos", async () => {
    const regla = await unaRegla({
      type: undefined,
      severity: undefined,
      cleanCodeAttribute: undefined,
      impacts: undefined,
      params: undefined,
      tags: undefined,
      sysTags: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      isTemplate: undefined,
    });

    expect(regla).toMatchObject({
      tipo: null,
      severidad: null,
      atributoCleanCode: null,
      impactos: [],
      parametros: [],
      tags: [],
      creadaEn: null,
      actualizadaEn: null,
      esPlantilla: false,
    });
  });

  it("un parámetro sin descripción, tipo ni valor por defecto solo lleva la clave", async () => {
    const regla = await unaRegla({ params: [{ key: "formato" }] });

    expect(regla.parametros).toEqual([{ clave: "formato" }]);
  });

  it("una regla deprecada conserva su estado", async () => {
    const regla = await unaRegla({ status: "DEPRECATED" });

    expect(regla.estado).toBe("DEPRECATED");
  });

  it.each([
    ["sin clave", { key: undefined }],
    ["sin nombre", { name: undefined }],
    ["sin lenguaje", { lang: undefined }],
    ["con tags que no son texto", { tags: [1, 2] }],
  ])("una regla %s es una respuesta inválida", async (_caso, cambios) => {
    const e = await error(unaRegla(cambios));

    expect(e.tipo).toBe("respuestaInvalida");
  });
});

describe("errores", () => {
  it.each([
    [401, "autenticacion"],
    [403, "permisos"],
    [404, "noEncontrado"],
    [400, "pedidoInvalido"],
  ] as const)("HTTP %i se informa como %s, sin reintentar", async (estado, tipo) => {
    const sonar = fetchFalso(() =>
      Response.json({ errors: [{ msg: "Organization 'x' not found" }] }, { status: estado }),
    );

    const e = await error(cliente(sonar.fetch).buscarReglas("cs"));

    expect(e.tipo).toBe(tipo);
    expect(e.estadoHttp).toBe(estado);
    expect(sonar.pedidos).toHaveLength(1);
  });

  it("el mensaje incluye lo que dice Sonar", async () => {
    const sonar = fetchFalso(() =>
      Response.json({ errors: [{ msg: "Organization 'x' not found" }] }, { status: 404 }),
    );

    const e = await error(cliente(sonar.fetch).buscarReglas("cs"));

    expect(e.message).toContain("Organization 'x' not found");
  });

  it.each([
    ["HTTP 500", () => new Response("error", { status: 500 })],
    ["HTTP 503", () => new Response("error", { status: 503 })],
    ["HTTP 429", () => new Response("", { status: 429 })],
    [
      "una falla de red",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("%s se reintenta y, si se recupera, sigue", async (_caso, falla) => {
    const sonar = fetchFalso((_p, numero) => (numero === 1 ? falla() : pagina([reglaDeLaApi("csharpsquid:S1")], 1, 500, 1)));

    const reglas = await cliente(sonar.fetch).buscarReglas("cs");

    expect(reglas).toHaveLength(1);
    expect(sonar.pedidos).toHaveLength(2);
  });

  it("se rinde después de 3 intentos, esperando más entre uno y otro", async () => {
    const esperas: number[] = [];
    const sonar = fetchFalso(() => new Response("error", { status: 502 }));

    const e = await error(
      cliente(sonar.fetch, { esperar: async (ms) => void esperas.push(ms) }).buscarReglas("cs"),
    );

    expect(e.tipo).toBe("servidor");
    expect(sonar.pedidos).toHaveLength(3);
    expect(esperas).toHaveLength(2);
    expect(esperas[1]).toBeGreaterThan(esperas[0]);
  });

  it("una falla de red persistente se informa como red", async () => {
    const sonar = fetchFalso(() => {
      throw new TypeError("fetch failed");
    });

    const e = await error(cliente(sonar.fetch).buscarReglas("cs"));

    expect(e.tipo).toBe("red");
  });

  it("una respuesta que no es JSON es inválida", async () => {
    const sonar = fetchFalso(() => new Response("<html>Mantenimiento</html>", { status: 200 }));

    const e = await error(cliente(sonar.fetch).buscarReglas("cs"));

    expect(e.tipo).toBe("respuestaInvalida");
  });

  it("una respuesta sin lista de reglas es inválida", async () => {
    const sonar = fetchFalso(() => ({ paging: { pageIndex: 1, pageSize: 500, total: 0 } }));

    const e = await error(cliente(sonar.fetch).buscarReglas("cs"));

    expect(e.tipo).toBe("respuestaInvalida");
  });

  it("ningún error expone el token", async () => {
    const casos: (() => unknown)[] = [
      () => Response.json({ errors: [{ msg: "x" }] }, { status: 401 }),
      () => new Response("error", { status: 500 }),
      () => new Response("no es json"),
      () => {
        throw new TypeError(`falló con ${TOKEN}`);
      },
    ];

    for (const caso of casos) {
      const e = await error(cliente(fetchFalso(caso).fetch).buscarReglas("cs"));
      expect(`${e.message} ${e.stack} ${JSON.stringify(e)}`).not.toContain(TOKEN);
    }
  });
});

describe("configuración", () => {
  it("sin token no se puede crear el cliente", () => {
    expect(() => cliente(fetchFalso(() => ({})).fetch, { token: "" })).toThrow(/token/i);
  });

  it("el tamaño de página tiene que estar entre 1 y 500", () => {
    expect(() => cliente(fetchFalso(() => ({})).fetch, { tamanoDePagina: 501 })).toThrow();
    expect(() => cliente(fetchFalso(() => ({})).fetch, { tamanoDePagina: 0 })).toThrow();
  });
});

describe("configuración desde el entorno", () => {
  it("sin SONAR_ORGANIZACION ni LAINCO_SONAR_TOKEN, dice cuáles faltan", () => {
    expect(() => clienteSonarDesdeEntorno({})).toThrow("SONAR_ORGANIZACION, LAINCO_SONAR_TOKEN");
    expect(() => clienteSonarDesdeEntorno({ SONAR_ORGANIZACION: "revertpablo", LAINCO_SONAR_TOKEN: "  " })).toThrow(
      "LAINCO_SONAR_TOKEN",
    );
  });

  it("con las dos, crea el cliente", () => {
    expect(clienteSonarDesdeEntorno({ SONAR_ORGANIZACION: "revertpablo", LAINCO_SONAR_TOKEN: TOKEN })).toBeDefined();
  });
});
