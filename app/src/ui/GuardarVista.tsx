"use client";

import { useActionState } from "react";

import { guardarVistaActual, type ResultadoDeVista } from "@/vistas/acciones";

/**
 * Guarda la búsqueda actual con un nombre. Si la búsqueda ya es una vista propia, viene
 * con su nombre: guardar de nuevo la actualiza.
 */
export function GuardarVista({
  parametros,
  nombreActual,
  compartidaActual,
}: {
  parametros: string;
  nombreActual?: string;
  compartidaActual?: boolean;
}) {
  const [resultado, guardar, guardando] = useActionState<ResultadoDeVista | null, FormData>(guardarVistaActual, null);

  return (
    // La key reinicia el formulario cuando cambia la búsqueda.
    <form key={parametros} action={guardar} className="flex flex-col gap-2">
      <input type="hidden" name="parametros" value={parametros} />
      <label className="flex flex-col gap-1">
        <span>Guardar esta búsqueda como</span>
        <input
          type="text"
          name="nombre"
          required
          maxLength={80}
          defaultValue={nombreActual ?? ""}
          placeholder="Por ejemplo, Bugs de C# pendientes"
          className="rounded border border-linea bg-superficie px-2 py-1"
        />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="compartida" defaultChecked={compartidaActual ?? false} className="accent-pino" />
        <span>Que la vea todo el equipo</span>
      </label>
      <button
        type="submit"
        disabled={guardando}
        className="self-start rounded border border-pino px-3 py-1 font-medium text-pino hover:bg-pino-claro disabled:opacity-50"
      >
        {guardando ? "Guardando…" : "Guardar vista"}
      </button>
      {resultado && (
        <p role="status" className={resultado.ok ? "text-tinta" : "text-error"}>
          {resultado.mensaje}
        </p>
      )}
    </form>
  );
}
