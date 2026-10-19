import { Suspense } from "react";

import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { aParametros, leerFiltros, type CampoDeOrden, type Filtros } from "@/dominio/filtros";
import { aplicarOperacionMasiva } from "@/inventario/acciones";
import { buscarReglas, opcionesDeFiltro, ultimaSincronizacionOk } from "@/inventario/consulta";
import { Encabezado } from "@/ui/Encabezado";
import { FormularioDeFiltros } from "@/ui/FormularioDeFiltros";
import { PanelDeFiltros } from "@/ui/PanelDeFiltros";
import { TablaDeReglas, type Columna } from "@/ui/TablaDeReglas";
import { VistasGuardadas } from "@/ui/VistasGuardadas";
import { listarVistas } from "@/vistas/vistas";

/**
 * Inventario de reglas (entrega 6.1, pasos 8 y 9; FASE-6.md, sección 5): filtros, orden,
 * vistas guardadas, selección múltiple y operaciones masivas con justificación común.
 */

// El botón de sincronizar del encabezado corre en esta página: hasta 5 minutos.
export const maxDuration = 300;

export default function Reglas({ searchParams }: PageProps<"/reglas">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-tenue">Cargando las reglas…</p>}>
      <Inventario searchParams={searchParams} />
    </Suspense>
  );
}

async function Inventario({ searchParams }: Pick<PageProps<"/reglas">, "searchParams">) {
  const usuario = await exigirUsuario();
  const parametros = await searchParams;
  const filtros = leerFiltros(parametros);
  // proxy.ts ya dejó la URL en su forma canónica.

  const db = obtenerDb();
  const ultima = await ultimaSincronizacionOk(db);
  const [filas, opciones, vistas] = await Promise.all([
    buscarReglas(db, filtros, ultima),
    opcionesDeFiltro(db),
    listarVistas(db, usuario.id),
  ]);

  const columna = (titulo: string, campo?: CampoDeOrden): Columna => ({
    titulo,
    ordenar: campo && {
      href: `/reglas?${aParametros(ordenadoPor(filtros, campo))}`.replace(/\?$/, ""),
      activa: filtros.orden === campo ? filtros.sentido : null,
    },
  });

  return (
    <>
      <Encabezado usuario={usuario} />
      <div className="flex flex-1 flex-col lg:flex-row">
        <PanelDeFiltros activos={cantidadDeFiltros(filtros)}>
          <VistasGuardadas vistas={vistas} parametrosActuales={aParametros(filtros)} />
          {/* La key regenera el formulario en cada búsqueda: si no, al navegar con un link
              (una vista, el orden) las casillas quedarían como estaban. */}
          <FormularioDeFiltros key={aParametros(filtros)} filtros={filtros} opciones={opciones} />
        </PanelDeFiltros>

        <main className="flex min-w-0 flex-1 flex-col">
          <h1 className="px-4 pt-4 pb-2 text-lg font-semibold lg:px-6" data-cantidad={filas.length}>
            {filas.length === opciones.total
              ? `${opciones.total} reglas`
              : `${filas.length} de ${opciones.total} reglas`}
          </h1>
          <TablaDeReglas
            filas={filas}
            rol={usuario.rol}
            estados={Object.fromEntries(opciones.estados.map((e) => [e.codigo, e.descripcion]))}
            lenguajes={Object.fromEntries(opciones.lenguajes.map((l) => [l.codigo, l.descripcion]))}
            columnas={{
              clave: columna("Clave", "clave"),
              nombre: columna("Nombre", "nombre"),
              lenguaje: columna("Lenguaje", "lenguaje"),
              tipo: columna("Tipo", "tipo"),
              severidad: columna("Severidad", "severidad"),
              estado: columna("Estado", "estado"),
            }}
            aplicar={aplicarOperacionMasiva}
          />
        </main>
      </div>
    </>
  );
}

/** Ordenar por un campo: si ya se ordenaba por ese, invierte el sentido. */
function ordenadoPor(filtros: Filtros, campo: CampoDeOrden): Filtros {
  const sentido = filtros.orden === campo && filtros.sentido === "asc" ? "desc" : "asc";
  return { ...filtros, orden: campo, sentido };
}

function cantidadDeFiltros(f: Filtros): number {
  return (
    (f.q ? 1 : 0) +
    f.estados.length +
    f.lenguajes.length +
    f.origenes.length +
    f.tipos.length +
    f.severidades.length +
    f.tags.length +
    f.atributos.length +
    (f.novedad ? 1 : 0) +
    (f.deprecadas !== "incluir" ? 1 : 0)
  );
}
