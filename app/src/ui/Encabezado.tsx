import { and, count, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";

import { signOut } from "@/auth";
import type { UsuarioActual } from "@/auth/sesion";
import { obtenerDb, type Db } from "@/db/cliente";
import { aviso, sincronizacion, usuario as tablaUsuario } from "@/db/esquema";
import { Origen } from "@/dominio/valores";
import { atencionDelPaquete } from "@/paquete/consultas";
import { atencionDePrueba } from "@/prueba/consultas";
import { pendientesDeAtencion } from "@/publicacion/consultas";
import { sincronizarAhora } from "@/sincronizacion/acciones";
import { describirResumen } from "@/sincronizacion/resumen";

import { BotonSincronizar } from "./BotonSincronizar";

const fecha = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** Las secciones de la app, para la navegación del encabezado. */
const SECCIONES = [
  { codigo: "inventario", texto: "Inventario", href: "/reglas" },
  { codigo: "progreso", texto: "Progreso", href: "/tablero" },
  { codigo: "sonar", texto: "Sonar", href: "/sonar" },
  { codigo: "paquete", texto: "Paquete", href: "/paquete" },
  { codigo: "prueba", texto: "Prueba", href: "/prueba" },
] as const;
export type Seccion = (typeof SECCIONES)[number]["codigo"];

/** Los orígenes que se sincronizan, en el orden en que se muestran. */
const ORIGENES_SINCRONIZADOS = [
  { origen: Origen.Sonar, nombre: "Sonar" },
  { origen: Origen.Roslyn, nombre: "Roslyn" },
] as const;

/** La última corrida de un origen, termine bien o no. */
async function ultimaSincronizacion(db: Db, origen: Origen) {
  const [ultima] = await db
    .select({
      iniciadaEn: sincronizacion.iniciadaEn,
      estado: sincronizacion.estado,
      nuevas: sincronizacion.nuevas,
      modificadas: sincronizacion.modificadas,
      deprecadas: sincronizacion.deprecadas,
      error: sincronizacion.error,
      version: sincronizacion.version,
      disparadaPor: tablaUsuario.nombre,
    })
    .from(sincronizacion)
    .leftJoin(tablaUsuario, eq(tablaUsuario.id, sincronizacion.disparadaPorId))
    .where(eq(sincronizacion.origen, origen))
    .orderBy(desc(sincronizacion.iniciadaEn))
    .limit(1);
  return ultima ?? null;
}

/**
 * Encabezado de las pantallas con sesión: las secciones, quién entró, la sincronización
 * de cada origen (Sonar y Roslyn) y salir.
 */
export async function Encabezado({ usuario, seccion }: { usuario: UsuarioActual; seccion: Seccion }) {
  const db = obtenerDb();
  const [ultimas, [{ avisos }], atencion, delPaquete, deLaPrueba] = await Promise.all([
    Promise.all(ORIGENES_SINCRONIZADOS.map(({ origen }) => ultimaSincronizacion(db, origen))),
    db.select({ avisos: count() }).from(aviso).where(and(isNull(aviso.resueltoEn))),
    pendientesDeAtencion(db),
    atencionDelPaquete(db),
    atencionDePrueba(db),
  ]);
  // Lo que alguien tiene que mirar en cada sección: desvíos y publicaciones fallidas.
  const insignias: Partial<Record<Seccion, { cantidad: number; detalle: string }>> = {
    sonar: insignia(atencion.desvios, atencion.fallidas),
    paquete: insignia(delPaquete.desvio ? 1 : 0, delPaquete.fallidas),
    prueba: deLaPrueba,
  };

  return (
    <header className="border-b border-linea bg-superficie">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <Link href="/reglas" className="text-base font-semibold tracking-tight">
            Catálogo de reglas
          </Link>
          <nav aria-label="Secciones" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SECCIONES.map((s) => (
              <Link
                key={s.codigo}
                href={s.href}
                aria-current={s.codigo === seccion ? "page" : undefined}
                className={`inline-flex items-center whitespace-nowrap ${
                  s.codigo === seccion
                    ? "font-medium text-tinta underline decoration-pino decoration-2 underline-offset-[6px]"
                    : "text-tenue hover:text-tinta"
                }`}
              >
                {s.texto}
                {(insignias[s.codigo]?.cantidad ?? 0) > 0 && (
                  <span
                    className="ml-1.5 inline-block rounded-full bg-[var(--aviso)] px-1.5 py-px text-xs font-medium text-superficie"
                    title={insignias[s.codigo]!.detalle}
                    data-atencion={insignias[s.codigo]!.cantidad}
                  >
                    {insignias[s.codigo]!.cantidad}
                    <span className="sr-only"> ({insignias[s.codigo]!.detalle})</span>
                  </span>
                )}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tenue" data-seccion="sincronizacion">
          {ORIGENES_SINCRONIZADOS.map(({ origen, nombre }, i) => {
            const ultima = ultimas[i];
            return (
              <span key={origen} data-origen={origen} data-ultima={ultima?.estado}>
                {ultima ? (
                  <>
                    {nombre}
                    {ultima.version ? ` (${ultima.version})` : ""} sincronizado el {fecha.format(ultima.iniciadaEn)}
                    {ultima.disparadaPor ? ` por ${ultima.disparadaPor}` : ""}:{" "}
                    <span className={ultima.estado === "error" ? "text-error" : undefined}>
                      {ultima.estado === "ok"
                        ? conMinuscula(describirResumen(ultima, nombre))
                        : describirResumen(ultima, nombre)}
                    </span>
                  </>
                ) : (
                  `${nombre} todavía no se sincronizó.`
                )}
              </span>
            );
          })}
          {avisos > 0 && <span>{avisos === 1 ? "1 aviso sin resolver" : `${avisos} avisos sin resolver`}</span>}
          <BotonSincronizar accion={sincronizarAhora} />
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span>{usuario.nombre}</span>
          <span className="text-tenue" data-rol={usuario.rol}>
            {usuario.rolDescripcion}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/ingresar" });
            }}
          >
            <button type="submit" className="text-tenue underline underline-offset-2 hover:text-tinta">
              Salir
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

/** "Sin cambios en Sonar." → "sin cambios en Sonar.": solo la primera letra. */
function conMinuscula(texto: string): string {
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}

/** La insignia de una sección: cuántas cosas hay que mirar y cuáles. */
function insignia(desvios: number, fallidas: number): { cantidad: number; detalle: string } {
  const detalle = [
    desvios > 0 && (desvios === 1 ? "1 desvío" : `${desvios} desvíos`),
    fallidas > 0 && (fallidas === 1 ? "1 publicación fallida" : `${fallidas} publicaciones fallidas`),
  ]
    .filter(Boolean)
    .join(" y ");
  return { cantidad: desvios + fallidas, detalle };
}
