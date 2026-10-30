import Link from "next/link";
import { Suspense } from "react";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { Rol } from "@/dominio/valores";
import { publicarPendientesAhora } from "@/publicacion/acciones";
import {
  desviosAbiertos,
  publicacionesSinPublicar,
  ultimaReconciliacion,
  type DesvioParaMostrar,
  type PublicacionParaMostrar,
} from "@/publicacion/consultas";
import { corregirDesvioAhora, corregirTodosAhora, reconciliarAhora } from "@/reconciliacion/acciones";
import { describirReconciliacion } from "@/reconciliacion/resumen";
import { perfilesDesdeEntorno, VARIABLE_DE_PERFIL } from "@/sonar/configuracion";
import { BotonAccion } from "@/ui/BotonAccion";
import { describirValor } from "@/ui/desvios";
import { Encabezado } from "@/ui/Encabezado";

/**
 * Publicación en Sonar (entrega 6.2, paso 6): la última reconciliación, los desvíos con
 * **Corregir** (solo decisores, decisión P1) y lo que todavía no se publicó.
 */

// Reconciliar y publicar corren en esta página: hasta 5 minutos.
export const maxDuration = 300;

const fecha = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

const NOMBRE_DE_LENGUAJE: Record<string, string> = { cs: "C#", ts: "TypeScript" };

export default function Sonar() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-tenue">Cargando…</p>}>
      <PanelDeSonar />
    </Suspense>
  );
}

async function PanelDeSonar() {
  const usuario = await exigirUsuario();
  const db = obtenerDb();
  const [ultima, desvios, sinPublicar] = await Promise.all([ultimaReconciliacion(db), desviosAbiertos(db), publicacionesSinPublicar(db)]);
  const esDecisor = usuario.rol === Rol.Decisor;

  let perfiles: Record<string, string> | null = null;
  try {
    perfiles = perfilesDesdeEntorno();
  } catch {
    // Se avisa abajo.
  }
  const corregibles = desvios.filter((d) => d.seCorrigeDesdeLaApp && !d.correccionEnCamino);
  const fallidas = sinPublicar.filter((p) => p.estado === "fallida");

  return (
    <>
      <Encabezado usuario={usuario} seccion="sonar" />
      <main className="flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-5 lg:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Publicación en Sonar</h1>
          {perfiles ? (
            <p className="text-sm text-tenue">
              La app gestiona los Quality Profiles{" "}
              {Object.entries(perfiles).map(([lenguaje, nombre], i) => (
                <span key={lenguaje}>
                  {i > 0 && " y "}
                  <strong className="font-medium text-tinta">{nombre}</strong> ({NOMBRE_DE_LENGUAJE[lenguaje] ?? lenguaje})
                </span>
              ))}
              : lo Incorporado queda activo, todo lo demás, inactivo.
            </p>
          ) : (
            <p role="alert" className="text-sm text-error">
              Faltan {Object.values(VARIABLE_DE_PERFIL).join(" y ")}: no se publica ni se reconcilia nada hasta configurarlas (app/README.md, «SonarQube»).
            </p>
          )}
        </div>

        <Panel titulo="Reconciliación" id="reconciliacion">
          <div className="flex flex-col gap-3 px-5 py-4" data-seccion="reconciliacion">
            <p className="text-sm">
              {ultima ? (
                <>
                  <span className="text-tenue">
                    Última, el {fecha.format(ultima.iniciadaEn)}
                    {ultima.disparadaPor ? ` por ${ultima.disparadaPor}` : " (automática)"}:{" "}
                  </span>
                  <span className={ultima.estado === "error" ? "text-error" : undefined}>{describirReconciliacion(ultima)}</span>
                </>
              ) : (
                <span className="text-tenue">Todavía no se reconcilió.</span>
              )}
            </p>
            {ultima && ultima.advertencias.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-[var(--aviso)]">
                {ultima.advertencias.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
            <p className="text-sm text-tenue">
              Compara cada perfil con la app todos los días. Las diferencias quedan como desvíos: la app no cambia Sonar
              por su cuenta.
            </p>
            <BotonAccion accion={reconciliarAhora} texto="Reconciliar ahora" enCurso="Reconciliando…" />
          </div>
        </Panel>

        <Panel titulo={desvios.length === 0 ? "Desvíos" : `Desvíos (${desvios.length})`} id="desvios">
          {desvios.length === 0 ? (
            <p className="px-5 py-4 text-sm text-tenue">Ninguno abierto: Sonar coincide con la app.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-linea px-5 py-3 text-sm">
                {esDecisor ? (
                  // Visible mientras haya desvíos de reglas, aunque ya estén en camino: así
                  // el resultado de la corrección sigue a la vista.
                  desvios.some((d) => d.seCorrigeDesdeLaApp) && (
                    <BotonAccion
                      accion={corregirTodosAhora}
                      texto={corregibles.length > 0 ? `Corregir todos (${corregibles.length})` : "Corregir todos"}
                      enCurso="Corrigiendo…"
                      principal
                      deshabilitado={corregibles.length === 0}
                    />
                  )
                ) : (
                  <span className="text-tenue">Los desvíos los corrige un decisor.</span>
                )}
                <span className="text-tenue">Corregir publica en Sonar lo que dice la app.</span>
              </div>
              <ul className="divide-y divide-linea" data-lista="desvios">
                {desvios.map((d) => (
                  <Desvio key={d.id} desvio={d} esDecisor={esDecisor} />
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel
          titulo={sinPublicar.length === 0 ? "Sin publicar" : `Sin publicar (${sinPublicar.length}${fallidas.length > 0 ? `, ${fallidas.length} fallidas` : ""})`}
          id="sin-publicar"
        >
          {/* El botón queda aunque no haya nada: así se ve el resultado de la última vez. */}
          <div className="flex flex-wrap items-center gap-3 border-b border-linea px-5 py-3 text-sm last:border-b-0">
            <BotonAccion
              accion={publicarPendientesAhora}
              texto="Publicar pendientes"
              enCurso="Publicando…"
              deshabilitado={sinPublicar.length === 0}
            />
            <span className="text-tenue">
              {sinPublicar.length === 0 ? "Todo lo decidido está publicado." : "Reintenta ya lo pendiente y lo que falló."}
            </span>
          </div>
          {sinPublicar.length > 0 && (
            <ul className="divide-y divide-linea" data-lista="sin-publicar">
              {sinPublicar.map((p) => (
                <SinPublicar key={p.id} publicacion={p} />
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

function Desvio({ desvio: d, esDecisor }: { desvio: DesvioParaMostrar; esDecisor: boolean }) {
  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:gap-6" data-desvio={d.tipo} data-clave={d.clave}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm">
          <span className="font-medium">{d.tipoDescripcion}</span>
          <span className="text-tenue"> · {NOMBRE_DE_LENGUAJE[d.lenguaje] ?? d.lenguaje}</span>
        </p>
        <p className="text-sm [overflow-wrap:anywhere]">
          {d.regla ? (
            <Link href={`/reglas/${d.regla.id}`} className="underline-offset-2 hover:underline">
              {d.regla.nombre}
            </Link>
          ) : null}{" "}
          <span className="font-mono text-xs text-tenue">{d.clave}</span>
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
          <dt className="text-tenue">La app</dt>
          <dd className="[overflow-wrap:anywhere]">{describirValor(d.detalle?.esperado)}</dd>
          <dt className="text-tenue">Sonar</dt>
          <dd className="[overflow-wrap:anywhere]">{describirValor(d.detalle?.encontrado)}</dd>
        </dl>
        <p className="text-xs text-tenue">
          Desde el {fecha.format(d.detectadoEn)} · visto por última vez el {fecha.format(d.vistoEn)}
        </p>
      </div>
      <div className="text-sm sm:w-56 sm:shrink-0 sm:text-right">
        {!d.seCorrigeDesdeLaApp ? (
          <span className="text-tenue">{d.regla === null && d.clave.includes(":") ? "La regla no está en el inventario: sincronizar primero." : "Se corrige en SonarQube."}</span>
        ) : d.correccionEnCamino ? (
          <span className="text-tenue">Hay una publicación en camino.</span>
        ) : esDecisor ? (
          <div className="flex sm:justify-end">
            <BotonAccion accion={corregirDesvioAhora.bind(null, d.id)} texto="Corregir" enCurso="Corrigiendo…" etiqueta={`Corregir ${d.clave}`} />
          </div>
        ) : (
          <span className="text-tenue">Lo corrige un decisor.</span>
        )}
      </div>
    </li>
  );
}

function SinPublicar({ publicacion: p }: { publicacion: PublicacionParaMostrar }) {
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
        Pedida por {p.pedidaPor} el {fecha.format(p.creadaEn)}
        {p.intentos > 0 && ` · ${p.intentos === 1 ? "1 intento" : `${p.intentos} intentos`}`}
        {!fallida && p.intentos > 0 && ` · próximo intento el ${fecha.format(p.proximoIntentoEn)}`}
      </p>
      {p.ultimoError && <p className={`[overflow-wrap:anywhere] ${fallida ? "text-error" : "text-tenue"}`}>{p.ultimoError}</p>}
    </li>
  );
}
