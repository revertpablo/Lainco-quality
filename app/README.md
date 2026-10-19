# Catálogo de reglas

App de la **Fase 6**: inventario de reglas y su ciclo de vida. Diseño en
`docs/FASE-6.md`; stack y plan de implementación en `docs/FASE-6-APP.md`.

Next.js 16 (App Router) + TypeScript, Postgres (Neon) con Drizzle, desplegada en Vercel.

## Estado

Entrega 6.1, **paso 8** (inventario). La pantalla principal es el inventario de reglas,
en `/reglas` (`/` lleva ahí).

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
vercel env pull .env.local         # baja DATABASE_URL y las de AUTH_ (no se commitea)
npm install
npm run dev
```

Abrir <http://localhost:3000>: lleva a la pantalla de ingreso. Para que el ingreso
funcione hacen falta las credenciales de Google y GitHub (ver [Ingreso y roles](#ingreso-y-roles)).
`GET /api/salud` dice si la base responde, sin sesión.

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
| `0003_avisos` | Tabla `aviso` y su tabla de referencia `motivoAviso` (paso 6). |

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
| `npm test` | Tests (Vitest). Los que usan la base se saltean si no está `DATABASE_URL_PRUEBAS` (ver [Tests](#tests)). |
| `npm run db:generate` | Genera una migración a partir de los cambios en `src/db/esquema.ts`. |
| `npm run db:migrate` | Aplica las migraciones pendientes. |
| `npm run db:studio` | Drizzle Studio. |
| `npm run sonar:grabar` | Graba respuestas reales de SonarQube Cloud para los tests (ver [SonarQube](#sonarqube)). |

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

### Cambiar el estado de una regla

**Todo cambio de estado pasa por `aplicarTransicion`** (`src/transiciones/aplicarTransicion.ts`).
Es la única función que escribe `estadoRegla`, y en la misma transacción escribe la
`decision`. En orden:

1. Bloquea las reglas pedidas (`SELECT ... FOR UPDATE`): dos cambios a la vez sobre la
   misma regla se hacen uno después del otro.
2. Verifica que cada regla siga en el estado que vio el usuario (`desde`). Si alguien la
   cambió mientras tanto, no se aplica.
3. Valida cada regla con `validarTransicion`, con el rol leído de la base.
4. Escribe el estado nuevo y una decisión por regla, con autor, justificación y, al
   incorporar, severidad y parámetros. Al salir de Incorporada se borran la severidad y los
   parámetros asignados; el historial los conserva.

**Todo o nada**: en una operación masiva, si una regla no puede, no cambia ninguna, y la
respuesta dice cuál y por qué. Las decisiones de una masiva comparten `loteId` y
justificación.

### API

Las dos rutas piden sesión y JSON, y rechazan pedidos de otro origen.

**`POST /api/reglas/{id}/transicion`**: una regla.

```json
{ "desde": "aRevisar", "hacia": "incorporada", "justificacion": "Bugs reales en el código",
  "severidad": "CRITICAL", "parametros": { "max": "5" } }
```

`severidad` (`BLOCKER`, `CRITICAL`, `MAJOR`, `MINOR`, `INFO`) y `parametros` solo se mandan
al incorporar. Los parámetros tienen que ser de la regla.

**`POST /api/reglas/transiciones`**: operación masiva, con una justificación común. Hasta
2.000 reglas. Siempre es masiva, aunque tenga una sola regla: hacia Incorporada se rechaza.

```json
{ "reglas": [{ "id": "…", "desde": "pendienteDeAnalizar" }, { "id": "…", "desde": "aRevisar" }],
  "hacia": "descartada", "justificacion": "Reglas de React: no usamos React" }
```

| HTTP | `error` | Cuándo |
|---|---|---|
| 200 | — | Se aplicó. Devuelve `loteId` (`null` si es individual) y las decisiones. |
| 400 | `pedidoInvalido` | El cuerpo no tiene la forma esperada. `detalles` dice qué campo. |
| 401 | `sinSesion` | No hay sesión. |
| 403 | `otroOrigen` | El pedido viene de otro sitio. |
| 404 | `noEncontradas` | Alguna regla no existe. |
| 409 | `estadoCambio` | Alguna regla ya no está en el estado `desde`. |
| 415 | `noEsJson` | El cuerpo no es JSON. |
| 422 | `rechazada` | El ciclo de vida no lo permite. `rechazos` dice, regla por regla, cada motivo con su mensaje. |

Las pantallas llaman a `aplicarTransicion` desde Server Actions, con estas mismas reglas:
la operación masiva del inventario (`src/inventario/acciones.ts`) valida el pedido con el
mismo esquema que `POST /api/reglas/transiciones`.

## Inventario

`/reglas` (FASE-6.md, sección 5). Muestra todas las reglas que cumplen los filtros, sin
paginar: el catálogo entero son unas 1.100 filas livianas, y así "seleccionar todas"
selecciona de verdad todas las filtradas.

**Filtros**: texto (clave o nombre), estado, tags, lenguaje, tipo, severidad por defecto,
atributo de clean code, origen, nuevas o modificadas en la última sincronización, y
deprecadas en Sonar (incluirlas, ocultarlas o solo esas). Con varios valores del mismo
filtro, alcanza con que coincida uno (por ejemplo, reglas con el tag `react` **o** `vue`).
Las columnas Clave, Nombre, Lenguaje, Tipo, Severidad y Estado ordenan al tocarlas.

**Los filtros viven en la URL** (`src/dominio/filtros.ts`): una búsqueda se comparte con un
link y el botón "atrás" funciona. `proxy.ts` deja cada búsqueda en una sola URL canónica
(sin campos vacíos ni valores inválidos, siempre en el mismo orden), así una vista guardada
(paso 9) es solo la URL con un nombre. El formulario de filtros funciona sin JavaScript.

**Operación masiva**: al seleccionar reglas aparece abajo una barra que ofrece solo los
cambios de estado que valen para **todas** las seleccionadas, en una operación masiva y con
el rol de quien mira (`destinosMasivos`, en `src/dominio/transiciones.ts`). Nunca ofrece
Incorporada. Si el cambio exige justificación, el botón no se habilita hasta escribirla; la
justificación queda en cada decisión. Si el servidor rechaza el cambio (por ejemplo, porque
otra persona cambió una regla mientras tanto), no se aplica nada y la barra dice por qué.

Ejemplo, el primer paso del triage: filtrar por estado **Pendiente de analizar** y tag
`react`, seleccionar todas, **Descartada**, escribir "No usamos React" y aplicar.

## Ingreso y roles

Auth.js (NextAuth v5) con dos proveedores (`docs/FASE-6-APP.md`, sección 5):

- **Google**: solo cuentas del Google Workspace de `laincosoftware.com` con el email
  verificado. Quien entra por primera vez se da de alta solo, como **analista**.
- **GitHub**: solo usuarios **ya dados de alta** por su login. Uno que no está, no entra.
- Un usuario con `activo = false` no entra por ninguno de los dos, y si tenía la sesión
  abierta la pierde en el pedido siguiente.

Quién entra lo decide `src/dominio/acceso.ts` (sin I/O, con tests). El dominio permitido
es la constante `DOMINIO_DE_LAINCO` de ese archivo.

**El rol vive en la tabla `usuario`**, no en Google ni en GitHub, y se lee de la base en
cada pedido: un cambio de rol o una baja rigen enseguida, sin esperar a que venza la
sesión. La cookie de sesión solo guarda el id del usuario.

**Qué ve cada rol.** Las acciones sobre una regla son sus transiciones.
`transicionesDisponibles(desde, rol)` (en `src/dominio/transiciones.ts`) da las que se le
muestran a cada uno, a partir de la misma tabla `TRANSICIONES` que valida el cambio: un
analista no ve las que requieren decisor, y lo que se muestra no puede discrepar con lo
que se valida.

### Dónde se verifica

| Capa | Qué hace |
|---|---|
| `src/proxy.ts` | Filtro grueso: sin sesión, redirige a `/ingresar` (o `401` en `/api/`). No va a la base. Quedan afuera `/ingresar`, `/api/auth/*`, `/api/salud` y `/api/cron/*` (que se autentica con `CRON_SECRET`). |
| `src/auth/sesion.ts` | `usuarioActual()` / `exigirUsuario()`: el usuario de la sesión leído de la base, con su rol. **Cada página, Server Action y Route Handler que toca datos lo llama**: `proxy` no alcanza (ver la guía de Next en `node_modules/next/dist/docs/01-app/02-guides/authentication.md`). |
| `src/auth/index.ts` | Configuración de Auth.js: al entrar, decide con `src/dominio/acceso.ts` y da de alta a los nuevos de Google (`src/auth/usuarios.ts`). |

### Dar de alta un usuario de GitHub

Por ahora, con SQL (la pantalla de usuarios queda para más adelante). El login va en
minúsculas, como lo exige la base:

```sql
insert into "usuario" ("nombre", "githubLogin") values ('Nombre Apellido', 'login-de-github');
```

Si la persona ya entró con Google, se completa su fila en lugar de crear otra:

```sql
update "usuario" set "githubLogin" = 'login-de-github' where "email" = 'nombre.apellido@laincosoftware.com';
```

Cambiar el rol o dar de baja, igual:

```sql
update "usuario" set "rol" = 'decisor' where "email" = 'nombre.apellido@laincosoftware.com';
update "usuario" set "activo" = false where "email" = 'nombre.apellido@laincosoftware.com';
```

### Credenciales (una sola vez)

Cinco variables, todas secretas, en el proyecto de Vercel. Después, en cada máquina,
`vercel env pull .env.local`.

| Variable | De dónde sale |
|---|---|
| `AUTH_SECRET` | Texto aleatorio de 32 bytes (abajo). **Uno distinto por entorno.** |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Cliente OAuth de Google (abajo). El mismo en los tres entornos. |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | OAuth App de GitHub (abajo). Una app para Development y otra para Production. |

`<produccion>` es el dominio de producción del proyecto de Vercel: **Settings → Domains**.

**Google.** En <https://console.cloud.google.com>, con la cuenta de `laincosoftware.com`:

1. **Proyecto**: crearlo con **Organización** `laincosoftware.com`. Si queda "Sin
   organización", después no aparece la opción **Interno**.
2. **Google Auth Platform** (o **APIs y servicios → Pantalla de consentimiento de
   OAuth**) **→ Comenzar**. En **Público**, **Interno**: Google solo deja pasar cuentas
   del Workspace, además del control de la app.
3. **Clientes → Crear cliente**, tipo **Aplicación web**. En **URIs de redireccionamiento
   autorizados**:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<produccion>/api/auth/callback/google`

   Un mismo cliente sirve para local y producción. El secreto se ve una sola vez.

**GitHub.** En la organización de GitHub, **Settings → Developer settings → OAuth Apps →
New Org OAuth App**. Una OAuth App admite **una sola** URL de callback, así que hacen falta
dos. Después de registrar cada una, **Generate a new client secret** (se ve una sola vez).

| App | Homepage URL | Authorization callback URL |
|---|---|---|
| `Catálogo de reglas (local)` | `http://localhost:3000` | `http://localhost:3000/api/auth/callback/github` |
| `Catálogo de reglas` | `https://<produccion>` | `https://<produccion>/api/auth/callback/github` |

**Cargarlas en Vercel.** Dentro de `app/`. Cada `vercel env add` pide el valor sin
mostrarlo en pantalla:

```powershell
# Google: el mismo cliente en los tres entornos
vercel env add AUTH_GOOGLE_ID production
vercel env add AUTH_GOOGLE_ID preview
vercel env add AUTH_GOOGLE_ID development
vercel env add AUTH_GOOGLE_SECRET production
vercel env add AUTH_GOOGLE_SECRET preview
vercel env add AUTH_GOOGLE_SECRET development

# GitHub: la app de producción en production, la local en development
vercel env add AUTH_GITHUB_ID production
vercel env add AUTH_GITHUB_SECRET production
vercel env add AUTH_GITHUB_ID development
vercel env add AUTH_GITHUB_SECRET development

# AUTH_SECRET: generar uno nuevo antes de cada entorno y pegarlo
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
vercel env add AUTH_SECRET production
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
vercel env add AUTH_SECRET preview
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
vercel env add AUTH_SECRET development

vercel env pull .env.local
```

`AUTH_SECRET` no se genera con `npx auth secret`: ese comando lo escribe directo en
`.env.local`, que después pisa `vercel env pull`. En Preview no se carga GitHub: ver
"Deploys de Preview" abajo.

**Probar.** `npm run dev` y abrir <http://localhost:3000>. Con Google, un decisor
cargado por seed entra como **Decisor**. Con GitHub, un login no cargado se rechaza con
"no está dada de alta"; para que entre, darlo de alta (ver arriba).

**Deploys de Preview.** Cada uno tiene una URL distinta, que no está registrada ni en
Google ni en GitHub, así que ahí el ingreso no funciona todavía. Se resuelve al configurar
el despliegue (Auth.js lo resuelve con `AUTH_REDIRECT_PROXY_URL`).

**`next start` en local** (no `next dev`): necesita `AUTH_TRUST_HOST=true`. En Vercel y en
`next dev` no hace falta.

## SonarQube

`src/sonar/cliente.ts` lee el catálogo de reglas de SonarQube Cloud con
`api/rules/search`. Lo usa la [sincronización](#sincronización-con-sonar).

- Pide las reglas de **un lenguaje** (`cs`, `ts`), en estado `READY`, `BETA` o
  `DEPRECATED`, sin las externas (`external_roslyn:LAIN005` y demás no son reglas de
  Sonar). Pagina de a 500, el máximo de la API.
- Devuelve cada regla con los nombres del dominio (`ReglaDeSonar`): clave, nombre,
  estado, tipo, severidad, tags, atributo de clean code, impactos, parámetros y
  descripción (las secciones de Sonar unidas, en HTML).
- **Trae la lista completa o falla.** Si hay más de 10.000 reglas (el límite de la API),
  si el total cambia entre páginas o si una regla viene repetida, lanza un error en vez de
  devolver una lista a medias: con una lista incompleta, la sincronización daría por
  eliminadas reglas que existen.
- Reintenta hasta 3 veces las fallas de red y los HTTP 429 y 5xx. Los 401, 403, 404 y 400
  no se reintentan; el error dice qué pasó, con el mensaje de Sonar. **Ningún error
  incluye el token.**

Variables de entorno (`src/sonar/configuracion.ts`):

| Variable | Valor |
|---|---|
| `SONAR_URL` | Opcional. Por defecto, `https://sonarcloud.io`. |
| `SONAR_ORGANIZACION` | Clave de la organización: hoy `revertpablo`. |
| `LAINCO_SONAR_TOKEN` | Token de usuario de SonarQube Cloud (**My Account → Security**). Secreto. Es **la misma variable que usa `tools/sonar-sync`**: en una máquina que ya la tiene definida, la app la toma sin más configuración, porque una variable de entorno del sistema tiene prioridad sobre los archivos `.env`. Para leer reglas alcanza cualquier token de un miembro de la organización; sin token, Sonar oculta las descripciones. Desde la entrega 6.2 la app necesita en Vercel un token que pueda administrar Quality Profiles (`docs/setup-sonarcloud.md`, paso 3.1). |

```powershell
vercel env add SONAR_ORGANIZACION production   # y preview y development
vercel env add LAINCO_SONAR_TOKEN production   # y preview; en development no hace falta si ya está en la máquina
vercel env pull .env.local
```

### Respuestas grabadas

Los tests de `tests/sonar/grabadas.test.ts` prueban el cliente contra respuestas reales de
SonarQube Cloud, guardadas en `tests/fixtures/sonar/`. Para grabarlas (o volver a
grabarlas, si Sonar cambia algo):

```powershell
npm run sonar:grabar
```

Usa las mismas variables (de la consola o de `.env.local`) y graba, en páginas de 100,
todas las reglas de `cs` y `ts` (515 y 608 el 2026-10-16), más dos errores: token inválido
y organización inexistente. Las páginas se guardan tal cual las devuelve Sonar,
comprimidas (`.json.gz`): sin comprimir pesan unos 12 MB, porque cada regla trae la
descripción en tres formatos. **El token no queda en ningún archivo.** Si algo falla, la
grabación anterior queda como estaba.

Sin grabación, esos tests se saltean; los de `tests/sonar/cliente.test.ts` (respuestas
armadas a mano) corren siempre.

Si en la terminal de VS Code falla con `ETIMEDOUT`, probar desde una terminal de
PowerShell aparte (pasó el 2026-10-16 en una red sin proxy).

### Proxy

Node no usa el proxy configurado en Windows (el navegador y .NET sí). En una red que sale
a internet por un proxy, `npm run sonar:grabar` y, en local, todo lo que consulte a Sonar
fallan con `ETIMEDOUT` o `ENETUNREACH`. En Vercel no pasa.

1. Ver qué proxy usa Windows:

   ```powershell
   netsh winhttp show proxy
   Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' |
     Select-Object ProxyEnable, ProxyServer, AutoConfigURL
   ```

   `ProxyServer` es `host:puerto`. Si en su lugar hay un `AutoConfigURL` (un archivo
   `.pac`), el proxy está escrito adentro de ese archivo.

2. Decirle a Node que use ese proxy (Node 22.21 o 24 en adelante):

   ```powershell
   $env:HTTPS_PROXY = "http://host:puerto"
   $env:NODE_USE_ENV_PROXY = "1"
   $env:NODE_USE_SYSTEM_CA = "1"   # si el proxy inspecciona HTTPS con un certificado propio
   npm run sonar:grabar
   ```

   Para no repetirlo, se pueden definir como variables de entorno de usuario en Windows.

## Sincronización con Sonar

Trae de Sonar todas las reglas de C# y TypeScript y las compara con las guardadas
(FASE-6.md, sección 3). Corre todos los días con Vercel Cron y cuando alguien toca
**Sincronizar ahora** en el encabezado (cualquier usuario con sesión: no cambia el
estado de ninguna regla).

| Caso | Qué hace |
|---|---|
| Regla nueva | La crea en **Pendiente de analizar**, asociada a la corrida que la trajo (`altaEnSincronizacionId`). Si Sonar ya la da como deprecada, entra marcada. |
| Cambió la descripción, los parámetros o la severidad por defecto | La actualiza y la marca **modificada** (`modificadaEnSincronizacionId`, `ultimaModificacion`). Si estaba Incorporada o En prueba, crea un **aviso**. |
| Cambió solo el nombre, los tags, el tipo, el atributo de clean code o los impactos | La actualiza, sin marcarla ni avisar. |
| Sonar la marca deprecada, o ya no aparece | Le pone fecha en `deprecadaEn`. Si estaba Incorporada, crea un aviso (`deprecada` o `eliminada`). |
| Estaba deprecada y vuelve a estar lista | Le saca la marca y la cuenta como modificada. |

Nunca cambia el estado del ciclo de vida de una regla. Cada corrida queda en
`sincronizacion` con su resultado y quién la disparó (vacío si fue el cron).

**Lógica y escritura, separadas.** Qué cambió lo decide `src/dominio/sincronizacion.ts`, sin
base ni red; el job (`src/sincronizacion/sincronizarSonar.ts`) trae las reglas, aplica los
cambios y registra la corrida.

**Protecciones**:
- Si Sonar no devuelve la lista completa, o no devuelve ninguna regla de un lenguaje que
  tiene reglas guardadas, la corrida termina con error y no se marca nada.
- Todos los cambios de una corrida van en una sola transacción: si algo falla, no queda
  nada a medias.
- Dos corridas a la vez (el cron y el botón) no se pisan: la transacción toma un lock de
  Postgres, y la segunda compara recién cuando terminó la primera.

### Cron

`vercel.json` programa `GET /api/cron/sincronizar-sonar` todos los días a las 9:00 UTC
(6:00 en Argentina; D6.6 sigue abierta, se asume diaria). Vercel manda
`Authorization: Bearer <CRON_SECRET>`; sin eso, la ruta responde `401`. Responde `200` con
el resumen si la corrida terminó bien y `500` si no.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # generar
vercel env add CRON_SECRET production
```

Para correrlo a mano en local, con `npm run dev` levantado:

```powershell
curl.exe -H "Authorization: Bearer $env:CRON_SECRET" http://localhost:3000/api/cron/sincronizar-sonar
```

Si la función se corta a mitad de camino (por ejemplo, por el límite de tiempo), la
corrida queda "En curso" para siempre en `sincronizacion`; la siguiente corre igual.

## Tests

`npm test` corre todos.

| Carpeta | Qué prueba | Necesita |
|---|---|---|
| `tests/dominio/` | Ciclo de vida, permisos, ingreso, comparación del catálogo. | Nada. |
| `tests/sonar/` | Cliente de Sonar, con respuestas armadas y con la grabación real. | Nada. |
| `tests/transiciones/api.test.ts` | Forma de los pedidos y respuestas de la API. | Nada. |
| `tests/auth/` | Ingreso: alta, duplicados, ingresos simultáneos, bajas. | Base de pruebas. |
| `tests/sincronizacion/` | Sincronización completa con la grabación: la primera corrida carga las 1.123 reglas, la segunda no cambia nada, cambios y avisos, corridas simultáneas. | Base de pruebas. |
| `tests/transiciones/aplicarTransicion.test.ts` | Cambios de estado individuales y masivos, todo o nada, estado cambiado, concurrencia. | Base de pruebas. |
| `tests/inventario/` | Filtros y orden del inventario. | Base de pruebas. |

La **base de pruebas** va en `DATABASE_URL_PRUEBAS`, con las migraciones aplicadas; sin esa
variable, esos tests se saltean. No usan `DATABASE_URL` a propósito, para no escribir por
error en la base de desarrollo: **los de sincronización borran todas las reglas de Sonar,
los avisos y las sincronizaciones de esa base**. Los demás crean sus propios datos (con
prefijos `prueba-ingreso-`, `PRUEBA-TRANS-`, `PRUEBA-INV-`) y los borran al terminar.

```powershell
$env:DATABASE_URL = "<URL de la base de pruebas>"; npm run db:migrate
$env:DATABASE_URL_PRUEBAS = $env:DATABASE_URL; npm test
Remove-Item Env:DATABASE_URL, Env:DATABASE_URL_PRUEBAS
```

Un branch de Neon descartable sirve como base de pruebas.

## Chequeo de salud

`GET /api/salud` devuelve `200` si la base responde y `503` si no. No requiere sesión y
no expone datos (solo si la base contesta y la latencia): sirve para verificar un
despliegue.

## Notas de Next.js 16

- **Cache Components está activo** (`cacheComponents` en `next.config.ts`). Todo lo que
  lee la sesión o la base en cada pedido va dentro de un `<Suspense>`: si no, Next intenta
  prerenderizarlo en el build. Leer la sesión ya marca el componente como dinámico; lo que
  lee la base **sin** leer la sesión llama además a `connection()` (ver
  `src/app/api/salud/route.ts`).
- `middleware` ahora se llama **`proxy`**: `src/proxy.ts`. Corre en Node.js, no en Edge.
- `AGENTS.md` lo escribe `next dev`: apunta a la documentación de esta versión de Next,
  que está en `node_modules/next/dist/docs/`.
- Fuentes del sistema en lugar de `next/font/google`, para que el build no dependa de
  la red.

## Estructura

```
app/
├── src/
│   ├── app/          # Rutas (App Router). reglas/: inventario. ingresar/: pantalla de ingreso. api/auth: Auth.js. api/salud: chequeo de salud. api/cron: jobs. api/reglas: transiciones.
│   ├── auth/         # Auth.js (index.ts, config.ts), alta y búsqueda de usuarios, sesión (sesion.ts).
│   ├── db/           # Esquema (esquema.ts), conexión (cliente.ts), chequeo (salud.ts).
│   ├── dominio/      # Reglas del negocio, sin I/O: valores.ts (códigos), transiciones.ts (ciclo de vida), acceso.ts (quién entra), sincronizacion.ts (qué cambió en Sonar), filtros.ts (filtros del inventario en la URL).
│   ├── inventario/   # Consulta del inventario y la acción de la operación masiva.
│   ├── sincronizacion/  # Job de sincronización con Sonar, acción del botón y resumen para el usuario.
│   ├── sonar/        # Cliente de la Web API de SonarQube (cliente.ts) y su configuración (configuracion.ts).
│   ├── transiciones/ # aplicarTransicion (el único que cambia estados), forma de los pedidos y respuestas de la API.
│   ├── ui/           # Componentes: encabezado, filtros, tabla con selección y barra de operación masiva.
│   └── proxy.ts      # Sin sesión, a /ingresar.
├── scripts/          # grabar-respuestas-sonar.mts: graba respuestas reales para los tests.
├── tests/            # Tests (Vitest). Ver "Tests".
│   └── fixtures/sonar/  # Respuestas grabadas de SonarQube Cloud. Se commitean.
├── drizzle/          # Migraciones versionadas. Se commitean.
├── drizzle.config.ts
├── vercel.json       # Cron de la sincronización.
└── .env.example
```
