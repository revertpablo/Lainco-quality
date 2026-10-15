/**
 * Pide `sslmode=verify-full` en lugar de `prefer`, `require` o `verify-ca`.
 *
 * Neon inyecta `sslmode=require`. La versión actual de `pg` ya lo trata como
 * `verify-full` (cifra y verifica el certificado), pero avisa que en la próxima versión
 * mayor `require` pasa a significar solo "cifrar", sin verificar el certificado. Pedirlo
 * explícito conserva el comportamiento de hoy, que es el más seguro, y saca el aviso.
 *
 * Una URL sin `sslmode` (un Postgres local) queda como está.
 */
export function conSslExplicito(url: string): string {
  let parseada: URL;
  try {
    parseada = new URL(url);
  } catch {
    return url;
  }

  const modo = parseada.searchParams.get("sslmode");
  if (modo === "prefer" || modo === "require" || modo === "verify-ca") {
    parseada.searchParams.set("sslmode", "verify-full");
    return parseada.toString();
  }

  return url;
}
