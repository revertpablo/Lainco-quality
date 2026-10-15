import { connection } from "next/server";
import { Suspense } from "react";

import { verificarBase } from "@/db/salud";

/**
 * Página provisoria del paso 1 de la entrega 6.1: confirma que la app levanta y se
 * conecta a la base. Se reemplaza por el inventario en el paso 8.
 */
export default function Inicio() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <header>
        <h1 className="text-2xl font-semibold">Catálogo de reglas</h1>
        <p className="text-sm opacity-70">Lainco Quality — Fase 6, entrega 6.1</p>
      </header>

      <Suspense fallback={<p className="text-sm opacity-70">Verificando la base de datos…</p>}>
        <EstadoDeLaBase />
      </Suspense>
    </main>
  );
}

async function EstadoDeLaBase() {
  // Se verifica en cada pedido, no una vez en el build.
  await connection();

  const base = await verificarBase();

  if (!base.ok) {
    return (
      <section className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm">
        <p className="font-medium">No hay conexión con la base de datos.</p>
        <p className="mt-1 break-words font-mono text-xs opacity-80">{base.error}</p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-green-600/40 bg-green-600/10 p-4 text-sm">
      <p className="font-medium">Base de datos conectada ({base.latenciaMs} ms).</p>
      <p className="mt-1 break-words font-mono text-xs opacity-80">{base.version}</p>
    </section>
  );
}
