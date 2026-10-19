import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { crearClienteSonar, type ReglaDeSonar } from "@/sonar/cliente";

/**
 * Acceso a la grabación de SonarQube Cloud (tests/fixtures/sonar/, `npm run sonar:grabar`)
 * para los tests que necesitan reglas reales sin red.
 */

const CARPETA = path.join(__dirname, "..", "fixtures", "sonar");

export const hayGrabacion = existsSync(path.join(CARPETA, "grabacion.json"));

export interface Grabacion {
  url: string;
  organizacion: string;
  tamanoDePagina: number;
  parametros: Record<string, string>;
  lenguajes: Record<string, { total: number; paginas: number }>;
}

export function leerArchivo<T>(archivo: string): T {
  const contenido = readFileSync(path.join(CARPETA, archivo));
  return JSON.parse((archivo.endsWith(".gz") ? gunzipSync(contenido) : contenido).toString("utf8")) as T;
}

/** Las reglas grabadas de un lenguaje, leídas con el cliente real. */
export async function reglasGrabadas(lenguaje: string): Promise<ReglaDeSonar[]> {
  const grabacion = leerArchivo<Grabacion>("grabacion.json");
  const fetch = (async (entrada: string | URL | Request) => {
    const url = new URL(String(entrada));
    return Response.json(leerArchivo(`reglas-${url.searchParams.get("languages")}-p${url.searchParams.get("p")}.json.gz`));
  }) as typeof globalThis.fetch;

  return crearClienteSonar({
    url: grabacion.url,
    organizacion: grabacion.organizacion,
    token: "token-de-prueba",
    tamanoDePagina: grabacion.tamanoDePagina,
    fetch,
  }).buscarReglas(lenguaje);
}
