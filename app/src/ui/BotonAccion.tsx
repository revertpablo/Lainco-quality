"use client";

import { useActionState } from "react";

export interface ResultadoDeAccion {
  ok: boolean;
  mensaje: string;
}

/**
 * Un botón que dispara una Server Action y muestra el resultado al lado: sincronizar,
 * reconciliar, publicar, corregir.
 */
export function BotonAccion({
  accion,
  texto,
  enCurso: textoEnCurso,
  principal = false,
  etiqueta,
  deshabilitado = false,
}: {
  accion: () => Promise<ResultadoDeAccion>;
  texto: string;
  /** Lo que dice mientras corre: "Sincronizando…". */
  enCurso: string;
  /** Botón destacado (la acción principal de la pantalla). */
  principal?: boolean;
  /** Nombre accesible, si el texto solo no alcanza ("Corregir csharpsquid:S107"). */
  etiqueta?: string;
  /** Visible pero sin efecto: así el resultado de la última vez sigue a la vista. */
  deshabilitado?: boolean;
}) {
  const [resultado, ejecutar, corriendo] = useActionState<ResultadoDeAccion | null>(() => accion(), null);

  return (
    <form action={ejecutar} className="flex flex-wrap items-center gap-2">
      <button
        type="submit"
        disabled={corriendo || deshabilitado}
        aria-label={etiqueta}
        className={
          principal
            ? "rounded bg-pino px-3 py-1 text-sm font-medium text-sobre-pino hover:opacity-90 disabled:opacity-50"
            : "rounded border border-linea px-2 py-0.5 text-sm text-tinta hover:border-tenue disabled:opacity-50"
        }
      >
        {corriendo ? textoEnCurso : texto}
      </button>
      {resultado && (
        <span role="status" className={`text-sm ${resultado.ok ? "text-tinta" : "text-error"}`}>
          {resultado.mensaje}
        </span>
      )}
    </form>
  );
}
