import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { aParametros, leerFiltros } from "@/dominio/filtros";
import { destinoDePublicacion } from "@/dominio/publicacion";
import { seEligeLaSeveridad, transicionesDisponibles } from "@/dominio/transiciones";
import { DestinoPublicacion, Rol } from "@/dominio/valores";
import { opcionesDeFiltro } from "@/inventario/consulta";
import { publicarPaqueteAhora } from "@/paquete/acciones";
import { publicarPendientesAhora } from "@/publicacion/acciones";
import { desviosAbiertos, ultimaPublicacionDeRegla } from "@/publicacion/consultas";
import { corregirDesvioAhora } from "@/reconciliacion/acciones";
import { historialDeRegla, obtenerRegla } from "@/reglas/detalle";
import { BotonAccion } from "@/ui/BotonAccion";
import { CambiarEstado } from "@/ui/CambiarEstado";
import { describirValor } from "@/ui/desvios";
import { Encabezado } from "@/ui/Encabezado";
import { COLOR_DE_ESTADO, textoDeSeveridad, textoDeTipo } from "@/ui/etiquetas";
import { Historial } from "@/ui/Historial";
import { describirEstadoEnPaquete, describirEstadoEnSonar } from "@/ui/publicacion";

/**
 * Detalle de una regla (entrega 6.1, paso 10): qué es, en qué estado está, cambiarle el
 * estado (la única forma de incorporar) y su historial completo.
 */

// El botón de sincronizar del encabezado corre en esta página: hasta 5 minutos.
export const maxDuration = 300;

const fechaCorta = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

export default function Regla(props: PageProps<"/reglas/[id]">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-tenue">Cargando la regla…</p>}>
      <Detalle {...props} />
    </Suspense>
  );
}

async function Detalle({ params, searchParams }: PageProps<"/reglas/[id]">) {
  const usuario = await exigirUsuario();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    notFound();
  }

  const db = obtenerDb();
  const [regla, historial, opciones, publicada, desvios] = await Promise.all([
    obtenerRegla(db, id),
    historialDeRegla(db, id),
    opcionesDeFiltro(db),
    ultimaPublicacionDeRegla(db, id),
    desviosAbiertos(db, id),
  ]);
  if (!regla) {
    notFound();
  }

  // Volver al inventario con los filtros que tenía, saneados como cualquier búsqueda.
  const volver = (await searchParams).volver;
  const filtrosDeVuelta = aParametros(leerFiltros(new URLSearchParams(typeof volver === "string" ? volver : "")));
  const estados = Object.fromEntries(opciones.estados.map((e) => [e.codigo, e.descripcion]));
  const disponibles = transicionesDisponibles(regla.estado, usuario.rol);
  const destino = destinoDePublicacion(regla.origen);
  const enSonar = describirEstadoEnSonar(publicada, regla.estado, (d) => fechaCorta.format(d));
  // Reglas propias (entrega 6.4): la severidad con la que va al .globalconfig es la de la regla.
  const enElPaquete = describirEstadoEnPaquete(
    publicada,
    regla.estado,
    regla.severidadAsignada ?? regla.severidadDefault,
    (d) => fechaCorta.format(d),
  );

  return (
    <>
      <Encabezado usuario={usuario} seccion="inventario" />
      <main className="flex flex-1 flex-col gap-6 px-4 py-5 lg:px-6">
        <div className="flex flex-col gap-2">
          <Link
            href={filtrosDeVuelta ? `/reglas?${filtrosDeVuelta}` : "/reglas"}
            className="self-start text-sm text-tenue underline underline-offset-2 hover:text-tinta"
          >
            Volver al inventario
          </Link>
          <p className="font-mono text-sm">{regla.clave}</p>
          <h1 className="max-w-4xl text-xl font-semibold text-balance">{regla.nombre}</h1>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tenue">
            <span className="inline-flex items-center gap-1.5 text-tinta" data-estado={regla.estado}>
              <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: COLOR_DE_ESTADO[regla.estado] }} />
              {regla.estadoDescripcion}
              {regla.severidadAsignada && <> con severidad {textoDeSeveridad(regla.severidadAsignada)}</>}
            </span>
            <span>{regla.lenguajeDescripcion}</span>
            <span>{regla.origenDescripcion}</span>
            {regla.tipo && <span>{textoDeTipo(regla.tipo)}</span>}
            {regla.severidadDefault && <span>Severidad por defecto {textoDeSeveridad(regla.severidadDefault)}</span>}
            {regla.deprecadaEn && <span className="text-error">Deprecada en el origen</span>}
            {regla.avisosPendientes > 0 && (
              <span className="text-error">
                {regla.avisosPendientes === 1 ? "1 aviso sin resolver" : `${regla.avisosPendientes} avisos sin resolver`}
              </span>
            )}
          </p>
          {regla.tags.length > 0 && <p className="text-sm text-tenue">Tags: {regla.tags.join(", ")}</p>}
        </div>

        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <div className="flex min-w-0 max-w-4xl flex-1 flex-col gap-6">
            <section aria-labelledby="titulo-descripcion" className="rounded-lg border border-linea bg-superficie">
              <h2 id="titulo-descripcion" className="border-b border-linea px-5 py-3 font-medium lg:px-7">
                Documentación de la regla
              </h2>
              {regla.descripcion ? (
                <div
                  className="descripcion-de-regla px-5 py-5 lg:px-7 lg:py-6"
                  dangerouslySetInnerHTML={{ __html: regla.descripcion }}
                />
              ) : (
                <p className="px-5 py-5 text-sm text-tenue lg:px-7">El origen no trae descripción para esta regla.</p>
              )}
            </section>

            {regla.parametros.length > 0 && (
              <section aria-labelledby="titulo-parametros" className="rounded-lg border border-linea bg-superficie">
                <h2 id="titulo-parametros" className="border-b border-linea px-5 py-3 font-medium lg:px-7">
                  Parámetros
                </h2>
                <div className="overflow-x-auto px-5 pb-3 lg:px-7">
                  <table className="w-full border-collapse text-sm">
                    <thead className="text-left text-tenue">
                      <tr className="border-b border-linea">
                        <th className="py-2 pr-4 font-normal">Clave</th>
                        <th className="py-2 pr-4 font-normal">Qué es</th>
                        <th className="py-2 pr-4 font-normal">Por defecto</th>
                        <th className="py-2 font-normal">Elegido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regla.parametros.map((p) => (
                        <tr key={p.clave} className="border-b border-linea align-top last:border-b-0">
                          <td className="py-2 pr-4 font-mono text-xs">{p.clave}</td>
                          <td className="py-2 pr-4">{p.descripcion}</td>
                          <td className="py-2 pr-4">{p.valorDefault}</td>
                          <td className="py-2">{regla.parametrosAsignados?.[p.clave] ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>

          {/* En pantallas angostas va antes de la descripción, que puede ser muy larga. */}
          <aside className="order-first flex flex-col gap-8 lg:order-none lg:w-96 lg:shrink-0">
            <section aria-labelledby="titulo-cambiar" className="flex flex-col gap-3 rounded-lg border border-linea bg-superficie p-4">
              <h2 id="titulo-cambiar" className="font-medium">
                Cambiar el estado
              </h2>
              <CambiarEstado
                reglaId={regla.id}
                estado={regla.estado}
                disponibles={disponibles}
                estados={estados}
                severidadDefault={regla.severidadDefault}
                seEligeSeveridad={seEligeLaSeveridad(regla.origen)}
                parametros={regla.parametros}
              />
            </section>

            {destino === DestinoPublicacion.PrConfiguracion && (
              <section
                aria-labelledby="titulo-en-el-paquete"
                className="flex flex-col gap-3 rounded-lg border border-linea bg-superficie p-4 text-sm"
                data-seccion="en-el-paquete"
              >
                <h2 id="titulo-en-el-paquete" className="text-base font-medium">
                  En el paquete
                </h2>
                <p>{enElPaquete.enElArchivo}</p>
                {enElPaquete.pedido && (
                  <p className={enElPaquete.tono === "error" ? "text-error" : enElPaquete.tono === "alerta" ? "text-[var(--estado-revisar)]" : undefined}>
                    {enElPaquete.pedido}
                  </p>
                )}
                {enElPaquete.pr && (
                  <a href={enElPaquete.pr.url} target="_blank" rel="noopener noreferrer" className="self-start underline underline-offset-2">
                    Ver el PR #{enElPaquete.pr.numero} en GitHub
                  </a>
                )}
                {enElPaquete.error && <p className="text-tenue [overflow-wrap:anywhere]">{enElPaquete.error}</p>}
                {publicada && publicada.estado !== "publicada" && (
                  <BotonAccion accion={publicarPaqueteAhora} texto="Publicar en el paquete" enCurso="Publicando…" />
                )}
              </section>
            )}

            {destino === DestinoPublicacion.PerfilSonar && (
              <section
                aria-labelledby="titulo-en-sonar"
                className="flex flex-col gap-3 rounded-lg border border-linea bg-superficie p-4 text-sm"
                data-seccion="en-sonar"
              >
                <h2 id="titulo-en-sonar" className="text-base font-medium">
                  En Sonar
                </h2>
                <p className={enSonar.tono === "error" ? "text-error" : enSonar.tono === "alerta" ? "text-[var(--estado-revisar)]" : undefined}>
                  {enSonar.texto}
                </p>
                {enSonar.error && <p className="text-tenue [overflow-wrap:anywhere]">{enSonar.error}</p>}
                {publicada && publicada.estado !== "publicada" && (
                  <BotonAccion accion={publicarPendientesAhora} texto="Publicar pendientes" enCurso="Publicando…" />
                )}
                {desvios.map((d) => (
                  <div key={d.id} className="flex flex-col gap-1 border-t border-linea pt-3" data-desvio={d.tipo}>
                    <p className="font-medium text-[var(--estado-revisar)]">{d.tipoDescripcion}</p>
                    <p>
                      <span className="text-tenue">La app: </span>
                      {describirValor(d.detalle?.esperado)}
                    </p>
                    <p>
                      <span className="text-tenue">Sonar: </span>
                      {describirValor(d.detalle?.encontrado)}
                    </p>
                    {d.correccionEnCamino ? (
                      <p className="text-tenue">Hay una publicación en camino.</p>
                    ) : usuario.rol === Rol.Decisor ? (
                      <BotonAccion accion={corregirDesvioAhora.bind(null, d.id)} texto="Corregir" enCurso="Corrigiendo…" />
                    ) : (
                      <p className="text-tenue">Lo corrige un decisor.</p>
                    )}
                  </div>
                ))}
              </section>
            )}

            <section aria-labelledby="titulo-historial" className="flex flex-col gap-3">
              <h2 id="titulo-historial" className="font-medium">
                Historial
              </h2>
              <Historial eventos={historial} />
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
