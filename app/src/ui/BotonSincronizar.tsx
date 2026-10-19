"use client";

import { useActionState } from "react";

import type { ResultadoDelBoton } from "@/sincronizacion/acciones";

/** Botón que dispara la sincronización y muestra el resultado. */
export function BotonSincronizar({ accion }: { accion: () => Promise<ResultadoDelBoton> }) {
  const [resultado, ejecutar, enCurso] = useActionState<ResultadoDelBoton | null>(() => accion(), null);

  return (
    <form action={ejecutar} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={enCurso}
        className="self-start rounded-md border border-current/20 px-3 py-1.5 text-sm font-medium hover:bg-current/5 disabled:opacity-50"
      >
        {enCurso ? "Sincronizando…" : "Sincronizar ahora"}
      </button>
      {resultado && (
        <p role="status" className={`text-sm ${resultado.ok ? "" : "text-red-600"}`}>
          {resultado.mensaje}
        </p>
      )}
    </form>
  );
}
