"use client";

import { useActionState } from "react";

import type { ResultadoDelBoton } from "@/sincronizacion/acciones";

/** Botón que dispara la sincronización con Sonar y muestra el resultado al lado. */
export function BotonSincronizar({ accion }: { accion: () => Promise<ResultadoDelBoton> }) {
  const [resultado, ejecutar, enCurso] = useActionState<ResultadoDelBoton | null>(() => accion(), null);

  return (
    <form action={ejecutar} className="flex flex-wrap items-center gap-2">
      <button
        type="submit"
        disabled={enCurso}
        className="rounded border border-linea px-2 py-0.5 text-sm text-tinta hover:border-tenue disabled:opacity-50"
      >
        {enCurso ? "Sincronizando…" : "Sincronizar ahora"}
      </button>
      {resultado && (
        <span role="status" className={resultado.ok ? "text-tinta" : "text-error"}>
          {resultado.mensaje}
        </span>
      )}
    </form>
  );
}
