import { asc } from "drizzle-orm";
import { Suspense } from "react";

import { signOut } from "@/auth";
import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { estado } from "@/db/esquema";
import { transicionesDisponibles } from "@/dominio/transiciones";

/**
 * Página de inicio provisoria. Muestra quién entró, con qué rol, y qué cambios de estado
 * puede hacer ese rol: es la verificación del paso 4 de la entrega 6.1 ("un analista no
 * ve las acciones de decisor"). Se reemplaza por el inventario en el paso 8, donde esas
 * mismas acciones aparecen sobre cada regla.
 */
export default function Inicio() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <Suspense fallback={<p className="text-sm opacity-70">Cargando…</p>}>
        <Contenido />
      </Suspense>
    </main>
  );
}

async function Contenido() {
  const usuario = await exigirUsuario();
  const estados = await obtenerDb().select().from(estado).orderBy(asc(estado.orden));
  const descripcion = new Map(estados.map((e) => [e.codigo, e.descripcion]));

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Catálogo de reglas</h1>
          <p className="text-sm opacity-70">
            {usuario.nombre} · <span data-rol={usuario.rol}>{usuario.rolDescripcion}</span>
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/ingresar" });
          }}
        >
          <button type="submit" className="text-sm underline opacity-70 hover:opacity-100">
            Salir
          </button>
        </form>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Cambios de estado que podés hacer</h2>
        <ul className="flex flex-col gap-3 text-sm">
          {estados.map((e) => {
            const disponibles = transicionesDisponibles(e.codigo, usuario.rol);
            return (
              <li key={e.codigo}>
                <p className="font-medium">Desde {e.descripcion}</p>
                {disponibles.length === 0 ? (
                  <p className="opacity-70">Ninguno.</p>
                ) : (
                  <ul className="pl-5">
                    {disponibles.map((t) => (
                      <li key={t.hacia} data-transicion={`${t.desde}-${t.hacia}`}>
                        → {descripcion.get(t.hacia) ?? t.hacia}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
