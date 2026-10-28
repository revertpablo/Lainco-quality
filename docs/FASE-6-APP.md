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

Lo que se sigue de R3: el `.globalconfig` generado pone `none` en toda regla que no esté
Incorporada, porque los descriptores vienen habilitados por defecto. Hoy LAIN004 y LAIN005
están en `warning` a mano: **antes de mergear el primer PR hay que incorporarlas en la app**
(son decisiones ya tomadas en las fases 1 y 3), o el PR las apaga. El PR lo deja a la vista
en el diff.

### Pasos

| # | Paso | Se verifica con |
|---|---|---|
| 1 | Catálogo de reglas propias: el formato (documentado, con número de versión de formato) y su generador para Roslyn (`tools/catalogo-reglas`), enganchado al build de `Lainco.Analyzers.Package`. Falla si una regla no tiene documentación en `docs/rules/`, si su ID no es `LAIN###`, si no está en `AnalyzerReleases` o si su severidad por defecto es `error`. | Tests del generador; el build produce `reglas-roslyn.json` con LAIN004 y LAIN005. **Hecho (2026-10-28)**: formato en `docs/catalogo-de-reglas.md` (versión de formato 1, común con ESLint: `origen`, `paquete`, `version`, `lenguaje` y las reglas con clave, título, descripción, categoría, severidad por defecto con las palabras del `.globalconfig`, habilitada por defecto, link de ayuda y el markdown de `docs/rules`). Generador en `tools/catalogo-reglas` (net8.0, carga el `.dll` y lee los descriptores; además de lo pedido verifica que el `helpLinkUri` lleve a su documentación). Target `GenerarCatalogoDeReglas` en `Lainco.Analyzers.Package`, después de compilar: deja el JSON junto al `.nupkg`, y si una regla no cumple el build falla con un error por regla. 45 tests, uno de ellos sobre las reglas de verdad. Verificado en la nube sin acceso a NuGet (con las DLLs de Roslyn y xunit de un build local): los tests pasan, el generador produce el catálogo con LAIN004 y LAIN005, y el target, en un proyecto con la misma estructura, lo deja junto al `.nupkg` con `dotnet pack -o` y hace fallar el build si falta un `docs/rules/<ID>.md`. Falta correr `dotnet pack` del paquete real en una máquina con NuGet. |
| 2 | Workflow de publicación (R4): al llegar a `main` un cambio de versión del paquete, empaqueta, publica en GitHub Packages y crea el release `vX.Y.Z` con el `.nupkg` y el catálogo. Falla si la versión ya existe. | La primera publicación real: el paquete en GitHub Packages y el release con sus dos assets. |
| 3 | Sincronizar reglas Roslyn en la app: cliente de la API de GitHub (último release y su catálogo) y job `sincronizar-roslyn` (cron diario más botón), con la misma comparación que Sonar: nuevas, modificadas y las que ya no están, deprecadas. Los datos de prueba de los tests dejan de usar el origen Roslyn. | Tests con un release grabado; el primer criterio de 6.4: una versión nueva agrega sus reglas sin carga manual. |
| 4 | Ciclo de vida de las reglas propias (R3): incorporar no pide severidad ni parámetros; el detalle muestra la documentación de la regla y, en lugar del recuadro "En Sonar", el estado en el paquete. Cada decisión que entra o sale de Incorporada encola la publicación con destino "PR de configuración" (la tabla `publicacion` suma el destino). | Tests de dominio y contra la base, como el paso 3 de la 6.2. |
| 5 | Generar el `.globalconfig` (función pura): orden por ID, un comentario por regla con su título, Incorporada con la severidad del descriptor, el resto `none`; nunca `error`. | Tests; con LAIN004 y LAIN005 incorporadas, el archivo generado equivale al que hoy se mantiene a mano. |
| 6 | El PR automático (R2, R5): lee el `.globalconfig` y la versión en `main`, y si difieren de lo que dice la app, crea o actualiza la rama y el PR, con la versión subida y las decisiones en la descripción. Reintentos como la publicación a Sonar. | Tests con un GitHub simulado; el segundo criterio de 6.4: incorporar una regla propia abre el PR. |
| 7 | Seguimiento en la app: estado del PR (abierto, mergeado, cerrado sin mergear) y de la versión publicada; un desvío si el `.globalconfig` de `main` no coincide con la app y no hay PR abierto. | En la pantalla, como el paso 6 de la 6.2. |
| 8 | Punta a punta contra GitHub: incorporar una regla propia abre el PR; mergearlo publica la versión; una regla nueva publicada aparece en el inventario. | Los dos criterios de 6.4. |

---

## 9. Puntos a confirmar

| # | Punto | Por qué importa |
|---|---|---|
| A | **Confidencialidad.** El inventario de reglas no tiene código de clientes, pero la entrega 6.5 guarda fragmentos de código en `muestra_prueba`, y la Fase 7 guarda `evidencia` de los hallazgos. Eso sí es código de clientes alojado en un tercero. | Hay que confirmar que es aceptable antes de llegar a 6.5, o decidir ahí que se guardan solo referencias (archivo + línea) sin el fragmento. |
| B | **¿La app queda expuesta a internet?** | **Resuelto (2026-10-15): sí, pública con login.** Cualquiera llega a la pantalla de login; solo entran cuentas del dominio de Lainco (Google) o usuarios dados de alta (GitHub). `/api/salud` es la única ruta sin sesión y no expone datos. |
| C | D6.6 — frecuencia de sincronización | Se asume diaria hasta que se defina. |
| D | D6.4 — período mínimo de prueba | Recién hace falta en 6.5. |
| E | D6.5 — repositorios del job de prueba | Recién hace falta en 6.5. |
