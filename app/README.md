# Catálogo de reglas

App de la **Fase 6**: inventario de reglas y su ciclo de vida. Diseño en
`docs/FASE-6.md`; stack y plan de implementación en `docs/FASE-6-APP.md`.

Next.js 16 (App Router) + TypeScript, Postgres (Neon) con Drizzle, desplegada en Vercel.

## Estado

Entrega 6.1, **paso 1** (scaffold y conexión a la base). La página de inicio es
provisoria: solo muestra si la base responde. Se reemplaza por el inventario en el paso 8.

## Puesta en marcha

Requisitos: **Node.js 20.9 o más nuevo** y la CLI de Vercel (`npm i -g vercel`).
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

`.env.example` lista las variables que hacen falta. Nunca se commitean valores reales.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` | Build de producción. **No necesita la base**: lo que la consulta corre en cada pedido, no en el build. |
| `npm start` | Sirve el build de producción. |
| `npm run typecheck` | Genera los tipos de rutas de Next y corre `tsc`. |
| `npm run lint` | ESLint. |

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
│   └── db/           # Conexión a Postgres (cliente.ts) y chequeo (salud.ts).
└── .env.example
```

El resto de la estructura (`dominio/`, `sonar/`, `ui/`, `drizzle/`, `tests/`) se agrega
en los pasos siguientes, según `docs/FASE-6-APP.md`, sección 7.
