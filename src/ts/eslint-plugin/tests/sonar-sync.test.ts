import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buscarAceptados, ErrorDeSonar } from "../src/aceptados/cliente.js";
import { leerOpciones } from "../src/aceptados/opciones.js";
import { ejecutar, PAUSA_TRAS_FALLA_MS } from "../src/aceptados/sincronizacion.js";

interface Pedido {
  url: URL;
  autorizacion: string | null;
}

/** Un SonarQube falso: responde con lo que diga `responder` y anota los pedidos. */
function servidorFalso(responder: (url: URL) => Response | Promise<Response>) {
  const pedidos: Pedido[] = [];
  const fetchFalso: typeof fetch = async (entrada, init) => {
    const url = new URL(String(entrada));
    pedidos.push({ url, autorizacion: new Headers(init?.headers).get("authorization") });
    return responder(url);
  };
  return { pedidos, fetch: fetchFalso };
}

function issue(rule: string, archivo: string, message: string, issueStatus: string | null = "ACCEPTED", resolution?: string) {
  return {
    rule,
    component: `revertpablo_Lainco-quality:${archivo}`,
    message,
    ...(issueStatus === null ? {} : { issueStatus }),
    ...(resolution ? { resolution } : {}),
  };
}

function pagina(total: number, ...issues: unknown[]) {
  return Response.json({ paging: { pageIndex: 1, pageSize: 500, total }, issues });
}

const OPCIONES = leerOpciones(["--proyecto", "revertpablo_Lainco-quality"]);

describe("buscarAceptados", () => {
  it("pide los aceptados y falsos positivos del proyecto con el token", async () => {
    const servidor = servidorFalso(() => pagina(0));

    await buscarAceptados(OPCIONES, "secreto", servidor.fetch);

    const [pedido] = servidor.pedidos;
    expect(pedido!.url.origin + pedido!.url.pathname).toBe("https://sonarcloud.io/api/issues/search");
    expect(Object.fromEntries(pedido!.url.searchParams)).toEqual({
      componentKeys: "revertpablo_Lainco-quality",
      issueStatuses: "ACCEPTED,FALSE_POSITIVE",
      ps: "500",
      p: "1",
    });
    expect(pedido!.autorizacion).toBe("Bearer secreto");
  });

  it("pasa la rama y la organización", async () => {
    const servidor = servidorFalso(() => pagina(0));
    const opciones = leerOpciones(["--proyecto", "p", "--rama", "develop", "--organizacion", "revertpablo"]);

    await buscarAceptados(opciones, "t", servidor.fetch);

    expect(servidor.pedidos[0]!.url.searchParams.get("branch")).toBe("develop");
    expect(servidor.pedidos[0]!.url.searchParams.get("organization")).toBe("revertpablo");
  });

  it("devuelve solo las reglas propias de los dos motores", async () => {
    const servidor = servidorFalso(() =>
      pagina(
        5,
        issue("external_roslyn:LAIN004", "A.cs", "a"),
        issue("external_eslint_repo:lainco/no-hardcoded-secrets", "web/config.ts", "Secreto hardcodeado en 'API_KEY'"),
        issue("external_eslint_repo:no-debugger", "web/config.ts", "Unexpected 'debugger' statement."),
        issue("external_roslyn:CA1822", "A.cs", "b"),
        issue("typescript:S1481", "web/config.ts", "Remove this unused variable."),
      ),
    );

    const issues = await buscarAceptados(OPCIONES, "t", servidor.fetch);

    expect(issues).toEqual([
      { archivo: "A.cs", regla: "LAIN004", mensaje: "a", estado: "ACCEPTED" },
      { archivo: "web/config.ts", regla: "lainco/no-hardcoded-secrets", mensaje: "Secreto hardcodeado en 'API_KEY'", estado: "ACCEPTED" },
    ]);
  });

  it("deduce el estado de 'resolution' si no viene 'issueStatus'", async () => {
    const servidor = servidorFalso(() =>
      pagina(
        3,
        issue("external_eslint_repo:lainco/a", "a.ts", "a", "FALSE_POSITIVE"),
        issue("external_eslint_repo:lainco/b", "b.ts", "b", null, "WONTFIX"),
        issue("external_eslint_repo:lainco/c", "c.ts", "c", null, "FALSE-POSITIVE"),
      ),
    );

    const issues = await buscarAceptados(OPCIONES, "t", servidor.fetch);

    expect(issues.map((i) => i.estado)).toEqual(["FALSE_POSITIVE", "ACCEPTED", "FALSE_POSITIVE"]);
  });

  it("recorre todas las páginas", async () => {
    const servidor = servidorFalso((url) =>
      url.searchParams.get("p") === "1"
        ? pagina(501, ...Array.from({ length: 500 }, (_, i) => issue("external_eslint_repo:lainco/a", `a${i}.ts`, "m")))
        : pagina(501, issue("external_eslint_repo:lainco/b", "b.ts", "m")),
    );

    const issues = await buscarAceptados(OPCIONES, "t", servidor.fetch);

    expect(issues).toHaveLength(501);
    expect(servidor.pedidos.map((p) => p.url.searchParams.get("p"))).toEqual(["1", "2"]);
  });

  it("corta con una página vacía aunque el total diga otra cosa", async () => {
    const servidor = servidorFalso(() => pagina(10));

    expect(await buscarAceptados(OPCIONES, "t", servidor.fetch)).toEqual([]);
    expect(servidor.pedidos).toHaveLength(1);
  });

  it.each([
    [401, "SonarQube rechazó el token. Revisá la variable LAINCO_SONAR_TOKEN."],
    [403, "El token no tiene permiso para ver los issues del proyecto 'revertpablo_Lainco-quality'."],
    [404, "SonarQube no encontró el proyecto 'revertpablo_Lainco-quality' (o la rama indicada)."],
    [500, "SonarQube respondió 500."],
  ])("traduce un %i", async (estado, mensaje) => {
    const servidor = servidorFalso(() => new Response("", { status: estado }));

    await expect(buscarAceptados(OPCIONES, "t", servidor.fetch)).rejects.toThrow(new ErrorDeSonar(mensaje));
  });

  it("falla si la API no entregaría todos los issues", async () => {
    const servidor = servidorFalso(() => pagina(10_001));

    await expect(buscarAceptados(OPCIONES, "t", servidor.fetch)).rejects.toThrow(
      "La consulta devuelve 10001 issues y la API no entrega más de 10000. El archivo quedaría incompleto, así que no se genera.",
    );
  });

  it("falla si la respuesta no es JSON", async () => {
    const servidor = servidorFalso(() => new Response("<html>"));

    await expect(buscarAceptados(OPCIONES, "t", servidor.fetch)).rejects.toThrow("SonarQube devolvió una respuesta que no es JSON.");
  });

  it("falla si no puede conectarse", async () => {
    const servidor = servidorFalso(() => {
      throw new TypeError("fetch failed");
    });

    await expect(buscarAceptados(OPCIONES, "t", servidor.fetch)).rejects.toThrow("No se pudo conectar con https://sonarcloud.io: fetch failed.");
  });
});

describe("leerOpciones", () => {
  it("toma los valores por defecto", () => {
    expect(leerOpciones(["--proyecto", "p"])).toEqual({
      proyecto: "p",
      organizacion: null,
      rama: null,
      url: "https://sonarcloud.io",
      salida: "sonar-accepted.json",
      vigenciaHoras: null,
    });
  });

  it.each([
    [[], "Falta --proyecto: la clave del proyecto en SonarQube."],
    [["--proyecto"], "Falta el valor de --proyecto."],
    [["--proyecto", "p", "--otra", "x"], "Opción desconocida: --otra."],
    [["--proyecto", "p", "--vigencia-horas", "-1"], "--vigencia-horas debe ser un número entero de horas, 0 o más: '-1'."],
  ])("rechaza %j", (argumentos, mensaje) => {
    expect(() => leerOpciones(argumentos)).toThrow(mensaje);
  });
});

describe("ejecutar", () => {
  let carpeta: string;
  let salida: string;
  let log: string[];
  const ahora = new Date("2026-11-02T12:00:00Z");

  beforeEach(() => {
    carpeta = mkdtempSync(join(tmpdir(), "sonar-sync-"));
    salida = join(carpeta, "sonar-accepted.json");
    log = [];
  });

  afterEach(() => {
    rmSync(carpeta, { recursive: true, force: true });
  });

  function correr(argumentos: string[], servidor = servidorFalso(() => pagina(0)), { sinToken = false } = {}) {
    return ejecutar(["--proyecto", "revertpablo_Lainco-quality", "--salida", salida, ...argumentos], {
      token: sinToken ? undefined : "t",
      fetch: servidor.fetch,
      log: (linea) => log.push(linea),
      ahora: () => ahora,
    });
  }

  function antiguedad(archivo: string, horas: number) {
    const fecha = new Date(ahora.getTime() - horas * 3_600_000);
    utimesSync(archivo, fecha, fecha);
  }

  it("escribe el archivo con el mismo formato que la versión .NET", async () => {
    const servidor = servidorFalso(() =>
      pagina(
        2,
        issue("external_eslint_repo:lainco/no-hardcoded-secrets", "web/config.ts", "Secreto hardcodeado en 'API_KEY'"),
        issue("external_roslyn:LAIN004", "Sample.Dominio/Articulo.cs", "La property 'Sample.Dominio.Articulo.Descripcion' no debe inicializarse en la declaración"),
      ),
    );

    expect(await correr([], servidor)).toBe(0);

    expect(readFileSync(salida, "utf8")).toBe(`{
  "version": 1,
  "proyecto": "revertpablo_Lainco-quality",
  "rama": null,
  "generado": "2026-11-02T12:00:00+00:00",
  "issues": [
    {
      "archivo": "Sample.Dominio/Articulo.cs",
      "regla": "LAIN004",
      "mensaje": "La property 'Sample.Dominio.Articulo.Descripcion' no debe inicializarse en la declaración",
      "estado": "ACCEPTED"
    },
    {
      "archivo": "web/config.ts",
      "regla": "lainco/no-hardcoded-secrets",
      "mensaje": "Secreto hardcodeado en 'API_KEY'",
      "estado": "ACCEPTED"
    }
  ]
}`);
    expect(log).toEqual([`sonar-sync: 2 issues aceptados de 'revertpablo_Lainco-quality' en ${salida}.`]);
  });

  it("sin token termina con 1 y no consulta", async () => {
    const servidor = servidorFalso(() => pagina(0));

    expect(await correr([], servidor, { sinToken: true })).toBe(1);
    expect(servidor.pedidos).toEqual([]);
    expect(log[0]).toContain("falta el token");
  });

  it("con opciones inválidas termina con 1 y muestra el uso", async () => {
    expect(await correr(["--otra", "x"])).toBe(1);
    expect(log[0]).toBe("sonar-sync: Opción desconocida: --otra.");
    expect(log.join("\n")).toContain("Uso: lainco-sonar-sync --proyecto <clave>");
  });

  it("con el archivo vigente no consulta, aunque no haya token", async () => {
    writeFileSync(salida, "{}");
    antiguedad(salida, 1);
    const servidor = servidorFalso(() => pagina(0));

    expect(await correr(["--vigencia-horas", "8"], servidor, { sinToken: true })).toBe(0);
    expect(servidor.pedidos).toEqual([]);
  });

  it("con el archivo vencido consulta", async () => {
    writeFileSync(salida, "{}");
    antiguedad(salida, 9);
    const servidor = servidorFalso(() => pagina(0));

    expect(await correr(["--vigencia-horas", "8"], servidor)).toBe(0);
    expect(servidor.pedidos).toHaveLength(1);
  });

  it("si Sonar falla, conserva el archivo anterior, marca la falla y termina con 2", async () => {
    writeFileSync(salida, "anterior");

    expect(await correr([], servidorFalso(() => new Response("", { status: 401 })))).toBe(2);

    expect(readFileSync(salida, "utf8")).toBe("anterior");
    expect(existsSync(`${salida}.falla`)).toBe(true);
    expect(log).toEqual([`sonar-sync: SonarQube rechazó el token. Revisá la variable LAINCO_SONAR_TOKEN. No se modificó ${salida}.`]);
  });

  it("tras una falla, las corridas automáticas hacen una pausa", async () => {
    writeFileSync(`${salida}.falla`, "x");
    antiguedad(`${salida}.falla`, PAUSA_TRAS_FALLA_MS / 3_600_000 / 2);
    const servidor = servidorFalso(() => pagina(0));

    expect(await correr(["--vigencia-horas", "8"], servidor)).toBe(0);
    expect(servidor.pedidos).toEqual([]);
  });

  it("una corrida manual ignora la pausa y borra la marca al terminar bien", async () => {
    writeFileSync(`${salida}.falla`, "x");
    antiguedad(`${salida}.falla`, 0);
    const servidor = servidorFalso(() => pagina(0));

    expect(await correr([], servidor)).toBe(0);
    expect(servidor.pedidos).toHaveLength(1);
    expect(existsSync(`${salida}.falla`)).toBe(false);
  });

  it("si otra corrida tiene el candado, sigue con el archivo actual", async () => {
    writeFileSync(`${salida}.lock`, "");
    antiguedad(`${salida}.lock`, 0);
    const servidor = servidorFalso(() => pagina(0));

    expect(await correr([], servidor)).toBe(0);
    expect(servidor.pedidos).toEqual([]);
    expect(log).toEqual([`sonar-sync: otra corrida está actualizando ${salida}; se sigue con el archivo actual.`]);
  });

  it("un candado abandonado no bloquea para siempre", async () => {
    writeFileSync(`${salida}.lock`, "");
    antiguedad(`${salida}.lock`, 1);
    const servidor = servidorFalso(() => pagina(0));

    expect(await correr([], servidor)).toBe(0);
    expect(servidor.pedidos).toHaveLength(1);
    expect(existsSync(`${salida}.lock`)).toBe(false);
  });
});
