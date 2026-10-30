<#
.SYNOPSIS
    Prepara un repositorio de C# para usar las reglas de Lainco Quality.

.DESCRIPTION
    Hace lo que se puede automatizar de docs/nuevo-repositorio.md. Se corre desde la raíz
    del repositorio (o con -Ruta) y se puede repetir: lo que ya está hecho no se toca.

    1. Paquete Lainco.Analyzers (las reglas propias, LAIN):
       - nuget.config del repositorio con el feed de GitHub Packages, sin credenciales;
       - Directory.Build.props con la referencia a la última versión publicada, la clave
         del proyecto de Sonar y los analyzers del SDK apagados (hasta la Fase 8);
       - las credenciales del feed en el NuGet.Config del usuario (nunca en el repositorio).
    2. Workflow de GitHub Actions que analiza el repositorio en SonarQube Cloud
       (.github/workflows/sonar.yml), si no existe.
    3. SonarQube Cloud (las reglas de Sonar y el quality gate): perfil "Lainco C#",
       quality gate "Lainco", análisis automático apagado y un token de análisis, que va
       directo al secret SONAR_TOKEN del repositorio en GitHub (con gh).
    4. La variable de entorno LAINCO_SONAR_TOKEN del usuario, para que el IDE oculte los
       issues aceptados en Sonar.
    5. Opcional (-ProtegerMain): que main exija el check de Sonar para mergear.

    Lo que no se puede automatizar lo lista al final: darle al repositorio acceso de
    lectura al paquete en GitHub Packages y, si se quiere, sumarlo a PRUEBA_REPOSITORIOS.

    Los tokens se leen de variables de entorno o se piden sin mostrarlos. El script nunca
    los imprime ni los escribe en archivos del repositorio.

.PARAMETER Ruta
    Raíz del repositorio. Por defecto, la carpeta actual.

.PARAMETER Repositorio
    owner/repo en GitHub. Por defecto, el del remoto origin.

.PARAMETER ProyectoSonar
    Clave del proyecto en SonarQube Cloud. Por defecto, owner_repo: la que pone Sonar al
    importar el repositorio desde GitHub.

.PARAMETER Solucion
    La solución que compila el workflow de Sonar. Por defecto, la única .sln o .slnx del
    repositorio.

.PARAMETER VersionDelPaquete
    Versión de Lainco.Analyzers. Por defecto, la del último release.

.PARAMETER CrearProyectoSonar
    Si el proyecto no existe en Sonar, lo crea por la API. Sin esto, el script pide
    importarlo desde la web, que además lo vincula con GitHub (el check en los PRs).

.PARAMETER RenovarTokenSonar
    Genera un token de análisis nuevo aunque el secret SONAR_TOKEN ya exista.

.PARAMETER ProtegerMain
    Si main no tiene reglas de protección, exige el check "SonarCloud Code Analysis".

.PARAMETER SinSonar
    No toca SonarQube Cloud ni el secret SONAR_TOKEN.

.PARAMETER SinCredenciales
    No configura las credenciales del feed ni LAINCO_SONAR_TOKEN en esta máquina (por
    ejemplo, si ya lo hizo otro repositorio).

.EXAMPLE
    .\Configurar-RepositorioLainco.ps1 -WhatIf
    Muestra lo que haría, sin cambiar nada.

.EXAMPLE
    $env:LAINCO_SONAR_ADMIN_TOKEN = "<token>"; .\Configurar-RepositorioLainco.ps1 -Ruta C:\Lainco\Github\Dico -ProtegerMain

.NOTES
    Variables de entorno que lee (si faltan, las pide):
      LAINCO_PACKAGES_TOKEN     Token clásico de GitHub con read:packages, para el feed.
      LAINCO_SONAR_ADMIN_TOKEN  Token de SonarQube Cloud de alguien que administra la
                                organización: crea el proyecto, le asigna perfil y gate, y
                                genera el token de análisis.
      LAINCO_SONAR_TOKEN        El de solo lectura de issues de cada programador.
    Requiere git, dotnet y, para el secret y la protección de main, gh (GitHub CLI) con
    sesión iniciada. Funciona en Windows PowerShell 5.1 y en PowerShell 7.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $Ruta = (Get-Location).Path,
    [string] $Repositorio,
    [string] $ProyectoSonar,
    [string] $Solucion,
    [string] $VersionDelPaquete,
    [string] $OrganizacionSonar = 'revertpablo',
    [string] $PerfilSonar = 'Lainco C#',
    [string] $QualityGate = 'Lainco',
    [string] $RepositorioDeReglas = 'revertpablo/Lainco-quality',
    [string] $DuenoDelFeed = 'revertpablo',
    [string] $VersionDotnet = '8.0.x',
    [switch] $CrearProyectoSonar,
    [switch] $RenovarTokenSonar,
    [switch] $ProtegerMain,
    [switch] $SinSonar,
    [switch] $SinCredenciales,
    # Para probar el script contra servidores simulados.
    [string] $SonarUrl = 'https://sonarcloud.io',
    [string] $GitHubApi = 'https://api.github.com'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
trap {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'No se terminó: corregí lo que dice y volvé a correr el script (lo que ya hizo no se repite).' -ForegroundColor Red
    exit 1
}
if ($PSVersionTable.PSVersion.Major -lt 6) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

$NombreDelFeed = 'lainco'
$UrlDelFeed = "https://nuget.pkg.github.com/$DuenoDelFeed/index.json"
$CheckDeSonar = 'SonarCloud Code Analysis'
$EsWindows = [IO.Path]::DirectorySeparatorChar -eq '\'

$script:Hecho = New-Object System.Collections.Generic.List[string]
$script:Pendiente = New-Object System.Collections.Generic.List[string]
$script:Avisos = New-Object System.Collections.Generic.List[string]

function Escribir-Paso([string] $texto) { Write-Host ''; Write-Host "== $texto" -ForegroundColor Cyan }
function Hecho([string] $texto) { $script:Hecho.Add($texto); Write-Host "   ok  $texto" -ForegroundColor Green }
function Igual([string] $texto) { Write-Host "   --  $texto" -ForegroundColor DarkGray }
function Aviso([string] $texto) { $script:Avisos.Add($texto); Write-Host "   !!  $texto" -ForegroundColor Yellow }
function Pendiente([string] $texto) { $script:Pendiente.Add($texto) }

function Leer-Secreto([string] $variable, [string] $pregunta) {
    $valor = [Environment]::GetEnvironmentVariable($variable)
    if ($valor) { return $valor }
    $seguro = Read-Host -Prompt "$pregunta (o definí $variable)" -AsSecureString
    $valor = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
    if (-not $valor) { throw "Falta $variable." }
    return $valor
}

function Hay-Comando([string] $nombre) { [bool](Get-Command $nombre -CommandType Application -ErrorAction SilentlyContinue) }

function Escribir-Archivo([string] $ruta, [string] $contenido) {
    # UTF-8 sin BOM y fines de línea de la plataforma, como los escribiría un editor.
    $contenido = ($contenido -replace "`r`n", "`n") -replace "`n", [Environment]::NewLine
    $carpeta = Split-Path -Parent $ruta
    if (-not (Test-Path $carpeta)) { New-Item -ItemType Directory -Path $carpeta -Force | Out-Null }
    [IO.File]::WriteAllText($ruta, $contenido, (New-Object Text.UTF8Encoding($false)))
}

function Guardar-Xml([xml] $documento, [string] $ruta) {
    $ajustes = New-Object Xml.XmlWriterSettings
    $ajustes.Indent = $true
    $ajustes.IndentChars = '  '
    $ajustes.OmitXmlDeclaration = -not ($documento.FirstChild -is [Xml.XmlDeclaration])
    $ajustes.Encoding = New-Object Text.UTF8Encoding($false)
    $escritor = [Xml.XmlWriter]::Create($ruta, $ajustes)
    try { $documento.Save($escritor) } finally { $escritor.Dispose() }
    [IO.File]::AppendAllText($ruta, [Environment]::NewLine)
}

function Leer-Xml([string] $ruta) {
    $documento = New-Object Xml.XmlDocument
    $documento.PreserveWhitespace = $false
    $documento.Load($ruta)
    return $documento
}

# ------------------------------------------------------------------- llamadas HTTP

function Invocar-Sonar([string] $metodo, [string] $ruta, [hashtable] $parametros = @{}) {
    $cabeceras = @{ Authorization = "Bearer $script:TokenSonar" }
    $url = "$SonarUrl/$ruta"
    try {
        if ($metodo -eq 'GET') {
            $consulta = ($parametros.GetEnumerator() | ForEach-Object { "$($_.Key)=$([Uri]::EscapeDataString([string]$_.Value))" }) -join '&'
            if ($consulta) { $url = "$url`?$consulta" }
            return Invoke-RestMethod -Method Get -Uri $url -Headers $cabeceras
        }
        return Invoke-RestMethod -Method Post -Uri $url -Headers $cabeceras -Body $parametros -ContentType 'application/x-www-form-urlencoded'
    }
    catch {
        $estado = $null
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) { $estado = [int]$_.Exception.Response.StatusCode }
        $detalle = $null
        if ($_.ErrorDetails) { $detalle = $_.ErrorDetails.Message }
        # Sonar responde {"errors":[{"msg":"..."}]}: se muestra solo el mensaje.
        try { $detalle = (@(($detalle | ConvertFrom-Json).errors) | ForEach-Object { $_.msg }) -join ' ' } catch { }
        if (-not $detalle) { $detalle = $_.Exception.Message }
        throw (New-Object Exception("Sonar respondió $estado a $metodo $ruta`: $detalle"))
    }
}

function Invocar-Gh([string[]] $argumentos, [string] $entrada) {
    # gh (GitHub CLI) con los argumentos dados; la entrada (un secreto) va por stdin, nunca
    # como argumento. Se busca el ejecutable: PowerShell no distingue mayúsculas, y un
    # "& gh" a secas podría llamar a una función con ese nombre.
    $ejecutable = Get-Command gh -CommandType Application | Select-Object -First 1
    if ($PSBoundParameters.ContainsKey('entrada')) { $salida = $entrada | & $ejecutable @argumentos 2>&1 }
    else { $salida = & $ejecutable @argumentos 2>&1 }
    return [pscustomobject]@{ Codigo = $LASTEXITCODE; Salida = ($salida | Out-String).Trim() }
}

# ------------------------------------------------------------------- 0. el repositorio

Escribir-Paso 'Repositorio'
$Ruta = (Resolve-Path $Ruta).Path
if (-not (Hay-Comando git)) { throw 'Falta git.' }
& git -C $Ruta rev-parse --is-inside-work-tree 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw "$Ruta no es un repositorio de git." }
$raiz = (& git -C $Ruta rev-parse --show-toplevel).Trim()
if ($raiz) { $Ruta = (Resolve-Path $raiz).Path }

if (-not $Repositorio) {
    $remoto = (& git -C $Ruta remote get-url origin 2>$null)
    if ($remoto -match 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/]+?)(\.git)?/?$') {
        $Repositorio = "$($Matches.owner)/$($Matches.repo)"
    }
    else { throw 'No se pudo deducir owner/repo del remoto origin: pasalo con -Repositorio.' }
}
if ($Repositorio -notmatch '^[\w.-]+/[\w.-]+$') { throw "-Repositorio tiene que ser owner/repo: $Repositorio" }
$owner, $repo = $Repositorio.Split('/')
if (-not $ProyectoSonar) { $ProyectoSonar = "${owner}_$repo" }

if (-not $Solucion) {
    $soluciones = @(& git -C $Ruta ls-files '*.sln' '*.slnx' | Where-Object { $_ })
    if ($soluciones.Count -eq 1) { $Solucion = $soluciones[0] }
    elseif ($soluciones.Count -eq 0) { throw 'El repositorio no tiene una .sln o .slnx commiteada: pasala con -Solucion.' }
    else { throw "Hay $($soluciones.Count) soluciones ($($soluciones -join ', ')): elegí una con -Solucion." }
}
$Solucion = $Solucion -replace '\\', '/'
if (-not (Test-Path (Join-Path $Ruta $Solucion))) { throw "No existe la solución $Solucion." }
Write-Host "   $Repositorio en $Ruta"
Write-Host "   Solución: $Solucion · Proyecto de Sonar: $ProyectoSonar"

# ------------------------------------------------------------------- 1. el paquete

Escribir-Paso 'Paquete Lainco.Analyzers'
if (-not $VersionDelPaquete) {
    try {
        $release = Invoke-RestMethod -Uri "$GitHubApi/repos/$RepositorioDeReglas/releases/latest" -Headers @{ 'User-Agent' = 'lainco-quality' }
        $VersionDelPaquete = ([string]$release.tag_name).TrimStart('v')
    }
    catch { throw "No se pudo leer el último release de $RepositorioDeReglas ($($_.Exception.Message)): pasá la versión con -VersionDelPaquete." }
}
Write-Host "   Versión: $VersionDelPaquete"

# nuget.config: el feed, sin credenciales (en CI las pone el workflow; en cada máquina, el
# NuGet.Config del usuario).
$rutaNuget = Join-Path $Ruta 'nuget.config'
if (-not (Test-Path $rutaNuget)) {
    if ($PSCmdlet.ShouldProcess($rutaNuget, 'Crear con el feed de Lainco')) {
        Escribir-Archivo $rutaNuget @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <!--
    El feed de Lainco.Analyzers (GitHub Packages). Sin credenciales: cada programador las
    tiene en su NuGet.Config de usuario, y el workflow de Sonar las toma del GITHUB_TOKEN.
    Ver docs/nuevo-repositorio.md en $RepositorioDeReglas.
  -->
  <packageSources>
    <add key="$NombreDelFeed" value="$UrlDelFeed" />
  </packageSources>
</configuration>
"@
        Hecho 'nuget.config creado con el feed de Lainco.'
    }
}
else {
    $xml = Leer-Xml $rutaNuget
    $fuentes = $xml.SelectSingleNode('/configuration/packageSources')
    $existente = $xml.SelectSingleNode("/configuration/packageSources/add[@value='$UrlDelFeed']")
    if ($existente) {
        $NombreDelFeed = $existente.GetAttribute('key')
        Igual "nuget.config ya tiene el feed ($NombreDelFeed)."
        if ($NombreDelFeed -notmatch '^[A-Za-z0-9_]+$') {
            Aviso "El feed se llama ""$NombreDelFeed"" en nuget.config: el workflow pasa las credenciales en la variable NuGetPackageSourceCredentials_$NombreDelFeed, y con ese nombre puede no funcionar. Conviene renombrarlo a lainco."
        }
    }
    elseif ($PSCmdlet.ShouldProcess($rutaNuget, 'Agregar el feed de Lainco')) {
        if (-not $fuentes) { $fuentes = $xml.DocumentElement.AppendChild($xml.CreateElement('packageSources')) }
        $nuevo = $xml.CreateElement('add')
        $nuevo.SetAttribute('key', $NombreDelFeed)
        $nuevo.SetAttribute('value', $UrlDelFeed)
        $fuentes.AppendChild($nuevo) | Out-Null
        Guardar-Xml $xml $rutaNuget
        Hecho 'nuget.config: se agregó el feed de Lainco.'
    }
}

# Directory.Build.props: la referencia y las propiedades que faltan; lo que el repositorio
# ya definió no se pisa, salvo la versión del paquete, que se lleva a la pedida.
$rutaProps = Join-Path $Ruta 'Directory.Build.props'
if (-not (Test-Path $rutaProps)) {
    if ($PSCmdlet.ShouldProcess($rutaProps, "Crear con Lainco.Analyzers $VersionDelPaquete")) {
        Escribir-Archivo $rutaProps @"
<Project>

  <!-- Lainco Quality: ver docs/nuevo-repositorio.md en $RepositorioDeReglas. -->

  <PropertyGroup>
    <!--
      A Sonar solo llegan reglas que el equipo eligió: los analyzers del SDK (CA, IDE) quedan
      apagados hasta que entren al inventario (Fase 8).
    -->
    <EnableNETAnalyzers>false</EnableNETAnalyzers>
    <EnforceCodeStyleInBuild>false</EnforceCodeStyleInBuild>
    <AnalysisLevel>none</AnalysisLevel>

    <!-- Proyecto de SonarQube Cloud: con LAINCO_SONAR_TOKEN, el IDE oculta los issues aceptados. -->
    <LaincoSonarProyecto>$ProyectoSonar</LaincoSonarProyecto>
  </PropertyGroup>

  <ItemGroup>
    <!-- Las reglas propias y su .globalconfig. Para tomar una decisión nueva de la app, subir la versión. -->
    <PackageReference Include="Lainco.Analyzers" Version="$VersionDelPaquete" PrivateAssets="all" />
  </ItemGroup>

</Project>
"@
        Hecho "Directory.Build.props creado (Lainco.Analyzers $VersionDelPaquete)."
    }
}
else {
    $xml = Leer-Xml $rutaProps
    $proyecto = $xml.DocumentElement
    $cambios = New-Object System.Collections.Generic.List[string]

    $referencia = $xml.SelectSingleNode("//PackageReference[@Include='Lainco.Analyzers']")
    if ($referencia) {
        $actual = $referencia.GetAttribute('Version')
        if ($actual -ne $VersionDelPaquete) {
            $referencia.SetAttribute('Version', $VersionDelPaquete)
            $cambios.Add("Lainco.Analyzers $actual → $VersionDelPaquete")
        }
        if ($referencia.GetAttribute('PrivateAssets') -ne 'all') {
            $referencia.SetAttribute('PrivateAssets', 'all')
            $cambios.Add('PrivateAssets="all"')
        }
    }
    else {
        $grupo = $xml.CreateElement('ItemGroup')
        $referencia = $xml.CreateElement('PackageReference')
        $referencia.SetAttribute('Include', 'Lainco.Analyzers')
        $referencia.SetAttribute('Version', $VersionDelPaquete)
        $referencia.SetAttribute('PrivateAssets', 'all')
        $grupo.AppendChild($referencia) | Out-Null
        $proyecto.AppendChild($grupo) | Out-Null
        $cambios.Add("referencia a Lainco.Analyzers $VersionDelPaquete")
    }

    $propiedades = [ordered]@{
        EnableNETAnalyzers      = 'false'
        EnforceCodeStyleInBuild = 'false'
        AnalysisLevel           = 'none'
        LaincoSonarProyecto     = $ProyectoSonar
    }
    $grupoDePropiedades = $null
    foreach ($nombre in $propiedades.Keys) {
        $definida = $xml.SelectSingleNode("//PropertyGroup/$nombre")
        if ($definida) {
            if ($definida.InnerText.Trim() -ne $propiedades[$nombre]) {
                Aviso "Directory.Build.props ya define $nombre = $($definida.InnerText.Trim()); se respeta, pero lo esperado es $($propiedades[$nombre]) (ver docs/nuevo-repositorio.md)."
            }
            continue
        }
        if (-not $grupoDePropiedades) {
            $grupoDePropiedades = $xml.CreateElement('PropertyGroup')
            $proyecto.InsertBefore($grupoDePropiedades, $proyecto.FirstChild) | Out-Null
        }
        $elemento = $xml.CreateElement($nombre)
        $elemento.InnerText = $propiedades[$nombre]
        $grupoDePropiedades.AppendChild($elemento) | Out-Null
        $cambios.Add("$nombre = $($propiedades[$nombre])")
    }

    if ($cambios.Count -eq 0) { Igual 'Directory.Build.props ya está configurado.' }
    elseif ($PSCmdlet.ShouldProcess($rutaProps, 'Actualizar: ' + ($cambios -join '; '))) {
        Guardar-Xml $xml $rutaProps
        Hecho ('Directory.Build.props: ' + ($cambios -join '; ') + '.')
    }
}

$duplicadas = @(Get-ChildItem -Path $Ruta -Recurse -Include '*.csproj' -File -ErrorAction SilentlyContinue |
    Where-Object { (Get-Content $_.FullName -Raw) -match 'Include="Lainco\.Analyzers"' })
foreach ($p in $duplicadas) {
    Aviso "$($p.FullName.Substring($Ruta.Length + 1)) también referencia Lainco.Analyzers: conviene sacarla y dejar solo la de Directory.Build.props."
}

# ------------------------------------------------------------------- 2. el workflow

Escribir-Paso 'Workflow de Sonar'
$rutaWorkflow = Join-Path $Ruta '.github/workflows/sonar.yml'
if (Test-Path $rutaWorkflow) {
    Igual '.github/workflows/sonar.yml ya existe: no se toca. Compararlo con la plantilla de docs/nuevo-repositorio.md.'
}
elseif ($PSCmdlet.ShouldProcess($rutaWorkflow, 'Crear')) {
    $variableDeCredenciales = "NuGetPackageSourceCredentials_$NombreDelFeed"
    Escribir-Archivo $rutaWorkflow @"
# Análisis en SonarQube Cloud (Lainco Quality, docs/nuevo-repositorio.md en $RepositorioDeReglas).
#
# Corre las reglas de Sonar que la app de catálogo incorporó (perfil "$PerfilSonar") y las
# propias del paquete Lainco.Analyzers, que llegan a Sonar como issues externos. El quality
# gate "$QualityGate" falla ante issues nuevos.

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
      # Credenciales del feed "$NombreDelFeed" de nuget.config. El repositorio necesita acceso de
      # lectura al paquete (ver docs/nuevo-repositorio.md).
      ${variableDeCredenciales}: Username=`${{ github.actor }};Password=`${{ secrets.GITHUB_TOKEN }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          # Sonar necesita el historial completo para el "código nuevo" del quality gate.
          fetch-depth: 0

      - name: Instalar Java
        # El SonarScanner corre sobre la JVM, aunque el proyecto sea .NET.
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - name: Instalar .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: $VersionDotnet

      - name: Cachear el SonarScanner
        uses: actions/cache@v4
        with:
          path: ~/.dotnet/tools
          key: `${{ runner.os }}-sonarscanner
          restore-keys: `${{ runner.os }}-sonarscanner

      - name: Instalar el SonarScanner
        run: |
          dotnet tool install --global dotnet-sonarscanner || \
          dotnet tool update --global dotnet-sonarscanner

      - name: Sonar — begin
        env:
          SONAR_TOKEN: `${{ secrets.SONAR_TOKEN }}
        run: |
          dotnet sonarscanner begin \
            /k:"$ProyectoSonar" \
            /o:"$OrganizacionSonar" \
            /d:sonar.token="`$SONAR_TOKEN" \
            /d:sonar.host.url="https://sonarcloud.io"

      - name: Build
        run: dotnet build "$Solucion" --no-incremental

      - name: Sonar — end
        env:
          SONAR_TOKEN: `${{ secrets.SONAR_TOKEN }}
        run: dotnet sonarscanner end /d:sonar.token="`$SONAR_TOKEN"
"@
    Hecho '.github/workflows/sonar.yml creado.'
}
Pendiente "Dar acceso de lectura al paquete: https://github.com/users/$DuenoDelFeed/packages/nuget/Lainco.Analyzers/settings → Manage Actions access → Add repository → $Repositorio (Read). Sin eso, el workflow no puede restaurar el paquete."

# ------------------------------------------------------------------- 3. credenciales locales

Escribir-Paso 'Credenciales en esta máquina'
if ($SinCredenciales) {
    Igual 'Omitido (-SinCredenciales).'
}
else {
    if (-not (Hay-Comando dotnet)) { throw 'Falta dotnet.' }
    if ($EsWindows) { $configDeUsuario = Join-Path $env:APPDATA 'NuGet/NuGet.Config' }
    else { $configDeUsuario = Join-Path $HOME '.nuget/NuGet/NuGet.Config' }

    $fuenteDeUsuario = $null
    $tieneCredenciales = $false
    if (Test-Path $configDeUsuario) {
        $xmlDeUsuario = Leer-Xml $configDeUsuario
        $fuenteDeUsuario = $xmlDeUsuario.SelectSingleNode("/configuration/packageSources/add[@value='$UrlDelFeed']")
        if ($fuenteDeUsuario) {
            $clave = $fuenteDeUsuario.GetAttribute('key')
            # En packageSourceCredentials, el nombre de la fuente es el nombre del elemento (con los espacios codificados).
            $tieneCredenciales = [bool]$xmlDeUsuario.SelectSingleNode("/configuration/packageSourceCredentials/*[local-name()='$([Xml.XmlConvert]::EncodeLocalName($clave))']")
        }
    }

    if ($fuenteDeUsuario -and $tieneCredenciales -and $fuenteDeUsuario.GetAttribute('key') -eq $NombreDelFeed) {
        Igual "El feed ya tiene credenciales en $configDeUsuario."
    }
    elseif ($PSCmdlet.ShouldProcess($configDeUsuario, "Guardar las credenciales del feed $NombreDelFeed")) {
        $usuario = $null
        if (Hay-Comando gh) {
            $r = Invocar-Gh @('api', 'user', '--jq', '.login')
            if ($r.Codigo -eq 0) { $usuario = $r.Salida }
        }
        if (-not $usuario) { $usuario = Read-Host -Prompt 'Usuario de GitHub' }
        $token = Leer-Secreto 'LAINCO_PACKAGES_TOKEN' 'Token clásico de GitHub con read:packages'

        if ($fuenteDeUsuario -and $fuenteDeUsuario.GetAttribute('key') -ne $NombreDelFeed) {
            # La misma URL con otro nombre: las credenciales se buscan por nombre, así que se renombra.
            & dotnet nuget remove source $fuenteDeUsuario.GetAttribute('key') --configfile $configDeUsuario | Out-Null
            $fuenteDeUsuario = $null
        }
        if ($fuenteDeUsuario) {
            $accion = 'update'
            $argumentos = @('nuget', 'update', 'source', $NombreDelFeed)
        }
        else {
            $accion = 'add'
            $argumentos = @('nuget', 'add', 'source', $UrlDelFeed, '--name', $NombreDelFeed)
        }
        $argumentos += @('--username', $usuario, '--password', $token, '--configfile', $configDeUsuario)
        # En Windows, dotnet cifra la contraseña; en Linux y macOS solo se puede guardar en claro.
        if (-not $EsWindows) { $argumentos += '--store-password-in-clear-text' }
        $salida = & dotnet @argumentos 2>&1
        if ($LASTEXITCODE -ne 0) { throw "dotnet nuget $accion source falló: $(($salida | Out-String).Replace($token, '***'))" }
        Hecho "Credenciales del feed guardadas en el NuGet.Config del usuario ($usuario)."
    }

    if ([Environment]::GetEnvironmentVariable('LAINCO_SONAR_TOKEN', 'User') -or $env:LAINCO_SONAR_TOKEN) {
        Igual 'LAINCO_SONAR_TOKEN ya está definida.'
    }
    elseif ($EsWindows -and $PSCmdlet.ShouldProcess('LAINCO_SONAR_TOKEN (variable de usuario)', 'Definir')) {
        $seguro = Read-Host -Prompt 'Token de SonarQube Cloud de solo lectura de issues, para LAINCO_SONAR_TOKEN (Enter para omitir)' -AsSecureString
        $valor = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
        if ($valor) {
            [Environment]::SetEnvironmentVariable('LAINCO_SONAR_TOKEN', $valor, 'User')
            Hecho 'LAINCO_SONAR_TOKEN definida para el usuario (vale en las consolas y el IDE que se abran después).'
        }
        else { Pendiente 'Definir LAINCO_SONAR_TOKEN (token de solo lectura de issues) para que el IDE oculte los issues aceptados.' }
    }
    elseif (-not $EsWindows) {
        Pendiente 'Definir LAINCO_SONAR_TOKEN en el perfil de la consola (token de solo lectura de issues).'
    }
}

# ------------------------------------------------------------------- 4. SonarQube Cloud

Escribir-Paso 'SonarQube Cloud'
$hayGh = Hay-Comando gh
if ($hayGh) { $hayGh = (Invocar-Gh @('auth', 'status')).Codigo -eq 0 }

if ($SinSonar) {
    Igual 'Omitido (-SinSonar).'
}
else {
    $script:TokenSonar = Leer-Secreto 'LAINCO_SONAR_ADMIN_TOKEN' 'Token de SonarQube Cloud de un administrador de la organización'

    $busqueda = Invocar-Sonar GET 'api/projects/search' @{ organization = $OrganizacionSonar; projects = $ProyectoSonar }
    $existe = @($busqueda.components | Where-Object { $_.key -eq $ProyectoSonar }).Count -gt 0
    if (-not $existe -and -not $CrearProyectoSonar) {
        Aviso "El proyecto $ProyectoSonar no existe en Sonar."
        Pendiente "Importar $Repositorio en SonarQube Cloud (+ → Analyze new project, organización $OrganizacionSonar; así queda vinculado a GitHub y aparece el check en los PRs) y volver a correr el script. O correrlo con -CrearProyectoSonar."
    }
    else {
        if (-not $existe) {
            if ($PSCmdlet.ShouldProcess($ProyectoSonar, 'Crear el proyecto en SonarQube Cloud')) {
                Invocar-Sonar POST 'api/projects/create' @{ organization = $OrganizacionSonar; project = $ProyectoSonar; name = $repo } | Out-Null
                Hecho "Proyecto $ProyectoSonar creado en Sonar."
                Aviso 'Creado por la API, el proyecto no queda vinculado a GitHub: el quality gate corre, pero no aparece como check en los PRs hasta vincularlo (Administration → General Settings → Pull Request Decoration, o importándolo).'
            }
        }
        else { Igual "El proyecto $ProyectoSonar existe." }

        # Análisis automático: si queda activo, Sonar rechaza el análisis del workflow. La API
        # para apagarlo no está documentada, así que si falla, se pide hacerlo en la web.
        if ($PSCmdlet.ShouldProcess($ProyectoSonar, 'Apagar el análisis automático')) {
            try {
                Invocar-Sonar POST 'api/autoscan/activation' @{ projectKey = $ProyectoSonar; enable = 'false' } | Out-Null
                Hecho 'Análisis automático apagado.'
            }
            catch {
                Aviso "No se pudo apagar el análisis automático por la API ($($_.Exception.Message))."
                Pendiente "En Sonar, $ProyectoSonar → Administration → Analysis Method: apagar Automatic Analysis."
            }
        }

        $perfiles = Invocar-Sonar GET 'api/qualityprofiles/search' @{ organization = $OrganizacionSonar; project = $ProyectoSonar; language = 'cs' }
        $perfilActual = @($perfiles.profiles | Where-Object { $_.language -eq 'cs' }) | Select-Object -First 1
        if ($perfilActual -and $perfilActual.name -eq $PerfilSonar) { Igual "Perfil de C#: $PerfilSonar." }
        elseif ($PSCmdlet.ShouldProcess($ProyectoSonar, "Asignar el perfil $PerfilSonar")) {
            Invocar-Sonar POST 'api/qualityprofiles/add_project' @{ organization = $OrganizacionSonar; project = $ProyectoSonar; language = 'cs'; qualityProfile = $PerfilSonar } | Out-Null
            Hecho "Perfil de C#: $PerfilSonar."
        }

        $gates = Invocar-Sonar GET 'api/qualitygates/list' @{ organization = $OrganizacionSonar }
        $gate = @($gates.qualitygates | Where-Object { $_.name -eq $QualityGate }) | Select-Object -First 1
        if (-not $gate) { throw "No existe el quality gate $QualityGate en la organización $OrganizacionSonar." }
        $gateActual = $null
        try { $gateActual = (Invocar-Sonar GET 'api/qualitygates/get_by_project' @{ organization = $OrganizacionSonar; project = $ProyectoSonar }).qualityGate } catch { }
        if ($gateActual -and $gateActual.name -eq $QualityGate) { Igual "Quality gate: $QualityGate." }
        elseif ($PSCmdlet.ShouldProcess($ProyectoSonar, "Asignar el quality gate $QualityGate")) {
            Invocar-Sonar POST 'api/qualitygates/select' @{ organization = $OrganizacionSonar; projectKey = $ProyectoSonar; gateId = [string]$gate.id } | Out-Null
            Hecho "Quality gate: $QualityGate."
        }

        # Token de análisis, directo al secret del repositorio.
        if (-not $hayGh) {
            Pendiente "Crear el secret SONAR_TOKEN en $Repositorio con un token de análisis de Sonar (gh no está instalado o no tiene sesión: gh auth login)."
        }
        else {
            $secretos = Invocar-Gh @('secret', 'list', '--repo', $Repositorio, '--json', 'name', '--jq', '.[].name')
            if ($secretos.Codigo -ne 0) { throw "gh secret list falló: $($secretos.Salida)" }
            $yaEsta = ($secretos.Salida -split "`n" | ForEach-Object { $_.Trim() }) -contains 'SONAR_TOKEN'
            if ($yaEsta -and -not $RenovarTokenSonar) { Igual "El secret SONAR_TOKEN ya existe en $Repositorio (-RenovarTokenSonar para reemplazarlo)." }
            elseif ($PSCmdlet.ShouldProcess("$Repositorio · SONAR_TOKEN", 'Generar un token de análisis y guardarlo como secret')) {
                $nombreDelToken = "ci-$owner-$repo-$(Get-Date -Format 'yyyyMMddHHmm')"
                $generado = Invocar-Sonar POST 'api/user_tokens/generate' @{ name = $nombreDelToken }
                $r = Invocar-Gh @('secret', 'set', 'SONAR_TOKEN', '--repo', $Repositorio) $generado.token
                $generado = $null
                if ($r.Codigo -ne 0) { throw "gh secret set falló: $($r.Salida)" }
                Hecho "Secret SONAR_TOKEN en $Repositorio (token de Sonar ""$nombreDelToken"")."
            }
        }
    }
    $script:TokenSonar = $null
}

# ------------------------------------------------------------------- 5. protección de main

if ($ProtegerMain) {
    Escribir-Paso 'Protección de main'
    if (-not $hayGh) { Pendiente "Exigir el check ""$CheckDeSonar"" en main (gh no está instalado o no tiene sesión)." }
    else {
        $actual = Invocar-Gh @('api', "repos/$Repositorio/branches/main/protection")
        if ($actual.Codigo -eq 0) {
            if ($actual.Salida -match [regex]::Escape($CheckDeSonar)) { Igual "main ya exige ""$CheckDeSonar""." }
            else {
                Aviso 'main ya tiene reglas de protección: no se tocan.'
                Pendiente "Agregar el check ""$CheckDeSonar"" a la protección de main (Settings → Branches)."
            }
        }
        elseif ($actual.Salida -notmatch 'Branch not protected') { throw "No se pudo leer la protección de main: $($actual.Salida)" }
        elseif ($PSCmdlet.ShouldProcess("$Repositorio · main", "Exigir el check $CheckDeSonar")) {
            $cuerpo = @{
                required_status_checks        = @{ strict = $false; contexts = @($CheckDeSonar) }
                enforce_admins                = $false
                required_pull_request_reviews = $null
                restrictions                  = $null
            } | ConvertTo-Json -Depth 4 -Compress
            $r = Invocar-Gh @('api', '-X', 'PUT', "repos/$Repositorio/branches/main/protection", '--input', '-') $cuerpo
            if ($r.Codigo -ne 0) { throw "No se pudo proteger main: $($r.Salida)" }
            Hecho "main exige ""$CheckDeSonar"" para mergear."
        }
    }
}

# ------------------------------------------------------------------- resumen

Pendiente "Opcional: sumar $Repositorio a PRUEBA_REPOSITORIOS en Vercel (con :$Solucion si tiene varias soluciones), para que el job nocturno pruebe ahí las reglas En prueba."
Pendiente 'Revisar y commitear nuget.config, Directory.Build.props y .github/workflows/sonar.yml; el primer push a main dispara el análisis.'

Write-Host ''
Write-Host '== Resumen' -ForegroundColor Cyan
if ($WhatIfPreference) { Write-Host '   (-WhatIf: no se cambió nada)' -ForegroundColor DarkGray }
Write-Host "   Hecho: $($script:Hecho.Count)"
if ($script:Avisos.Count) { Write-Host '   Avisos:' -ForegroundColor Yellow; $script:Avisos | ForEach-Object { Write-Host "    - $_" } }
Write-Host '   Falta (a mano):' -ForegroundColor Yellow
$i = 1
foreach ($p in $script:Pendiente) { Write-Host "    $i. $p"; $i++ }
