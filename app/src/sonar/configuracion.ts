import { Lenguaje } from "@/dominio/valores";

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

/**
 * Variable de entorno con el nombre del Quality Profile que gestiona la app, por lenguaje
 * (entrega 6.2, decisión P3). Al agregar un lenguaje, TypeScript obliga a agregar su
 * variable acá.
 */
export const VARIABLE_DE_PERFIL: Record<Lenguaje, string> = {
  [Lenguaje.CSharp]: "SONAR_PERFIL_CS",
  [Lenguaje.TypeScript]: "SONAR_PERFIL_TS",
};

/**
 * El nombre del perfil de cada lenguaje, tal como se ve en SonarQube Cloud (`Lainco C#`).
 * Lo necesita solo la publicación: sin estas variables la sincronización sigue andando.
 *
 * Falla con un mensaje claro si falta alguna. No hay valores por defecto a propósito:
 * publicar en el perfil equivocado cambia lo que analiza Sonar.
 */
export function perfilesDesdeEntorno(entorno: Record<string, string | undefined> = process.env): Record<Lenguaje, string> {
  const lenguajes = Object.keys(VARIABLE_DE_PERFIL) as Lenguaje[];
  const faltan = lenguajes.map((l) => VARIABLE_DE_PERFIL[l]).filter((nombre) => !entorno[nombre]?.trim());
  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno para publicar en SonarQube: ${faltan.join(", ")}. Ver app/README.md.`);
  }
  return Object.fromEntries(lenguajes.map((l) => [l, entorno[VARIABLE_DE_PERFIL[l]]!.trim()])) as Record<Lenguaje, string>;
}
