/**
 * Genera `dist/reglas-eslint.json` después de compilar el plugin. Si alguna regla no cumple
 * las convenciones, lista todas y termina con error: el build falla.
 *
 *   npm run build   (lo corre al final)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import plugin from "../src/index.js";
import { generarCatalogo, serializar } from "./catalogo.js";

const carpetaDelPlugin = join(dirname(fileURLToPath(import.meta.url)), "..");
const carpetaDeDocumentacion = join(carpetaDelPlugin, "..", "..", "..", "docs", "rules", "lainco");
const { name, version } = JSON.parse(readFileSync(join(carpetaDelPlugin, "package.json"), "utf8"));

const resultado = generarCatalogo(name, version, plugin.rules, (nombre) => {
  const archivo = join(carpetaDeDocumentacion, `${nombre}.md`);
  return existsSync(archivo) ? readFileSync(archivo, "utf8") : null;
});

if (!resultado.ok) {
  for (const error of resultado.errores) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

const salida = join(carpetaDelPlugin, "dist", "reglas-eslint.json");
mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, serializar(resultado.catalogo), "utf8");
console.log(`Catálogo con ${resultado.catalogo.reglas.length} reglas en ${salida}`);
