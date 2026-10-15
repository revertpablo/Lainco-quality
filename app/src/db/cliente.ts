import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { conSslExplicito } from "./ssl";

/**
 * Conexión a Postgres (Neon en Vercel, cualquier Postgres en local).
 *
 * Se crea recién en el primer uso, y no al importar el módulo: así `next build` no
 * necesita DATABASE_URL, y una variable faltante da un error claro en el momento en que
 * se la necesita.
 */
let db: NodePgDatabase | undefined;

export function obtenerDb(): NodePgDatabase {
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

  db = drizzle(pool);
  return db;
}
