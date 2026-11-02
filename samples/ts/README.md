# Sample TypeScript — violaciones conocidas

Equivalente TypeScript de `samples/SampleSolution` (Fase 5, paso 5 de `docs/FASE-5.md`):
código chico con violaciones **a propósito** de las reglas `lainco/...` y contraejemplos
que no deben disparar. Se analiza en el **mismo proyecto de Sonar** que la sample C#
(decisión T4): el repositorio es mixto.

## Cómo correrla

```bash
cd src/ts && npm ci && npm run build && cd ../..
src/ts/node_modules/.bin/eslint --config samples/ts/eslint.config.mjs samples/ts
```

**Estado actual:** 3 advertencias de `lainco/no-hardcoded-secrets` y ninguna otra.

## Violaciones intencionales

Cada una está marcada con un comentario `// >>> lainco/<regla>`.

| Regla | Archivo | Símbolo del mensaje |
|---|---|---|
| `lainco/no-hardcoded-secrets` | `src/configuracion.ts` | `API_KEY` |
| `lainco/no-hardcoded-secrets` | `src/configuracion.ts` | `servicios.pagos.clientSecret` |
| `lainco/no-hardcoded-secrets` | `src/conexion.ts` | `Conexion.password` |

## Contraejemplos

| Regla | Dónde | Por qué no viola |
|---|---|---|
| `lainco/no-hardcoded-secrets` | `DB_PASSWORD` | El valor viene de `process.env`. |
| `lainco/no-hardcoded-secrets` | `tokenType`, `passwordLabel` | El núcleo del nombre no es un secreto. |
| `lainco/no-hardcoded-secrets` | `Conexion` (constructor) | El secreto llega por parámetro. |
| `lainco/no-hardcoded-secrets` | `passwordHint` | Un texto con espacios es de interfaz. |
