# Estado del proyecto

Dónde está cada fase y qué sigue. **Actualizar al cerrar cada entrega.**

Última actualización: **2026-10-07**.

---

## Resumen

| Fase | Estado |
|---|---|
| 0 — Setup | ✅ Completa |
| 1 — Primera regla y empaquetado | ✅ Completa, salvo publicar el paquete al feed |
| 2 — Circuito con SonarQube Cloud | 🔶 **En curso — 4 de 5 criterios cumplidos** |
| 3 — Reglas restantes (LAIN001, 002, 003, 005, 006) | ⬜ Sin empezar |
| 4 — Suppressor | ⬜ Sin empezar |
| 5 — TypeScript | ⬜ Sin empezar |
| 6 — App de catálogo | ⬜ Sin empezar. Stack decidido, diseño en `FASE-6-APP.md` |
| 7 — Hallazgos de IA y revisores | ⬜ Sin empezar |
| 8 — Warnings del compilador | ⬜ Sin empezar (posterior) |

---

## Lo que está funcionando hoy

- **LAIN004** implementada, con 13 tests (6 positivos, 7 negativos).
- **Paquete NuGet `Lainco.Analyzers` 0.1.0**, con los analyzers en `analyzers/dotnet/cs`
  y el `.globalconfig` de severidades en `buildTransitive`.
- La **sample** consume el paquete y produce exactamente una advertencia: LAIN004.
- **GitHub Actions** analiza la sample en cada push a `main` y en cada PR.
- Los issues **llegan a SonarQube Cloud** como `external_roslyn:LAIN004`.
- El **quality gate `Lainco`** falla ante un issue nuevo (verificado con el PR #1).

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
| **Publicar el paquete en GitHub Packages** | Ver `publicacion-de-paquetes.md` | Último punto de la Fase 1. Hoy la sample lo consume de un feed local. Requiere un PAT con `write:packages`. |
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

### Abiertas — hacen falta para la Fase 3

| # | Decisión |
|---|---|
| D3 | LAIN002: ¿el constructor `protected` sin parámetros queda exceptuado de encadenar? |
| D4 | LAIN002: ¿el encadenamiento puede ser transitivo o debe ser directo? |
| D5 | LAIN005: ¿extension methods y `Main` se exceptúan, o pasan por aceptación en Sonar? |
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
| Quality Profiles | `Lainco C#` y `Lainco Typescript`, vacíos y Default |
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

# 1. Tests de los analyzers — deben pasar 13
dotnet test src/dotnet/Lainco.Analyzers.sln

# 2. Empaquetar: la sample consume el paquete desde este feed local,
#    que está en .gitignore y hay que generar en cada máquina.
dotnet pack src/dotnet/Lainco.Analyzers.Package -c Release -o artifacts/nupkg

# 3. Build de la sample — debe dar exactamente 1 advertencia, LAIN004
dotnet build samples/SampleSolution/SampleSolution.sln
```

Si el paso 3 da 0 advertencias, es casi seguro el cache de NuGet: al reempaquetar la
misma versión con contenido distinto, NuGet sirve la vieja. Se limpia con
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
