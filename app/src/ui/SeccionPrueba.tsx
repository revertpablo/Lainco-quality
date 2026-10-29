import Link from "next/link";

import { EstadoCorrida } from "@/dominio/valores";
import type { PruebaDeRegla } from "@/prueba/consultas";

import { EvaluarMuestra } from "./EvaluarMuestra";
import { describirMinimo, describirTasa } from "./prueba";

/**
 * La prueba de una regla en su detalle (entrega 6.5, paso 6): cuántos issues levanta en
 * cada repositorio, cómo cambió entre corridas, cuánto le falta para el mínimo, y las
 * muestras para evaluar, con la tasa de falsos positivos. Nada de esto está en Sonar.
 */

const fecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" });
const fechaCorta = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

const ESTADO_DE_CORRIDA: Record<EstadoCorrida, string> = { enCurso: "en curso", terminada: "terminada", fallida: "fallida" };

const cantidad = (n: number | null) => (n === null ? <span className="text-tenue">—</span> : n.toLocaleString("es-AR"));

export function SeccionPrueba({ prueba, enPrueba, seProbaConElJob }: { prueba: PruebaDeRegla; enPrueba: boolean; seProbaConElJob: boolean }) {
  const minimo = describirMinimo(prueba);
  const ultima = prueba.corridas.find((c) => c.total !== null);
  // Los repositorios de todas las corridas mostradas, para las columnas de la evolución.
  const repositorios = [...new Set(prueba.corridas.flatMap((c) => c.repositorios.map((r) => r.repositorio)))].sort();

  return (
    <section aria-labelledby="titulo-prueba" className="rounded-lg border border-linea bg-superficie" data-seccion="prueba">
      <h2 id="titulo-prueba" className="border-b border-linea px-5 py-3 font-medium lg:px-7">
        Prueba
      </h2>
      <div className="flex flex-col gap-5 px-5 py-4 text-sm lg:px-7">
        {!seProbaConElJob ? (
          <p className="text-tenue">El job de prueba corre reglas de C# (de Sonar y propias). Las de TypeScript se suman con la Fase 5.</p>
        ) : (
          <>
            {enPrueba && (
              <p className={minimo.cumple ? undefined : "text-[var(--estado-revisar)]"} data-minimo={minimo.cumple ? "cumple" : "falta"}>
                {minimo.texto}
              </p>
            )}
            {prueba.corridas.length === 0 ? (
              <p className="text-tenue">
                Todavía no la corrió el job de prueba. Corre todas las noches sobre los repositorios configurados; ver la pantalla{" "}
                <Link href="/prueba" className="underline underline-offset-2">
                  Prueba
                </Link>
                .
              </p>
            ) : (
              <>
                <p>
                  {ultima ? (
                    <>
                      <strong className="font-medium">{cantidad(ultima.total)}</strong> {ultima.total === 1 ? "issue" : "issues"} en la última corrida con
                      resultados ({fecha.format(ultima.iniciadaEn)}). En Sonar no aparece nada.
                    </>
                  ) : (
                    <span className="text-tenue">Ninguna corrida tuvo resultados todavía: los repositorios no compilaron.</span>
                  )}
                </p>

                <div className="overflow-x-auto" data-tabla="evolucion">
                  <table className="w-full border-collapse text-sm">
                    <caption className="pb-2 text-left text-tenue">Issues por repositorio en cada corrida, de la más nueva.</caption>
                    <thead className="text-left text-tenue">
                      <tr className="border-b border-linea">
                        <th scope="col" className="py-2 pr-4 font-normal">
                          Corrida
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-normal">
                          Total
                        </th>
                        {repositorios.map((r) => (
                          <th key={r} scope="col" className="py-2 pr-4 text-right font-normal">
                            {r}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {prueba.corridas.map((c) => (
                        <tr key={c.id} className="border-b border-linea last:border-b-0" data-corrida={c.estado}>
                          <th scope="row" className="py-2 pr-4 text-left font-normal whitespace-nowrap">
                            {fechaCorta.format(c.iniciadaEn)}
                            {c.estado !== EstadoCorrida.Terminada && <span className="text-tenue"> · {ESTADO_DE_CORRIDA[c.estado]}</span>}
                          </th>
                          <td className="py-2 pr-4 text-right tabular-nums">{cantidad(c.total)}</td>
                          {repositorios.map((nombre) => {
                            const r = c.repositorios.find((x) => x.repositorio === nombre);
                            return (
                              <td key={nombre} className="py-2 pr-4 text-right tabular-nums" title={r?.error ?? undefined}>
                                {r?.estado === "error" ? <span className="text-error">error</span> : cantidad(r?.cantidad ?? null)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-2">
                  <h3 className="font-medium">Muestras</h3>
                  <p data-tasa={prueba.tasa.tasa ?? ""}>{describirTasa(prueba.tasa)}</p>
                  {prueba.muestras.length === 0 ? (
                    <p className="text-tenue">La última corrida no encontró issues de esta regla.</p>
                  ) : (
                    <>
                      <p className="text-tenue">
                        Hasta 20 por repositorio, de la última corrida con resultados. Abrí cada una en GitHub y marcala: la
                        evaluación se conserva mientras siga apareciendo.
                      </p>
                      <ul className="divide-y divide-linea rounded border border-linea" data-lista="muestras">
                        {prueba.muestras.map((m) => (
                          <li key={m.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-4" data-evaluacion={m.evaluacion}>
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <a href={m.link} target="_blank" rel="noopener noreferrer" className="font-mono text-xs underline-offset-2 [overflow-wrap:anywhere] hover:underline">
                                {m.repositorio} · {m.archivo}
                                <span className="whitespace-nowrap">:{m.linea}</span>
                              </a>
                              <p className="[overflow-wrap:anywhere]">{m.mensaje}</p>
                              {m.evaluadaPor && m.evaluadaEn && (
                                <p className="text-xs text-tenue">
                                  Evaluada por {m.evaluadaPor} el {fecha.format(m.evaluadaEn)}
                                </p>
                              )}
                            </div>
                            <EvaluarMuestra muestraId={m.id} evaluacion={m.evaluacion} etiqueta={`${m.archivo}:${m.linea}`} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
