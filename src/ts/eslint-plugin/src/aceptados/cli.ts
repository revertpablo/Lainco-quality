#!/usr/bin/env node
/**
 * `lainco-sonar-sync`: genera `sonar-accepted.json` con los issues de reglas propias
 * aceptados en SonarQube. La versión Node de `tools/sonar-sync` (T3 de docs/FASE-5.md).
 *
 *   LAINCO_SONAR_TOKEN=<token> npx lainco-sonar-sync --proyecto <clave>
 */

import { ejecutar } from "./sincronizacion.js";

process.exitCode = await ejecutar(process.argv.slice(2), {
  token: process.env.LAINCO_SONAR_TOKEN,
  fetch,
  log: (linea) => console.log(linea),
  ahora: () => new Date(),
});
