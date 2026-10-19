"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { destinosMasivos } from "@/dominio/transiciones";
import type { Estado, Rol } from "@/dominio/valores";
import type { ResultadoDeOperacion } from "@/inventario/acciones";
import type { FilaDeInventario } from "@/inventario/consulta";

import { COLOR_DE_ESTADO, textoDeSeveridad, textoDeTipo } from "./etiquetas";

export interface Columna {
  titulo: string;
  /** Link que ordena por esta columna, o nada si no se ordena por ella. */
  ordenar?: { href: string; activa: "asc" | "desc" | null };
}

interface Props {
  filas: FilaDeInventario[];
  rol: Rol;
  /** Texto de cada estado y lenguaje (tablas de referencia). */
  estados: Record<string, string>;
  lenguajes: Record<string, string>;
  columnas: Record<"clave" | "nombre" | "lenguaje" | "tipo" | "severidad" | "estado", Columna>;
  aplicar: (pedido: unknown) => Promise<ResultadoDeOperacion>;
  /** La búsqueda actual, para que el detalle de una regla vuelva a ella. */
  volver: string;
}

/**
 * Tabla del inventario con selección múltiple. Al seleccionar aparece la barra de abajo:
 * ofrece solo los cambios de estado que valen para **todas** las reglas seleccionadas en
 * una operación masiva y con el rol de quien mira (`destinosMasivos`), y pide la
 * justificación común cuando hace falta. La validación de verdad la hace el servidor.
 */
export function TablaDeReglas({ filas, rol, estados, lenguajes, columnas, aplicar, volver }: Props) {
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [hacia, setHacia] = useState<Estado | null>(null);
  const [justificacion, setJustificacion] = useState("");
  const [resultado, setResultado] = useState<ResultadoDeOperacion | null>(null);
  const [aplicando, startTransition] = useTransition();

  // Si cambian las filas (otro filtro, o después de aplicar), la selección se queda solo
  // con las que siguen a la vista.
  const visibles = useMemo(() => new Map(filas.map((f) => [f.id, f])), [filas]);
  const seleccionadas = [...seleccion].filter((id) => visibles.has(id)).map((id) => visibles.get(id)!);

  const destinos = destinosMasivos(seleccionadas.map((f) => f.estado), rol);
  const destino = destinos.find((d) => d.hacia === hacia) ?? null;
  const faltaJustificacion = destino?.requiereJustificacion && justificacion.trim() === "";

  const todasMarcadas = filas.length > 0 && seleccionadas.length === filas.length;
  const claveDe = new Map(filas.map((f) => [f.id, f.clave]));

  function alternar(id: string) {
    const nueva = new Set(seleccion);
    if (nueva.has(id)) nueva.delete(id);
    else nueva.add(id);
    setSeleccion(nueva);
    setResultado(null);
  }

  function alternarTodas() {
    setSeleccion(todasMarcadas ? new Set() : new Set(filas.map((f) => f.id)));
    setResultado(null);
  }

  function limpiarSeleccion() {
    setSeleccion(new Set());
    setHacia(null);
    setJustificacion("");
  }

  function confirmar() {
    if (!destino || faltaJustificacion) return;
    const pedido = {
      reglas: seleccionadas.map((f) => ({ id: f.id, desde: f.estado })),
      hacia: destino.hacia,
      justificacion: justificacion.trim() || undefined,
    };
    startTransition(async () => {
      const respuesta = await aplicar(pedido);
      setResultado(respuesta);
      if (respuesta.ok) limpiarSeleccion();
    });
  }

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-papel text-left text-tenue">
            <tr className="border-b border-linea">
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={todasMarcadas ? "Quitar la selección" : `Seleccionar las ${filas.length} reglas`}
                  checked={todasMarcadas}
                  ref={(el) => {
                    if (el) el.indeterminate = seleccionadas.length > 0 && !todasMarcadas;
                  }}
                  onChange={alternarTodas}
                  className="accent-pino"
                />
              </th>
              {(["clave", "nombre", "lenguaje", "tipo", "severidad", "estado"] as const).map((c) => (
                <Encabezado key={c} columna={columnas[c]} />
              ))}
              <th className="px-3 py-2 font-normal">Tags</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const marcada = seleccion.has(f.id);
              return (
                <tr
                  key={f.id}
                  data-clave={f.clave}
                  className={`border-b border-linea align-top ${marcada ? "bg-pino-claro" : "hover:bg-superficie"} ${f.estado === "descartada" ? "text-tenue" : ""}`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${f.clave}`}
                      checked={marcada}
                      onChange={() => alternar(f.id)}
                      className="accent-pino"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{f.clave}</td>
                  <td className="min-w-64 px-3 py-2">
                    <Link
                      href={volver ? `/reglas/${f.id}?volver=${encodeURIComponent(volver)}` : `/reglas/${f.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {f.nombre}
                    </Link>
                    <Marcas fila={f} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{lenguajes[f.lenguaje] ?? f.lenguaje}</td>
                  <td className="whitespace-nowrap px-3 py-2">{textoDeTipo(f.tipo)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{textoDeSeveridad(f.severidad)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ background: COLOR_DE_ESTADO[f.estado] }}
                      />
                      {estados[f.estado] ?? f.estado}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-tenue">
                    <Tags tags={f.tags} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filas.length === 0 && (
          <p className="px-4 py-10 text-center text-tenue">
            Ninguna regla cumple estos filtros.{" "}
            <Link href="/reglas" className="underline underline-offset-2 hover:text-tinta">
              Ver todas
            </Link>
          </p>
        )}
      </div>

      {resultado && !resultado.ok && seleccionadas.length === 0 && <Resultado resultado={resultado} claveDe={claveDe} />}
      {resultado?.ok && (
        <p role="status" className="sticky bottom-0 bg-pino px-4 py-3 text-sm text-sobre-pino lg:px-6">
          {resultado.mensaje}
        </p>
      )}

      {seleccionadas.length > 0 && (
        <section
          aria-label="Operación sobre las reglas seleccionadas"
          className="sticky bottom-0 z-20 flex flex-col gap-3 bg-pino px-4 py-3 text-sm text-sobre-pino lg:px-6"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <strong className="font-semibold">
              {seleccionadas.length === 1 ? "1 regla seleccionada" : `${seleccionadas.length} reglas seleccionadas`}
            </strong>
            {destinos.length === 0 ? (
              <span>
                {seleccionadas.some((f) => f.estado === "aRevisar" || f.estado === "enPrueba" || f.estado === "incorporada") &&
                rol !== "decisor"
                  ? "No hay un cambio de estado que valga para todas en una operación masiva con tu rol."
                  : "No hay un cambio de estado que valga para todas en una operación masiva."}
              </span>
            ) : (
              <fieldset className="flex flex-wrap items-center gap-2">
                <legend className="sr-only">Pasar a</legend>
                <span aria-hidden>Pasar a</span>
                {destinos.map((d) => (
                  <label
                    key={d.hacia}
                    className={`cursor-pointer rounded border px-2 py-0.5 ${hacia === d.hacia ? "border-sobre-pino bg-sobre-pino text-pino" : "border-sobre-pino/50 hover:border-sobre-pino"}`}
                  >
                    <input
                      type="radio"
                      name="hacia"
                      value={d.hacia}
                      checked={hacia === d.hacia}
                      onChange={() => setHacia(d.hacia)}
                      className="sr-only"
                    />
                    {estados[d.hacia] ?? d.hacia}
                  </label>
                ))}
              </fieldset>
            )}
            <button type="button" onClick={limpiarSeleccion} className="ml-auto underline underline-offset-2">
              Quitar la selección
            </button>
          </div>

          {destino && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex flex-1 flex-col gap-1">
                <span>
                  Justificación{destino.requiereJustificacion ? "" : " (opcional)"}: queda en cada una de las decisiones
                </span>
                <textarea
                  value={justificacion}
                  onChange={(e) => setJustificacion(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className="rounded bg-superficie px-2 py-1 text-tinta"
                />
              </label>
              <button
                type="button"
                onClick={confirmar}
                disabled={aplicando || faltaJustificacion}
                className="rounded bg-sobre-pino px-3 py-1.5 font-medium text-pino disabled:opacity-60"
              >
                {aplicando
                  ? "Aplicando…"
                  : `Pasar ${seleccionadas.length === 1 ? "1 regla" : `${seleccionadas.length} reglas`} a ${estados[destino.hacia] ?? destino.hacia}`}
              </button>
            </div>
          )}

          {resultado && !resultado.ok && <Resultado resultado={resultado} claveDe={claveDe} />}
        </section>
      )}
    </div>
  );
}

function Encabezado({ columna }: { columna: Columna }) {
  if (!columna.ordenar) {
    return <th className="px-3 py-2 font-normal">{columna.titulo}</th>;
  }
  const { href, activa } = columna.ordenar;
  return (
    <th
      className="px-3 py-2 font-normal"
      aria-sort={activa === "asc" ? "ascending" : activa === "desc" ? "descending" : undefined}
    >
      <Link href={href} className={`whitespace-nowrap hover:text-tinta ${activa ? "text-tinta" : ""}`}>
        {columna.titulo}
        {activa && <span aria-hidden> {activa === "asc" ? "▲" : "▼"}</span>}
      </Link>
    </th>
  );
}

function Marcas({ fila }: { fila: FilaDeInventario }) {
  const marcas = [
    fila.nueva && "nueva",
    fila.modificada && "modificada en Sonar",
    fila.deprecada && "deprecada en Sonar",
  ].filter(Boolean);
  if (marcas.length === 0) return null;
  return <span className="ml-2 text-xs text-tenue">({marcas.join(", ")})</span>;
}

function Tags({ tags }: { tags: string[] }) {
  const VISIBLES = 3;
  if (tags.length === 0) return null;
  const resto = tags.length - VISIBLES;
  return (
    <span title={tags.join(", ")}>
      {tags.slice(0, VISIBLES).join(", ")}
      {resto > 0 && ` y ${resto} más`}
    </span>
  );
}

function Resultado({ resultado, claveDe }: { resultado: ResultadoDeOperacion; claveDe: Map<string, string> }) {
  return (
    <div role="alert" className="rounded bg-superficie px-3 py-2 text-error">
      <p className="font-medium">{resultado.mensaje}</p>
      {resultado.rechazos && (
        <ul className="mt-1 list-disc pl-5 text-tinta">
          {resultado.rechazos.slice(0, 10).map((r) => (
            <li key={r.reglaId}>
              <span className="font-mono text-xs">{claveDe.get(r.reglaId) ?? r.reglaId}</span>: {r.motivos.join(" ")}
            </li>
          ))}
          {resultado.rechazos.length > 10 && <li>Y {resultado.rechazos.length - 10} reglas más.</li>}
        </ul>
      )}
    </div>
  );
}
