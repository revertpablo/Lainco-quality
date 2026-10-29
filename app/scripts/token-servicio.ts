/**
 * Administra los tokens de servicio con los que los jobs de CI entran a /api/ci/
 * (entrega 6.5, paso 1, decisión E5).
 *
 * Uso, dentro de app/:
 *
 *   npm run token -- crear --nombre job-de-prueba [--alcance prueba] [--dias 365]
 *   npm run token -- listar
 *   npm run token -- revocar --nombre job-de-prueba
 *
 * Lee DATABASE_URL de la consola o de los archivos .env (los mismos que `npm run dev`).
 * Para otro entorno, se pasa DATABASE_URL en la consola (app/README.md, "Bases por entorno").
 *
 * `crear` muestra el token **una sola vez**: la base guarda solo su hash. Se copia al secret
 * del job y no se escribe en ningún otro lado. Para cambiar un token, se crea otro con otro
 * nombre, se actualiza el secret y se da de baja el viejo.
 */
import { parseArgs } from "node:util";

import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { Db } from "@/db/cliente";
import * as esquema from "@/db/esquema";
import { conSslExplicito } from "@/db/ssl";
import { AlcanceToken } from "@/dominio/valores";
import {
  crearTokenServicio,
  DIAS_MAXIMOS,
  ErrorDeTokenServicio,
  listarTokensServicio,
  revocarTokenServicio,
} from "@/servicio/tokensDeServicio";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const AYUDA = `Uso:
  npm run token -- crear --nombre <nombre> [--alcance ${Object.values(AlcanceToken).join("|")}] [--dias 1-${DIAS_MAXIMOS}]
  npm run token -- listar
  npm run token -- revocar --nombre <nombre>`;

const fecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" });

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      nombre: { type: "string" },
      alcance: { type: "string", default: AlcanceToken.Prueba },
      dias: { type: "string", default: String(DIAS_MAXIMOS) },
    },
  });
  const [comando] = positionals;

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Falta DATABASE_URL (app/README.md, «Bases por entorno»).");
    return 1;
  }
  const pool = new Pool({ connectionString: conSslExplicito(url), max: 1 });
  const db = drizzle(pool, { schema: esquema }) as unknown as Db;

  try {
    switch (comando) {
      case "crear": {
        const alcance = values.alcance as AlcanceToken;
        if (!values.nombre || !Object.values(AlcanceToken).includes(alcance)) {
          console.error(AYUDA);
          return 1;
        }
        const creado = await crearTokenServicio(db, { nombre: values.nombre, alcance, dias: Number(values.dias) });
        console.log(`Token "${creado.nombre}" (alcance ${alcance}), vence el ${fecha.format(creado.expiraEn)}.`);
        console.log("Copialo ahora al secret del job: no se vuelve a mostrar y la app no lo guarda.\n");
        console.log(creado.token);
        return 0;
      }
      case "listar": {
        const tokens = await listarTokensServicio(db);
        if (tokens.length === 0) {
          console.log("No hay tokens de servicio.");
        }
        for (const t of tokens) {
          const uso = t.ultimoUsoEn ? `último uso el ${fecha.format(t.ultimoUsoEn)}` : "sin usar";
          console.log(`${t.nombre}  ${t.prefijo}…  ${t.alcance}  ${t.estado}  vence el ${fecha.format(t.expiraEn)}  ${uso}`);
        }
        return 0;
      }
      case "revocar": {
        if (!values.nombre) {
          console.error(AYUDA);
          return 1;
        }
        const dado = await revocarTokenServicio(db, values.nombre);
        console.log(dado ? `Token "${values.nombre}" dado de baja.` : `No hay un token vigente llamado "${values.nombre}".`);
        return dado ? 0 : 1;
      }
      default:
        console.error(AYUDA);
        return 1;
    }
  } catch (error) {
    if (error instanceof ErrorDeTokenServicio) {
      console.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().then(
  (codigo) => {
    process.exitCode = codigo;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
