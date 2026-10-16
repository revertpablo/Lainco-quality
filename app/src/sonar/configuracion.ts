import { crearClienteSonar, type ClienteSonar } from "./cliente";

/**
 * Cliente de Sonar configurado con las variables de entorno:
 *
 *   SONAR_URL            URL del servidor. Por defecto, https://sonarcloud.io.
 *   SONAR_ORGANIZACION   Clave de la organización en SonarQube Cloud.
 *   LAINCO_SONAR_TOKEN   Token de SonarQube. Es la misma variable que usa
 *                        tools/sonar-sync en las máquinas de desarrollo. Secreto.
 *
 * Falla con un mensaje claro si falta alguna obligatoria. Nunca muestra el token.
 */
export function clienteSonarDesdeEntorno(entorno: Record<string, string | undefined> = process.env): ClienteSonar {
  const faltan = ["SONAR_ORGANIZACION", "LAINCO_SONAR_TOKEN"].filter((nombre) => !entorno[nombre]?.trim());
  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno para SonarQube: ${faltan.join(", ")}. Ver app/README.md.`);
  }

  return crearClienteSonar({
    url: entorno.SONAR_URL?.trim() || "https://sonarcloud.io",
    organizacion: entorno.SONAR_ORGANIZACION!.trim(),
    token: entorno.LAINCO_SONAR_TOKEN!.trim(),
  });
}
