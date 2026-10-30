# D8 — Stack y arquitectura de la app de catálogo

Resuelve la decisión D8 de `docs/PLAN.md` y define cómo se construye la app descrita en `docs/FASE-6.md`.

Fecha: 2026-09-23.

---

## 1. Decisión

**TypeScript de punta a punta, en un único proyecto Next.js (App Router) desplegado en Vercel, con Postgres gestionado.**

| Pieza | Elección | Por qué |
|---|---|---|
| Framework | Next.js 16 (App Router) | Un solo proyecto para el front React y el back Node. Server Components para las vistas de lectura, Route Handlers para la API que consumen los jobs de CI. |
| Lenguaje | TypeScript | Decisión del equipo. El mismo lenguaje que `@lainco/eslint-plugin` de la Fase 5. |
| Base de datos | Neon Postgres, vía Vercel Marketplace | Relacional: el modelo de la sección 11 de `FASE-6.md` es relacional y auditado. El Marketplace aprovisiona y inyecta las variables de entorno solo. |
| Acceso a datos | Drizzle ORM + drizzle-kit | Migraciones versionadas en el repo, tipado derivado del esquema, SQL explícito cuando hace falta (el triage necesita consultas con muchos filtros). |
| UI | Tailwind CSS + shadcn/ui + TanStack Table | El corazón de la app es una tabla densa de cientos de filas con filtros, selección múltiple y acciones masivas. |
| Validación | Zod | Un solo esquema sirve para validar el request de la API, el formulario y la salida estructurada de la IA (entrega 6.3). |
| Autenticación | Auth.js (NextAuth v5) con Google Workspace + GitHub | Ver sección 5. |
| IA (entrega 6.3) | AI SDK vía Vercel AI Gateway, con `generateObject` + esquema Zod | `generateObject` obliga la salida estructurada que pide la sección 6 de `FASE-6.md`. El Gateway permite cambiar de modelo sin tocar código (decisión D6.3 / D7.1). |
| Jobs periódicos | Vercel Cron | Sincronización diaria con Sonar y job de reconciliación. |

**Lo que se descartó y por qué**

- *Backend .NET separado*: el resto del repo es C#, pero la app no comparte nada con los analyzers — habla con APIs HTTP y con su propia base. Un segundo stack es más superficie para mantener sin beneficio.
- *Supabase*: trae auth, realtime y storage que acá no se usan. Con Neon + Auth.js hay menos piezas.
- *Vercel Queues para la publicación a Sonar*: ver sección 4; una tabla `publicacion` como outbox es más simple de inspeccionar y ya está en el modelo de datos.

---

## 2. Arquitectura

```
                      ┌──────────────── Vercel ────────────────┐
                      │                                        │
  Navegador ─────────►│  Next.js App Router                    │
  (equipo Lainco)     │   ├─ UI React (inventario, triage,      │
                      │   │   historial, tablero)               │
                      │   ├─ Server Actions (transiciones)      │
                      │   └─ Route Handlers (/api/...)          │
                      │            │                            │
  GitHub Actions ────►│────────────┤  (token de servicio)       │
  (job de prueba 6.5) │            │                            │
                      │   Vercel Cron                           │
                      │   ├─ sincronizar-sonar   (diario)       │
                      │   ├─ publicar-sonar      (diario)       │
                      │   └─ reconciliar-sonar   (diario)       │
                      │            │                            │
                      └────────────┼────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┬──────────────────┐
              ▼                    ▼                    ▼                  ▼
        Neon Postgres      SonarQube Cloud API     GitHub API        AI Gateway
        (inventario,        (reglas, quality        (PRs de          (pre-clasificación,
         decisiones)         profiles)               configuración)    entrega 6.3)
```

**Regla de diseño:** todo cambio de estado pasa por una única función de dominio (`aplicarTransicion`) que valida la transición, el rol y la justificación, y escribe `estadoRegla` + `decision` en la misma transacción. Ni la UI ni la API escriben el estado por su cuenta.

---

## 3. Modelo de datos

Traducción del modelo de la sección 11 de `FASE-6.md` a tablas de Postgres. Nombres en español y en **camelCase** (tablas, columnas, claves, índices y restricciones), igual que en TypeScript.

**Conjuntos cerrados de valores** (estado, origen, lenguaje, rol, estado de sincronización): **tablas de referencia** con `codigo` fijo (el que usa el programa, definido en `src/dominio/valores.ts`), `descripcion` (el texto para el usuario) y `orden`. Las columnas que los usan son claves foráneas a `codigo`. Se prefirieron a los enums de Postgres porque permiten un texto para mostrar distinto del código y cambiarlo sin tocar el esquema. (Resuelto el 2026-10-15.)

| Tabla | Notas de implementación |
|---|---|
| `regla` | Clave natural `(origen, clave)` con índice único. `tags` como `text[]` (con índice GIN, para filtrar con `@>`) y `parametros` como `jsonb`. `hash_descripcion` en `text`. |
| `estadoRegla` | Fila por regla (relación 1:1). Estado actual, severidad asignada, valores de parámetros. Es la tabla que consulta el generador de configuración. |
| `decision` | **Append-only.** Nunca se actualiza ni se borra: es el historial. `lote_id` agrupa las operaciones masivas. |
| `sugerenciaIa` | Clave de cache `(regla_id, hash_descripcion, version_normas, version_evaluador)`. |
| `relacion` | Bidireccional. Se guarda una fila y se consulta en ambos sentidos; `check (regla_a_id <> regla_b_id)` y único sobre el par normalizado. |
| `corridaPrueba`, `resultadoPrueba`, `muestraPrueba` | Entrega 6.5. |
| `sincronizacion` | Log de cada corrida del job: fecha, origen, contadores. |
| `aviso` | Lo que la sincronización detectó y obliga a revisar una decisión (FASE-6.md, sección 3). Agregada en el paso 6. |
| `publicacion` | Outbox: destino, payload, estado, intentos, último error. |
| `usuario` | Identidad + rol (`analista` / `decisor`). Ver sección 5. |
| `vistaGuardada` | Nombre, usuario, filtros como `jsonb`, indicador de compartida. |

**Índices que importan para el triage:** `estadoRegla(estado)`, `regla(lenguaje, tipo)`, y un índice GIN sobre `regla.tags` para el descarte masivo por tag, que es la primera operación del triage inicial.

**Máquina de estados:** la tabla de transiciones permitidas de la sección 4 de `FASE-6.md` se codifica como una constante en TypeScript, no en la base. Cada entrada declara si exige justificación, si exige rol decisor y si admite operación masiva. Los tests recorren la tabla entera, incluyendo las transiciones prohibidas (en particular `Pendiente de analizar → Incorporada`, que debe fallar siempre).

---

## 4. Jobs y procesos de fondo

| Job | Disparo | Qué hace |
|---|---|---|
| `sincronizar-sonar` | Cron diario (D6.6) + botón en la app | Pagina `api/rules/search` por lenguaje, compara con lo almacenado, crea / actualiza / marca deprecadas, escribe una fila en `sincronizacion`. |
| `publicar-sonar` | Enseguida después de cada decisión + cron diario de reintento + botón (decisión P2 de la entrega 6.2) | Toma filas pendientes de `publicacion` y llama a `activate_rule` / `deactivate_rule`. Reintentos con retroceso exponencial; tras N fallos queda en `fallida` y aparece como alerta en la app. |
| `reconciliar-sonar` | Cron diario + botón | Compara el Quality Profile real contra `estadoRegla` y genera alertas de desvío (sección 10 de `FASE-6.md`). |

La sincronización de ~500 reglas entra holgada en el límite de 300 s de una función de Vercel. Si al implementarla resultara ajustada, se parte por lenguaje en dos invocaciones.

**Por qué outbox y no cola:** la publicación a Sonar debe ser inspeccionable y reintentable a mano desde la UI, y `publicacion` ya estaba en el modelo de datos como registro del resultado. Una tabla que ya existe hace de cola sin agregar un servicio más.

---

## 5. Autenticación y roles

**Auth.js (NextAuth v5)** con dos proveedores:

- **Google** — restringido al dominio de Google Workspace de Lainco, validando el `hd` del perfil en el callback de `signIn`. Es el camino normal: el equipo ya tiene esa identidad.
- **GitHub** — para que las cuentas que operan contra GitHub Packages y los PRs de configuración puedan entrar con la misma identidad que usan en los repos. **Solo entran usuarios ya dados de alta** en la tabla `usuario` (resuelto el 2026-10-15): un decisor carga el usuario de GitHub; sin eso, el login se rechaza. A diferencia de Google, GitHub no tiene un dominio que acote quién es de Lainco.

Quien entra con Google por primera vez se da de alta como analista (confirmado el 2026-10-16). Hasta que haya una pantalla de usuarios, el alta de usuarios de GitHub, los cambios de rol y las bajas se hacen por SQL (`app/README.md`, "Ingreso y roles"); el registro de cambios de rol como decisión queda para esa pantalla.

**Los roles viven en la tabla `usuario` de la app, no en el proveedor de identidad.** El proveedor solo dice *quién sos*; la app dice *qué podés hacer*. Esto:

- resuelve **D6.1** sin depender de la estructura de equipos de GitHub ni de grupos de Google;
- deja el cambio de rol registrado como una decisión más, con autor y fecha;
- evita que agregar a alguien a un equipo de GitHub le dé, de rebote, permiso para tocar el quality gate.

Los decisores iniciales (D6.1, resuelta el 2026-10-15) se cargan por seed: Federico Sánchez y Pablo Revert.

**Tokens de servicio** (para el job de prueba de 6.5 y el CI): tabla aparte de tokens con hash, alcance y fecha de expiración. No entran por Auth.js; se validan en el Route Handler.

---

## 6. Integraciones externas

| Integración | Credencial | Provisión |
|---|---|---|
| Neon Postgres | `DATABASE_URL` | `vercel integration add neon` — inyecta las variables solo. |
| SonarQube Cloud | Token con permiso de administrar Quality Profiles | Variable de entorno del proyecto de Vercel. |
| GitHub | Token con permiso de crear ramas y PRs en `lainco-quality` | Entrega 6.4. |
| Proveedor de IA | AI Gateway | Entrega 6.3. |

Ninguna se commitea. Todas se manejan con `vercel env` (ver la guía `vercel:env-vars`).

---

## 7. Estructura del proyecto

Dentro de `app/` en la raíz del repo, tal como lo previó `docs/PLAN.md`:

```
app/
├── src/
│   ├── app/
│   │   ├── (app)/                 # UI autenticada
│   │   │   ├── reglas/            # Inventario y triage
│   │   │   ├── reglas/[id]/       # Detalle e historial
│   │   │   └── tablero/           # Progreso
│   │   └── api/
│   │       ├── cron/              # sincronizar-sonar, publicaciones, reconciliar
│   │       └── ci/                # Ingesta de resultados del job de prueba (6.5)
│   ├── dominio/                   # Máquina de estados, reglas de negocio. Sin I/O.
│   ├── db/                        # Esquema Drizzle, migraciones, consultas
│   ├── sonar/                     # Cliente de la Web API
│   └── ui/                        # Componentes
├── drizzle/                       # Migraciones generadas
└── tests/
```

`src/dominio/` no importa nada de la base ni de la red: es lo que se testea primero y sin infraestructura.

---

## 8. Plan de implementación de la entrega 6.1

En orden. Cada paso es verificable antes de pasar al siguiente.

| # | Paso | Se verifica con |
|---|---|---|
| 1 | Scaffold de Next.js, `vercel link`, `vercel integration add neon`, `vercel env pull` | La app levanta en local y se conecta a la base. |
| 2 | Esquema Drizzle y primera migración | `drizzle-kit migrate` crea las tablas; seed de los decisores. **Hecho (2026-10-15)**: migraciones versionadas con `generate` + `migrate` en lugar de `push`, por la regla de "migraciones versionadas en el repo" de la sección 1; seed y valores de referencia como migraciones escritas a mano. Solo las tablas de 6.1; las demás, con su entrega. Nombres en camelCase y tablas de referencia en lugar de enums. |
| 3 | Máquina de estados en `src/dominio/`, con tests primero | Tests que recorren toda la tabla de transiciones, permitidas y prohibidas. **Hecho (2026-10-16)**: `src/dominio/transiciones.ts`, 85 tests con Vitest. Masivas: toda transición salvo hacia Incorporada, configurable por fila. En prueba → Incorporada sin chequeo de resultados hasta 6.5. |
| 4 | Auth.js con Google (dominio restringido) + GitHub, y roles | Un usuario fuera del dominio no entra; un analista no ve las acciones de decisor. **Hecho (2026-10-16)**: Auth.js 5 (beta) con sesión JWT; el rol se lee de `usuario` en cada pedido. Quién entra, en `src/dominio/acceso.ts`; qué acciones ve cada rol, con `transicionesDisponibles` sobre la misma tabla de transiciones. Google: dominio y email verificados; los nuevos entran como analistas. GitHub: solo dados de alta. El alta de usuarios de GitHub y los cambios de rol, por SQL hasta que haya pantalla de usuarios. |
| 5 | Cliente de la Web API de Sonar, con paginación | Test contra respuestas grabadas. **Hecho (2026-10-16)**: `src/sonar/cliente.ts`. Tests sobre respuestas armadas a mano (errores, reintentos, paginación inconsistente) y sobre respuestas reales de SonarQube Cloud grabadas con `npm run sonar:grabar`: 515 reglas de `cs` y 608 de `ts`. La grabación mostró que SonarQube Cloud pagina con `total`/`p`/`ps` (no con `paging`) y sigue mandando `htmlDesc`. El cliente falla si no puede traer la lista completa y consistente. Token: `LAINCO_SONAR_TOKEN`, la misma variable de `tools/sonar-sync`. |
| 6 | Job `sincronizar-sonar` + endpoint de cron + botón a demanda | Primera corrida carga todas las reglas de `cs` y `ts` en Pendiente; la segunda no cambia nada. **Hecho (2026-10-16)**: verificado con la grabación real (515 + 608 reglas) en tests contra Postgres y de punta a punta con el cron y el botón. Qué cambió lo decide `src/dominio/sincronizacion.ts`; los cambios de una corrida van en una transacción con lock, así el cron y el botón no se pisan. Se agregó la tabla `aviso` (decisión del 2026-10-16) para las reglas Incorporadas o En prueba que cambian en Sonar y las Incorporadas que Sonar depreca o elimina; mostrarlos queda para los pasos de UI. Cron diario a las 9:00 UTC (D6.6 sigue abierta). |
| 7 | API de transiciones (individual y masiva) sobre la función de dominio | Un intento de incorporación masiva se rechaza. **Hecho (2026-10-19)**: `src/transiciones/aplicarTransicion.ts` y dos Route Handlers (`POST /api/reglas/{id}/transicion`, `POST /api/reglas/transiciones`), validados con Zod. Todo o nada, con bloqueo de filas y verificación del estado que vio el usuario. Una masiva lo es aunque tenga una regla. Severidades de Sonar: `BLOCKER` a `INFO`. Verificado de punta a punta: un decisor que intenta incorporar en masa recibe 422; un analista descarta en un lote las 71 reglas con tag `react`, con la justificación en cada decisión. |
| 8 | Tabla de inventario: filtros, orden, selección múltiple, acciones masivas | Descarte masivo por tag con justificación común, que queda en cada decisión. **Hecho (2026-10-19)**: `/reglas`. Filtros en la URL (una URL canónica por búsqueda, para las vistas guardadas del paso 9), sin paginar (todas las filtradas, ~1.100 como máximo). La barra de selección ofrece solo los destinos válidos para todas las seleccionadas con el rol del usuario (`destinosMasivos`) y pasa por `aplicarTransicion`. Verificado en el navegador: una analista descarta las 71 reglas pendientes con tag `react` con una justificación, que queda en las 71 decisiones con el mismo lote. |
| 9 | Vistas guardadas | Se guarda y se recupera un conjunto de filtros. **Hecho (2026-10-19)**: en la tabla `vistaGuardada` del paso 2, sin migración nueva. Se guardan los parámetros de la URL y se leen con los mismos filtros, así una vista vieja no rompe. Nombre único por usuario (guardar con el mismo nombre actualiza); compartidas visibles para todos, solo el autor las cambia o borra. |
| 10 | Detalle de regla con historial completo | El historial muestra autor, fecha y justificación de cada decisión. **Hecho (2026-10-19)**: `/reglas/{id}`. Historial con las decisiones (autor, fecha, justificación, severidad, parámetros, tamaño del lote), la llegada al inventario, la deprecación y los avisos. El cambio de estado individual vive acá: es la única forma de incorporar. Descripción de Sonar saneada con `sanitize-html`, en un panel propio, con el código coloreado con `highlight.js`. Arreglo en el cliente de Sonar: las secciones de la descripción se ordenan siempre igual (la API las devuelve en cualquier orden, y eso habría cambiado la huella sin cambios reales); la primera sincronización después del arreglo marca como modificadas unas 670 reglas, por única vez. |
| 11 | Tablero de progreso | Porcentaje triageado por lenguaje y tipo; reglas estancadas hace más de N días. **Hecho (2026-10-19)**: `/tablero`. Triageada es toda regla que salió de Pendiente de analizar (porcentaje redondeado para abajo). Por lenguaje y tipo, con una barra por estado y link a las pendientes en el inventario; reglas en cada estado por origen (FASE-6.md, sección 5); estancadas en A revisar o En prueba hace más de N días (14 por defecto, se cambia en la página), con quién las pasó. |

Al terminar el paso 11 se cumplen los cinco criterios de aceptación de 6.1 en `docs/FASE-6.md`.

---

## 8 bis. Plan de implementación de la entrega 6.2 — Publicación a Sonar

Criterios de aceptación (`FASE-6.md`, sección 13):

- Incorporar una regla la activa en el perfil de Sonar con la severidad elegida; descartarla la desactiva.
- Activar una regla a mano en Sonar genera una alerta de desvío.

### Decisiones (2026-10-19)

| # | Decisión |
|---|---|
| P1 | **Desvíos: la app alerta y un decisor corrige.** La reconciliación no toca Sonar sola: deja una alerta con la diferencia, y un botón la corrige llevando Sonar a lo que dice la app (la app es la fuente de verdad). Nadie pierde un cambio sin enterarse. |
| P2 | **Publicación enseguida, con reintento.** La decisión se guarda y en el mismo pedido, ya respondido, se publica (`after()` de Next). Si Sonar falla, la publicación queda pendiente en `publicacion` (outbox) y la reintenta un cron o un botón. Reemplaza el cron cada 5 minutos de la sección 4, que además no entra en el plan Hobby de Vercel (solo crons diarios). |
| P3 | **Perfiles por variable de entorno.** `SONAR_PERFIL_CS` y `SONAR_PERFIL_TS` dicen el nombre del perfil de cada lenguaje (`Lainco C#` y `Lainco Typescript`). Se prueba contra los perfiles reales. |
| P4 | **Severidad clásica, traducida a impactos al publicar.** SonarQube Cloud deprecó `severity` en `activate_rule` (21/08/2026) y pide `impacts`, una severidad por calidad del software. El decisor sigue eligiendo BLOCKER … INFO; al publicar, la elegida va a cada impacto de la regla con la equivalencia de Sonar (BLOCKER→BLOCKER, CRITICAL→HIGH, MAJOR→MEDIUM, MINOR→LOW, INFO→INFO). Sin migración ni cambios en la pantalla de incorporar. Se descubrió al grabar la API el 2026-10-19. |
| P5 | **"El perfil no es el default" es un desvío.** El 2026-10-19 `Lainco C#` y `Lainco Typescript` no eran default (lo era "Sonar way comprehensive"); el proyecto los usa porque está asociado a mano. Un proyecto nuevo que no se asocie analizaría con Sonar way. Tipo de desvío `perfilNoEsDefault` (migración `0005`). Ese mismo día se marcaron como default en SonarQube Cloud. |

Lo que se mantiene de `FASE-6.md`:

- **Solo Incorporada está activa en Sonar.** En prueba no aparece en Sonar (entrega 6.5), así que publicar es: entrar a Incorporada activa la regla (con la severidad y los parámetros decididos); salir de Incorporada (a Descartada o a En prueba) la desactiva. Una transición que no toca Incorporada no publica nada.
- **La publicación es idempotente.** La fila de `publicacion` dice "llevar esta regla a lo que dice la app"; quien publica lee el estado de la regla al momento de publicar. Si la regla cambió dos veces antes de publicarse, se publica una sola vez, lo último.
- **El token** es `LAINCO_SONAR_TOKEN`. En SonarQube Cloud el token tiene los permisos de su usuario: ese usuario necesita el permiso **Administer Quality Profiles** en la organización.

### Pasos

| # | Paso | Se verifica con |
|---|---|---|
| 1 | Esquema: `publicacion` (outbox: regla, estado, intentos, próximo intento, último error) y `desvio` (tipo, regla si corresponde, detalle, detectado, resuelto). Configuración de los perfiles (P3). | `drizzle-kit migrate` crea las tablas; la configuración rechaza un perfil que falta. **Hecho (2026-10-19)**: migración `0004_publicacion_y_desvios`. La base garantiza una sola publicación pendiente por regla (encolar de nuevo no duplica) y un solo desvío abierto por tipo, lenguaje y clave; toda publicación la pide una decisión o la corrección de un desvío, nunca las dos. El desvío guarda la clave de Sonar además de la regla, porque una regla activada a mano puede no estar en el inventario. Perfiles en `SONAR_PERFIL_CS` y `SONAR_PERFIL_TS`, sin valor por defecto; los lee solo la publicación. |
| 2 | Cliente de Sonar para perfiles: buscar el perfil por nombre (clave, herencia), reglas activas del perfil con severidad y parámetros, proyectos y el perfil que usan; `activate_rule` y `deactivate_rule`. | Tests contra respuestas grabadas de SonarQube Cloud (se amplía `npm run sonar:grabar` con las lecturas). Se confirma cómo toma la severidad SonarQube Cloud (severidad clásica o impactos). **En curso (2026-10-19)**: `src/sonar/perfiles.ts` (lo común con el catálogo pasó a `src/sonar/http.ts`), con tests sobre respuestas armadas. Primera grabación real el 2026-10-19: el token puede administrar el perfil; `severity` está deprecado (decisión P4); `api/components/search` no acepta `qualifiers`; los perfiles gestionados no son default (P5). **Hecho (2026-10-19)** con una segunda grabación, que trae las activaciones reales de "Sonar way comprehensive" (376 reglas de C# y 472 de TypeScript, en varias páginas): cada una con severidad clásica, impactos y, algunas, parámetros. Todas están en el inventario. Ojo para el paso 5: el perfil informa 379 y 496 reglas activas (`activeRuleCount`) y la búsqueda devuelve 376 y 472; la reconciliación compara las dos cuentas y avisa si no coinciden en un perfil gestionado. |
| 3 | Encolar al decidir: `aplicarTransicion` agrega la fila de `publicacion` en la misma transacción, solo al entrar o salir de Incorporada. | Incorporar crea una publicación pendiente; retirar también; un descarte masivo desde Pendiente no crea ninguna; si la transición falla, no queda nada encolado. **Hecho (2026-10-19)**: `src/dominio/publicacion.ts` decide (solo reglas de Sonar, solo al entrar o salir de Incorporada: 4 de las 12 transiciones) y `aplicarTransicion` encola en la misma transacción. Si la regla ya tenía una pendiente, pasa a ser de la nueva decisión y se reintenta enseguida. La API devuelve los ids de las publicaciones pendientes. |
| 4 | Publicar: enseguida después de la decisión, y un cron diario más un botón para reintentar lo pendiente. Reintentos con espera creciente; tras N fallos queda **fallida** y aparece como alerta. | Con un Sonar simulado: incorporar llama a `activate_rule` con la severidad y los parámetros; retirar llama a `deactivate_rule`; con Sonar caído queda pendiente y el reintento la publica. **Hecho (2026-10-19)**: `src/publicacion/publicar.ts`, `after()` en `src/transiciones/aplicarYPublicar.ts` (lo usan la API y las Server Actions), cron `/api/cron/publicar-sonar` a las 10:00 UTC y la acción `publicarPendientesAhora` (su botón va en la pantalla del paso 6). Esperas de 1, 5, 30 y 120 minutos; al quinto intento, fallida; un rechazo de Sonar, fallida enseguida. Verificado también de punta a punta con la app corriendo y un Sonar simulado sobre la grabación real: incorporar `csharpsquid:S107` con CRITICAL y `max=5` mandó `impacts=MAINTAINABILITY=HIGH` y `params=max=5`; retirarla la desactivó; con Sonar caído quedó pendiente y el cron la publicó. |
| 5 | Reconciliación: cron diario más botón. Compara el perfil real con la app y registra desvíos: activa en Sonar sin estar Incorporada, Incorporada e inactiva, severidad (impactos) o parámetros distintos, perfil con herencia, perfil que no es el default (P5), proyecto con otro perfil. Un desvío que desaparece se cierra solo. | Activar una regla a mano en el Sonar simulado genera el desvío; corregirlo lo cierra. **Hecho (2026-10-20)**: la comparación en `src/dominio/reconciliacion.ts` (sin base ni red), la corrida en `src/reconciliacion/reconciliar.ts` con su log en la tabla `reconciliacion` (migración `0006`), cron `/api/cron/reconciliar-sonar` a las 11:00 UTC y acciones `reconciliarAhora` y `corregirDesvioAhora` (sus botones, en el paso 6). Si Sonar falla, la corrida no toca los desvíos. Una regla con la publicación en camino no es desvío. Corregir encola una publicación ligada al desvío; toda publicación exitosa cierra los desvíos de su regla. Los desvíos del perfil y de los proyectos se corrigen en SonarQube. Verificado también de punta a punta con la app corriendo y un Sonar simulado: la primera corrida marcó las 43 reglas incorporadas antes de publicar como "Incorporada e inactiva"; activar `csharparchitecture:S7788` a mano generó el desvío, y desactivarla lo cerró en la corrida siguiente. |
| 6 | Pantalla: estado de publicación en el detalle y en el inventario; lista de desvíos con **Corregir** (decisor, P1) y de publicaciones fallidas con **Reintentar**; aviso en el encabezado. | Un decisor corrige un desvío; un analista lo ve pero no puede corregir. **Hecho (2026-10-21)**: pantalla `/sonar` (reconciliación, desvíos con Corregir y Corregir todos, sin publicar con Publicar pendientes), insignia en el encabezado, recuadro "En Sonar" en el detalle y marcas en el inventario. "Corregir todos" es para la primera reconciliación, que marca como desvío toda regla incorporada antes de la 6.2. Verificado en el navegador con un Sonar simulado: el analista ve los 43 desvíos sin botones; el decisor corrigió uno y después los 42 restantes, y la reconciliación siguiente dio 0; una regla activada a mano apareció con "Reconciliar ahora", se corrigió desde su detalle con Sonar caído (quedó pendiente con el error, marcada en el inventario) y "Publicar pendientes" la publicó. El simulador asume que al activar una regla sin parámetros elegidos SonarQube Cloud completa los valores por defecto (así está "Sonar way comprehensive" en la grabación): confirmado en el paso 7. |
| 7 | Punta a punta contra SonarQube Cloud con los perfiles reales. | Los dos criterios de 6.2: incorporar activa con la severidad elegida, descartar desactiva, activar a mano genera la alerta. **Hecho (2026-10-28)**: probado por Federico Sánchez con `npm run dev` contra los perfiles reales. Confirmó las dos dudas que habían quedado: al activar una regla sin elegir parámetros, SonarQube Cloud completa los valores por defecto (no aparece el desvío "Otros parámetros"), y desactivar una regla que ya está inactiva no es un error. Durante la prueba hubo fallas de red intermitentes desde la máquina ("fetch failed"): la publicación quedó pendiente, se reintentó y se publicó, como está diseñado. Desde entonces el error dice la causa de la falla (`ETIMEDOUT`, `ECONNRESET`...), que el `fetch` de Node escondía. |

---

## 8 ter. Plan de implementación de la entrega 6.4 — Reglas propias (parte Roslyn)

Criterios de aceptación (`FASE-6.md`, sección 13):

- Publicar una versión nueva de `Lainco.Analyzers` agrega sus reglas al inventario sin carga manual.
- Incorporar una regla propia abre un PR con el cambio en el `.globalconfig`.

**Alcance.** Solo las reglas Roslyn: la Fase 5 (ESLint) no empezó. Lo de ESLint usa el
mismo formato de catálogo y el mismo código de sincronización, y se suma cuando exista
`@lainco/eslint-plugin`. Se hace antes que la 6.3 porque la 6.3 espera las decisiones D6.2 y
D6.3, y la 6.4 no depende de ella (decisión del 2026-10-28).

### Decisiones (2026-10-28)

| # | Decisión |
|---|---|
| R1 | **Catálogo generado en el build, como asset del release.** El build de `Lainco.Analyzers` genera `reglas-roslyn.json`: un paso después de compilar lee los descriptores del `.dll` (ID, título, descripción, categoría, severidad por defecto, link de ayuda) y la documentación de `docs/rules/`. No lo genera el analyzer en la compilación de los proyectos que lo usan: Roslyn no permite que un analyzer escriba archivos (RS1035), y correría en cada build de cada repo. **Formato común con ESLint**: en la Fase 5 el build de `@lainco/eslint-plugin` genera el mismo formato desde el `meta` de sus reglas. El JSON se adjunta al release de GitHub de cada versión, y la app lo sincroniza como hace con Sonar. |
| R2 | **Token fine-grained de GitHub** (`LAINCO_GITHUB_TOKEN`), limitado a este repositorio, con permiso de lectura y escritura sobre *Contents* y *Pull requests*. Los PRs figuran a nombre del dueño del token; vence (máximo un año). |
| R3 | **La severidad la dice la regla.** Al incorporar una regla propia no se elige severidad: el `.globalconfig` le pone la severidad por defecto de su descriptor (hoy, `warning` en todas). Cualquier otro estado es `none`. El generador del catálogo falla si un descriptor dice `error` (convención de `CLAUDE.md`). |
| R4 | **El merge publica.** El PR de la app sube la versión del paquete (parche) además de cambiar el `.globalconfig`; al mergearse, un workflow empaqueta, publica en GitHub Packages y crea el release con el `.nupkg` y `reglas-roslyn.json`. Resuelve la tarea pendiente de la Fase 1 ("Publicar el paquete en GitHub Packages"). |
| R5 | **Un solo PR abierto, que se actualiza.** Como la publicación a Sonar, cada decisión que entra o sale de Incorporada deja pendiente "llevar el `.globalconfig` a lo que dice la app"; quien publica genera el archivo con el estado de ese momento y crea o actualiza **el** PR de la app (rama `catalogo/globalconfig`). Varias decisiones antes del merge van al mismo PR, y la descripción las lista con autor y justificación. |
| R6 | **Las reglas propias nacen apagadas** (decisión del 2026-10-28, al cerrar el paso 5). El `.globalconfig` solo puede apagar las reglas que la app ya conoce: con descriptores habilitados por defecto, una regla nueva correría en todos los repositorios desde su primera versión hasta que la app la sincronizara y un PR la apagara, contra el principio rector. Por eso los descriptores llevan `isEnabledByDefault: false` (convención de `CLAUDE.md`) y el `.globalconfig` enciende las Incorporadas. El generador del catálogo falla si una regla viene habilitada. |

Lo que se sigue de R3 y R6: el `.globalconfig` generado enciende las Incorporadas con su
severidad y pone `none` en las demás (redundante con R6, pero explícito). Hoy LAIN004 y LAIN005
están en `warning` a mano: **antes de mergear el primer PR hay que incorporarlas en la app**
(son decisiones ya tomadas en las fases 1 y 3), o el PR las apaga. El PR lo deja a la vista
en el diff.

### Pasos

| # | Paso | Se verifica con |
|---|---|---|
| 1 | Catálogo de reglas propias: el formato (documentado, con número de versión de formato) y su generador para Roslyn (`tools/catalogo-reglas`), enganchado al build de `Lainco.Analyzers.Package`. Falla si una regla no tiene documentación en `docs/rules/`, si su ID no es `LAIN###`, si no está en `AnalyzerReleases` o si su severidad por defecto es `error`. | Tests del generador; el build produce `reglas-roslyn.json` con LAIN004 y LAIN005. **Hecho (2026-10-28)**: formato en `docs/catalogo-de-reglas.md` (versión de formato 1, común con ESLint: `origen`, `paquete`, `version`, `lenguaje` y las reglas con clave, título, descripción, categoría, severidad por defecto con las palabras del `.globalconfig`, habilitada por defecto, link de ayuda y el markdown de `docs/rules`). Generador en `tools/catalogo-reglas` (net8.0, carga el `.dll` y lee los descriptores; además de lo pedido verifica que el `helpLinkUri` lleve a su documentación). Target `GenerarCatalogoDeReglas` en `Lainco.Analyzers.Package`, después de compilar: deja el JSON junto al `.nupkg`, y si una regla no cumple el build falla con un error por regla. 45 tests, uno de ellos sobre las reglas de verdad. Verificado en la nube sin acceso a NuGet (con las DLLs de Roslyn y xunit de un build local): los tests pasan, el generador produce el catálogo con LAIN004 y LAIN005, y el target, en un proyecto con la misma estructura, lo deja junto al `.nupkg` con `dotnet pack -o` y hace fallar el build si falta un `docs/rules/<ID>.md`. Falta correr `dotnet pack` del paquete real en una máquina con NuGet. |
| 2 | Workflow de publicación (R4): al llegar a `main` un cambio de versión del paquete, empaqueta, publica en GitHub Packages y crea el release `vX.Y.Z` con el `.nupkg` y el catálogo. Falla si la versión ya existe. | La primera publicación real: el paquete en GitHub Packages y el release con sus dos assets. **Hecho (2026-10-28)**: `.github/workflows/publicar-analyzers.yml`. Corre con cada push a `main` que toca los analyzers, lo que viaja en el paquete o `docs/rules/` (y a mano). Si la versión ya tiene release no hace nada; si no, verifica `AnalyzerReleases`, corre los tests de los analyzers, de `catalogo-reglas` y de `sonar-sync`, empaqueta, publica en GitHub Packages con el `GITHUB_TOKEN` y crea el release `vX.Y.Z` con el `.nupkg` y `reglas-roslyn.json`, con las reglas en las notas. "Falla si la versión ya existe" quedó así: la versión no se repite porque se mira el release (un push sin subir la versión no publica, sin fallar), y un tag suelto sin release frena la publicación. Para que `AnalyzerReleases` quede al día, el workflow no publica si quedan reglas en Unshipped o falta `## Release X.Y.Z` en Shipped: LAIN004 y LAIN005 pasaron a Shipped como 0.1.0, la primera versión. Verificado el mismo día: el push del paso a `main` publicó la 0.1.0 en GitHub Packages y creó el release `v0.1.0` con sus dos assets. Los pasos que se pueden probar fuera de GitHub están en `.github/scripts/publicacion-analyzers.sh`, probados a mano; workflow y script pasan `actionlint` y `shellcheck`. |
| 3 | Sincronizar reglas Roslyn en la app: cliente de la API de GitHub (último release y su catálogo) y job `sincronizar-roslyn` (cron diario más botón), con la misma comparación que Sonar: nuevas, modificadas y las que ya no están, deprecadas. Los datos de prueba de los tests dejan de usar el origen Roslyn. | Tests con un release grabado; el primer criterio de 6.4: una versión nueva agrega sus reglas sin carga manual. **Hecho (2026-10-28)**: cliente en `src/github/cliente.ts` (último release y assets, con reintentos; el asset se baja de la URL de la API, así sirve también con un repositorio privado), formato del catálogo en `src/catalogo/formato.ts` (rechaza un formato que no conoce, claves que no son del origen y severidad `error`), y el job en `src/sincronizacion/sincronizarRoslyn.ts`. La corrida de Sonar pasó a `src/sincronizacion/corrida.ts`, común a los dos orígenes: misma comparación, misma escritura, un lock por origen. Una regla Roslyn queda con el título como nombre, la documentación como descripción (cambiarla la marca modificada), la severidad del descriptor (`warning`) y la categoría como tag; si deja de estar en el catálogo, se eliminó: queda deprecada. La corrida guarda la versión del paquete (migración `0007`). Cron diario a las 9:30 UTC; **Sincronizar ahora** sincroniza Sonar y Roslyn a la vez, y el encabezado muestra los dos. "Nuevas" y "modificadas" del inventario miran la última sincronización de cada origen. Variables `GITHUB_REPOSITORIO` y `LAINCO_GITHUB_TOKEN`. Los tests que no son de sincronización usan reglas ESLint. Verificado con tests (el catálogo real del release v0.1.0 como grabación) y de punta a punta con la app y un GitHub simulado: la primera corrida cargó LAIN004 y LAIN005; con ellas incorporadas, una "0.2.0" que agrega LAIN006, cambia la documentación de LAIN004 y saca LAIN005 dio 1 nueva, 1 modificada, 1 eliminada y 2 avisos; la descarga del asset siguió la redirección sin reenviar el token. Verificado el mismo día contra GitHub, con el token fine-grained: **Sincronizar ahora** trajo LAIN004 y LAIN005 del release v0.1.0. |
| 4 | Ciclo de vida de las reglas propias (R3): incorporar no pide severidad ni parámetros; el detalle muestra la documentación de la regla y, en lugar del recuadro "En Sonar", el estado en el paquete. Cada decisión que entra o sale de Incorporada encola la publicación con destino "PR de configuración" (la tabla `publicacion` suma el destino). | Tests de dominio y contra la base, como el paso 3 de la 6.2. **Hecho (2026-10-28)**: `validarTransicion` sabe el origen: una regla propia se incorpora sin severidad (con severidad se rechaza: `severidadNoSeElige`), y `aplicarTransicion` le asigna la del descriptor, que queda en el estado y en la decisión. Migración `0008`: `publicacion.destino` (perfil de Sonar o PR de configuración), que decide `destinoDeLaDecision` según el origen (las normas de IA no se publican). Publicar en Sonar, reintentar y la pantalla Sonar miran solo el perfil. El detalle de una regla propia muestra su documentación (markdown con `marked`, saneada y con el código coloreado como la de Sonar, sin el título) y el recuadro "En el paquete" en lugar de "En Sonar": cómo va en el `.globalconfig` y si el pedido al PR está pendiente; el formulario no pide severidad y dice con cuál se incorpora. En el inventario, "sin pasar al paquete". Los tests que incorporan con severidad usan reglas de normas de IA. Verificado en el navegador: LAIN006 pasó a A revisar y a Incorporada sin elegir severidad, quedó con `warning` en el estado y la decisión, y con su publicación pendiente hacia el PR de configuración, que no aparece en la pantalla Sonar. |
| 5 | Generar el `.globalconfig` (función pura): orden por ID, un comentario por regla con su título, Incorporada con la severidad del descriptor, el resto `none`; nunca `error`. | Tests; con LAIN004 y LAIN005 incorporadas, el archivo generado equivale al que hoy se mantiene a mano. **Hecho (2026-10-28)**, y después la decisión R6: LAIN004 y LAIN005 pasaron a `isEnabledByDefault: false` (en `AnalyzerReleases.Unshipped.md`, como regla cambiada a `Disabled`: la próxima versión la mueve a Shipped), los tests de los analyzers las encienden con un `.globalconfig` como el del paquete, y el generador del catálogo rechaza una regla habilitada por defecto. Verificado con el compilador (sin `.globalconfig` no se reportan, con `warning` sí, con `none` no) y con los tests de los analyzers y del generador del catálogo, todos en verde (Federico Sánchez, 2026-10-28). Lo anterior: `generarGlobalconfig` en `app/src/paquete/globalconfig.ts`. Además de lo pedido: las reglas eliminadas del paquete (deprecadas en el inventario) no se configuran; rechaza claves que no son `LAIN###`, repetidas y una Incorporada sin severidad válida; sin fechas ni versiones, así el mismo estado da el mismo archivo. El encabezado dice que lo genera la app y que no se edita a mano. Verificado con 15 tests, uno contra el archivo real del repositorio: las líneas que lee el compilador son las mismas; cambian el encabezado y el comentario de LAIN005 (el título del descriptor es más corto que el del archivo a mano). |
| 6 | El PR automático (R2, R5): lee el `.globalconfig` y la versión en `main`, y si difieren de lo que dice la app, crea o actualiza la rama y el PR, con la versión subida y las decisiones en la descripción. Reintentos como la publicación a Sonar. | Tests con un GitHub simulado; el segundo criterio de 6.4: incorporar una regla propia abre el PR. **Hecho (2026-10-28)**: `app/src/paquete/pr.ts` (qué propone el PR, sin red ni base) y `app/src/paquete/publicar.ts` (el job), con el cliente de GitHub ampliado (archivos, ramas, commits con la API de Git, PRs). Toma todas las publicaciones pendientes juntas; si `main` ya tiene el `.globalconfig` de la app, las da por publicadas y cierra el PR abierto; si no, un commit sobre `main` con el `.globalconfig`, la versión con el parche subido y `AnalyzerReleases` (Unshipped pasa a Shipped bajo la versión nueva, para que el workflow publique), la rama `catalogo/globalconfig` movida a ese commit, y el PR creado o actualizado, con una fila por regla que cambia y la decisión que la explica. Se dispara después de responder a cada decisión, con el cron `publicar-paquete` (10:30 UTC) y con el botón del detalle; reintentos como en Sonar. Migración `0009`: el número y el link del PR en cada publicación. El test de la sincronización de Roslyn pasó a transacciones descartadas, como este, porque los dos usan reglas Roslyn. Verificado con 38 tests nuevos (entre ellos, el job con un GitHub en memoria, con los archivos del paquete de antes del primer PR como `main`, en `app/tests/fixtures/paquete/`) y de punta a punta con la app y un GitHub simulado por HTTP: el cron abrió el PR #1 (0.1.0 → 0.1.1, R6 movida a Shipped) y descartar la regla desde el detalle actualizó el mismo PR, que siguió siendo un commit sobre `main`. Falta probarlo contra GitHub (paso 8). |
| 7 | Seguimiento en la app: estado del PR (abierto, mergeado, cerrado sin mergear) y de la versión publicada; un desvío si el `.globalconfig` de `main` no coincide con la app y no hay PR abierto. | En la pantalla, como el paso 6 de la 6.2. **Hecho (2026-10-28)**: pantalla `/paquete` (versión publicada y en main, PRs, lo que falta pasar al paquete, el desvío con **Abrir el PR** para un decisor), insignia **Paquete** en el encabezado y el estado del PR en el detalle de la regla. La revisión (`app/src/paquete/revisar.ts`, cron `revisar-paquete` a las 11:30 UTC y **Revisar ahora**) trae el estado de cada PR abierto desde GitHub, lee de main el `.globalconfig` y la versión, y abre, mantiene o cierra el desvío `globalconfigDistinto`: main distinto de la app, sin PR abierto y sin nada pendiente. Corregirlo es `publicarPaquete` con `forzar`. Migración `0010`: `prConfiguracion` (la publicación registra cada PR que abre; los anteriores se cargan de las publicaciones), `revisionPaquete` y el tipo de desvío; la reconciliación con Sonar y la pantalla Sonar no ven ese desvío. Un PR mergeado se compara con la versión publicada (por número de versión): hasta que se publica y se sincroniza, dice que falta publicarla. Verificado con 27 tests nuevos y de punta a punta con la app y un GitHub simulado: «Revisar ahora» detectó el desvío (en main LAIN005, que la app ya no tiene, y sin LAIN006), «Abrir el PR» lo corrigió con un PR hacia la 0.1.2 y la revisión siguiente lo cerró; mergeado en el simulador, la revisión lo marcó mergeado y main coincidió con la app. |
| 8 | Punta a punta contra GitHub: incorporar una regla propia abre el PR; mergearlo publica la versión; una regla nueva publicada aparece en el inventario. | Los dos criterios de 6.4.  **Hecho (2026-10-29)**: probado el paso 6 contra GitHub: con LAIN004 y LAIN005 incorporadas, la app abrió el PR #2 (`Lainco.Analyzers 0.1.1`, a nombre del dueño del token), que cambió el `.globalconfig`, subió la versión y movió a Shipped el cambio de R6; se mergeó. El workflow publicó la 0.1.1 al mergear (release `v0.1.1` con el `.nupkg` y `reglas-roslyn.json`: LAIN004 y LAIN005 con `habilitadaPorDefecto: false`). Para la regla nueva se implementó LAIN001 de verdad (Fase 3; tests, documentación y en Shipped bajo `## Release 0.2.0`, versión menor por ser regla nueva); el catálogo de la 0.2.0, generado con el generador real, la trae apagada. Al mergearla, el workflow publicó el release `v0.2.0` (2026-10-29) y **Sincronizar ahora** trajo LAIN001 al inventario como Pendiente de analizar, sin carga manual (Federico Sánchez). Antes de publicarla se le sumó a LAIN001 el caso de las entidades (`Lainco.Domain.IEntity`), y el generador del catálogo pasó a aceptar varios descriptores con el mismo ID si solo cambia el mensaje. Los dos criterios de la 6.4 se cumplen contra GitHub. |

---

## 8 quater. Plan de implementación de la entrega 6.5 — En prueba (parte C#)

Criterios de aceptación (`FASE-6.md`, sección 13):

- Una regla de Sonar En prueba muestra cantidad de issues por repositorio sin que aparezca nada en Sonar.
- Se pueden marcar muestras como falso positivo y la app calcula la tasa.

**Alcance.** Solo C#: las reglas de Sonar para C# (con `SonarAnalyzer.CSharp`) y las reglas
Roslyn propias. TypeScript (`eslint-plugin-sonarjs`, el mapeo de claves y las reglas ESLint
propias) se suma después de la Fase 5, como en la 6.4 (decisión del 2026-10-29).

### Decisiones (2026-10-29)

| # | Decisión |
|---|---|
| E1 | **Las muestras guardan solo la referencia** (punto A, sección 9): repositorio, commit, archivo, línea, columna, mensaje y el link al código en GitHub en ese commit. Ningún fragmento de código en la base. Evaluar una muestra es abrir el link. |
| E2 | **Repositorios en una lista configurable** (D6.5): la variable `PRUEBA_REPOSITORIOS` de la app (`owner/repo`, separados por coma). Arranca con `revertpablo/Lainco-quality` (la sample) y se agregan los reales después. La app se la pasa al job junto con la configuración. |
| E3 | **Período mínimo: N corridas** (D6.4), con `PRUEBA_CORRIDAS_MINIMAS` (5 si no se configura). Cuentan las corridas terminadas que incluyeron la regla **desde la última vez que entró a En prueba**. Pasar de En prueba a Incorporada exige ese mínimo; hasta la 6.5 no se verificaba nada (sección 4 de `FASE-6.md`). |
| E4 | **El job pide la configuración a la app y le devuelve los resultados; nada va a Sonar.** Un workflow programado (nocturno, y a mano) del repositorio `Lainco-quality`: pide la configuración (la app abre la corrida), compila cada repositorio con `SonarAnalyzer.CSharp` y la última versión publicada de `Lainco.Analyzers` agregados por fuera del repositorio, con un `.globalconfig` de prueba que enciende solo las reglas En prueba, y saca un SARIF (`ErrorLog`). Un script reduce el SARIF a cantidades y muestras por regla, y el job lo sube. El repositorio analizado no se modifica. |
| E5 | **Tokens de servicio** (sección 5): tabla con el hash del token (nunca el token), nombre, alcance (`prueba`), vencimiento, último uso y baja. Se crean con un script que muestra el token una sola vez; el job lo lee de un secret. No entran por Auth.js: los valida el Route Handler. |
| E6 | **Una muestra se reconoce entre corridas** por regla, repositorio, archivo y mensaje (los mensajes llevan el símbolo, convención de `CLAUDE.md`; el de Sonar también suele nombrarlo). La evaluación (válida / falso positivo) se conserva mientras la muestra siga apareciendo. Por corrida se guardan todas las cantidades y hasta 20 muestras por regla y repositorio, las ya evaluadas primero. Tasa de falsos positivos = falsos positivos / evaluadas. |
| E7 | **Probable localmente.** El job informa qué IDs trae la versión de `SonarAnalyzer.CSharp` que usa (los saca del SARIF, que los lista todos); la app marca `probableLocalmente` en las reglas de Sonar para C# (las Roslyn propias siempre lo son). Una regla no probable no puede pasar a En prueba; puede ir de A revisar a Incorporada sin prueba, como hasta ahora. |

### Pasos

| # | Paso | Se verifica con |
|---|---|---|
| 1 | Tokens de servicio (E5): tabla `tokenServicio`, script para crear y dar de baja, y la validación para los Route Handlers de `/api/ci/` (token vencido, dado de baja o de otro alcance: 401). | Tests contra la base. **Hecho (2026-10-29)**: migración `0011` (`tokenServicio`, con el alcance `prueba` como tabla de referencia; la base rechaza un hash que no sea un SHA-256 y un vencimiento anterior a la creación). El token es `lqs_` + 32 bytes al azar en base64url; la app guarda el SHA-256, el prefijo para reconocerlo y el último uso (`src/servicio/`). `autorizarServicio` responde siempre el mismo 401, sin decir si el token no existe, venció o se dio de baja; el motivo va al log. El proxy deja pasar `/api/ci/`. Script `npm run token -- crear\|listar\|revocar` (con `tsx`, ahora dependencia de desarrollo): muestra el token una sola vez, vencimiento entre 1 y 365 días, nombre único. Verificado con 28 tests nuevos (792 en total, lint, typecheck y build limpios), el script contra la base de desarrollo en todos sus casos y el servidor: `/api/ci/` ya no pide sesión y `/api/cix` sí. |
| 2 | Modelo de la prueba: migración con `corridaPrueba` (estado, repositorios, reglas incluidas, versiones de los analyzers, link a la corrida del workflow), `resultadoPrueba` (corrida, regla, repositorio, commit, cantidad, o el error si no compiló) y `muestraPrueba` (E1, E6). Funciones puras: el `.globalconfig` de prueba, la identidad de una muestra, la tasa y las corridas que cuentan para el mínimo. | Tests de dominio y de la migración. **Hecho (2026-10-29)**: migración `0012`. `corridaPrueba` (estado en curso, terminada o fallida, con fecha de fin y el motivo si falló; el token que la abrió, el link al workflow y las versiones de los analyzers), `reglaEnCorrida`, `repositorioEnCorrida` (sin estado hasta que llegan sus resultados; analizado con su commit, o con error y su motivo; `owner/repo` en minúsculas) y `resultadoPrueba`, que por claves foráneas compuestas solo acepta un repositorio y una regla de la corrida, cero incluido. `muestraPrueba` no es por corrida: una por regla, repositorio, archivo y mensaje (E6), con la línea y el commit de la última vez y la primera y última corrida en que apareció, así la evaluación se conserva; la base rechaza rutas absolutas y evaluaciones sin autor. Funciones puras en `src/dominio/prueba.ts`: el `.globalconfig` de prueba (`dotnet_analyzer_diagnostic.severity = none` y las reglas En prueba en `warning`, con `global_level = 1000` para ganarle al `.globalconfig` del paquete, que pone `none` en las reglas propias sin incorporar: con dos archivos del mismo nivel el compilador descarta la clave), la traducción entre IDs de diagnóstico y reglas (`S2325` ↔ `csharpsquid:S2325`, `LAIN001`), la ruta relativa, la identidad y el link de una muestra, la tasa y las corridas que cuentan. Verificado con 56 tests nuevos (848 en total; lint y typecheck limpios). |
| 3 | Configuración de prueba: `GET /api/ci/prueba/configuracion` abre la corrida y devuelve los repositorios, el `.globalconfig` de prueba y las reglas incluidas (Sonar C# y Roslyn En prueba, solo las probables). Sin reglas En prueba, no abre corrida y el job termina sin hacer nada. | Tests del Route Handler con token. **Hecho (2026-10-29)**, como `POST /api/ci/prueba/corridas` (abre una corrida: cambia datos, no es un GET; los resultados del paso 5 van a `POST /api/ci/prueba/corridas/{id}/resultados`). Cuerpo JSON opcional con el link al workflow y las versiones de los analyzers. Entran las reglas En prueba de C#, no deprecadas, Roslyn `LAIN###` y de Sonar `csharpsquid:` salvo las que se sabe que no están en `SonarAnalyzer.CSharp` (null cuenta como probable hasta saberlo). Una corrida anterior que siga en curso pasa a fallida, con el motivo, aunque esta vez no haya reglas. Responde 201 con la corrida, los repositorios, las reglas y el `.globalconfig`; 200 sin corrida; 401, 415, 400 y 500 (falta `PRUEBA_REPOSITORIOS`, nueva variable). Código en `src/prueba/` (`configuracion.ts`, `abrir.ts`, `http.ts`, sin Next para probarlo en transacción). Verificado con 22 tests nuevos (870 en total; lint, typecheck y build limpios) y con el servidor contra la base de desarrollo: sin token 401; con token 201 con 28 reglas de C# de las 83 En prueba; un segundo pedido dejó la primera corrida fallida; un cuerpo inválido, 400 con el detalle; el token registró su uso. |
| 4 | El job (E4): `.github/workflows/prueba-reglas.yml` (cron nocturno y a mano), el `.targets` que agrega los analyzers y el `.globalconfig` sin tocar el repositorio, y el script que reduce el SARIF (con tests, sobre SARIF grabados de la sample). Un repositorio que no compila queda con su error y la corrida sigue con los demás. | El script con tests; el workflow, con `actionlint` y una corrida real contra una app de prueba. **Hecho (2026-10-29)**, salvo la corrida real en GitHub, que va con el paso 8 (necesita la ruta de resultados del paso 5). `.github/prueba/Prueba.targets` (importado con `-p:CustomAfterMicrosoftCommonTargets`): saca al evaluar las `PackageReference` del repositorio a `Lainco.Analyzers` y `SonarAnalyzer.CSharp` (corren las del job, una vez, y no hay que restaurarlas: la sample las toma de un feed local que en un clon no existe; con `RestoreIgnoreFailedSources` restaura igual) y antes de compilar agrega los analyzers, el `.globalconfig` y un SARIF por proyecto y target framework. Dos hallazgos verificados con el compilador: el `.globalconfig` tiene que entrar como `EditorConfigFiles` (los `GlobalAnalyzerConfigFiles` se convierten al evaluar; agregados en un target se ignoran y no se aplica nada), y `global_level = 1000` es necesario (con un `.globalconfig` del repositorio que pone LAIN001 en `none`, sin él la regla no corre). `SonarAnalyzer.CSharp` se baja del release de `SonarSource/sonar-dotnet` en GitHub (trae el `.nupkg`; NuGet no hace falta), `Lainco.Analyzers` del último release. `reducir-sarif.mjs` (10 tests con `node --test`, uno sobre un SARIF real recortado): cantidad por regla con cero, sin suprimidos, fuera del repositorio ni repetidos entre target frameworks, hasta 200 ubicaciones por regla; y las reglas disponibles, que el SARIF lista aunque no hayan disparado (456 de Sonar en la 10.35): E7 sale de ahí, en la ingesta. `PRUEBA_REPOSITORIOS` admite `owner/repo:ruta/de/la.sln` (Lainco-quality tiene dos soluciones); sin solución, el job compila la única o informa el error. Pasos en `.github/scripts/prueba-reglas.sh` (`analyzers`, `abrir`, `analizar`, `enviar`, `todo`), `shellcheck` y `actionlint` limpios. Verificado en la nube con la app y repositorios locales: con SonarAnalyzer.CSharp 10.35 y LAIN001, la app abrió una corrida de 30 reglas en 4 repositorios; uno dio LAIN001 y S1118 con sus ubicaciones y 459 reglas disponibles, y los otros tres, su error (dos soluciones, CS1525, no existe); `enviar` informó el 404 de la ruta que falta y el job terminó con error, como corresponde. Desde la máquina de Federico Sánchez, con acceso a GitHub: `analyzers` bajó SonarAnalyzer.CSharp 10.35.0.4138 (la 10.34 al fijar `SONAR_ANALYZER_VERSION`) y Lainco.Analyzers 0.2.0, solo los dos `.dll`; con una versión que no existe, falla diciéndolo. |
| 5 | Ingesta: `POST /api/ci/prueba/corridas/{id}/resultados` valida el formato, guarda cantidades y muestras (heredando evaluaciones, E6), actualiza `probableLocalmente` (E7) y cierra la corrida. Repetir el envío de un repositorio no duplica nada. | Tests contra la base con resultados grabados. **Hecho (2026-10-29)**: `src/prueba/ingesta.ts` y la ruta. Valida que las reglas sean exactamente las de la corrida (422 con las que faltan y sobran), que el repositorio sea de ella (422) y que la corrida siga en curso (409; lock de la fila de la corrida). Una regla cuyo ID no está entre los disponibles no tiene resultado; con la lista se marca `probableLocalmente` en todas las reglas de Sonar para C# del inventario (sin ninguna de Sonar en la lista no se toca nada). Muestras con `elegirMuestras` (`src/dominio/prueba.ts`): hasta 20, las evaluadas primero, upsert por identidad. Un envío repetido reemplaza al anterior mientras la corrida está en curso; con todos los repositorios, la corrida termina. Verificado con 20 tests nuevos (895 en total; lint, typecheck y build limpios) y de punta a punta en la nube con la app, el script del job y dos repositorios locales: una corrida de 30 reglas terminó al llegar los dos; uno dio LAIN001 y S1118 con su muestra, el otro su error de compilación; 5 reglas En prueba que no están en SonarAnalyzer.CSharp 10.35 quedaron sin resultado y no probables; 456 reglas de Sonar para C# quedaron probables. |
| 6 | Pantallas: en el detalle de una regla En prueba, issues totales y por repositorio, evolución entre corridas, corridas que faltan para el mínimo, las muestras con su link y **Válida** / **Falso positivo**, y la tasa. Una pantalla **Prueba** con las corridas (estado, repositorios, errores) y las reglas en prueba. | En el navegador, con resultados cargados; el segundo criterio de 6.5. **Hecho (2026-10-29)**: consultas en `src/prueba/consultas.ts` (la prueba de una regla, el panel y lo que pide atención), `evaluarMuestra` (`src/prueba/evaluar.ts`, cualquier usuario con sesión: la evalúa el equipo, FASE-6.md sección 8) y textos en `src/ui/prueba.ts`. Detalle de la regla: sección **Prueba** arriba de la documentación (lo que falta para el mínimo, issues de la última corrida con resultados, tabla de evolución por repositorio, muestras con link y **Válida** / **Falso positivo**, que tocado de nuevo deja la muestra sin evaluar, y la tasa). Pantalla **Prueba** (`/prueba`) con las reglas en prueba y las últimas 15 corridas; insignia si la última corrida falló o tuvo repositorios con error. `PRUEBA_CORRIDAS_MINIMAS` (5 por defecto; si está mal, las pantallas lo avisan y usan 5). La navegación pasa a dos líneas en pantallas angostas: con la quinta sección se salía de los 390 px. Verificado con 29 tests nuevos (924 en total; lint, typecheck y build limpios) y en el navegador con datos cargados por `abrirCorrida` y `registrarResultado` (cuatro corridas sobre dos repositorios, una con un repositorio que no compiló y otra fallida): marcar una muestra como falso positivo y otra como válida dio 50 % en el detalle y en la pantalla Prueba, con quién y cuándo; quitar la evaluación la recalculó; sin desbordes a 390 px y en modo oscuro. El segundo criterio de 6.5 se cumple. |
| 7 | Ciclo de vida: En prueba → Incorporada exige el mínimo de corridas (E3); hacia En prueba se rechaza una regla no probable localmente (E7). Las reglas En prueba siguen fuera de Sonar y con `none` en el `.globalconfig` del paquete. | Tests de dominio y contra la base. **Hecho (2026-10-29)**: `requiereResultadosDePrueba` pasó a `true` en En prueba → Incorporada (la única transición que lo exige), y el motivo nuevo `noSePuedeProbar` rechaza ir a En prueba con `probableLocalmente` falso, también en operaciones masivas (todo o nada). `aplicarTransicion` cuenta las corridas con `corridasQueCuentanPorRegla` (`src/prueba/consultas.ts`) y recibe el mínimo (por defecto, de `PRUEBA_CORRIDAS_MINIMAS`). A las reglas que el job de C# no corre (TypeScript, ESLint, normas de IA) no se les pide el mínimo: no tienen cómo juntarlo hasta la Fase 5; la precisión quedó en `FASE-6.md`, sección 4. El formulario de cambio de estado muestra, al elegir la opción, por qué no se puede todavía. Lo de Sonar y el `.globalconfig` ya era así: solo entrar o salir de Incorporada publica. Verificado con 13 tests nuevos (937 en total; lint y typecheck limpios) y en el navegador: con mínimo 5, incorporar LAIN001 (3 corridas) mostró el aviso y el servidor lo rechazó con su motivo; S9001 no pudo pasar a En prueba; con mínimo 3, LAIN001 se incorporó con la severidad de la regla. |
| 8 | Punta a punta: una regla de Sonar para C# y LAIN001 En prueba; el workflow corre sobre la sample, la app muestra los issues por repositorio, el perfil de Sonar no cambia, y marcar muestras da la tasa. | Los dos criterios de 6.5. **Hecho (2026-10-29)**, contra GitHub y la app desplegada en Vercel (producción, con `PRUEBA_REPOSITORIOS` = `revertpablo/Lainco-quality:samples/SampleSolution/SampleSolution.sln`, el secret `LAINCO_PRUEBA_TOKEN` y la variable `LAINCO_APP_URL`). Con LAIN001 y `csharpsquid:S109` (números mágicos) En prueba, el workflow **Prueba de reglas**, lanzado a mano, corrió sobre la sample. La primera corrida, sin la solución en la variable, dejó el repositorio con el error que lista las cuatro soluciones de Lainco-quality; con la ruta, la segunda dio LAIN001 1 (`Pedido.cs`) y S109 2 (`CalculadorDeTotales.cs`, el `100` del porcentaje, y `ExtensionesDeDecimal.cs`), las dos con "1 de 5" corridas. Marcar una muestra de S109 como falso positivo y la otra como válida dio la tasa del 50 %. En SonarQube Cloud no apareció ningún issue de S109 y la regla siguió inactiva en el perfil. Los dos criterios de la 6.5 se cumplen (Federico Sánchez). |

---

## 9. Puntos a confirmar

| # | Punto | Por qué importa |
|---|---|---|
| A | **Confidencialidad.** El inventario de reglas no tiene código de clientes, pero la entrega 6.5 guarda fragmentos de código en `muestra_prueba`, y la Fase 7 guarda `evidencia` de los hallazgos. Eso sí es código de clientes alojado en un tercero. | **Resuelto para la 6.5 (2026-10-29): solo referencias** (repositorio, commit, archivo, línea, mensaje y link), sin fragmento (decisión E1). La `evidencia` de la Fase 7 se decide en la Fase 7. |
| B | **¿La app queda expuesta a internet?** | **Resuelto (2026-10-15): sí, pública con login.** Cualquiera llega a la pantalla de login; solo entran cuentas del dominio de Lainco (Google) o usuarios dados de alta (GitHub). `/api/salud` es la única ruta sin sesión y no expone datos. |
| C | D6.6 — frecuencia de sincronización | Se asume diaria hasta que se defina. |
| D | D6.4 — período mínimo de prueba | **Resuelta (2026-10-29): N corridas**, configurable (decisión E3). |
| E | D6.5 — repositorios del job de prueba | **Resuelta (2026-10-29): lista configurable** (decisión E2). |
