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
                      │   ├─ procesar-publicaciones (c/5 min)   │
                      │   └─ reconciliar-perfil  (diario)       │
                      │            │                            │
                      └────────────┼────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┬──────────────────┐
              ▼                    ▼                    ▼                  ▼
        Neon Postgres      SonarQube Cloud API     GitHub API        AI Gateway
        (inventario,        (reglas, quality        (PRs de          (pre-clasificación,
         decisiones)         profiles)               configuración)    entrega 6.3)
```

**Regla de diseño:** todo cambio de estado pasa por una única función de dominio (`aplicarTransicion`) que valida la transición, el rol y la justificación, y escribe `estado_regla` + `decision` en la misma transacción. Ni la UI ni la API escriben el estado por su cuenta.

---

## 3. Modelo de datos

Traducción del modelo de la sección 11 de `FASE-6.md` a tablas de Postgres. Nombres en español, `snake_case`.

| Tabla | Notas de implementación |
|---|---|
| `regla` | Clave natural `(origen, clave)` con índice único. `tags` y `parametros` como `jsonb`. `hash_descripcion` en `text`. |
| `estado_regla` | Fila por regla (relación 1:1). Estado actual, severidad asignada, valores de parámetros. Es la tabla que consulta el generador de configuración. |
| `decision` | **Append-only.** Nunca se actualiza ni se borra: es el historial. `lote_id` agrupa las operaciones masivas. |
| `sugerencia_ia` | Clave de cache `(regla_id, hash_descripcion, version_normas, version_evaluador)`. |
| `relacion` | Bidireccional. Se guarda una fila y se consulta en ambos sentidos; `check (regla_a_id <> regla_b_id)` y único sobre el par normalizado. |
| `corrida_prueba`, `resultado_prueba`, `muestra_prueba` | Entrega 6.5. |
| `sincronizacion` | Log de cada corrida del job: fecha, origen, contadores. |
| `publicacion` | Outbox: destino, payload, estado, intentos, último error. |
| `usuario` | Identidad + rol (`analista` / `decisor`). Ver sección 5. |
| `vista_guardada` | Nombre, usuario, filtros como `jsonb`, indicador de compartida. |

**Índices que importan para el triage:** `estado_regla(estado)`, `regla(lenguaje, tipo)`, y un índice GIN sobre `regla.tags` para el descarte masivo por tag, que es la primera operación del triage inicial.

**Máquina de estados:** la tabla de transiciones permitidas de la sección 4 de `FASE-6.md` se codifica como una constante en TypeScript, no en la base. Cada entrada declara si exige justificación, si exige rol decisor y si admite operación masiva. Los tests recorren la tabla entera, incluyendo las transiciones prohibidas (en particular `Pendiente de analizar → Incorporada`, que debe fallar siempre).

---

## 4. Jobs y procesos de fondo

| Job | Disparo | Qué hace |
|---|---|---|
| `sincronizar-sonar` | Cron diario (D6.6) + botón en la app | Pagina `api/rules/search` por lenguaje, compara con lo almacenado, crea / actualiza / marca deprecadas, escribe una fila en `sincronizacion`. |
| `procesar-publicaciones` | Cron cada 5 min | Toma filas pendientes de `publicacion` y llama a `activate_rule` / `deactivate_rule`. Reintentos con retroceso exponencial; tras N fallos queda en `fallida` y aparece como alerta en la app. |
| `reconciliar-perfil` | Cron diario | Compara el Quality Profile real contra `estado_regla` y genera alertas de desvío (sección 10 de `FASE-6.md`). |

La sincronización de ~500 reglas entra holgada en el límite de 300 s de una función de Vercel. Si al implementarla resultara ajustada, se parte por lenguaje en dos invocaciones.

**Por qué outbox y no cola:** la publicación a Sonar debe ser inspeccionable y reintentable a mano desde la UI, y `publicacion` ya estaba en el modelo de datos como registro del resultado. Una tabla que ya existe hace de cola sin agregar un servicio más.

---

## 5. Autenticación y roles

**Auth.js (NextAuth v5)** con dos proveedores:

- **Google** — restringido al dominio de Google Workspace de Lainco, validando el `hd` del perfil en el callback de `signIn`. Es el camino normal: el equipo ya tiene esa identidad.
- **GitHub** — para que las cuentas que operan contra GitHub Packages y los PRs de configuración puedan entrar con la misma identidad que usan en los repos.

**Los roles viven en la tabla `usuario` de la app, no en el proveedor de identidad.** El proveedor solo dice *quién sos*; la app dice *qué podés hacer*. Esto:

- resuelve **D6.1** sin depender de la estructura de equipos de GitHub ni de grupos de Google;
- deja el cambio de rol registrado como una decisión más, con autor y fecha;
- evita que agregar a alguien a un equipo de GitHub le dé, de rebote, permiso para tocar el quality gate.

El primer usuario decisor se carga por seed en la migración inicial.

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
| 2 | Esquema Drizzle y primera migración | `drizzle-kit push` crea las tablas; seed del usuario decisor. |
| 3 | Máquina de estados en `src/dominio/`, con tests primero | Tests que recorren toda la tabla de transiciones, permitidas y prohibidas. |
| 4 | Auth.js con Google (dominio restringido) + GitHub, y roles | Un usuario fuera del dominio no entra; un analista no ve las acciones de decisor. |
| 5 | Cliente de la Web API de Sonar, con paginación | Test contra respuestas grabadas. |
| 6 | Job `sincronizar-sonar` + endpoint de cron + botón a demanda | Primera corrida carga todas las reglas de `cs` y `ts` en Pendiente; la segunda no cambia nada. |
| 7 | API de transiciones (individual y masiva) sobre la función de dominio | Un intento de incorporación masiva se rechaza. |
| 8 | Tabla de inventario: filtros, orden, selección múltiple, acciones masivas | Descarte masivo por tag con justificación común, que queda en cada decisión. |
| 9 | Vistas guardadas | Se guarda y se recupera un conjunto de filtros. |
| 10 | Detalle de regla con historial completo | El historial muestra autor, fecha y justificación de cada decisión. |
| 11 | Tablero de progreso | Porcentaje triageado por lenguaje y tipo; reglas estancadas hace más de N días. |

Al terminar el paso 11 se cumplen los cinco criterios de aceptación de 6.1 en `docs/FASE-6.md`.

---

## 9. Puntos a confirmar

| # | Punto | Por qué importa |
|---|---|---|
| A | **Confidencialidad.** El inventario de reglas no tiene código de clientes, pero la entrega 6.5 guarda fragmentos de código en `muestra_prueba`, y la Fase 7 guarda `evidencia` de los hallazgos. Eso sí es código de clientes alojado en un tercero. | Hay que confirmar que es aceptable antes de llegar a 6.5, o decidir ahí que se guardan solo referencias (archivo + línea) sin el fragmento. |
| B | **¿La app queda expuesta a internet?** | En Vercel lo está por defecto. Si hace falta restringir, se puede con Vercel Firewall o exigiendo VPN, pero conviene decidirlo antes de desplegar. |
| C | D6.6 — frecuencia de sincronización | Se asume diaria hasta que se defina. |
| D | D6.4 — período mínimo de prueba | Recién hace falta en 6.5. |
| E | D6.5 — repositorios del job de prueba | Recién hace falta en 6.5. |
