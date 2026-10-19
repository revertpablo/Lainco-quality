import Link from "next/link";

/** Una regla que no existe (o un id mal escrito). */
export default function ReglaInexistente() {
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-3 px-4 py-12">
      <h1 className="text-xl font-semibold">Esa regla no está en el inventario</h1>
      <p className="text-tenue">Puede que el link esté incompleto o que la regla se haya borrado.</p>
      <Link href="/reglas" className="self-start underline underline-offset-2">
        Ir al inventario
      </Link>
    </main>
  );
}
