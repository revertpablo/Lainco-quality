import Link from "next/link";
import { Suspense } from "react";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { seProbaConElJob } from "@/dominio/prueba";
import { EstadoCorrida } from "@/dominio/valores";
import { minimoDeCorridas } from "@/prueba/configuracion";
import { panelDePrueba, type CorridaParaMostrar, type ReglaEnPrueba } from "@/prueba/consultas";
import { Encabezado } from "@/ui/Encabezado";
import { describirCorrida, describirMinimo, describirTasa } from "@/ui/prueba";

/**
 * Prueba de reglas (entrega 6.5, paso 6): las corridas del job de prueba, con lo que pasó en
 * cada repositorio, y las reglas En prueba con su último resultado, cuánto les falta para el
 * mínimo y su tasa de falsos positivos. El detalle de cada regla está en su página.
 */

const fecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" });

const TONO_DE_CORRIDA: Record<EstadoCorrida, string | undefined> = { enCurso: "text-tenue", terminada: undefined, fallida: "text-error" };

export default function Prueba() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-tenue">Cargando…</p>}>
      <PanelDePrueba />
    </Suspense>
  );
}

async function PanelDePrueba() {
  const usuario = await exigirUsuario();
  const minimo = minimoDeCorridas();
  const panel = await panelDePrueba(obtenerDb(), { minimo: minimo.minimo });
  const delJob = panel.reglas.filter((r) => seProbaConElJob(r));
  const fueraDelJob = panel.reglas.filter((r) => !seProbaConElJob(r));

  return (
    <>
      <Encabezado usuario={usuario} seccion="prueba" />
      <main className="flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-5 lg:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Prueba de reglas</h1>
          <p className="max-w-3xl text-sm text-tenue">
            Todas las noches el job compila los repositorios configurados con las reglas En prueba y trae cuántos issues levantaría cada
            una y dónde. A Sonar no va nada: probar una regla no afecta el quality gate. Para incorporarla hacen falta {panel.minimo}{" "}
            {panel.minimo === 1 ? "corrida" : "corridas"} desde que entró en prueba.
          </p>
          {minimo.error && (
            <p role="alert" className="text-sm text-error">
              {minimo.error}
            </p>
          )}
        </div>

        <Panel titulo={delJob.length === 0 ? "Reglas en prueba" : `Reglas en prueba (${delJob.length})`} id="reglas">
          {delJob.length === 0 ? (
            <p className="px-5 py-4 text-sm text-tenue">No hay reglas de C# En prueba: el job no tiene nada que correr.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" data-tabla="reglas-en-prueba">
                <thead className="text-left text-tenue">
                  <tr className="border-b border-linea">
                    <th scope="col" className="px-5 py-2 font-normal">
                      Regla
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">
                      Issues
                    </th>
                    <th scope="col" className="py-2 pr-4 font-normal">
                      Corridas
                    </th>
                    <th scope="col" className="py-2 pr-5 font-normal">
                      Falsos positivos
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {delJob.map((r) => (
                    <FilaDeRegla key={r.id} regla={r} minimo={panel.minimo} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {fueraDelJob.length > 0 && (
            <p className="border-t border-linea px-5 py-3 text-sm text-tenue">
              {fueraDelJob.length === 1 ? "1 regla En prueba no es" : `${fueraDelJob.length} reglas En prueba no son`} de C#: el job no las corre
              (las de TypeScript se suman con la Fase 5).
            </p>
          )}
        </Panel>

        <Panel titulo="Corridas" id="corridas">
          {panel.corridas.length === 0 ? (
            <p className="px-5 py-4 text-sm text-tenue">El job todavía no corrió. Ver app/README.md, «Prueba de reglas».</p>
          ) : (
            <ul className="divide-y divide-linea" data-lista="corridas">
              {panel.corridas.map((c) => (
                <Corrida key={c.id} corrida={c} />
              ))}
            </ul>
          )}
        </Panel>
      </main>
    </>
  );
}

function Panel({ titulo, id, children }: { titulo: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`titulo-${id}`} className="rounded-lg border border-linea bg-superficie">
      <h2 id={`titulo-${id}`} className="border-b border-linea px-5 py-3 font-medium">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function FilaDeRegla({ regla: r, minimo }: { regla: ReglaEnPrueba; minimo: number }) {
  const estadoDelMinimo = describirMinimo({ minimo, cuentan: r.cuentan, probableLocalmente: r.probableLocalmente });
  return (
    <tr className="border-b border-linea align-top last:border-b-0" data-clave={r.clave}>
      <td className="px-5 py-2">
        <Link href={`/reglas/${r.id}`} className="underline-offset-2 hover:underline">
          {r.nombre}
        </Link>
        <span className="block font-mono text-xs text-tenue">{r.clave}</span>
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">{r.ultimoTotal === null ? <span className="text-tenue">—</span> : r.ultimoTotal.toLocaleString("es-AR")}</td>
      <td className={`py-2 pr-4 ${estadoDelMinimo.cumple ? "" : "text-[var(--aviso)]"}`}>
        {r.probableLocalmente === false ? "No se puede probar" : `${r.cuentan} de ${minimo}`}
      </td>
      <td className="py-2 pr-5">{r.tasa.tasa === null ? <span className="text-tenue">Sin evaluar</span> : describirTasa(r.tasa)}</td>
    </tr>
  );
}

function Corrida({ corrida: c }: { corrida: CorridaParaMostrar }) {
  return (
    <li className="flex flex-col gap-1.5 px-5 py-3 text-sm" data-corrida={c.estado}>
      <p>
        <span className="font-medium">{fecha.format(c.iniciadaEn)}</span>
        <span className="text-tenue">
          {" "}
          · {c.reglas === 1 ? "1 regla" : `${c.reglas} reglas`}
          {c.versionSonarAnalyzer && ` · SonarAnalyzer.CSharp ${c.versionSonarAnalyzer}`}
          {c.versionLaincoAnalyzers && ` · Lainco.Analyzers ${c.versionLaincoAnalyzers}`}
        </span>
        {c.workflowUrl && (
          <>
            {" "}
            <a href={c.workflowUrl} target="_blank" rel="noopener noreferrer" className="text-tenue underline underline-offset-2 hover:text-tinta">
              Ver en GitHub Actions
            </a>
          </>
        )}
      </p>
      <p className={TONO_DE_CORRIDA[c.estado]}>{describirCorrida(c)}</p>
      {c.repositorios.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-lista="repositorios">
          {c.repositorios.map((r) => (
            <li key={r.repositorio} className="[overflow-wrap:anywhere]" data-repositorio={r.repositorio} data-estado={r.estado ?? "pendiente"}>
              <span className="font-mono text-xs">{r.repositorio}</span>{" "}
              {r.estado === "ok" ? (
                <span className="text-tenue">analizado{r.commit && ` en ${r.commit.slice(0, 7)}`}</span>
              ) : r.estado === "error" ? (
                <span className="text-error">{r.error}</span>
              ) : (
                <span className="text-tenue">{c.estado === EstadoCorrida.EnCurso ? "sin resultados todavía" : "sin resultados"}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
