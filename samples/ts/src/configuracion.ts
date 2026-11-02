// Configuración de la sample. Mezcla a propósito secretos escritos en el código
// (violaciones de lainco/no-hardcoded-secrets) con valores que la regla no debe marcar.

// >>> lainco/no-hardcoded-secrets
export const API_KEY = "sample-api-key-no-es-real";

// Contraejemplo: el valor viene del entorno.
export const DB_PASSWORD = process.env.DB_PASSWORD;

// Contraejemplos: nombres que hablan de un secreto pero no lo son.
export const tokenType = "Bearer";
export const passwordLabel = "Contraseña";

export const servicios = {
  pagos: {
    url: "https://pagos.lainco.example",
    // >>> lainco/no-hardcoded-secrets
    clientSecret: "pagos-2026",
  },
};
