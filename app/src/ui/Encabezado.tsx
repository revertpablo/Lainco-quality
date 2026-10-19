import { and, count, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";

import { signOut } from "@/auth";
import type { UsuarioActual } from "@/auth/sesion";
import { obtenerDb } from "@/db/cliente";
import { aviso, estadoSincronizacion, sincronizacion, usuario as tablaUsuario } from "@/db/esquema";
import { Origen } from "@/dominio/valores";
import { sincronizarAhora } from "@/sincronizacion/acciones";
import { describirResumen } from "@/sincronizacion/resumen";

import { BotonSincronizar } from "./BotonSincronizar";

const fecha = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** Encabezado de las pantallas con sesión: quién entró, la sincronización con Sonar y salir. */
export async function Encabezado({ usuario }: { usuario: UsuarioActual }) {
  const db = obtenerDb();
  const [[ultima], [{ avisos }]] = await Promise.all([
    db
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
      .limit(1),
    db.select({ avisos: count() }).from(aviso).where(and(isNull(aviso.resueltoEn))),
  ]);

  return (
    <header className="border-b border-linea bg-superficie">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 lg:px-6">
        <Link href="/reglas" className="text-base font-semibold tracking-tight">
          Catálogo de reglas
        </Link>

        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tenue" data-seccion="sincronizacion">
          <span data-ultima={ultima?.estado}>
            {ultima ? (
              <>
                Sonar sincronizado el {fecha.format(ultima.iniciadaEn)}
                {ultima.disparadaPor ? ` por ${ultima.disparadaPor}` : ""}:{" "}
                <span className={ultima.estado === "error" ? "text-error" : undefined}>
                  {ultima.estado === "ok" ? conMinuscula(describirResumen(ultima)) : describirResumen(ultima)}
                </span>
              </>
            ) : (
              "Sonar todavía no se sincronizó."
            )}
          </span>
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
