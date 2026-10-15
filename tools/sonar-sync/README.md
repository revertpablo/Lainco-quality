# sonar-sync — issues aceptados en SonarQube, para el IDE

Herramienta de línea de comandos de la **Fase 4, tareas 1 y 2**. Consulta la Web API de
SonarQube Cloud por los issues de **reglas externas LAIN** que los revisores marcaron como
**Aceptado** o **Falso positivo**, y genera `sonar-accepted.json`.

Ese archivo lo lee el suppressor (tarea 3) para ocultar en el IDE lo que ya se decidió en
Sonar. **No se commitea**: es un cache local (está en `.gitignore`).

En el día a día **no se corre a mano**: viaja dentro del paquete `Lainco.Analyzers` y el
build local la ejecuta solo (ver [Integración con el build](#integración-con-el-build)).

## Uso

```bash
export LAINCO_SONAR_TOKEN=<token personal>      # PowerShell: $env:LAINCO_SONAR_TOKEN = "..."

dotnet run --project tools/sonar-sync/src/Lainco.SonarSync -- \
    --proyecto revertpablo_Lainco-quality
```

| Opción | Obligatoria | Por defecto | Qué es |
|---|---|---|---|
| `--proyecto` | Sí | — | Clave del proyecto en SonarQube. |
| `--organizacion` | No | — | Clave de la organización en SonarQube Cloud. |
| `--rama` | No | La principal | Rama de la que se leen los issues. |
| `--url` | No | `https://sonarcloud.io` | URL del servidor. |
| `--salida` | No | `sonar-accepted.json` | Archivo a generar. |
| `--vigencia-horas` | No | — (consulta siempre) | Si el archivo tiene menos de esas horas, no consulta. `0`: consulta siempre. La usa el build; con ella también aplica la pausa tras una falla. |
| `--ayuda` | No | — | Muestra el uso. |

### Token

Se lee **solo** de la variable de entorno `LAINCO_SONAR_TOKEN`, nunca de un argumento,
para que no quede en el historial de la consola ni en los logs del build. Tampoco se
escribe nunca en la salida.

Es un token **personal** de cada programador (`setup-sonarcloud.md`, paso 3.2), distinto
del `SONAR_TOKEN` de análisis que usa el CI. La herramienta solo hace pedidos `GET`.

## Qué genera

```json
{
  "version": 1,
  "proyecto": "revertpablo_Lainco-quality",
  "rama": null,
  "generado": "2026-10-14T21:22:15+00:00",
  "issues": [
    {
      "archivo": "samples/SampleSolution/Sample.Dominio/Articulo.cs",
      "regla": "LAIN004",
      "mensaje": "La property 'Sample.Dominio.Articulo.Descripcion' no debe inicializarse en la declaración",
      "estado": "ACCEPTED"
    }
  ]
}
```

- **`archivo` + `regla` + `mensaje`** son la clave con la que el suppressor reconoce el
  diagnóstico. **No hay número de línea a propósito**: el mensaje lleva el nombre
  completamente calificado del símbolo, así que el issue se reconoce aunque el código se
  mueva (convención de `CLAUDE.md`, verificada en la Fase 2).
- **`archivo`** es relativo a la raíz del análisis de Sonar, con `/`.
- **`regla`** va sin el repositorio de Sonar: `LAIN004`, no `external_roslyn:LAIN004`.
  Es el ID con el que Roslyn emite el diagnóstico.
- **`estado`** es `ACCEPTED` o `FALSE_POSITIVE`. El suppressor trata los dos igual; se
  guarda para poder leer el archivo.
- **`version`** es la versión del formato. Si cambia la forma del archivo se incrementa,
  para que el suppressor detecte un archivo que no sabe leer.
- Los issues van **ordenados** por archivo, regla y mensaje: dos corridas sin cambios en
  Sonar generan el mismo archivo, salvo `generado`.

## Cómo consulta

Un `GET api/issues/search` con `componentKeys=<proyecto>` e
`issueStatuses=ACCEPTED,FALSE_POSITIVE`, de a 500 issues por página (el máximo de la API),
hasta cubrir el `paging.total`.

El filtro de reglas se hace **del lado de la herramienta**: solo quedan las reglas
`external_<motor>:LAIN###`. Las reglas de Sonar (`csharpsquid:...`) y las de los analyzers
del SDK (`external_roslyn:CA...`) se descartan.

La API no entrega más de **10.000 issues por consulta**. Si el total de aceptados del
proyecto lo supera, la herramienta **falla** en vez de generar un archivo incompleto.

## Códigos de salida y fallas

| Código | Significado | Archivo |
|---|---|---|
| `0` | Se generó el archivo. | Reemplazado. |
| `1` | Error de configuración: faltan opciones o el token. No se consultó a Sonar. | Sin cambios. |
| `2` | Sonar falló: sin red, token rechazado, proyecto inexistente, timeout (30 s), respuesta inválida. | **Sin cambios.** |

El archivo se escribe de forma **atómica** (temporal y reemplazo): nunca queda a medio
escribir. Ante cualquier falla se conserva el anterior, así que el build local sigue con
el último cache bueno.

### Varias corridas a la vez y fallas repetidas

Un build en paralelo lanza una corrida por proyecto. Para que eso no se convierta en una
consulta por proyecto:

- **Candado** (`sonar-accepted.json.lock`): una sola corrida a la vez consulta a Sonar.
  Las demás terminan enseguida con código `0` y siguen con el archivo que haya. El
  candado se borra solo al terminar.
- **Pausa tras una falla** (`sonar-accepted.json.falla`): si la consulta falla, las
  corridas **automáticas** (con `--vigencia-horas`) no reintentan durante **15 minutos**.
  Sin esto, con Sonar caído cada proyecto esperaría el timeout de 30 s en cada build.
  Una corrida manual (sin `--vigencia-horas`) ignora la pausa: sirve para reintentar
  enseguida, por ejemplo después de corregir el token.

## Integración con el build

El paquete `Lainco.Analyzers` trae la herramienta en `tools/sonar-sync/` y un `.targets` en
`buildTransitive/` que la corre **antes de compilar** (`BeforeTargets="CoreCompile"`).

### Qué hace falta en cada repo

Una propiedad, en el `Directory.Build.props` de la raíz:

```xml
<PropertyGroup>
  <LaincoSonarProyecto>clave-del-proyecto-en-sonar</LaincoSonarProyecto>
</PropertyGroup>
```

Y en cada máquina, la variable de entorno `LAINCO_SONAR_TOKEN`. Sin token el build
funciona igual y muestra un aviso (mensaje, no warning).

### Cuándo corre

| Situación | Qué pasa |
|---|---|
| Build en CI (`CI`, `GITHUB_ACTIONS`, `TF_BUILD` o `ContinuousIntegrationBuild` en `true`) | No corre. |
| Build de diseño del IDE (`DesignTimeBuild`) | No corre. |
| Repo sin `LaincoSonarProyecto` | No corre. |
| `sonar-accepted.json` con menos de `LaincoSonarVigenciaHoras` horas | No corre: ni siquiera lanza el proceso. |
| Sin `LAINCO_SONAR_TOKEN` | Aviso de importancia alta, el build sigue. |
| Sonar caído, token rechazado, timeout | Mensaje con el motivo, el build sigue con el archivo anterior. **Nunca falla el build.** |

### Propiedades

| Propiedad | Por defecto | Qué es |
|---|---|---|
| `LaincoSonarProyecto` | — | Clave del proyecto en Sonar. **Sin ella no se sincroniza.** |
| `LaincoSonarOrganizacion` | — | Organización en SonarQube Cloud. |
| `LaincoSonarRama` | La principal | Rama de la que se leen los issues. |
| `LaincoSonarUrl` | `https://sonarcloud.io` | URL del servidor. |
| `LaincoSonarVigenciaHoras` | `8` | Horas antes de volver a consultar. |
| `LaincoSonarRaiz` | Raíz del repo git | Raíz del análisis de Sonar: las rutas del archivo son relativas a ella. Se busca hacia arriba la carpeta con `.git/HEAD` (o el archivo `.git`, en worktrees y submódulos). |
| `LaincoSonarAceptados` | `$(LaincoSonarRaiz)sonar-accepted.json` | Ruta del archivo. |
| `LaincoSonarSync` | `true` (`false` en CI) | `false` para apagarlo. |

Se pueden definir en el `Directory.Build.props` del repo o, para una sola máquina, como
variables de entorno (por ejemplo `LaincoSonarVigenciaHoras=1`).

Para forzar una actualización: borrar `sonar-accepted.json` y compilar, o compilar con
`-p:LaincoSonarVigenciaHoras=0`.

### Requisitos

`dotnet` (el que corre el build, vía `DOTNET_HOST_PATH`, o el del `PATH`) con un runtime
.NET 8 **o más nuevo**: la herramienta tiene `RollForward=Major`.

## Estructura

| Ruta | Qué es |
|---|---|
| `src/Lainco.SonarSync/` | La herramienta. `net8.0`, **sin dependencias de NuGet**: `HttpClient` y `System.Text.Json` vienen con el runtime. Genera `sonar-sync.dll`. |
| `tests/Lainco.SonarSync.Tests/` | Tests xUnit. Reemplazan a Sonar con un `HttpMessageHandler` falso (`ServidorSonarFalso`): no salen a la red. |
| `Lainco.SonarSync.sln` | Solución con los dos proyectos. |

```bash
dotnet test tools/sonar-sync/Lainco.SonarSync.sln     # 36 tests
```

El `.targets` está en `src/dotnet/Lainco.Analyzers.Package/build/Lainco.Analyzers.targets`.

## Pendiente (resto de la Fase 4)

- **Tareas 3 y 4**: el suppressor que lee este archivo y la propiedad
  `LaincoSuppressAccepted`.
- **Reglas de ESLint** (Fase 5): cuando existan, habrá que sumar `lainco/<regla>` al filtro.
