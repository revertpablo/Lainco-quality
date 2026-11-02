# Paquetes TypeScript — Fase 5

| Paquete | Qué es |
|---|---|
| `@lainco/eslint-plugin` (`eslint-plugin/`) | Las reglas propias (`lainco/<nombre>`), el processor `lainco/aceptados` y el comando `lainco-sonar-sync`. |
| `@lainco/eslint-config` (`eslint-config/`) | La configuración compartida: enciende solo las reglas de `reglas.json` y, en local, oculta los issues aceptados en Sonar. |

Plan, decisiones (T1–T7) y avance en `docs/FASE-5.md`. Las reglas están documentadas en
`docs/rules/lainco/`.

## Uso en un repositorio

```bash
npm install -D eslint @lainco/eslint-config
```

```js
// eslint.config.mjs
import lainco from "@lainco/eslint-config";

export default [...lainco];
```

Sin `recommended` de ESLint ni de typescript-eslint: corre solo lo que el equipo eligió.
**No** se usa `// eslint-disable` (CLAUDE.md, "Gobernanza"): las excepciones se aceptan en
Sonar.

## Issues aceptados en Sonar (equivalente de la Fase 4)

En local, la configuración:

1. **Lanza `lainco-sonar-sync` en segundo plano** si `sonar-accepted.json` (en la raíz del
   repositorio git) tiene más de 8 horas. No la espera: ESLint nunca se demora ni falla
   por Sonar.
2. **Engancha el processor `lainco/aceptados`**, que oculta los mensajes que coinciden en
   archivo + regla + mensaje con un issue del archivo.

En CI (`CI`, `GITHUB_ACTIONS` o `TF_BUILD`) no hace ninguna de las dos cosas: un issue
aceptado que no llega a Sonar, Sonar lo da por corregido.

La clave del proyecto se lee de `sonar-project.properties` (`sonar.projectKey`,
`sonar.organization`). Si no está, se pasa a mano:

```js
import { configurar } from "@lainco/eslint-config";

export default [...configurar({ sonar: { proyecto: "clave", organizacion: "org" } })];
```

| Variable de entorno | Qué hace |
|---|---|
| `LAINCO_SONAR_TOKEN` | Token personal de Sonar, de solo lectura. Sin él no se sincroniza (el processor usa el archivo que haya). |
| `LAINCO_SONAR_SYNC=false` | No lanza la sincronización. |
| `LAINCO_SUPPRESS_ACCEPTED=false` | No oculta nada: muestra también los issues aceptados. |
| `LAINCO_SONAR_ACEPTADOS` | Otra ruta para `sonar-accepted.json`. |

Para forzar una actualización, a mano:

```bash
npx lainco-sonar-sync --proyecto <clave> --organizacion <org>
```

Mismas opciones, códigos de salida, candado y pausa tras una falla que la versión .NET
(`tools/sonar-sync/README.md`). En un repositorio mixto las dos escriben el mismo archivo,
y las dos guardan las reglas propias de los dos motores.

## Desarrollo

```bash
cd src/ts
npm install
npm test        # los dos paquetes
npm run build   # el plugin primero: genera también dist/reglas-eslint.json
```
