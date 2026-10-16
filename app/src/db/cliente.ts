import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as esquema from "./esquema";
import { conSslExplicito } from "./ssl";

/**
 * Conexión a Postgres (Neon en Vercel, cualquier Postgres en local).
 *
 * Se crea recién en el primer uso, y no al importar el módulo: así `next build` no
 * necesita DATABASE_URL, y una variable faltante da un error claro en el momento en que
 * se la necesita.
 */
export type Db = NodePgDatabase<typeof esquema> & { $client: Pool };

let db: Db | undefined;

export function obtenerDb(): Db {
  if (db) {
    return db;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Falta DATABASE_URL. En local, bajala con `vercel env pull .env.local` (ver app/README.md).",
    );
  }

  const pool = new Pool({ connectionString: conSslExplicito(url), max: 5 });

  // En Vercel (Fluid compute), cierra las conexiones ociosas antes de que la instancia
  // se suspenda. Fuera de Vercel no hace nada.
  attachDatabasePool(pool);

  db = drizzle(pool, { schema: esquema });
  return db;
}
