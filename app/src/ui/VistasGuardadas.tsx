import Link from "next/link";

import { borrarVistaPropia } from "@/vistas/acciones";
import type { Vista } from "@/vistas/vistas";

import { GuardarVista } from "./GuardarVista";

/**
 * Vistas guardadas, arriba de los filtros: un link por vista (la que coincide con la
 * búsqueda actual queda marcada) y el formulario para guardar la búsqueda actual.
 */
export function VistasGuardadas({ vistas, parametrosActuales }: { vistas: Vista[]; parametrosActuales: string }) {
  const actual = vistas.find((v) => v.parametros === parametrosActuales && v.propia);

  return (
    <section aria-labelledby="titulo-vistas" className="mb-6 flex flex-col gap-3 border-b border-linea pb-5 text-sm">
      <h2 id="titulo-vistas" className="font-medium">
        Vistas guardadas
      </h2>

      {vistas.length === 0 ? (
        <p className="text-tenue">Todavía no hay. Filtrá y guardá la búsqueda con un nombre para volver a ella.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {vistas.map((v) => {
            const esLaActual = v.parametros === parametrosActuales;
            return (
              <li key={v.id} className="flex items-baseline gap-2" data-vista={v.nombre}>
                <Link
                  href={v.parametros ? `/reglas?${v.parametros}` : "/reglas"}
                  aria-current={esLaActual ? "page" : undefined}
                  className={`min-w-0 flex-1 border-l-2 pl-2 break-words hover:text-tinta ${esLaActual ? "border-pino font-medium" : "border-transparent"}`}
                >
                  {v.nombre}
                </Link>
                <span className="shrink-0 text-xs text-tenue">
                  {v.propia ? (v.compartida ? "compartida" : "") : `de ${v.autor}`}
                </span>
                {v.propia && (
                  <form action={borrarVistaPropia} className="shrink-0">
                    <input type="hidden" name="id" value={v.id} />
                    <button
                      type="submit"
                      aria-label={`Borrar la vista ${v.nombre}`}
                      className="text-xs text-tenue underline underline-offset-2 hover:text-error"
                    >
                      Borrar
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <GuardarVista parametros={parametrosActuales} nombreActual={actual?.nombre} compartidaActual={actual?.compartida} />
    </section>
  );
}
