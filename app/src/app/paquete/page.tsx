import Link from "next/link";
import { Suspense } from "react";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { Rol } from "@/dominio/valores";
import { corregirDesvioDelPaqueteAhora, publicarPaqueteAhora, revisarPaqueteAhora } from "@/paquete/acciones";
import { estadoDelPaquete, type PrParaMostrar } from "@/paquete/consultas";
import { describirRevision } from "@/paquete/resumen";
import type { PublicacionParaMostrar } from "@/publicacion/consultas";
import { BotonAccion } from "@/ui/BotonAccion";
import { Encabezado } from "@/ui/Encabezado";
import { describirPr, numeroDeVersion } from "@/ui/paquete";

/**
 * El paquete de reglas propias (entrega 6.4, paso 7): qué versión de Lainco.Analyzers está
 * publicada, en qué están los PRs de configuración que abre la app, qué falta pasar al
 * paquete y, si el `.globalconfig` de main no es el de la app, el desvío.
 */

// Revisar y publicar hablan con GitHub desde esta página.
export const maxDuration = 60;

const fecha = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});
const formatear = (d: Date) => fecha.format(d);

const TONO = { normal: undefined, alerta: "text-[var(--aviso)]", error: "text-error" } as const;

export default function Paquete() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-tenue">Cargando…</p>}>
      <PanelDelPaquete />
    </Suspense>
  );
}

async function PanelDelPaquete() {
  const usuario = await exigirUsuario();
  const estado = await estadoDelPaquete(obtenerDb());
  const esDecisor = usuario.rol === Rol.Decisor;
  const versionPublicada = numeroDeVersion(estado.publicada?.version ?? null);
  const fallidas = estado.sinPasar.filter((p) => p.estado === "fallida");
  const revision = estado.ultimaRevision;

  return (
    <>
      <Encabezado usuario={usuario} seccion="paquete" />
      <main className="flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-5 lg:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Paquete de reglas propias</h1>
          <p className="text-sm text-tenue">
            Lo que se decide sobre las reglas de <strong className="font-medium text-tinta">Lainco.Analyzers</strong> llega a los
            repositorios con un PR que cambia su <code>.globalconfig</code>: al mergearlo se publica una versión nueva del paquete.
          </p>
        </div>

        <Panel titulo="Versión y revisión" id="version">
          <div className="flex flex-col gap-3 px-5 py-4 text-sm" data-seccion="version">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-tenue">Publicada</dt>
              <dd data-version-publicada={versionPublicada ?? ""}>
                {estado.publicada ? (
                  <>
                    {estado.publicada.version}{" "}
                    <span className="text-tenue">(sincronizada el {formatear(estado.publicada.sincronizadaEn)})</span>
                  </>
                ) : (
                  <span className="text-tenue">Todavía no se sincronizó ninguna versión.</span>
                )}
              </dd>
              <dt className="text-tenue">En main</dt>
              <dd>{revision?.versionEnMain ?? <span className="text-tenue">Todavía no se revisó.</span>}</dd>
            </dl>
            {revision && (
              <p>
                <span className="text-tenue">
                  Última revisión, el {formatear(revision.iniciadaEn)}
                  {revision.disparadaPor ? ` por ${revision.disparadaPor}` : " (automática)"}:{" "}
                </span>
                <span className={revision.estado === "error" ? "text-error" : undefined}>{describirRevision(revision)}</span>
              </p>
            )}
            <p className="text-tenue">
              Todos los días mira en qué están los PRs y compara el <code>.globalconfig</code> de main con el de la app.
            </p>
            <BotonAccion accion={revisarPaqueteAhora} texto="Revisar ahora" enCurso="Revisando…" />
          </div>
        </Panel>

        {estado.desvio && (
          <Panel titulo="Desvío" id="desvio">
            <div className="flex flex-col gap-3 px-5 py-4 text-sm" data-desvio="globalconfigDistinto">
              <p className="font-medium text-[var(--aviso)]">El .globalconfig de main no es el de la app, y no hay un PR abierto.</p>
              <p className="text-tenue">
                Alguien lo cambió a mano, o el PR se cerró sin mergear. Abrir el PR lleva main a lo que dice la app; si el cambio
                de main era correcto, primero hay que decidirlo en la app.
              </p>
              <CambiosDelDesvio detalle={estado.desvio.detalle} />
              <p className="text-xs text-tenue">
                Desde el {formatear(estado.desvio.detectadoEn)} · visto por última vez el {formatear(estado.desvio.vistoEn)}
              </p>
              {esDecisor ? (
                <BotonAccion accion={corregirDesvioDelPaqueteAhora} texto="Abrir el PR" enCurso="Abriendo…" principal />
              ) : (
                <p className="text-tenue">Lo corrige un decisor.</p>
              )}
            </div>
          </Panel>
        )}

        <Panel titulo="PRs de configuración" id="prs">
          {estado.prs.length === 0 ? (
            <p className="px-5 py-4 text-sm text-tenue">La app todavía no abrió ninguno.</p>
          ) : (
            <ul className="divide-y divide-linea" data-lista="prs">
              {estado.prs.map((pr) => (
                <Pr key={pr.numero} pr={pr} versionPublicada={versionPublicada} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          titulo={estado.sinPasar.length === 0 ? "Sin pasar al paquete" : `Sin pasar al paquete (${estado.sinPasar.length}${fallidas.length > 0 ? `, ${fallidas.length} fallidas` : ""})`}
          id="sin-pasar"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-linea px-5 py-3 text-sm last:border-b-0">
            <BotonAccion
              accion={publicarPaqueteAhora}
              texto="Publicar en el paquete"
              enCurso="Publicando…"
              deshabilitado={estado.sinPasar.length === 0}
            />
            <span className="text-tenue">
              {estado.sinPasar.length === 0 ? "Todo lo decidido está en un PR o en main." : "Arma o actualiza el PR ya, y reintenta lo que falló."}
            </span>
          </div>
          {estado.sinPasar.length > 0 && (
            <ul className="divide-y divide-linea" data-lista="sin-pasar">
              {estado.sinPasar.map((p) => (
                <SinPasar key={p.id} publicacion={p} />
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

function Pr({ pr, versionPublicada }: { pr: PrParaMostrar; versionPublicada: string | null }) {
  const descripcion = describirPr(pr, versionPublicada, formatear);
  return (
    <li className="flex flex-col gap-1 px-5 py-3 text-sm" data-pr={pr.numero} data-estado={pr.estado}>
      <p>
        <a href={pr.url} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-2 hover:underline">
          PR #{pr.numero}
        </a>
        {pr.version && <span className="text-tenue"> · Lainco.Analyzers {pr.version}</span>}
        <span className="text-tenue"> · {pr.estadoDescripcion}</span>
      </p>
      <p className={TONO[descripcion.tono]}>{descripcion.texto}</p>
      <p className="text-xs text-tenue">
        Abierto el {formatear(pr.creadoEn)} · actualizado por la app el {formatear(pr.actualizadoEn)}
        {pr.revisadoEn && ` · revisado el ${formatear(pr.revisadoEn)}`}
      </p>
    </li>
  );
}

function CambiosDelDesvio({ detalle }: { detalle: { esperado: Record<string, string | null>; encontrado: Record<string, string | null> } | null }) {
  const claves = Object.keys(detalle?.esperado ?? {}).sort();
  if (!detalle || claves.length === 0) {
    return <p className="text-tenue">Las severidades son las mismas: cambian solo los comentarios del archivo.</p>;
  }
  const valor = (v: string | null) => (v ? <code>{v}</code> : <span className="text-tenue">(no está)</span>);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="text-left text-tenue">
          <tr className="border-b border-linea">
            <th className="py-2 pr-4 font-normal">Regla</th>
            <th className="py-2 pr-4 font-normal">La app</th>
            <th className="py-2 font-normal">main</th>
          </tr>
        </thead>
        <tbody>
          {claves.map((clave) => (
            <tr key={clave} className="border-b border-linea last:border-b-0">
              <td className="py-2 pr-4 font-mono text-xs">{clave}</td>
              <td className="py-2 pr-4">{valor(detalle.esperado[clave])}</td>
              <td className="py-2">{valor(detalle.encontrado[clave])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SinPasar({ publicacion: p }: { publicacion: PublicacionParaMostrar }) {
  const fallida = p.estado === "fallida";
  return (
    <li className="flex flex-col gap-1 px-5 py-3 text-sm" data-publicacion={p.estado} data-clave={p.clave}>
      <p className="[overflow-wrap:anywhere]">
        <span className={fallida ? "font-medium text-error" : "font-medium"}>{p.estadoDescripcion}</span>{" "}
        <Link href={`/reglas/${p.reglaId}`} className="underline-offset-2 hover:underline">
          {p.nombre}
        </Link>{" "}
        <span className="font-mono text-xs text-tenue">{p.clave}</span>
      </p>
      <p className="text-tenue">
        Pedida por {p.pedidaPor} el {formatear(p.creadaEn)}
        {p.intentos > 0 && ` · ${p.intentos === 1 ? "1 intento" : `${p.intentos} intentos`}`}
        {!fallida && p.intentos > 0 && ` · próximo intento el ${formatear(p.proximoIntentoEn)}`}
      </p>
      {p.ultimoError && <p className={`[overflow-wrap:anywhere] ${fallida ? "text-error" : "text-tenue"}`}>{p.ultimoError}</p>}
    </li>
  );
}
