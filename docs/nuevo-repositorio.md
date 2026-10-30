# Un repositorio nuevo de C# con las reglas de Lainco

Cómo hacer que un repositorio use las reglas que el equipo incorporó en la app de catálogo.
Las reglas llegan por **dos caminos**, y hay que configurar los dos:

| Camino | Qué reglas | Dónde se ven | Qué hay que configurar |
|---|---|---|---|
| Paquete NuGet `Lainco.Analyzers` | Las propias (`LAIN###`), con el `.globalconfig` que enciende las incorporadas | En el IDE y en el build; en Sonar, como issues externos | El feed de GitHub Packages, `Directory.Build.props` |
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
| `LAINCO_PACKAGES_TOKEN`: un token clásico de GitHub con `read:packages` | Las credenciales del feed en esta máquina. Solo la primera vez: después quedan en el `NuGet.Config` del usuario. |
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

Desde la raíz del repositorio nuevo:

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
| `-Solucion ruta\a.sln` | El repositorio tiene más de una solución (si no, el script lo pide). |
| `-Repositorio owner/repo` | El remoto `origin` no es de GitHub. |
| `-ProyectoSonar clave` | La clave en Sonar no es `owner_repo` (la que pone Sonar al importar). |
| `-VersionDelPaquete 0.2.0` | Fijar una versión en lugar de la del último release. |
| `-CrearProyectoSonar` | Crear el proyecto de Sonar por la API si no existe. |
| `-RenovarTokenSonar` | Reemplazar el secret `SONAR_TOKEN` por un token nuevo. |
| `-SinSonar` / `-SinCredenciales` | Saltear la parte de Sonar, o la de esta máquina (feed y `LAINCO_SONAR_TOKEN`). |
| `-VersionDotnet 9.0.x` | El SDK que instala el workflow, si el repositorio no es de .NET 8. |

### Qué hace

1. **Paquete.** Crea o completa `nuget.config` con el feed `lainco` (sin credenciales) y
   `Directory.Build.props` con `Lainco.Analyzers` en la última versión publicada, la clave
   del proyecto de Sonar y los analyzers del SDK apagados. Lo que el repositorio ya definió
   no lo pisa, salvo la versión del paquete; si algo difiere de lo esperado, lo avisa. Avisa
   también si algún `.csproj` referencia el paquete por su cuenta.
2. **Workflow.** Crea `.github/workflows/sonar.yml` (la plantilla de abajo) si no existe.
3. **Esta máquina.** Guarda las credenciales del feed en el `NuGet.Config` del usuario (en
   Windows, cifradas) y, en Windows, define `LAINCO_SONAR_TOKEN` como variable de usuario.
   Si el feed ya estaba registrado con otro nombre (`github-lainco`, de la guía anterior), lo
   renombra a `lainco`.
4. **Sonar.** Apaga el análisis automático, asigna el perfil `Lainco C#` y el quality gate
   `Lainco`, genera un token de análisis y lo guarda como secret `SONAR_TOKEN` del
   repositorio, sin mostrarlo.
5. **`main`** (con `-ProtegerMain`). Si no tiene reglas de protección, exige el check
   `SonarCloud Code Analysis`. Si ya tiene, no las toca y lo deja como pendiente.

Al final lista lo que quedó **a mano**: siempre, darle al repositorio acceso al paquete
(abajo, paso 2), y revisar y commitear los archivos.

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
`GITHUB_TOKEN`; cada programador, de su `NuGet.Config`):

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
    <!-- A Sonar solo llegan reglas elegidas: los analyzers del SDK, apagados hasta la Fase 8. -->
    <EnableNETAnalyzers>false</EnableNETAnalyzers>
    <EnforceCodeStyleInBuild>false</EnforceCodeStyleInBuild>
    <AnalysisLevel>none</AnalysisLevel>
    <!-- Con LAINCO_SONAR_TOKEN, el IDE oculta los issues aceptados en Sonar (Fase 4). -->
    <LaincoSonarProyecto>owner_repo</LaincoSonarProyecto>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Lainco.Analyzers" Version="0.2.0" PrivateAssets="all" />
  </ItemGroup>
</Project>
```

La versión es la del último release de `Lainco-quality`. Las reglas LAIN nacen apagadas y
las enciende el `.globalconfig` del paquete: cuando la app publica una versión nueva (porque
se incorporó o descartó una regla propia), **subir la versión acá** (o volver a correr el
script) es lo que la trae al repositorio.

**`LAINCO_SONAR_TOKEN`**: variable de entorno de usuario con el token de solo lectura de
issues. Sin ella el build funciona igual, pero el IDE muestra también los issues aceptados.

### 2. Acceso del repositorio al paquete

El paquete está vinculado a `Lainco-quality`, y por defecto solo ese repositorio lo puede
leer desde Actions. En
<https://github.com/users/revertpablo/packages/nuget/Lainco.Analyzers/settings> → **Manage
Actions access** → **Add repository**: el repositorio nuevo, con rol **Read**. Sin esto, el
workflow falla al restaurar con un `401` o `403` del feed. No hay API para hacerlo: el
script no puede.

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

permissions:
  contents: read
  packages: read        # Lainco.Analyzers, de GitHub Packages
  pull-requests: read

jobs:
  analisis:
    name: Análisis
    runs-on: ubuntu-latest
    env:
      # Credenciales del feed "lainco" de nuget.config (paso 2: acceso al paquete).
      NuGetPackageSourceCredentials_lainco: Username=${{ github.actor }};Password=${{ secrets.GITHUB_TOKEN }}

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # el "código nuevo" del quality gate necesita el historial

      - uses: actions/setup-java@v4   # el SonarScanner corre sobre la JVM
        with:
          distribution: temurin
          java-version: 17

      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: 8.0.x

      - name: Instalar el SonarScanner
        run: dotnet tool install --global dotnet-sonarscanner || dotnet tool update --global dotnet-sonarscanner

      - name: Sonar — begin
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
        run: |
          dotnet sonarscanner begin /k:"owner_repo" /o:"revertpablo" \
            /d:sonar.token="$SONAR_TOKEN" /d:sonar.host.url="https://sonarcloud.io"

      - name: Build
        run: dotnet build "Solucion.sln" --no-incremental

      - name: Sonar — end
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
        run: dotnet sonarscanner end /d:sonar.token="$SONAR_TOKEN"
```

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
| El restore falla en el workflow con `401`/`403` de `nuget.pkg.github.com` | Falta el paso 2 (acceso del repositorio al paquete). |
| El restore falla en una máquina con `401` | Faltan las credenciales del feed, o están con otro nombre que el de `nuget.config`. |
| Sonar rechaza el análisis porque el análisis automático está activo | Paso 3.2. |
| El análisis anda pero no aparece el check en los PRs | El proyecto no está vinculado a GitHub (se creó por la API): importarlo o vincularlo en Sonar. |
| El build se rompe con los warnings LAIN | El repositorio tiene `TreatWarningsAsErrors`. Las reglas propias son `warning` a propósito: el que bloquea es el quality gate. |
| En el IDE aparecen issues ya aceptados en Sonar | Falta `LAINCO_SONAR_TOKEN` o `LaincoSonarProyecto`. |
