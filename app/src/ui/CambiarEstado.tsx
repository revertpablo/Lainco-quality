"use client";

import { useActionState, useState } from "react";

import type { Transicion } from "@/dominio/transiciones";
import type { Estado } from "@/dominio/valores";
import { cambiarEstadoDeRegla, type ResultadoDeCambio } from "@/reglas/acciones";
import { SEVERIDADES } from "@/transiciones/pedidos";

import { textoDeSeveridad } from "./etiquetas";

interface Props {
  reglaId: string;
  estado: Estado;
  /** Las transiciones que el rol de quien mira puede hacer desde el estado actual. */
  disponibles: Transicion[];
  estados: Record<string, string>;
  severidadDefault: string | null;
  parametros: { clave: string; descripcion?: string; valorDefault?: string }[];
}

/**
 * Cambio de estado individual. Pide lo que exige la transición elegida: justificación,
 * severidad y, al incorporar, los valores de los parámetros. La validación de verdad la
 * hace el servidor.
 */
export function CambiarEstado({ reglaId, estado, disponibles, estados, severidadDefault, parametros }: Props) {
  const [hacia, setHacia] = useState<Estado | null>(null);
  const [resultado, enviar, enviando] = useActionState<ResultadoDeCambio | null, FormData>(cambiarEstadoDeRegla, null);
  const elegida = disponibles.find((t) => t.hacia === hacia);

  if (disponibles.length === 0) {
    return <p className="text-sm text-tenue">Con tu rol no hay cambios de estado posibles desde {estados[estado]}.</p>;
  }

  return (
    // La key vuelve a armar el formulario cuando cambia el estado (después de aplicar).
    <form key={estado} action={enviar} className="flex flex-col gap-3 text-sm">
      <input type="hidden" name="reglaId" value={reglaId} />
      <input type="hidden" name="desde" value={estado} />

      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1.5">Pasar a</legend>
        {disponibles.map((t) => (
          <label
            key={t.hacia}
            className={`cursor-pointer rounded border px-2 py-0.5 ${hacia === t.hacia ? "border-pino bg-pino text-sobre-pino" : "border-linea hover:border-tenue"}`}
          >
            <input
              type="radio"
              name="hacia"
              value={t.hacia}
              checked={hacia === t.hacia}
              onChange={() => setHacia(t.hacia)}
              className="sr-only"
            />
            {estados[t.hacia] ?? t.hacia}
          </label>
        ))}
      </fieldset>

      {elegida && (
        <>
          {elegida.requiereSeveridad && (
            <label className="flex flex-col gap-1">
              <span>Severidad con la que se incorpora</span>
              <select
                name="severidad"
                required
                defaultValue={severidadDefault && (SEVERIDADES as readonly string[]).includes(severidadDefault) ? severidadDefault : ""}
                className="rounded border border-linea bg-superficie px-1 py-1"
              >
                <option value="" disabled>
                  Elegir
                </option>
                {SEVERIDADES.map((s) => (
                  <option key={s} value={s}>
                    {textoDeSeveridad(s)}
                    {s === severidadDefault ? " (la de Sonar)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {elegida.hacia === "incorporada" && parametros.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1">Parámetros (vacío: el valor por defecto)</legend>
              {parametros.map((p) => (
                <label key={p.clave} className="flex flex-col gap-0.5">
                  <span className="font-mono text-xs">{p.clave}</span>
                  {p.descripcion && <span className="text-xs text-tenue">{p.descripcion}</span>}
                  <input
                    type="text"
                    name={`parametro.${p.clave}`}
                    placeholder={p.valorDefault ?? ""}
                    maxLength={500}
                    className="rounded border border-linea bg-superficie px-2 py-1"
                  />
                </label>
              ))}
            </fieldset>
          )}

          <label className="flex flex-col gap-1">
            <span>Justificación{elegida.requiereJustificacion ? "" : " (opcional)"}</span>
            <textarea
              name="justificacion"
              rows={3}
              maxLength={2000}
              required={elegida.requiereJustificacion}
              className="rounded border border-linea bg-superficie px-2 py-1"
            />
          </label>

          <button
            type="submit"
            disabled={enviando}
            className="self-start rounded bg-pino px-3 py-1.5 font-medium text-sobre-pino disabled:opacity-60"
          >
            {enviando ? "Aplicando…" : `Pasar a ${estados[elegida.hacia] ?? elegida.hacia}`}
          </button>
        </>
      )}

      {resultado && (
        <div role={resultado.ok ? "status" : "alert"} className={resultado.ok ? "text-tinta" : "text-error"}>
          <p>{resultado.mensaje}</p>
          {resultado.motivos && (
            <ul className="list-disc pl-5">
              {resultado.motivos.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
