"use client";

import { useState, useTransition } from "react";

import { EvaluacionMuestra } from "@/dominio/valores";
import { evaluarMuestraAhora } from "@/prueba/acciones";

/**
 * Los botones para evaluar una muestra (entrega 6.5, paso 6): Válida o Falso positivo. El
 * elegido queda marcado; tocarlo de nuevo vuelve a sin evaluar.
 */
export function EvaluarMuestra({ muestraId, evaluacion, etiqueta }: { muestraId: string; evaluacion: EvaluacionMuestra; etiqueta: string }) {
  const [enCurso, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const elegir = (nueva: EvaluacionMuestra) => {
    setError(null);
    empezar(async () => {
      const resultado = await evaluarMuestraAhora(muestraId, nueva === evaluacion ? EvaluacionMuestra.SinEvaluar : nueva);
      if (!resultado.ok) {
        setError(resultado.mensaje);
      }
    });
  };

  const boton = (opcion: EvaluacionMuestra, texto: string, colorElegido: string) => {
    const elegido = evaluacion === opcion;
    return (
      <button
        type="button"
        onClick={() => elegir(opcion)}
        disabled={enCurso}
        aria-pressed={elegido}
        aria-label={`${texto}: ${etiqueta}`}
        className={`rounded border px-2 py-0.5 text-sm disabled:opacity-50 ${elegido ? `${colorElegido} font-medium` : "border-linea text-tinta hover:border-tenue"}`}
      >
        {texto}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Evaluar ${etiqueta}`}>
      {boton(EvaluacionMuestra.Valida, "Válida", "border-pino bg-pino text-sobre-pino")}
      {boton(EvaluacionMuestra.FalsoPositivo, "Falso positivo", "border-error bg-error text-superficie")}
      {error && (
        <span role="alert" className="text-sm text-error">
          {error}
        </span>
      )}
    </div>
  );
}
