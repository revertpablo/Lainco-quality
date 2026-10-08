# Lainco Quality

Plataforma de control de calidad de código de Lainco. Reemplaza el uso de las reglas por defecto de SonarQube por un conjunto de reglas **elegidas explícitamente por el equipo**, provenientes de cuatro orígenes, gestionadas en un único circuito.

Si llegás nuevo al proyecto, empezá por **`docs/CONCEPTO.md`**: explica qué se está construyendo y por qué, sin implementación.

**Antes de empezar cualquier cosa, leé `docs/ESTADO.md`**: dice en qué fase estamos, qué
está verificado, qué quedó pendiente y qué decisiones siguen abiertas.

El plan de trabajo por fases está en `docs/PLAN.md`. Antes de empezar una tarea, leé la fase correspondiente y sus criterios de aceptación.

Los resultados de los spikes y las decisiones medidas están en `docs/decisiones/`. Al cerrar una entrega, actualizá `docs/ESTADO.md`.

## Principio rector

**Ninguna regla está activa si alguien del equipo no la eligió.** Esto vale para reglas de Sonar, reglas propias (Roslyn / ESLint), analyzers del SDK de .NET y reglas recomendadas de typescript-eslint.

## Arquitectura

| Pieza | Rol |
|---|---|
| `Lainco.Analyzers` (Roslyn, C#) | Reglas duras propias para .NET. Se ven en el IDE y se importan en Sonar como issues externos. |
| `@lainco/eslint-plugin` (TypeScript) | Reglas duras propias para TypeScript. Se importan en Sonar vía reporte JSON de ESLint. |
| SonarQube Cloud | Única herramienta de gestión de issues: triage, estados (Aceptado / Falso positivo), quality gate sobre código nuevo. Quality Profile propio, sin herencia de "Sonar way". |
| Suppressor (Roslyn) / Processor (ESLint) | Ocultan en el IDE los issues aceptados en Sonar. Leen `sonar-accepted.json`, sincronizado desde la API de Sonar. **Solo activos en builds locales, nunca en CI.** |
| App de catálogo de reglas | Fuente de verdad sobre qué reglas están activas y con qué severidad. Ciclo de vida: Pendiente de analizar → A revisar → En prueba → Incorporada / Descartada. |
| Registro de hallazgos (fase posterior) | Hallazgos de IA y de revisores, reemitidos como issues externos en cada análisis. |

## Gobernanza

- Solo los revisores tienen permiso para aceptar issues o marcarlos como falso positivo en Sonar.
- **Prohibido** resolver issues con `[SuppressMessage]`, `#pragma warning disable`, `// eslint-disable` o supresiones en `GlobalSuppressions.cs`. Las excepciones las deciden los revisores en Sonar, no el programador en el código.
- El archivo `sonar-accepted.json` no se commitea: es un cache local.

## Convenciones para reglas propias

- IDs: `LAIN###` para Roslyn, `lainco/<nombre-kebab>` para ESLint. **Un ID nunca se reutiliza**, aunque la regla se elimine (Sonar lo usa para reconocer issues entre corridas).
- Severidad por defecto: `warning`. Nunca `error` en el descriptor: el que bloquea es el quality gate, y el suppressor necesita poder actuar.
- **El mensaje de cada diagnóstico debe incluir el nombre completamente calificado del símbolo afectado** (ej.: `Método estático 'Lainco.Dico.Contenedor.Calcular' no permitido`). Es lo que permite reconocer un issue aceptado aunque cambie de línea. No incluir números de línea ni datos variables en el mensaje.
- Cada regla lleva: analyzer, tests positivos y negativos, y documentación en `docs/rules/<ID>.md` referenciada desde `helpLinkUri`.
- Analyzers Roslyn: target `netstandard2.0`, mantener `AnalyzerReleases.Shipped.md` / `AnalyzerReleases.Unshipped.md` al día.
- Tests Roslyn con `Microsoft.CodeAnalysis.Testing` (`CSharpAnalyzerVerifier`).

## Catálogo actual de reglas duras

| ID | Regla |
|---|---|
| LAIN001 | El constructor sin parámetros debe ser `protected`, salvo que sea el único constructor del tipo. |
| LAIN002 | Un solo constructor con código; todos los demás deben encadenar a él (`: this(...)`). |
| LAIN003 | Cada entidad mapeada en NHibernate debe tener un test que asigne valores a todas sus properties persistidas. |
| LAIN004 | No se permite inicialización inline de properties (`{ get; set; } = valor`). |
| LAIN005 | No se permiten métodos estáticos, salvo operators. Las excepciones se aceptan en Sonar. |
| LAIN006 | No se permite `ToList()` sobre queries a base de datos (receptor `IQueryable` o abstracciones de query propias). |

## Forma de trabajo

- Hay dos líneas de trabajo paralelas (ver `docs/PLAN.md`): motores de reglas (fases 1–5 y 7) e inventario de reglas (Fase 6, detallada en `docs/FASE-6.md`). Dentro de cada línea, trabajar una fase o entrega por vez, en orden, sin adelantar trabajo de las siguientes.
- Ante una decisión marcada como pendiente en el plan, **preguntar** en lugar de asumir.
- Cada regla nueva se desarrolla con los tests primero.
- Escribir código, comentarios y documentación en español; nombres de tipos y miembros según las convenciones de cada lenguaje.
