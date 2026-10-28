import { crearClienteGitHub, type ClienteGitHub } from "./cliente";

/**
 * Cliente de GitHub configurado con las variables de entorno (entrega 6.4, decisión R2):
 *
 *   GITHUB_REPOSITORIO   El repositorio de los paquetes de reglas propias, como
 *                        dueño/repositorio: revertpablo/Lainco-quality.
 *   LAINCO_GITHUB_TOKEN  Token fine-grained limitado a ese repositorio. Para leer los
 *                        releases alcanza con Contents de lectura; el PR automático
 *                        (paso 6) necesita escritura en Contents y Pull requests. Secreto.
 *   GITHUB_API_URL       URL de la API. Por defecto, https://api.github.com.
 *
 * Falla con un mensaje claro si falta alguna obligatoria. Nunca muestra el token.
 */
export function clienteGitHubDesdeEntorno(entorno: Record<string, string | undefined> = process.env): ClienteGitHub {
  const faltan = ["GITHUB_REPOSITORIO", "LAINCO_GITHUB_TOKEN"].filter((nombre) => !entorno[nombre]?.trim());
  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno para GitHub: ${faltan.join(", ")}. Ver app/README.md.`);
  }

  return crearClienteGitHub({
    url: entorno.GITHUB_API_URL?.trim() || "https://api.github.com",
    repositorio: entorno.GITHUB_REPOSITORIO!.trim(),
    token: entorno.LAINCO_GITHUB_TOKEN!.trim(),
  });
}
