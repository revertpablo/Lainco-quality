# Un repositorio nuevo de C# con las reglas de Lainco

Cómo hacer que un repositorio use las reglas que el equipo incorporó en la app de catálogo.
Las reglas llegan por **dos caminos**, y hay que configurar los dos:

| Camino | Qué reglas | Dónde se ven | Qué hay que configurar |
|---|---|---|---|
| Paquete NuGet `Lainco.Analyzers` | Las propias (`LAIN###`), con el `.globalconfig` que enciende las incorporadas. Desde la 0.3.0, además, una base que apaga todo lo demás: analyzers del SDK (`CA`, `IDE`), de otros paquetes y advertencias del compilador (`CS`) | En el IDE y en el build; en Sonar, como issues externos | El feed de GitHub Packages, `Directory.Build.props` |
| Quality Profile `Lainco C#` de SonarQube Cloud | Las de Sonar que la app incorporó | En Sonar, después de cada análisis del CI | El proyecto en Sonar y el workflow que lo analiza |

El quality gate `Lainco` (falla ante issues nuevos) se aplica a las dos, en Sonar.

> Todo apunta todavía a la **cuenta de prueba** (`revertpablo`): el feed, la organización de
> Sonar y los links de documentación de las reglas. Al pasar a la cuenta de Lainco cambian
> esas URLs y claves (ver "Cuentas y accesos" en `ESTADO.md`).

---

## Con el script

`tools/nuevo-repositorio/Configurar-RepositorioLainco.ps1` hace casi todo. Funciona en
Windows PowerShell 5.1 y en PowerShell 7, se puede repetir (lo que ya está hecho no se
toca) y con `-WhatIf` muestra lo que haría sin cambiar nada.

### Antes de correrlo

| Qué | Para qué |
|---|---|
| `git` y `dotnet` | Siempre. |
| `gh` (GitHub CLI) con sesión iniciada (`gh auth login`), con permiso de administración sobre el repositorio | Para guardar el secret `SONAR_TOKEN` y, con `-ProtegerMain`, proteger `main`. Sin `gh`, esos pasos quedan en la lista de pendientes. |
| `LAINCO_PACKAGES_TOKEN`: un token clásico de GitHub con `read:packages` | Las credenciales del feed en esta máquina (solo la primera vez: después quedan en el `NuGet.Config` del usuario) y, si el repositorio no lo tiene, el secret `ANALYZERS_NUGET_GITHUB_TOKEN` del workflow. Para el secret conviene el de un usuario técnico: el workflow restaura a su nombre. |
| `LAINCO_SONAR_ADMIN_TOKEN`: un token de SonarQube Cloud de alguien que administra la organización | Crear el proyecto (si hace falta), asignarle perfil y gate, y generar el token de análisis del CI. Conviene que sea de un usuario técnico: el token de análisis queda a su nombre. |
| El token de solo lectura de issues de cada programador | Para `LAINCO_SONAR_TOKEN` (la pide el script en Windows si no está definida). |

Si una variable falta, el script la pide sin mostrarla. Ningún token se imprime ni se
escribe en el repositorio.

**Recomendado:** importar antes el repositorio en SonarQube Cloud desde la web (**+ →
Analyze new project**, organización `revertpablo`). Así el proyecto queda vinculado a GitHub
y el resultado del quality gate aparece como check en los PRs. Si no existe, el script lo
avisa y para la parte de Sonar; con `-CrearProyectoSonar` lo crea por la API, pero sin ese
vínculo.

### Correrlo

Desde la raíz del repositorio nuevo (o desde cualquier lado, con `-Ruta` o la ruta completa
de `-Solucion`; corrido dentro de `Lainco-quality` sin ninguno de los dos, se niega):

```powershell
$script = "C:\Lainco\Github\Lainco-quality\tools\nuevo-repositorio\Configurar-RepositorioLainco.ps1"

& $script -WhatIf                 # qué haría
& $script -ProtegerMain           # hacerlo, y que main exija el check de Sonar
```

Si Windows no deja correr scripts, para esta consola:
`Set-ExecutionPolicy -Scope Process Bypass`.

Parámetros que pueden hacer falta:

| Parámetro | Cuándo |
|---|---|
| `-Solucion ruta\a.sln` | El repositorio tiene más de una solución (si no, el script lo pide). Puede ser relativa a la raíz o la ruta completa: con la ruta completa y sin `-Ruta`, el repositorio es el que contiene la solución, se corra desde donde se corra. Las `.slnx` las compila el SDK 10 que instala el workflow. |
| `-Repositorio owner/repo` | El remoto `origin` no es de GitHub. |
| `-ProyectoSonar clave` | La clave en Sonar no es `owner_repo` (la que pone Sonar al importar). |
| `-VersionDelPaquete 0.2.0` | Fijar una versión en lugar de la del último release. |
| `-CrearProyectoSonar` | Crear el proyecto de Sonar por la API si no existe. |
| `-RenovarTokenSonar` | Reemplazar el secret `SONAR_TOKEN` por un token nuevo. |
| `-CompiladorEnLocal` | Agregar `LaincoCompiladorEnLocal=true` a `Directory.Build.props`: las advertencias del compilador se ven en local y no llegan a Sonar (ver "Qué apaga el paquete"). Necesita el paquete 0.4.0 o posterior. |
| `-SinSonar` / `-SinCredenciales` | Saltear la parte de Sonar, o la de esta máquina (feed y `LAINCO_SONAR_TOKEN`). |
| `-VersionDotnet 9.0.x` | El SDK que instala el workflow, si no sirve el 10 (que compila igual proyectos de .NET 6, 8 y 9). |

### Qué hace

1. **Paquete.** Crea o completa `nuget.config` con el feed `lainco` (sin credenciales) y
   `Directory.Build.props` con `Lainco.Analyzers` en la última versión publicada y la clave
   del proyecto de Sonar. Lo que el repositorio ya definió no lo pisa, salvo la versión del
   paquete; si algo difiere de lo esperado, lo avisa. Avisa también si algún `.csproj`
   referencia el paquete por su cuenta, y si `Directory.Build.props` todavía define
   `EnableNETAnalyzers`, `EnforceCodeStyleInBuild` o `AnalysisLevel`, que desde la 0.3.0 fija
   el paquete (ver "Qué apaga el paquete").
2. **Workflow.** Crea `.github/workflows/sonar.yml` (la plantilla de abajo) si no existe.
   Con `gh`, guarda además el secret `ANALYZERS_NUGET_GITHUB_TOKEN` (con
   `LAINCO_PACKAGES_TOKEN`) si el repositorio no lo tiene.
3. **Esta máquina.** Guarda las credenciales del feed en el `NuGet.Config` del usuario (en
   Windows, cifradas) y, en Windows, define `LAINCO_SONAR_TOKEN` como variable de usuario.
   Si el feed ya estaba registrado con otro nombre (`github-lainco`, de la guía anterior), lo
   renombra a `lainco`.
4. **Sonar.** Apaga el análisis automático, asigna el perfil `Lainco C#` y el quality gate
   `Lainco`, genera un token de análisis y lo guarda como secret `SONAR_TOKEN` del
   repositorio, sin mostrarlo.
5. **`main`** (con `-ProtegerMain`). Si no tiene reglas de protección, exige el check
   `SonarCloud Code Analysis`. Si ya tiene, no las toca y lo deja como pendiente.

Al final lista lo que quedó **a mano**: siempre, revisar y commitear los archivos; sin `gh`,
también el secret del feed (abajo, paso 2).

**Verificado** con PowerShell 7 contra servidores simulados de Sonar y GitHub: repositorio
vacío, repositorio con configuración propia (`nuget.config` con `<clear/>`, otra versión del
paquete, dos soluciones), feed registrado con el nombre viejo, `-WhatIf` (no cambia nada) y
segunda corrida (no repite nada). El workflow generado pasa `actionlint`. **Falta probarlo
contra SonarQube Cloud y GitHub reales**: en particular, la API que apaga el análisis
automático no está documentada; si falla, el script lo avisa y lo deja como pendiente.

---

## A mano

Lo mismo que hace el script, paso por paso.

### 1. El paquete

**Credenciales del feed**, una vez por máquina, con un token clásico de GitHub con
`read:packages` (GitHub Packages lo pide aunque el repositorio sea público):

```powershell
dotnet nuget add source "https://nuget.pkg.github.com/revertpablo/index.json" `
  --name lainco --username <usuario-de-github> --password <token> `
  --configfile "$env:APPDATA\NuGet\NuGet.Config"
```

**`nuget.config`** en la raíz del repositorio, sin credenciales (el workflow las toma del
secret `ANALYZERS_NUGET_GITHUB_TOKEN`; cada programador, de su `NuGet.Config`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="lainco" value="https://nuget.pkg.github.com/revertpablo/index.json" />
  </packageSources>
</configuration>
```

El nombre de la fuente tiene que ser el mismo en los dos lados (`lainco`): NuGet busca las
credenciales por nombre.

**`Directory.Build.props`** en la raíz, para que lo tomen todos los proyectos:

```xml
<Project>
  <PropertyGroup>
    <!-- Con LAINCO_SONAR_TOKEN, el IDE oculta los issues aceptados en Sonar (Fase 4). -->
    <LaincoSonarProyecto>owner_repo</LaincoSonarProyecto>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Lainco.Analyzers" Version="0.3.0" PrivateAssets="all" />
  </ItemGroup>
</Project>
```

La versión es la del último release de `Lainco-quality`. Las reglas LAIN nacen apagadas y
las enciende el `.globalconfig` del paquete: cuando la app publica una versión nueva (porque
se incorporó o descartó una regla propia), **subir la versión acá** (o volver a correr el
script) es lo que la trae al repositorio.

#### Qué apaga el paquete

Desde la 0.3.0, **no hay que configurar ninguna advertencia en el repositorio**: el paquete
trae dos `.globalconfig` y fija tres propiedades.

| Pieza | Qué hace |
|---|---|
| `Lainco.Analyzers.Base.globalconfig` | Apaga los diagnósticos de cualquier analyzer (`dotnet_analyzer_diagnostic.severity = none`). Tiene `global_level = -1`. |
| `Lainco.Analyzers.Base.Compilador.globalconfig` | Apaga, uno por uno, todas las advertencias del compilador de C# (`CS####`), con la misma prioridad. Con `LaincoCompiladorEnLocal`, solo en CI (abajo). |
| `Lainco.Analyzers.globalconfig` | El que genera la app: enciende las reglas incorporadas. Tiene más prioridad que la base, y una severidad por ID siempre le gana a la configuración masiva, así que lo que enciende se ve. |
| `EnableNETAnalyzers` y `EnforceCodeStyleInBuild` en `true` | Cargan los analyzers del SDK (`CA`, `IDE`) también en el build y en CI. Sin esto, una regla `CA` o `IDE` que la app encendiera no aparecería, sin ningún aviso. Con todo apagado, el compilador ni los ejecuta. |
| `AnalysisLevel` en `none` | Con cualquier otro valor, el SDK suma su propio `.globalconfig` con una severidad por ID para cada regla `CA`, que le ganaría a la base. |

El paquete fija las tres propiedades después del `Directory.Build.props` del repositorio, así
que pisa lo que diga ese archivo. Un `.csproj` todavía puede cambiarlas, porque se evalúa
después; no hay que hacerlo.

**Advertencias del compilador solo en local (opcional).** Con

```xml
<LaincoCompiladorEnLocal>true</LaincoCompiladorEnLocal>
```

en el `PropertyGroup` del `Directory.Build.props` (o el script con `-CompiladorEnLocal`), las advertencias del compilador (`CS####`)
se ven en el IDE y en el build de cada programador, pero en CI se apagan y no llegan a Sonar.
Es una excepción al principio rector que decide cada repositorio: por defecto (sin la
propiedad) se apagan en los dos lados. El paquete detecta CI con las variables `CI`,
`GITHUB_ACTIONS` o `TF_BUILD`, o la propiedad `ContinuousIntegrationBuild`; GitHub Actions
define las dos primeras. Los analyzers (`CA`, `IDE`, de otros paquetes) siguen apagados en los
dos lados, y lo que encienda la app aparece en los dos.

Lo que la base **no** alcanza: las reglas de Sonar del análisis de CI (las configura el
escáner, con su propio ruleset), los errores, y los avisos de MSBuild y NuGet (`NETSDK####`,
`NU####`), que no son del compilador. Tampoco se usan `NoWarn` ni `WarningLevel` para
apagar advertencias: el compilador los aplica antes que los `.globalconfig`, y la app ya no
podría volver a encender esa regla.

**`LAINCO_SONAR_TOKEN`**: variable de entorno de usuario con el token de solo lectura de
issues. Sin ella el build funciona igual, pero el IDE muestra también los issues aceptados.

### 2. El secret del feed

El workflow restaura `Lainco.Analyzers` con el secret `ANALYZERS_NUGET_GITHUB_TOKEN`: un token
clásico de GitHub con `read:packages` (**Settings → Secrets and variables → Actions** del
repositorio). Conviene que sea de un usuario técnico.

No alcanza con el `GITHUB_TOKEN` del workflow: el paquete está en la cuenta `revertpablo`, y
el permiso de leerlo desde Actions (**Manage Actions access** del paquete) solo se puede dar
a repositorios del mismo dueño. Un repositorio de otra organización necesita un token propio.
Sin el secret, o con un token vencido, el workflow falla al restaurar con un `401` o `403`
del feed.

### 3. SonarQube Cloud

1. Importar el repositorio: **+ → Analyze new project**, organización `revertpablo`. La clave
   queda `owner_repo`.
2. **Administration → Analysis Method**: apagar **Automatic Analysis**. Si queda prendido,
   Sonar rechaza el análisis del workflow.
3. **Administration → Quality Profiles**: C# con `Lainco C#` (es el default de la
   organización, así que normalmente ya está).
4. **Administration → Quality Gate**: `Lainco`.
5. Un token de análisis (**My Account → Security**), como secret `SONAR_TOKEN` del
   repositorio en GitHub (**Settings → Secrets and variables → Actions**).

### 4. El workflow

`.github/workflows/sonar.yml`, cambiando la clave del proyecto y la solución:

```yaml
name: Sonar

on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:      # para correrlo a mano

permissions:
  contents: read
  packages: read        # Lainco.Analyzers, de GitHub Packages
  pull-requests: read

jobs:
  analisis:
    name: Análisis
    runs-on: ubuntu-latest
    env:
      # Credenciales del feed "lainco" de nuget.config (paso 2: el secret del feed).
      NuGetPackageSourceCredentials_lainco: Username=${{ github.actor }};Password=${{ secrets.ANALYZERS_NUGET_GITHUB_TOKEN }}

    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0          # el "código nuevo" del quality gate necesita el historial

      - uses: actions/setup-java@v6   # el SonarScanner corre sobre la JVM
        with:
          distribution: zulu
          java-version: 21

      - uses: actions/setup-dotnet@v6
        with:
          dotnet-version: 10.0.x     # compila .slnx y proyectos de .NET 6 en adelante

      - name: Cachear los plugins de Sonar
        uses: actions/cache@v6
        with:
          path: ~/.sonar/cache
          key: ${{ runner.os }}-sonar
          restore-keys: ${{ runner.os }}-sonar

      - name: Cachear el SonarScanner
        uses: actions/cache@v6
        with:
          path: ~/.dotnet/tools
          key: ${{ runner.os }}-sonarscanner
          restore-keys: ${{ runner.os }}-sonarscanner

      - name: Instalar el SonarScanner
        run: dotnet tool install --global dotnet-sonarscanner || dotnet tool update --global dotnet-sonarscanner

      - name: Sonar — begin
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
        run: |
          dotnet sonarscanner begin /k:"owner_repo" /o:"revertpablo" \
            /d:sonar.token="$SONAR_TOKEN" /d:sonar.host.url="https://sonarcloud.io" \
            /d:sonar.exclusions="**/*.sql,**/*.css,**/*.scss,**/*.less,**/*.json,**/*.ps1,**/*.psm1,**/*.psd1,**/*.yml,**/*.yaml"

      - name: Build
        run: dotnet build "Solucion.sln" --no-incremental

      - name: Sonar — end
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
        run: dotnet sonarscanner end /d:sonar.token="$SONAR_TOKEN"
```

`sonar.exclusions` deja afuera del análisis los archivos SQL, CSS, JSON, PowerShell y YAML.
Para esos lenguajes no hay perfil de Lainco, y Sonar usaría el suyo ("Sonar way core"): llegarían
issues de reglas que nadie eligió. Quedan afuera de todo el análisis, incluida la detección de
secretos. Si un repositorio necesita analizar alguno, se saca de la lista.

### 5. Que el gate bloquee

En GitHub, **Settings → Branches**: una regla para `main` que exija el check
**SonarCloud Code Analysis**. Sin ella, el gate avisa pero se puede mergear igual.

### 6. Opcional: la prueba de reglas

Para que el job nocturno mida también acá las reglas En prueba: sumar el repositorio a
`PRUEBA_REPOSITORIOS` en Vercel (`owner/repo`, o `owner/repo:ruta/a.sln` si tiene varias
soluciones) y redesplegar. Si es privado, el job necesita el secret `PRUEBA_GITHUB_TOKEN`
(ver "Prueba de reglas" en `app/README.md`).

---

## Si algo no anda

| Síntoma | Causa probable |
|---|---|
| El restore falla en el workflow con `401`/`403` de `nuget.pkg.github.com` | Falta el secret `ANALYZERS_NUGET_GITHUB_TOKEN`, o el token venció o no tiene `read:packages` (paso 2). |
| El restore falla en una máquina con `401` | Faltan las credenciales del feed, o están con otro nombre que el de `nuget.config`. |
| Sonar rechaza el análisis porque el análisis automático está activo | Paso 3.2. |
| El análisis anda pero no aparece el check en los PRs | El proyecto no está vinculado a GitHub (se creó por la API): importarlo o vincularlo en Sonar. |
| El build se rompe con los warnings LAIN | El repositorio tiene `TreatWarningsAsErrors`. Las reglas propias son `warning` a propósito: el que bloquea es el quality gate. |
| En el IDE aparecen issues ya aceptados en Sonar | Falta `LAINCO_SONAR_TOKEN` o `LaincoSonarProyecto`. |
| Aparecen advertencias `CS`, `CA` o `IDE` que nadie eligió (en el build o en Sonar, como `external_roslyn:...`) | El repositorio usa una versión del paquete anterior a la 0.3.0, o un `.csproj` cambia `EnableNETAnalyzers`, `AnalysisLevel` o agrega `NoWarn`/`WarningLevel`. |
| La app encendió una regla `CA`, `CS` o `IDE` y no aparece | Lo mismo: versión del paquete anterior a la 0.3.0, o un `.csproj` que define `AnalysisLevel` o un `NoWarn` con ese código. |
