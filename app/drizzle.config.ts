import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

import { conSslExplicito } from "./src/db/ssl";

// Las mismas variables que usa `npm run dev`: .env.development.local, .env.local,
// .env.development y .env, en ese orden de prioridad (las baja `vercel env pull`).
// drizzle-kit corre fuera de Next y no las lee solo.
//
// Una DATABASE_URL definida en la consola tiene prioridad sobre los archivos: así se
// migra otro entorno sin tocar nada (ver app/README.md, "Bases por entorno").
loadEnvConfig(process.cwd(), true);

const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/esquema.ts",
  out: "./drizzle",
  // `generate` no se conecta a la base; `migrate`, `push` y `studio` sí.
  dbCredentials: { url: url ? conSslExplicito(url) : "" },
  strict: true,
  verbose: true,
});
