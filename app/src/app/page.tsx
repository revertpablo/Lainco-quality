import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { Suspense } from "react";

import { signOut } from "@/auth";
import { exigirUsuario } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { aviso, estado, estadoSincronizacion, lenguaje, regla, sincronizacion, usuario as tablaUsuario } from "@/db/esquema";
import { transicionesDisponibles } from "@/dominio/transiciones";
import { Origen } from "@/dominio/valores";
import { sincronizarAhora } from "@/sincronizacion/acciones";
import { describirResumen } from "@/sincronizacion/resumen";
import { BotonSincronizar } from "@/ui/BotonSincronizar";

/** El botón de sincronizar corre en esta página: hasta 5 minutos (como el cron). */
export const maxDuration = 300;

/**
 * Página de inicio provisoria. Muestra:
 * - quién entró, con qué rol, y qué cambios de estado puede hacer ese rol (paso 4: "un
 *   analista no ve las acciones de decisor");
 * - la última sincronización con Sonar, cuántas reglas hay y el botón para sincronizar
 *   (paso 6).
 * Se reemplaza por el inventario en el paso 8 y el tablero en el paso 11.
 */
export default function Inicio() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <Suspense fallback={<p className="text-sm opacity-70">Cargando…</p>}>
        <Contenido />
      </Suspense>
    </main>
  );
}

async function Contenido() {
  const usuario = await exigirUsuario();
  const estados = await obtenerDb().select().from(estado).orderBy(asc(estado.orden));
  const descripcion = new Map(estados.map((e) => [e.codigo, e.descripcion]));

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Catálogo de reglas</h1>
          <p className="text-sm opacity-70">
            {usuario.nombre} · <span data-rol={usuario.rol}>{usuario.rolDescripcion}</span>
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/ingresar" });
          }}
        >
          <button type="submit" className="text-sm underline opacity-70 hover:opacity-100">
            Salir
          </button>
        </form>
      </header>

      <Suspense fallback={<p className="text-sm opacity-70">Cargando la sincronización…</p>}>
        <Sincronizacion />
      </Suspense>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Cambios de estado que podés hacer</h2>
        <ul className="flex flex-col gap-3 text-sm">
          {estados.map((e) => {
            const disponibles = transicionesDisponibles(e.codigo, usuario.rol);
            return (
              <li key={e.codigo}>
                <p className="font-medium">Desde {e.descripcion}</p>
                {disponibles.length === 0 ? (
                  <p className="opacity-70">Ninguno.</p>
                ) : (
                  <ul className="pl-5">
                    {disponibles.map((t) => (
                      <li key={t.hacia} data-transicion={`${t.desde}-${t.hacia}`}>
                        → {descripcion.get(t.hacia) ?? t.hacia}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

const fecha = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

async function Sincronizacion() {
  const db = obtenerDb();
  const [ultima] = await db
    .select({
      iniciadaEn: sincronizacion.iniciadaEn,
      estado: sincronizacion.estado,
      estadoDescripcion: estadoSincronizacion.descripcion,
      nuevas: sincronizacion.nuevas,
      modificadas: sincronizacion.modificadas,
      deprecadas: sincronizacion.deprecadas,
      error: sincronizacion.error,
      disparadaPor: tablaUsuario.nombre,
    })
    .from(sincronizacion)
    .innerJoin(estadoSincronizacion, eq(estadoSincronizacion.codigo, sincronizacion.estado))
    .leftJoin(tablaUsuario, eq(tablaUsuario.id, sincronizacion.disparadaPorId))
    .where(eq(sincronizacion.origen, Origen.Sonar))
    .orderBy(desc(sincronizacion.iniciadaEn))
    .limit(1);

  const porLenguaje = await db
    .select({ lenguaje: lenguaje.descripcion, cantidad: count() })
    .from(regla)
    .innerJoin(lenguaje, eq(lenguaje.codigo, regla.lenguaje))
    .where(and(eq(regla.origen, Origen.Sonar), isNull(regla.deprecadaEn)))
    .groupBy(lenguaje.descripcion, lenguaje.orden)
    .orderBy(asc(lenguaje.orden));

  const [{ pendientes }] = await db.select({ pendientes: count() }).from(aviso).where(isNull(aviso.resueltoEn));

  return (
    <section className="flex flex-col gap-3" data-seccion="sincronizacion">
      <h2 className="text-lg font-medium">Sincronización con Sonar</h2>
      <div className="text-sm">
        {ultima ? (
          <p data-ultima={ultima.estado}>
            Última: {fecha.format(ultima.iniciadaEn)} ({ultima.disparadaPor ?? "automática"}) —{" "}
            {ultima.estado === "ok" ? describirResumen(ultima) : `${ultima.estadoDescripcion}. ${describirResumen(ultima)}`}
          </p>
        ) : (
          <p>Todavía no se sincronizó.</p>
        )}
        <p className="opacity-70" data-reglas>
          {porLenguaje.length === 0
            ? "No hay reglas de Sonar."
            : `Reglas vigentes (sin las deprecadas): ${porLenguaje.map((l) => `${l.cantidad} de ${l.lenguaje}`).join(", ")}.`}
          {pendientes > 0 && ` Avisos sin resolver: ${pendientes}.`}
        </p>
      </div>
      <BotonSincronizar accion={sincronizarAhora} />
    </section>
  );
}
