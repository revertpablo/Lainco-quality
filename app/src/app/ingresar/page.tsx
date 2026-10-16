import { Suspense } from "react";

import { signIn } from "@/auth";
import { DOMINIO_DE_LAINCO, MENSAJES_DE_INGRESO, type MotivoDeIngresoRechazado } from "@/dominio/acceso";

/**
 * Pantalla de ingreso. Es lo único que ve alguien sin sesión (docs/FASE-6-APP.md,
 * sección 9, punto B). Si un ingreso se rechaza, Auth.js vuelve acá con `?error=`.
 */
export default function Ingresar({ searchParams }: PageProps<"/ingresar">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-12">
      <header>
        <h1 className="text-2xl font-semibold">Catálogo de reglas</h1>
        <p className="text-sm opacity-70">Lainco Quality</p>
      </header>

      <Suspense>
        <Formulario searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Formulario({ searchParams }: Pick<PageProps<"/ingresar">, "searchParams">) {
  const parametros = await searchParams;
  const error = primero(parametros.error);
  const desde = destinoSeguro(primero(parametros.desde));

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
          {mensajeDeError(error)}
        </p>
      )}

      <form action={ingresar}>
        <input type="hidden" name="proveedor" value="google" />
        <input type="hidden" name="desde" value={desde} />
        <Boton>Entrar con Google</Boton>
        <p className="mt-1 text-xs opacity-70">Con tu cuenta de {DOMINIO_DE_LAINCO}.</p>
      </form>

      <form action={ingresar}>
        <input type="hidden" name="proveedor" value="github" />
        <input type="hidden" name="desde" value={desde} />
        <Boton>Entrar con GitHub</Boton>
        <p className="mt-1 text-xs opacity-70">Solo si un decisor cargó tu usuario de GitHub.</p>
      </form>
    </div>
  );
}

function Boton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="w-full rounded-md border border-current/20 px-4 py-2 text-sm font-medium hover:bg-current/5"
    >
      {children}
    </button>
  );
}

async function ingresar(datos: FormData) {
  "use server";

  const proveedor = datos.get("proveedor");
  if (proveedor !== "google" && proveedor !== "github") {
    return;
  }

  await signIn(proveedor, { redirectTo: destinoSeguro(datos.get("desde")) });
}

/** Solo rutas de la propia app: evita que `?desde=` mande a otro sitio después de entrar. */
function destinoSeguro(valor: unknown): string {
  return typeof valor === "string" && valor.startsWith("/") && !valor.startsWith("//") && !valor.startsWith("/\\")
    ? valor
    : "/";
}

function mensajeDeError(error: string): string {
  if (error in MENSAJES_DE_INGRESO) {
    return MENSAJES_DE_INGRESO[error as MotivoDeIngresoRechazado];
  }
  // AccessDenied, Configuration y demás errores propios de Auth.js.
  return "No se pudo iniciar sesión. Probá de nuevo; si sigue fallando, avisale a un decisor.";
}

function primero(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}
