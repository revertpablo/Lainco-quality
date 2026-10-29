# Estado del proyecto

Dónde está cada fase y qué sigue. **Actualizar al cerrar cada entrega.**

Última actualización: **2026-10-19**.

---

## Resumen

| Fase | Estado |
|---|---|
| 0 — Setup | ✅ Completa |
| 1 — Primera regla y empaquetado | ✅ Completa. El paquete se publica en GitHub Packages desde la 6.4 (0.1.0, 2026-10-28) |
| 2 — Circuito con SonarQube Cloud | ✅ Completa, se verifico que luego de aceptar el issue en Sonar y al mover, no se reportó en el Sonar |
| 3 — Reglas restantes (LAIN001, 002, 003, 005, 006) | 🟡 En curso: LAIN005 completa (vista en IDE y en Sonar); LAIN001 implementada (2026-10-28) y en el paquete 0.2.0, falta verla en Sonar |
| 4 — Suppressor | ✅ Completa |
| 5 — TypeScript | ⬜ Sin empezar |
| 6 — App de catálogo | 🟡 Entrega 6.1 terminada: los 11 pasos (scaffold, esquema y migraciones, máquina de estados, ingreso y roles, cliente de Sonar, sincronización, API de transiciones, inventario, vistas guardadas, detalle e historial, tablero de progreso), con los cinco criterios de aceptación cubiertos por tests. Entrega 6.2 terminada (2026-10-28): los 7 pasos (tablas `publicacion` y `desvio`, cliente de perfiles, encolar al decidir, publicar con reintentos, reconciliación y desvíos, pantalla Sonar, prueba contra SonarQube Cloud), con sus dos criterios de aceptación verificados contra los perfiles reales. Plan y decisiones P1–P5 en `FASE-6-APP.md`, sección 8 bis. Entrega 6.4 (reglas propias, parte Roslyn), adelantada a la 6.3 porque esta espera D6.2 y D6.3: plan en 8 pasos y decisiones R1–R5 en `FASE-6-APP.md`, sección 8 ter; los 8 pasos hechos (2026-10-28 y 29): el catálogo `reglas-roslyn.json` con su generador `tools/catalogo-reglas`, enganchado al build del paquete; el workflow que publica el paquete y crea el release al subir la versión, verificado con la publicación de la 0.1.0; la sincronización de las reglas Roslyn desde el último release, verificada contra GitHub (el primer criterio de la 6.4 se cumple); el ciclo de vida de las reglas propias, que se incorporan con su severidad y encolan el PR de configuración; la generación del `.globalconfig` desde el estado de la app; la decisión R6: las reglas propias nacen apagadas y las enciende ese archivo; el PR de configuración, que la app abre o actualiza con cada decisión (probado contra GitHub: PR #2, mergeado); y el seguimiento en la pantalla Paquete (PRs, versión publicada y el desvío si main no coincide con la app). Entrega 6.4 (parte Roslyn) terminada (2026-10-29): en el paso 8, el workflow publicó la 0.1.1 al mergear el PR #2 y la 0.2.0 con LAIN001, que la sincronización trajo al inventario; los dos criterios se cumplen contra GitHub. La parte ESLint espera la Fase 5. Entrega 6.5 (En prueba, parte C#): plan en 8 pasos y decisiones E1–E7 en `FASE-6-APP.md`, sección 8 quater (2026-10-29); resuelven el punto A (las muestras guardan solo referencias), D6.4 (N corridas) y D6.5 (lista configurable de repositorios). Pasos 1 a 4 hechos: los tokens de servicio con los que el job entra a `/api/ci/`, las tablas de corridas, resultados y muestras con las funciones puras de la prueba, la ruta con la que el job abre una corrida y recibe qué probar, y el job (workflow `Prueba de reglas`, el `.targets` que agrega los analyzers sin tocar el repositorio y el reductor de SARIF), probado en la nube con repositorios locales; la primera corrida en GitHub va con el paso 8. Ver `app/README.md` |
| 7 — Hallazgos de IA y revisores | ⬜ Sin empezar |
| 8 — Warnings del compilador | ⬜ Sin empezar (posterior) |

---

## Lo que está funcionando hoy

- **LAIN004** implementada, con 13 tests (6 positivos, 7 negativos).
- **LAIN005** implementada, con 29 tests (13 positivos, 16 negativos). D5 resuelta.
- **LAIN001** implementada, con 32 casos de test (18 positivos, 14 negativos). Cuenta los
  constructores escritos en el código (incluido el primario); en una clase `sealed` acepta
  también `private`. Las entidades (`Lainco.Domain.IEntity`, directa o heredada) que
  declaran constructores tienen que tener uno sin parámetros, también si son abstractas. Nace apagada: en la sample dispara en `Pedido.cs` solo cuando el
  `.globalconfig` la enciende. Detalle en `rules/LAIN001.md`.
- **Paquete NuGet `Lainco.Analyzers` 0.1.0**, con los analyzers en `analyzers/dotnet/cs`
  y el `.globalconfig` de severidades en `buildTransitive`.
- **`tools/sonar-sync`** genera `sonar-accepted.json` con los issues LAIN aceptados o falsos
  positivos en Sonar. 36 tests, sin dependencias de NuGet.
- **El paquete `Lainco.Analyzers`** trae sonar-sync y un `.targets` que la corre antes de
  cada build local (cada 8 horas, nunca en CI, nunca rompe el build). La sample tiene
  `LaincoSonarProyecto`. Probado con un repo consumidor de prueba en 13 escenarios.
- **`Lainco.Analyzers.Suppressor`** oculta en el IDE y en el build local los issues que
  figuran en `sonar-accepted.json` (archivo + regla + mensaje). 19 tests. Probado de punta
  a punta con el compilador real. Solo actúa con `LaincoSuppressAccepted` en `true`: el
  `.targets` la fuerza a `false` en CI.
- La **sample** consume el paquete y produce advertencias solo de reglas LAIN: LAIN004
  (×2, en `Articulo.cs`) y LAIN005 (en `CalculadorDeTotales.cs`).
- **GitHub Actions** analiza la sample en cada push a `main` y en cada PR.
- Los issues **llegan a SonarQube Cloud** como `external_roslyn:LAIN004`.
- El **quality gate `Lainco`** falla ante un issue nuevo (verificado con el PR #1).

## Fase 4 — criterios de aceptación

| Criterio | Estado |
|---|---|
| Aceptar un issue en Sonar y refrescar hace que desaparezca del IDE | ✅ |
| En CI el issue sigue llegando a Sonar y sigue figurando como aceptado | ✅ |
| Sin token o sin red, el build local funciona igual | ✅ (probado: sin token, Sonar caído, timeout, token rechazado) |

## Fase 2 — qué falta

| Criterio de aceptación | Estado |
|---|---|
| El issue de LAIN004 aparece en Sonar como issue externo | ✅ |
| El PR con una violación nueva hace fallar el quality gate | ✅ (PR #1) |
| No aparece ningún issue que no sea LAIN | ✅ (total = 1) |
| Spike de proyectos de test resuelto y documentado | ✅ (`decisiones/spike-issues-en-tests.md`) |
| **Un issue aceptado sigue aceptado después de moverse de línea** | ⬜ **PENDIENTE** |

### La prueba de persistencia (lo único que falta)

Es el criterio más importante que queda: valida la convención de mensajes con nombre
completamente calificado, de la que dependen la **Fase 4** (el suppressor matchea por
archivo + regla + mensaje) y la **Fase 7** entera.

Pasos:

1. En SonarCloud, aceptar el issue de LAIN004 en `Sample.Dominio/Articulo.cs`.
2. Mover el código de línea **sin cambiar el símbolo** (por ejemplo, agregar líneas
   arriba de la property).
3. Pushear y esperar el análisis.
4. Confirmar que el issue sigue aceptado y no reaparece como nuevo.

Si falla, hay que repensar cómo se identifican los issues entre corridas, y eso afecta
el diseño de las fases 4 y 7.

---

## Tareas sueltas pendientes

| Qué | Dónde | Por qué importa |
|---|---|---|
| **Branch protection sobre `main`** | GitHub → Settings → Branches | Hoy el check de SonarCloud falla pero GitHub deja mergear igual. Requerir el check `SonarCloud Code Analysis` convierte el aviso en bloqueo. |
| **Descartar la rama `prueba/quality-gate` y el PR #1** | GitHub | Son temporales, de la prueba del gate. **No se mergean.** Cerrar el PR y borrar la rama cuando la prueba de persistencia esté hecha (el issue de ese PR sirve si se quiere probar sobre el PR en vez de `main`). |
| **Actualizar acciones deprecadas del workflow** | `.github/workflows/sonar.yml` | `setup-java@v4` y Node 20 avisan deprecación. No rompe nada todavía. |

---

## Decisiones

### Resueltas

| # | Decisión |
|---|---|
| D1 | CI: **GitHub Actions** |
| D2 | NHibernate: **Fluent NHibernate (`ClassMap<T>`)** |
| D7 | Paquetes: **NuGet en GitHub Packages**, npm en npmjs.com |
| D8 | App de catálogo: **Next.js + TypeScript + Neon Postgres en Vercel** (`FASE-6-APP.md`) |
| D8.1 | `CS1591` se apaga **en todos lados**, vía el `.globalconfig` del paquete |
| D8.3 | Los analyzers del SDK **entran al inventario** |
| D5 | LAIN005: se exceptúan en la regla los operators, el `Main` que es **punto de entrada real** y los extension methods sobre tipos **definidos fuera del proyecto** que se compila (incluye otros proyectos de la solución). Además se exceptúan las fuentes de datos de `[MemberData]` de xUnit. Detalle en `rules/LAIN005.md` |
| D6.1 | Decisores iniciales: **Federico Sánchez** y **Pablo Revert** (seed). El resto entra como analista. Los cambios de rol se van a hacer desde la app; hasta que haya pantalla de usuarios, por SQL |
| 6-B | La app queda **pública con login** (Google restringido al dominio de Lainco; GitHub solo para usuarios dados de alta) |

### Abiertas — hacen falta para la Fase 3

| # | Decisión |
|---|---|
| D3 | LAIN002: ¿el constructor `protected` sin parámetros queda exceptuado de encadenar? |
| D4 | LAIN002: ¿el encadenamiento puede ser transitivo o debe ser directo? |
| D6 | LAIN006: qué tipos cuentan como "query a base" además de `IQueryable<T>` |

Hay además una decisión **nueva**, surgida del spike: **sobre qué archivo exactamente
reporta LAIN003**. Un issue sobre un archivo de test que no cambió no entra al código
nuevo, así que agregar una entidad sin su test podría no bloquear nada. Detalle en
`decisiones/spike-issues-en-tests.md`.

Las demás (D6.x, D7.x, D8.2) recién hacen falta en sus fases.

---

## Cuentas y accesos

> ⚠️ **Todo esto es una cuenta de prueba**, creada solo para validar la arquitectura. Al
> pasar a la cuenta definitiva de Lainco hay que actualizar la clave de organización en
> `setup-sonarcloud.md`, el `RepositoryUrl` de `Lainco.Analyzers.Package.csproj` y el
> `BaseUrl` de `Convenciones.cs` (el `helpLinkUri` de las reglas).

| Servicio | Dato |
|---|---|
| Repositorio | `https://github.com/revertpablo/Lainco-quality` (público) |
| Organización de Sonar | `revertpablo` |
| Project key | `revertpablo_Lainco-quality` |
| Quality Profiles | `Lainco C#` y `Lainco Typescript`, vacíos y Default. Hasta el 2026-10-19 el default era "Sonar way comprehensive" (el proyecto usaba los nuestros por asociación explícita); desde la 6.2 la app avisa si dejan de ser default |
| Quality Gate | `Lainco` — una condición: `new_violations > 0` |
| Plan de Sonar | Trial de Team plan con downgrade automático a Free el 17/10/2026. Nada de lo que usamos es premium. |

**Lo que necesita quien continúe:**

1. **GitHub** — acceso de escritura al repo. El repo es público, así que clonar y leer no
   requiere nada; para pushear hace falta ser colaborador.
2. **SonarCloud** — ser miembro de la organización `revertpablo`, con permisos de
   administración si va a tocar Quality Profiles o el Quality Gate.
3. El secret `SONAR_TOKEN` **ya está cargado** en el repo; no hay que regenerarlo.

---

## Puesta en marcha en otra máquina

Requisitos: **.NET SDK 8** (o superior), **git**, y `gh` opcional.

```bash
git clone https://github.com/revertpablo/Lainco-quality.git
cd Lainco-quality

# 1. Tests de los analyzers y el suppressor — deben pasar todos
dotnet test src/dotnet/Lainco.Analyzers.sln

# 2. Empaquetar: la sample consume el paquete desde este feed local,
#    que está en .gitignore y hay que generar en cada máquina.
dotnet pack src/dotnet/Lainco.Analyzers.Package -c Release -o artifacts/nupkg

# 3. Build de la sample — debe dar 3 advertencias: LAIN004 ×2 y LAIN005
dotnet build samples/SampleSolution/SampleSolution.sln
```

Si el paso 3 no muestra las advertencias de alguna regla nueva, es casi seguro el cache
de NuGet: al reempaquetar la misma versión con contenido distinto, NuGet sirve la vieja. Se limpia con
`rm -rf ~/.nuget/packages/lainco.analyzers/0.1.0` y se repite desde el paso 2.

No hay nada más que configurar: no hacen falta tokens ni variables de entorno para
trabajar en local. Los secretos solo viven en el CI.

---

## Qué leer, y en qué orden

1. **`CONCEPTO.md`** — qué se está construyendo y por qué. Sin implementación; se lee en diez minutos y alcanza para entender la maquinaria completa.
2. **Este archivo** — dónde estamos parados.
3. **`../CLAUDE.md`** — principio rector, arquitectura, gobernanza y convenciones.
4. **`PLAN.md`** — las fases, con tareas y criterios de aceptación.
5. `decisiones/` — resultados de los spikes, con lo que cada uno midió y concluyó.
6. `FASE-6.md`, `FASE-6-APP.md`, `FASE-7.md` — diseño detallado de lo que viene después.
7. `setup-sonarcloud.md` y `publicacion-de-paquetes.md` — pasos manuales.
