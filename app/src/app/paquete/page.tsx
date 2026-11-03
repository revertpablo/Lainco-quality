import Link from "next/link";
import { Suspense } from "react";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { Origen, Rol } from "@/dominio/valores";
import { corregirDesvioDelPaqueteAhora, publicarPaqueteAhora, revisarPaqueteAhora } from "@/paquete/acciones";
import { estadoDelPaquete, type EstadoDelPaquete, type PrParaMostrar } from "@/paquete/consultas";
import { PAQUETES, type DefinicionDelPaquete } from "@/paquete/paquetes";
import { describirRevision } from "@/paquete/resumen";
import type { PublicacionParaMostrar } from "@/publicacion/consultas";
import { BotonAccion } from "@/ui/BotonAccion";
import { Encabezado } from "@/ui/Encabezado";
import { describirPr, numeroDeVersion } from "@/ui/paquete";

/**
 * Los paquetes de reglas propias (entrega 6.4, paso 7): qué versión está publicada, en qué
 * están los PRs de configuración que abre la app, qué falta pasar al paquete y, si el
 * archivo de configuración de main no es el de la app, el desvío. Una sección por paquete:
 * Lainco.Analyzers y @lainco/eslint-config (parte ESLint, L4).
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
  const db = obtenerDb();
  const estados = await Promise.all(PAQUETES.map(async (paquete) => ({ paquete, estado: await estadoDelPaquete(db, paquete) })));
  const esDecisor = usuario.rol === Rol.Decisor;
  const sinPasar = estados.reduce((total, { estado }) => total + estado.sinPasar.length, 0);

  return (
    <>
      <Encabezado usuario={usuario} seccion="paquete" />
      <main className="flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-5 lg:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Paquetes de reglas propias</h1>
          <p className="text-sm text-tenue">
            Lo que se decide sobre las reglas propias llega a los repositorios con un PR que cambia la configuración de su paquete:
            el <code>.globalconfig</code> de <strong className="font-medium text-tinta">Lainco.Analyzers</strong> o el{" "}
            <code>reglas.json</code> de <strong className="font-medium text-tinta">@lainco/eslint-config</strong>. Al mergearlo se
            publica una versión nueva del paquete.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <BotonAccion accion={revisarPaqueteAhora} texto="Revisar ahora" enCurso="Revisando…" />
          <BotonAccion accion={publicarPaqueteAhora} texto="Publicar en el paquete" enCurso="Publicando…" deshabilitado={sinPasar === 0} />
          <span className="text-tenue">
            Todos los días se revisan los dos: en qué están sus PRs y si main tiene la configuración de la app.
          </span>
        </div>

        {estados.map(({ paquete, estado }) => (
          <SeccionDelPaquete key={paquete.origen} paquete={paquete} estado={estado} esDecisor={esDecisor} />
        ))}
      </main>
    </>
  );
}

function SeccionDelPaquete({ paquete, estado, esDecisor }: { paquete: DefinicionDelPaquete; estado: EstadoDelPaquete; esDecisor: boolean }) {
  const deEslint = paquete.origen === Origen.Eslint;
  const versionPublicada = deEslint ? null : numeroDeVersion(estado.publicada?.version ?? null);
  const fallidas = estado.sinPasar.filter((p) => p.estado === "fallida");
  const revision = estado.ultimaRevision;
  const id = paquete.origen;

  return (
    <section aria-labelledby={`paquete-${id}`} className="flex flex-col gap-4" data-paquete={id}>
      <h2 id={`paquete-${id}`} className="font-semibold">
        {paquete.nombre} <span className="font-normal text-tenue">· {paquete.archivo}</span>
      </h2>

      <Panel titulo="Versión y revisión" id={`version-${id}`}>
        <div className="flex flex-col gap-3 px-5 py-4 text-sm" data-seccion="version">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-tenue">{deEslint ? "Plugin publicado" : "Publicada"}</dt>
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
              <span className={revision.estado === "error" ? "text-error" : undefined}>{describirRevision(revision, paquete.archivo)}</span>
            </p>
          )}
        </div>
      </Panel>

      {estado.desvio && (
        <Panel titulo="Desvío" id={`desvio-${id}`}>
          <div className="flex flex-col gap-3 px-5 py-4 text-sm" data-desvio={paquete.desvio.tipo}>
            <p className="font-medium text-[var(--aviso)]">El {paquete.archivo} de main no es el de la app, y no hay un PR abierto.</p>
            <p className="text-tenue">
              Alguien lo cambió a mano, o el PR se cerró sin mergear. Abrir el PR lleva main a lo que dice la app; si el cambio
              de main era correcto, primero hay que decidirlo en la app.
            </p>
            <CambiosDelDesvio detalle={estado.desvio.detalle} />
            <p className="text-xs text-tenue">
              Desde el {formatear(estado.desvio.detectadoEn)} · visto por última vez el {formatear(estado.desvio.vistoEn)}
            </p>
            {esDecisor ? (
              <BotonAccion accion={corregirDesvioDelPaqueteAhora.bind(null, paquete.origen)} texto="Abrir el PR" enCurso="Abriendo…" principal />
            ) : (
              <p className="text-tenue">Lo corrige un decisor.</p>
            )}
          </div>
        </Panel>
      )}

      <Panel titulo="PRs de configuración" id={`prs-${id}`}>
        {estado.prs.length === 0 ? (
          <p className="px-5 py-4 text-sm text-tenue">La app todavía no abrió ninguno.</p>
        ) : (
          <ul className="divide-y divide-linea" data-lista="prs">
            {estado.prs.map((pr) => (
              <Pr key={pr.numero} pr={pr} versionPublicada={versionPublicada} paquete={paquete.nombre} sinVersionPublicada={deEslint} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        titulo={estado.sinPasar.length === 0 ? "Sin pasar al paquete" : `Sin pasar al paquete (${estado.sinPasar.length}${fallidas.length > 0 ? `, ${fallidas.length} fallidas` : ""})`}
        id={`sin-pasar-${id}`}
      >
        {estado.sinPasar.length === 0 ? (
          <p className="px-5 py-4 text-sm text-tenue">Todo lo decidido está en un PR o en main.</p>
        ) : (
          <ul className="divide-y divide-linea" data-lista="sin-pasar">
            {estado.sinPasar.map((p) => (
              <SinPasar key={p.id} publicacion={p} />
            ))}
          </ul>
        )}
      </Panel>
    </section>
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

function Pr({
  pr,
  versionPublicada,
  paquete,
  sinVersionPublicada,
}: {
  pr: PrParaMostrar;
  versionPublicada: string | null;
  paquete: string;
  sinVersionPublicada: boolean;
}) {
  const descripcion = describirPr(pr, versionPublicada, formatear, sinVersionPublicada);
  return (
    <li className="flex flex-col gap-1 px-5 py-3 text-sm" data-pr={pr.numero} data-estado={pr.estado}>
      <p>
        <a href={pr.url} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-2 hover:underline">
          PR #{pr.numero}
        </a>
        {pr.version && (
          <span className="text-tenue">
            {" "}
            · {paquete} {pr.version}
          </span>
        )}
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
