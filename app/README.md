# Catálogo de reglas

App de la **Fase 6**: inventario de reglas y su ciclo de vida. Diseño en
`docs/FASE-6.md`; stack y plan de implementación en `docs/FASE-6-APP.md`.

Next.js 16 (App Router) + TypeScript, Postgres (Neon) con Drizzle, desplegada en Vercel.

## Estado

Entrega 6.1, **paso 3** (máquina de estados). La página de inicio es
provisoria: solo muestra si la base responde. Se reemplaza por el inventario en el paso 8.

## Puesta en marcha

Requisitos: **Node.js 22.12 o más nuevo** (lo pide Vitest; Next pide 20.9) y la CLI de
Vercel (`npm i -g vercel`).
Todos los comandos se corren **dentro de `app/`**.

### Una sola vez por proyecto (ya hecho si el proyecto de Vercel existe)

```bash
cd app
vercel link                        # crea o elige el proyecto de Vercel
vercel integration add neon        # aprovisiona Neon Postgres y le inyecta DATABASE_URL
```

En **Project Settings → Build and Deployment → Root Directory** del proyecto de Vercel,
poner `app`: la app no está en la raíz del repo.

### En cada máquina

```bash
cd app
vercel link                        # elegir el proyecto existente
vercel env pull .env.local         # baja DATABASE_URL (no se commitea)
npm install
npm run dev
```

Abrir <http://localhost:3000>: tiene que decir **"Base de datos conectada"** con la
versión de Postgres. Si dice "No hay conexión", el mensaje indica la causa.

## Base de datos

El esquema está en `src/db/esquema.ts`; las migraciones, versionadas, en `drizzle/`.

```bash
npm run db:migrate      # aplica las migraciones pendientes a la base de DATABASE_URL
```

`db:migrate` usa la misma `DATABASE_URL` que `npm run dev`: la de `.env.development.local`
o, si no está ahí, la de `.env.local`. Una `DATABASE_URL` definida en la consola tiene
prioridad sobre los archivos. Es seguro correrlo varias veces: solo aplica lo que falta,
y lleva la cuenta en la tabla `drizzle.__drizzle_migrations`.

### Convenciones

- **Todo en camelCase**: tablas, columnas, claves, índices y restricciones, igual que en
  TypeScript. En SQL escrito a mano van entre comillas dobles:
  `select "reglaId", "estado" from "estadoRegla"`.
- **Conjuntos cerrados de valores** (estados, orígenes, lenguajes, roles, estados de
  sincronización) como **tablas de referencia**, no como enums de Postgres:
  - `codigo`: fijo, es lo que usa el programa. Los códigos están definidos en
    `src/dominio/valores.ts`.
  - `descripcion`: el texto que se le muestra al usuario. Se puede corregir con una
    migración sin tocar código.
  - `orden`: el orden en listados y filtros.

  Las columnas que los usan son claves foráneas a `codigo`, así que la base rechaza un
  código que no existe. **Un código nuevo se agrega en los dos lados**: en
  `src/dominio/valores.ts` y con una migración que lo inserte en su tabla.

### Bases por entorno

Lo recomendado, con la integración de Neon en Vercel: **una base (branch de Neon) por
entorno**. Un branch de Neon es una copia de la base, con su propia URL, que se crea
en segundos.

| Entorno | Base | Cómo se configura |
|---|---|---|
| **Production** | Branch principal de Neon (`main`) | Es lo que deja configurado `vercel integration add neon`. |
| **Preview** (un deploy por PR) | Un branch por deploy, `preview/<rama-de-git>`, copia de producción | En Vercel: **Storage → la base de Neon → Connect Project → Advanced Options → Deployments Configuration**, activar **Required → Preview** y **"Resource must be active before deployment"**. Cada deploy de preview recibe su propia `DATABASE_URL`. |
| **Development** | Un branch propio, por ejemplo `desarrollo` | 1. En la consola de Neon, crear el branch `desarrollo` a partir de `main`. 2. En la conexión de la base con el proyecto de Vercel, **destildar Development**. 3. `vercel env add DATABASE_URL development` y pegar la URL *pooled* del branch `desarrollo`. 4. En cada máquina, `vercel env pull .env.local`. |

Si alguien quiere su propia base (un Postgres local o un branch de Neon personal), la
pone en `.env.development.local`: ese archivo tiene prioridad sobre `.env.local`, que
es el que pisa `vercel env pull`.

**Migrar cada entorno.** Development se migra con `npm run db:migrate`, que usa los
archivos locales. Para migrar otro entorno, se pasa su URL por la consola:

```powershell
$env:DATABASE_URL = "<URL del branch>"; npm run db:migrate; Remove-Item Env:DATABASE_URL
```

Los branches de Preview nacen como copia de producción, así que traen sus migraciones
pero **no las del PR**: cuando se configure el despliegue, las migraciones van a tener
que correr como parte del build de Preview y Production. Queda para cuando se despliegue
la app.

### Cambiar el esquema

1. Editar `src/db/esquema.ts`.
2. `npm run db:generate -- --name <que_cambia>` genera la migración en `drizzle/`.
   Revisar el SQL antes de commitearlo.
3. `npm run db:migrate` la aplica.

Lo que Drizzle no sabe expresar (por ejemplo, datos iniciales) va en una migración escrita
a mano: `npx drizzle-kit generate --custom --name <nombre>` crea el archivo vacío.

**Nunca se edita una migración ya aplicada** en alguna base: se agrega otra.

`npm run db:studio` abre Drizzle Studio para mirar los datos.

### Qué hay hoy

| Migración | Qué hace |
|---|---|
| `0000_esquema_inicial` | Tablas de la entrega 6.1: `usuario`, `regla`, `estadoRegla`, `decision`, `sincronizacion`, `vistaGuardada`, y las tablas de referencia `estado`, `origen`, `lenguaje`, `rol`, `estadoSincronizacion`. |
| `0001_valores_de_referencia` | Códigos y descripciones de las tablas de referencia. |
| `0002_decisores_iniciales` | Seed de los decisores de D6.1: Federico Sánchez y Pablo A. Revert. |

Las tablas de las entregas siguientes (publicación, sugerencias de IA, relaciones,
pruebas) se agregan con su propia migración cuando se implementan.

`.env.example` lista las variables que hacen falta. Nunca se commitean valores reales.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` | Build de producción. **No necesita la base**: lo que la consulta corre en cada pedido, no en el build. |
| `npm start` | Sirve el build de producción. |
| `npm run typecheck` | Genera los tipos de rutas de Next y corre `tsc`. |
| `npm run lint` | ESLint. |
| `npm test` | Tests (Vitest). |
| `npm run db:generate` | Genera una migración a partir de los cambios en `src/db/esquema.ts`. |
| `npm run db:migrate` | Aplica las migraciones pendientes. |
| `npm run db:studio` | Drizzle Studio. |

## Ciclo de vida de las reglas

`src/dominio/transiciones.ts` define la máquina de estados de `docs/FASE-6.md`
(sección 4). La tabla `TRANSICIONES` es **la única definición** de qué cambios de estado
existen y qué exige cada uno:

| Campo | Qué significa |
|---|---|
| `requiereJustificacion` | Hace falta una justificación escrita (no vale solo espacios). |
| `requiereSeveridad` | Hace falta elegir la severidad con la que se incorpora. |
| `requiereDecisor` | Solo la puede hacer alguien con rol decisor. |
| `requiereResultadosDePrueba` | Hacen falta resultados de prueba. Hoy en `false` en todas: se activa en En prueba → Incorporada con la entrega 6.5. |
| `admiteMasiva` | Se puede aplicar a varias reglas a la vez. Hoy en `true` en toda transición que no va a Incorporada. |

Para cambiar una regla del ciclo de vida se toca **solo su fila**. Los tests
(`tests/dominio/transiciones.test.ts`) comparan la tabla contra el diseño de
`FASE-6.md` y garantizan, entre otras cosas, que Pendiente de analizar → Incorporada no
exista y que ninguna transición hacia Incorporada admita operación masiva.

`validarTransicion` valida una solicitud contra la tabla y devuelve todos los motivos de
rechazo juntos; `MENSAJES_DE_RECHAZO` tiene el texto para el usuario de cada uno.

## Chequeo de salud

`GET /api/salud` devuelve `200` si la base responde y `503` si no. No requiere sesión y
no expone datos (solo si la base contesta y la latencia): sirve para verificar un
despliegue.

## Notas de Next.js 16

- **Cache Components está activo** (`cacheComponents` en `next.config.ts`). Todo lo que
  lee la base en cada pedido llama a `connection()` y va dentro de un `<Suspense>`: si
  no, Next intenta prerenderizarlo en el build. Ver `src/app/page.tsx`.
- `middleware` ahora se llama **`proxy`** (se va a usar en el paso 4, autenticación).
- `AGENTS.md` lo escribe `next dev`: apunta a la documentación de esta versión de Next,
  que está en `node_modules/next/dist/docs/`.
- Fuentes del sistema en lugar de `next/font/google`, para que el build no dependa de
  la red.

## Estructura

```
app/
├── src/
│   ├── app/          # Rutas (App Router). api/salud: chequeo de salud.
│   ├── db/           # Esquema (esquema.ts), conexión (cliente.ts), chequeo (salud.ts).
│   └── dominio/      # Reglas del negocio, sin I/O: valores.ts (códigos), transiciones.ts (ciclo de vida).
├── tests/            # Tests (Vitest). tests/dominio/ no necesita base ni red.
├── drizzle/          # Migraciones versionadas. Se commitean.
├── drizzle.config.ts
└── .env.example
```

El resto de la estructura (`sonar/`, `ui/`) se agrega
en los pasos siguientes, según `docs/FASE-6-APP.md`, sección 7.
