"use client";

import { useState, type ReactNode } from "react";

/**
 * Columna de filtros. En pantallas anchas está siempre a la vista; en el celular se abre
 * con un botón, para que la tabla quede arriba.
 */
export function PanelDeFiltros({ activos, children }: { activos: number; children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <aside className="border-b border-linea lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls="filtros"
        onClick={() => setAbierto(!abierto)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium lg:hidden"
      >
        <span>Filtros{activos > 0 ? ` (${activos})` : ""}</span>
        <span aria-hidden>{abierto ? "−" : "+"}</span>
      </button>
      <div id="filtros" className={`${abierto ? "block" : "hidden"} px-4 pb-4 lg:block lg:py-4`}>
        {children}
      </div>
    </aside>
  );
}
