import type { Avance } from "@/dominio/progreso";
import { Estado } from "@/dominio/valores";

import { COLOR_DE_ESTADO } from "./etiquetas";

/** Orden de los tramos: lo decidido a la izquierda, lo pendiente a la derecha. */
const ORDEN: Estado[] = [Estado.Incorporada, Estado.Descartada, Estado.EnPrueba, Estado.ARevisar, Estado.PendienteDeAnalizar];

/**
 * Una barra con un tramo por estado, proporcional a la cantidad de reglas. Es decorativa:
 * los números están en el texto de al lado, y el detalle, en el `title`.
 */
export function BarraDeEstados({ avance, estados }: { avance: Avance; estados: Record<string, string> }) {
  const detalle = ORDEN.filter((e) => avance.porEstado[e] > 0)
    .map((e) => `${estados[e] ?? e}: ${avance.porEstado[e]}`)
    .join(" · ");
  return (
    <div className="flex h-2.5 w-full min-w-16 overflow-hidden rounded-full bg-linea" title={detalle} aria-hidden>
      {avance.total > 0 &&
        ORDEN.map((e) =>
          avance.porEstado[e] > 0 ? (
            <span
              key={e}
              className="h-full"
              style={{ width: `${(avance.porEstado[e] * 100) / avance.total}%`, background: COLOR_DE_ESTADO[e] }}
            />
          ) : null,
        )}
    </div>
  );
}

/** Las referencias de colores de la barra. */
export function ReferenciasDeEstados({ estados }: { estados: Record<string, string> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-tenue">
      {ORDEN.map((e) => (
        <li key={e} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: COLOR_DE_ESTADO[e] }} />
          {estados[e] ?? e}
        </li>
      ))}
    </ul>
  );
}
