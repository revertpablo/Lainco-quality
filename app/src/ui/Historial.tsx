import type { EventoDelHistorial } from "@/reglas/detalle";

import { COLOR_DE_ESTADO, textoDeSeveridad } from "./etiquetas";

const fecha = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * Historial de una regla como línea de tiempo, de lo más nuevo a lo más viejo. Cada
 * decisión muestra el cambio de estado, quién y cuándo, y la justificación; los eventos
 * del origen (llegada, deprecación, avisos) van más tenues.
 */
export function Historial({ eventos }: { eventos: EventoDelHistorial[] }) {
  return (
    <ol className="relative flex flex-col gap-5 border-l border-linea pl-5 text-sm">
      {eventos.map((e) => (
        <li key={e.id} className="relative" data-evento={e.tipo}>
          <span
            aria-hidden
            className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-papel"
            style={{ background: e.tipo === "decision" ? COLOR_DE_ESTADO[e.hacia] : "var(--linea)" }}
          />
          <Evento evento={e} />
        </li>
      ))}
    </ol>
  );
}

function Evento({ evento: e }: { evento: EventoDelHistorial }) {
  const cuando = <time dateTime={e.fecha.toISOString()}>{fecha.format(e.fecha)}</time>;

  switch (e.tipo) {
    case "decision":
      return (
        <div className="flex flex-col gap-1">
          <p className="font-medium">
            {e.desdeDescripcion} a {e.haciaDescripcion}
          </p>
          <p className="text-tenue">
            <span data-autor>{e.autor}</span>, {cuando}
            {e.lote && e.lote.cantidad > 1 && <>, junto con otras {e.lote.cantidad - 1} reglas</>}
          </p>
          {e.justificacion ? (
            <blockquote className="border-l-2 border-linea pl-3 whitespace-pre-line" data-justificacion>
              {e.justificacion}
            </blockquote>
          ) : (
            <p className="text-tenue">Sin justificación.</p>
          )}
          {(e.severidad || e.parametros) && (
            <p className="text-tenue">
              {e.severidad && <>Severidad {textoDeSeveridad(e.severidad)}</>}
              {e.severidad && e.parametros && ". "}
              {e.parametros && (
                <>
                  Parámetros:{" "}
                  {Object.entries(e.parametros).map(([clave, valor], i) => (
                    <span key={clave}>
                      {i > 0 && ", "}
                      <code className="font-mono text-xs">{clave}</code> = {valor}
                    </span>
                  ))}
                </>
              )}
            </p>
          )}
        </div>
      );
    case "aviso":
      return (
        <div className="flex flex-col gap-1 text-tenue">
          <p>Aviso: {e.motivoDescripcion.toLowerCase()}</p>
          <p>
            {cuando}, {e.resuelto ? "resuelto" : "sin resolver"}
          </p>
        </div>
      );
    case "deprecada":
      return (
        <div className="flex flex-col gap-1 text-tenue">
          <p>El origen la marcó como deprecada</p>
          <p>{cuando}</p>
        </div>
      );
    case "alta":
      return (
        <div className="flex flex-col gap-1 text-tenue">
          <p>Llegó al inventario</p>
          <p>{cuando}</p>
        </div>
      );
  }
}
