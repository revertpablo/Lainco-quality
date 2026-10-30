import Link from "next/link";
import { Suspense } from "react";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { aParametros, FILTROS_POR_DEFECTO } from "@/dominio/filtros";
import {
  DIAS_PARA_ESTANCADA_MAXIMO,
  leerDias,
  resumirProgreso,
  type Avance,
} from "@/dominio/progreso";
import { Estado, type Lenguaje } from "@/dominio/valores";
import { conteosPorEstado, referencias, reglasEstancadas } from "@/tablero/consulta";
import { BarraDeEstados, ReferenciasDeEstados } from "@/ui/BarraDeEstados";
import { Encabezado } from "@/ui/Encabezado";
import { COLOR_DE_ESTADO, textoDeTipo } from "@/ui/etiquetas";

/**
 * Tablero de progreso del triage (entrega 6.1, paso 11; FASE-6.md, sección 5): porcentaje
 * triageado por lenguaje y tipo, reglas en cada estado por origen, y las reglas estancadas
 * En análisis, En prueba o En duda hace más de N días.
 */

// El botón de sincronizar del encabezado corre en esta página: hasta 5 minutos.
export const maxDuration = 300;

const fecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "America/Argentina/Buenos_Aires" });
const numero = new Intl.NumberFormat("es-AR");

export default function Progreso({ searchParams }: PageProps<"/tablero">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-tenue">Cargando el progreso…</p>}>
      <Tablero searchParams={searchParams} />
    </Suspense>
  );
}

async function Tablero({ searchParams }: Pick<PageProps<"/tablero">, "searchParams">) {
  const usuario = await exigirUsuario();
  const dias = leerDias((await searchParams).dias);

  const db = obtenerDb();
  const [conteos, textos, estancadas] = await Promise.all([conteosPorEstado(db), referencias(db), reglasEstancadas(db, dias)]);
  const resumen = resumirProgreso(
    conteos,
    textos.lenguajes.map((l) => l.codigo),
    textos.origenes.map((o) => o.codigo),
  );
  const estados = Object.fromEntries(textos.estados.map((e) => [e.codigo, e.descripcion]));
  const lenguajes = Object.fromEntries(textos.lenguajes.map((l) => [l.codigo, l.descripcion]));
  const origenes = Object.fromEntries(textos.origenes.map((o) => [o.codigo, o.descripcion]));
  const { total } = resumen;

  return (
    <>
      <Encabezado usuario={usuario} seccion="progreso" />
      <main className="flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-5 lg:px-6">
        <h1 className="text-lg font-semibold">Progreso del triage</h1>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-seccion="resumen">
          <Cifra titulo="Triageadas" valor={`${total.porcentaje} %`} detalle={`${numero.format(total.triageadas)} de ${numero.format(total.total)}`} destacada />
          <Cifra titulo={estados[Estado.PendienteDeAnalizar]} valor={numero.format(total.porEstado.pendienteDeAnalizar)} color={COLOR_DE_ESTADO.pendienteDeAnalizar} />
          <Cifra titulo={estados[Estado.Incorporada]} valor={numero.format(total.porEstado.incorporada)} color={COLOR_DE_ESTADO.incorporada} />
          <Cifra titulo={estados[Estado.Descartada]} valor={numero.format(total.porEstado.descartada)} color={COLOR_DE_ESTADO.descartada} />
          <Cifra
            titulo="Estancadas"
            valor={numero.format(estancadas.length)}
            detalle={`más de ${dias} ${dias === 1 ? "día" : "días"} sin avanzar`}
            alerta={estancadas.length > 0}
          />
        </dl>

        <Panel titulo="Por lenguaje y tipo" id="por-lenguaje">
          <p className="px-5 pt-3 text-sm text-tenue">
            Una regla está triageada cuando salió de {estados[Estado.PendienteDeAnalizar]}.
          </p>
          <div className="px-5 pt-2">
            <ReferenciasDeEstados estados={estados} />
          </div>
          <div className="overflow-x-auto px-5 pb-3">
            <table className="w-full border-collapse text-sm" data-tabla="por-lenguaje">
              <thead className="text-left text-tenue">
                <tr className="border-b border-linea">
                  <th className="py-2 pr-2 font-normal sm:pr-4">Lenguaje y tipo</th>
                  <th className="hidden py-2 pr-2 sm:pr-4 text-right font-normal sm:table-cell">Reglas</th>
                  <th className="py-2 pr-2 sm:pr-4 text-right font-normal">Triageadas</th>
                  <th className="w-1/3 py-2 pr-2 sm:pr-4 font-normal sm:w-2/5">
                    <span className="sr-only">Reglas por estado</span>
                  </th>
                  <th className="py-2 text-right font-normal">Pendientes</th>
                </tr>
              </thead>
              {resumen.porLenguaje.map((l) => (
                <tbody key={l.lenguaje} className="border-b border-linea last:border-b-0">
                  <FilaDeAvance
                    titulo={lenguajes[l.lenguaje] ?? l.lenguaje}
                    avance={l.avance}
                    estados={estados}
                    pendientes={pendientesEnInventario(l.lenguaje, undefined)}
                    principal
                  />
                  {l.porTipo.map((t) => (
                    <FilaDeAvance
                      key={t.tipo ?? ""}
                      titulo={t.tipo ? textoDeTipo(t.tipo) : "Sin tipo"}
                      avance={t.avance}
                      estados={estados}
                      // Sin tipo no se puede filtrar en el inventario.
                      pendientes={t.tipo ? pendientesEnInventario(l.lenguaje, t.tipo) : null}
                    />
                  ))}
                </tbody>
              ))}
            </table>
            {resumen.porLenguaje.length === 0 && <p className="py-6 text-center text-tenue">Todavía no hay reglas en el inventario.</p>}
          </div>
        </Panel>

        <Panel titulo="Reglas en cada estado, por origen" id="por-origen">
          <div className="overflow-x-auto px-5 pb-3">
            <table className="w-full min-w-[36rem] border-collapse text-sm" data-tabla="por-origen">
              <thead className="text-left text-tenue">
                <tr className="border-b border-linea">
                  <th className="py-2 pr-4 font-normal">Origen</th>
                  {textos.estados.map((e) => (
                    <th key={e.codigo} className="py-2 pr-4 text-right font-normal">
                      {e.descripcion}
                    </th>
                  ))}
                  <th className="py-2 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                {resumen.porOrigen.map((o) => (
                  <tr key={o.origen} className="border-b border-linea last:border-b-0">
                    <td className="py-2 pr-4">{origenes[o.origen] ?? o.origen}</td>
                    {textos.estados.map((e) => (
                      <td key={e.codigo} className={`py-2 pr-4 text-right ${o.avance.porEstado[e.codigo] === 0 ? "text-tenue" : ""}`}>
                        {numero.format(o.avance.porEstado[e.codigo])}
                      </td>
                    ))}
                    <td className="py-2 text-right font-medium">{numero.format(o.avance.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel titulo={`Estancadas: en ${estados[Estado.EnAnalisis]} o ${estados[Estado.EnPrueba]} hace más de ${dias} ${dias === 1 ? "día" : "días"}`} id="estancadas">
          <form method="get" className="flex flex-wrap items-center gap-2 px-5 pt-3 text-sm">
            <label htmlFor="dias" className="text-tenue">
              Más de
            </label>
            <input
              id="dias"
              name="dias"
              type="number"
              min={1}
              max={DIAS_PARA_ESTANCADA_MAXIMO}
              defaultValue={dias}
              required
              className="w-20 rounded border border-linea bg-superficie px-2 py-1"
            />
            <span className="text-tenue">días</span>
            <button type="submit" className="rounded border border-linea px-3 py-1 hover:border-tenue">
              Ver
            </button>
          </form>
          {estancadas.length === 0 ? (
            <p className="px-5 py-5 text-sm text-tenue">Ninguna regla lleva tanto tiempo sin avanzar.</p>
          ) : (
            <div className="overflow-x-auto px-5 pb-3">
              <table className="w-full border-collapse text-sm" data-tabla="estancadas">
                <thead className="text-left text-tenue">
                  <tr className="border-b border-linea">
                    <th className="py-2 pr-4 font-normal">Regla</th>
                    <th className="py-2 pr-4 font-normal">Estado</th>
                    <th className="hidden py-2 pr-4 font-normal sm:table-cell">Desde</th>
                    <th className="py-2 pr-4 text-right font-normal">Días</th>
                    <th className="hidden py-2 font-normal md:table-cell">La pasó</th>
                  </tr>
                </thead>
                <tbody>
                  {estancadas.map((r) => (
                    <tr key={r.id} data-clave={r.clave} className="border-b border-linea align-top last:border-b-0">
                      <td className="py-2 pr-4 [overflow-wrap:anywhere]">
                        <Link href={`/reglas/${r.id}`} className="underline-offset-2 hover:underline">
                          {r.nombre}
                        </Link>
                        <span className="block text-xs text-tenue">
                          <span className="font-mono">{r.clave}</span> · {lenguajes[r.lenguaje] ?? r.lenguaje}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4">
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: COLOR_DE_ESTADO[r.estado] }} />
                          {r.estadoDescripcion}
                        </span>
                      </td>
                      <td className="hidden whitespace-nowrap py-2 pr-4 sm:table-cell">{fecha.format(r.desde)}</td>
                      <td className="py-2 pr-4 text-right font-medium">{r.dias}</td>
                      <td className="hidden whitespace-nowrap py-2 text-tenue md:table-cell">{r.autor ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </main>
    </>
  );
}

/** Link al inventario con las pendientes de un lenguaje (y tipo). */
function pendientesEnInventario(lenguaje: Lenguaje, tipo: string | undefined): string {
  const filtros = {
    ...FILTROS_POR_DEFECTO,
    estados: [Estado.PendienteDeAnalizar],
    lenguajes: [lenguaje],
    tipos: tipo ? [tipo] : [],
  };
  return `/reglas?${aParametros(filtros)}`;
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

function Cifra({
  titulo,
  valor,
  detalle,
  color,
  destacada,
  alerta,
}: {
  titulo: string;
  valor: string;
  detalle?: string;
  color?: string;
  destacada?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-linea bg-superficie px-4 py-3">
      <dt className="inline-flex items-center gap-1.5 text-sm text-tenue">
        {color && <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: color }} />}
        {titulo}
      </dt>
      <dd className={`text-2xl font-semibold ${destacada ? "text-pino" : ""} ${alerta ? "text-[var(--aviso)]" : ""}`}>
        {valor}
      </dd>
      {detalle && <dd className="text-xs text-tenue">{detalle}</dd>}
    </div>
  );
}

function FilaDeAvance({
  titulo,
  avance,
  estados,
  pendientes,
  principal,
}: {
  titulo: string;
  avance: Avance;
  estados: Record<string, string>;
  pendientes: string | null;
  principal?: boolean;
}) {
  const cantidadPendientes = avance.porEstado.pendienteDeAnalizar;
  return (
    <tr className={principal ? "font-medium" : "text-sm"} data-fila={titulo}>
      <td className={`py-2 pr-2 sm:pr-4 ${principal ? "" : "pl-4"}`}>{titulo}</td>
      <td className="hidden py-2 pr-2 sm:pr-4 text-right sm:table-cell">{numero.format(avance.total)}</td>
      <td className="py-2 pr-2 sm:pr-4 text-right" data-porcentaje={avance.porcentaje}>
        {avance.porcentaje} %
      </td>
      <td className="py-2 pr-2 sm:pr-4">
        <BarraDeEstados avance={avance} estados={estados} />
      </td>
      <td className="py-2 text-right">
        {cantidadPendientes === 0 ? (
          <span className="text-tenue">0</span>
        ) : pendientes ? (
          <Link href={pendientes} className="text-pino underline underline-offset-2">
            {numero.format(cantidadPendientes)}
          </Link>
        ) : (
          numero.format(cantidadPendientes)
        )}
      </td>
    </tr>
  );
}
