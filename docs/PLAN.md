# Plan de trabajo — Lainco Quality

Cada fase tiene un objetivo, tareas, criterios de aceptación y un prompt sugerido para arrancarla en Claude Code. Las fases están ordenadas para validar el circuito completo lo antes posible y dejar lo más costoso para cuando la base esté probada.

## Dos líneas de trabajo en paralelo

| Línea | Fases | Qué entrega |
|---|---|---|
| **Motores de reglas** | 1 → 2 → 3 → 4 → 5 → 7 | Reglas propias (Roslyn, ESLint, IA) funcionando en IDE, CI y Sonar. |
| **Inventario de reglas** | 6 (entregas 6.1 a 6.6) | Catálogo de todas las reglas y gestión de su estado. |

Ambas arrancan después de la Fase 0. El inventario empieza con las reglas de Sonar (entrega 6.1) mientras se construyen las reglas propias, y va incorporando los demás orígenes a medida que la otra línea avanza. Mientras tanto, los Quality Profiles vacíos garantizan que ninguna regla de Sonar afecte el quality gate hasta que el equipo la incorpore.

Detalle de las fases 6 y 7 en `docs/FASE-6.md` y `docs/FASE-7.md`. Stack y arquitectura de la app de catálogo en `docs/FASE-6-APP.md`.

---

## Decisiones pendientes

Resolver antes de la fase indicada. Claude Code debe preguntar si alguna sigue abierta.

| # | Decisión | Opciones | Necesaria para | Estado |
|---|---|---|---|---|
| D1 | Plataforma de CI | GitHub Actions / Azure Pipelines | Fase 2 | **Resuelta (2026-09-23): GitHub Actions** |
| D2 | Estilo de mapeo NHibernate | Fluent NHibernate (`ClassMap<T>`) / Mapping by code (`ClassMapping<T>`) / `.hbm.xml` | Fase 3 (LAIN003) | **Resuelta (2026-09-23): Fluent NHibernate (`ClassMap<T>`)** |
| D3 | LAIN002: ¿el constructor `protected` sin parámetros (para proxies de NHibernate) queda exceptuado de encadenar? | Exceptuado / Debe encadenar | Fase 3 | Abierta |
| D4 | LAIN002: ¿el encadenamiento puede ser transitivo (A → B → C) o debe ser directo al constructor con código? | Transitivo / Directo | Fase 3 | Abierta |
| D5 | LAIN005: ¿extension methods y `Main` se exceptúan en la regla o pasan por aceptación en Sonar? | Exceptuados / Aceptación manual | Fase 3 | Abierta |
| D6 | LAIN006: tipos que cuentan como "query a base" además de `IQueryable<T>` (abstracciones de repositorio propias, `IQueryOver`, etc.) | Lista de tipos | Fase 3 | Abierta |
| D7 | Feed privado para paquetes NuGet / npm | GitHub Packages / Azure Artifacts / otro | Fase 1 | **Resuelta (2026-09-23): NuGet en GitHub Packages; npm en npmjs.com (scope `@lainco`)** |
| D8 | Stack de la app de catálogo | A definir | Fase 6 (entrega 6.1, en paralelo con Fase 1) | **Resuelta (2026-09-23): Next.js + TypeScript + Neon Postgres en Vercel. Diseño en `docs/FASE-6-APP.md`** |

---

## Estructura del repositorio

```
lainco-quality/
├── CLAUDE.md
├── docs/
│   ├── PLAN.md
│   └── rules/                      # Una página por regla (LAIN001.md, ...)
├── src/
│   ├── dotnet/
│   │   ├── Lainco.Analyzers/               # Analyzers (netstandard2.0)
│   │   ├── Lainco.Analyzers.Suppressor/    # DiagnosticSuppressor (fase 4)
│   │   ├── Lainco.Analyzers.Package/       # Empaquetado NuGet + buildTransitive
│   │   └── Lainco.Analyzers.Tests/
│   └── ts/
│       ├── eslint-plugin/          # @lainco/eslint-plugin (fase 5)
│       └── eslint-config/          # @lainco/eslint-config (fase 5)
├── tools/
│   └── sonar-sync/                 # Descarga de issues aceptados (fase 4)
├── ci-templates/                   # Pipelines reutilizables
├── samples/
│   └── SampleSolution/             # Solución de prueba con violaciones conocidas
└── app/                            # App de catálogo de reglas (fase 6)
```

---

## Fase 0 — Setup

**Objetivo:** repositorio listo y decisiones D1 y D7 tomadas.

**Tareas**
1. Crear la estructura de carpetas y la solución .NET.
2. Crear `samples/SampleSolution`: una solución chica con un proyecto de dominio, uno de mapeos NHibernate y uno de tests, que contenga **a propósito** al menos una violación de cada regla. Sirve para probar el circuito de punta a punta en todas las fases.
3. Configurar `.gitignore` (incluir `sonar-accepted.json`).
4. En SonarQube Cloud: crear la organización y los Quality Profiles de C# y TypeScript **vacíos y sin herencia**. Son el punto de partida del inventario (Fase 6) y del circuito (Fase 2).

**Criterio de aceptación:** la solución compila, la sample tiene violaciones documentadas en su README y los perfiles vacíos existen en Sonar.

**Prompt sugerido**
> Leé CLAUDE.md y docs/PLAN.md. Arrancamos la Fase 0. Creá la estructura del repositorio y la solución de ejemplo con violaciones intencionales de LAIN001 a LAIN006. Antes de crear el proyecto de mapeos, preguntame la decisión D2.

---

## Fase 1 — Primera regla y empaquetado

**Objetivo:** una regla simple (LAIN004) funcionando en el IDE, distribuida como paquete NuGet.

**Tareas**
1. Proyecto `Lainco.Analyzers` (netstandard2.0), con release tracking.
2. Implementar LAIN004 (inicialización inline de properties) con tests positivos y negativos.
3. Documentación `docs/rules/LAIN004.md` y `helpLinkUri`.
4. Proyecto de empaquetado que genere el NuGet con:
   - los analyzers en `analyzers/dotnet/cs`,
   - un `.globalconfig` en `buildTransitive` con las severidades de las reglas (por ahora escrito a mano; en la fase 6 lo generará la app).
5. Publicar en el feed privado (D7).
6. Referenciar el paquete desde `samples/SampleSolution` vía `Directory.Build.props`.

**Criterios de aceptación**
- Los tests pasan.
- Abriendo la sample en Visual Studio o Rider, la violación de LAIN004 aparece como warning con el mensaje que incluye el símbolo completo.
- Cambiar la severidad en el `.globalconfig` del paquete cambia lo que se ve en la sample.

**Prompt sugerido**
> Fase 1. Implementá LAIN004 con tests primero, siguiendo las convenciones de CLAUDE.md. Después armá el proyecto de empaquetado con el .globalconfig en buildTransitive y referencialo desde la sample.

---

## Fase 2 — Circuito con SonarQube Cloud (validación crítica)

**Objetivo:** probar de punta a punta que los issues de las reglas propias llegan a Sonar y se gestionan. **Es la fase que valida toda la arquitectura: no avanzar si algo falla acá.**

**Tareas**
1. En SonarQube Cloud: crear el proyecto para la sample, asignarle el Quality Profile de C# vacío creado en la Fase 0, y crear un Quality Gate que falle con issues nuevos.
2. Pipeline de CI (D1) con `dotnet sonarscanner begin` → `dotnet build` → `dotnet sonarscanner end`, en push a la rama principal y en PRs.
3. Desactivar los analyzers del SDK (`<EnableNETAnalyzers>false</EnableNETAnalyzers>`) y cualquier otro paquete de analyzers, para que solo lleguen a Sonar las reglas LAIN.
4. **Spike de proyectos de test:** crear una regla trivial temporal que dispare dentro del proyecto de tests de la sample y verificar si Sonar la importa. El resultado define el diseño de LAIN003. Documentar el resultado en `docs/decisiones/spike-issues-en-tests.md`.
5. Verificar la persistencia: aceptar un issue en Sonar, mover el código de línea, reanalizar y confirmar que sigue aceptado.

**Criterios de aceptación**
- El issue de LAIN004 aparece en Sonar como issue externo.
- El PR con una violación nueva hace fallar el quality gate.
- Un issue aceptado sigue aceptado después de moverse de línea.
- No aparece ningún issue que no sea LAIN.
- Spike de tests resuelto y documentado.

**Prompt sugerido**
> Fase 2. Armá el pipeline de CI para la sample con el SonarScanner for .NET. Guiame paso a paso con lo que tengo que configurar a mano en SonarQube Cloud. Después hacemos el spike de issues en proyectos de test.

---

## Fase 3 — Reglas restantes

**Objetivo:** completar LAIN001 a LAIN006. Orden sugerido de menor a mayor complejidad.

| Orden | Regla | Notas |
|---|---|---|
| 1 | LAIN005 | Sintáctica. Resolver D5. |
| 2 | LAIN001 | Análisis de constructores del tipo. |
| 3 | LAIN002 | Resolver D3 y D4. Detectar ciclos de encadenamiento. |
| 4 | LAIN006 | Requiere modelo semántico. Resolver D6. `ToList()` sobre `IQueryable` resuelve a `Enumerable.ToList`: hay que mirar el tipo del receptor, no el método. |
| 5 | LAIN003 | Depende de D2 y del spike de la fase 2. Análisis a nivel compilación (`CompilationStartAction` / `CompilationEndAction`). Solo se ve en el IDE con análisis de solución completa. |

**Criterios de aceptación (por regla):** tests positivos y negativos, documentación, violación de la sample detectada en IDE y en Sonar.

**Prompt sugerido**
> Fase 3, regla LAIN005. Preguntame lo que haga falta de las decisiones pendientes, escribí los tests y después el analyzer.

---

## Fase 4 — Ocultar en el IDE los issues aceptados en Sonar

**Objetivo:** que el IDE no muestre issues que los revisores ya aceptaron.

**Tareas**
1. `tools/sonar-sync`: herramienta de línea de comandos que consulta la Web API de SonarQube Cloud por los issues de reglas externas LAIN en estado Aceptado o Falso positivo, y genera `sonar-accepted.json` con archivo (ruta relativa), regla y mensaje. Paginación, token personal de solo lectura por variable de entorno.
2. Target de MSBuild que corre `sonar-sync` antes del build **solo en builds locales**, con cache (refrescar si el archivo tiene más de N horas; N configurable). Si falla la API, el build sigue sin error.
3. `Lainco.Analyzers.Suppressor`: `DiagnosticSuppressor` que lee `sonar-accepted.json` vía `AdditionalFiles` y suprime los diagnósticos que coinciden en archivo + regla + mensaje.
4. El suppressor se activa con una propiedad de build (`LaincoSuppressAccepted`) expuesta con `CompilerVisibleProperty`, que en CI vale `false`.

**Criterios de aceptación**
- Aceptar un issue en Sonar y refrescar hace que desaparezca del IDE.
- En CI el issue sigue llegando a Sonar y sigue figurando como aceptado.
- Sin token o sin red, el build local funciona igual.

---

## Fase 5 — TypeScript

**Objetivo:** replicar el circuito para TypeScript.

**Tareas**
1. `@lainco/eslint-plugin` con typescript-eslint (`RuleCreator`, `parserServices` para reglas con tipos). Misma convención de mensajes con símbolo completo.
2. `@lainco/eslint-config`: configuración compartida (flat config) que activa solo las reglas elegidas. Sin `recommended` de ESLint ni de typescript-eslint.
3. Processor con `postprocess()` que filtra los mensajes según `sonar-accepted.json`, activo solo en local.
4. Pipeline: `eslint -f json -o eslint-report.json` + `sonar.eslint.reportPaths`. Quality Profile de TypeScript vacío en Sonar.
5. Verificar cómo convive con el scanner de .NET si hay repos mixtos.

**Criterio de aceptación:** mismos criterios que las fases 2 y 4, para TypeScript.

---

## Fase 6 — Inventario y catálogo de reglas (línea paralela)

**Objetivo:** inventario de todas las reglas disponibles (Sonar, Roslyn, ESLint, normas de IA) con su ciclo de vida: Pendiente de analizar → A revisar → En prueba → Incorporada / Descartada. La app es la fuente de verdad de qué reglas están activas.

**Detalle completo en `docs/FASE-6.md`.**

| Entrega | Contenido | Depende de |
|---|---|---|
| 6.1 | Inventario de Sonar: sincronización, estados, historial, triage masivo | Fase 0 — **arranca en paralelo con la Fase 1** |
| 6.2 | Publicación al Quality Profile y detección de desvíos | 6.1 |
| 6.3 | Pre-clasificación por IA y relaciones entre reglas | 6.1 |
| 6.4 | Reglas propias Roslyn / ESLint en el inventario | 6.2, Fases 3 y 5 |
| 6.5 | Estado "En prueba" con job de CI | 6.2, Fase 2 |
| 6.6 | Normas de IA como cuarto origen | 6.4, Fase 7 |

**Prompt sugerido**
> Fase 6, entrega 6.1. Leé docs/FASE-6.md. Antes de escribir código, proponeme el stack y el diseño de la app, y resolvamos D8 y D6.1.

---

## Fase 7 — Registro de hallazgos de IA y revisores (posterior)

Se detalla cuando las fases anteriores estén en producción. Resumen del diseño acordado:

- Catálogo cerrado de normas de diseño con ID; la IA solo reporta contra ese catálogo.
- Mensajes con plantilla fija (norma + símbolo); la explicación de la IA va como comentario en el PR.
- Cache de hallazgos por hash de archivo + versión de normas, para reemitir sin volver a consultar la IA.
- Comando en comentario de PR (`/sonar <ID>`) para que un revisor registre un hallazgo; solo usuarios con rol de revisor.
- Registro fuera del código; en cada análisis se genera un reporte de issues externos (SARIF o formato genérico de Sonar).
- Cierre explícito (`/sonar-resolve`) o por reverificación cuando cambia el símbolo.

---

## Fase 8 — Warnings del compilador y analyzers del SDK (posterior)

**Objetivo:** extender el principio rector a los diagnósticos que hoy no gobierna nadie.

### El problema

La arquitectura gobierna cuatro orígenes de reglas (Sonar, Roslyn propias, ESLint,
normas de IA), pero deja afuera dos que igual le aparecen al programador en el IDE y en
el build:

| Origen | Ejemplo | Situación actual |
|---|---|---|
| **Warnings del compilador de C#** (`CS####`) | `CS1591`: falta el comentario XML en un miembro público. | Sin gobierno. Cada repo lo resuelve como puede. |
| **Analyzers del SDK de .NET** (`CA####`, `IDE####`) | `CA1822`: el método puede ser estático. | La Fase 2 los apaga en bloque con `EnableNETAnalyzers=false`, para que a Sonar solo lleguen reglas LAIN. Es una medida gruesa y temporal. |

El síntoma concreto que motivó esta fase: en los `DataContract`, `CS1591` pide un
comentario XML por cada property, y hoy se silencia **poniendo un comentario vacío** en
cada una. Eso es exactamente lo que la sección "Gobernanza" de `CLAUDE.md` prohíbe para
los issues de Sonar — una supresión desparramada por el código, decidida caso por caso
por el programador — solo que disfrazada de documentación.

El principio es el mismo que para las reglas: **ningún warning está encendido o apagado
si el equipo no lo decidió, y la decisión vive en un solo lugar.**

### Mecanismo

No hace falta inventar nada: el vehículo ya existe desde la Fase 1. El paquete
`Lainco.Analyzers` distribuye un `.globalconfig` en `buildTransitive`, y ese archivo
también configura diagnósticos del compilador.

**Verificado (2026-09-28)** sobre un proyecto con `GenerateDocumentationFile=true` y un
`DataContract` sin comentarios:

```
# lainco.globalconfig
is_global = true
dotnet_diagnostic.CS1591.severity = none
```

- Las advertencias `CS1591` desaparecen.
- El archivo `.xml` de documentación **se sigue generando**, así que los miembros que sí
  tienen comentario conservan su IntelliSense. Es la diferencia con apagar
  `GenerateDocumentationFile`, que los perdería todos.

Los comentarios vacíos se borran: dejan de hacer falta.

### Tareas

1. **Inventariar** los `CS####` y `CA####`/`IDE####` que hoy aparecen en los
   repositorios reales, con su frecuencia. Sin ese dato, la decisión se toma a ciegas.
2. **Incorporarlos como quinto origen** del inventario de la Fase 6, con el mismo ciclo
   de vida (ver `docs/FASE-6.md`, sección 2).
3. **Generar las severidades** en el mismo `.globalconfig` que ya produce la app.
4. **Reemplazar `EnableNETAnalyzers=false`** por la lista explícita de analyzers del SDK
   que el equipo haya incorporado.
5. **Limpiar los comentarios XML vacíos** de los `DataContract` una vez que `CS1591`
   quede decidido.

### Consecuencia de incorporar los analyzers del SDK (D8.3)

El SDK de .NET trae varios cientos de reglas `CA####` e `IDE####`, que se suman a las
460+ de Sonar para C#. Dos efectos a tener en cuenta:

- **Volumen de triage.** Las herramientas de la sección 5 de `docs/FASE-6.md` (descarte
  masivo por tag, vistas guardadas, pre-clasificación por IA) pasan a ser todavía más
  necesarias. Conviene triagearlos después de las reglas de Sonar, no en paralelo.
- **Solapamiento entre orígenes.** Muchas reglas `CA` dicen lo mismo que una regla de
  Sonar, y a veces las dos chocan con una regla propia. El caso testigo: `CA1822` y
  `csharpsquid:S2325` piden ambas convertir en estáticos los métodos que no usan datos
  de instancia, y las dos contradicen LAIN005.

  Esto vuelve **crítico** el mecanismo de relaciones entre reglas (sección 7 de
  `docs/FASE-6.md`): sin él, la misma observación llegaría por tres caminos distintos y
  el equipo decidiría tres veces sobre lo mismo. La pre-clasificación por IA de la
  entrega 6.3 tiene que poder detectar equivalencias **cruzando orígenes**, no solo
  dentro de cada uno.

### Diferencias con los otros orígenes

- **No pasan por SonarQube.** Los warnings del compilador no se importan como issues de
  Sonar, así que no afectan el quality gate ni tienen estados de aceptación. El ciclo de
  vida se reduce a decidir la severidad, y el único destino de publicación es el
  `.globalconfig`. Tampoco les aplica el suppressor de la Fase 4.
- **Algunos no son configurables.** Ciertos diagnósticos del compilador son errores o
  están marcados como no configurables, y no se pueden ajustar por `.globalconfig`.
  El inventario tiene que distinguirlos, igual que hoy distingue las reglas de Sonar
  "no probables localmente".
- **Ojo con `TreatWarningsAsErrors`.** Si un repo lo tiene activo, una severidad
  `warning` rompe el build. Conviene relevarlo en la tarea 1.

### Decisiones pendientes

| # | Decisión | Opciones | Estado |
|---|---|---|---|
| D8.1 | ¿`CS1591` se apaga en todos lados o solo donde están los DTO? | Global (`.globalconfig` del paquete) / por ruta (`.editorconfig` con secciones, que el `.globalconfig` no permite). | **Resuelta (2026-09-28): en todos lados.** Va en el `.globalconfig` del paquete, que es el mecanismo que ya existe. No hace falta `.editorconfig` por ruta. |
| D8.2 | ¿El equipo quiere documentación XML en algún assembly? | Apagar solo la advertencia (`CS1591`) / apagar además `GenerateDocumentationFile`. | **Abierta a propósito.** Se deja como duda a futuro: por ahora se apaga solo la advertencia, que es reversible y conserva el `.xml` para los miembros que sí tienen comentario. Revisar si alguna vez se publica un assembly para consumo externo. |
| D8.3 | ¿Los analyzers del SDK (`CA####`, `IDE####`) entran al inventario o se dejan apagados? | Entran como origen / quedan fuera del alcance. | **Resuelta (2026-09-28): entran al inventario**, con el mismo ciclo de vida que el resto. `EnableNETAnalyzers=false` de la Fase 2 queda como medida temporal hasta que estén triageados. |
