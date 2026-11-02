import { crearProcessor } from "./aceptados/processor.js";
import { noHardcodedSecrets } from "./reglas/no-hardcoded-secrets.js";

/**
 * `@lainco/eslint-plugin`. Se registra con el prefijo `lainco`, así las reglas quedan como
 * `lainco/<nombre>`. Ninguna regla está encendida: las enciende `@lainco/eslint-config`
 * (decisión T7 de docs/FASE-5.md), que también engancha el processor `lainco/aceptados`.
 */
const plugin = {
  meta: {
    name: "@lainco/eslint-plugin",
  },
  rules: {
    "no-hardcoded-secrets": noHardcodedSecrets,
  },
  processors: {
    aceptados: crearProcessor({}),
  },
};

export default plugin;

export { crearProcessor } from "./aceptados/processor.js";
export { lanzarSincronizacion, leerProyectoDeSonar, VIGENCIA_HORAS_POR_DEFECTO } from "./aceptados/lanzador.js";
export { buscarRaiz, esCI } from "./entorno.js";
