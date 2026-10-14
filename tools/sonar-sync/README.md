# sonar-sync — issues aceptados en SonarQube, para el IDE

Herramienta de línea de comandos de la **Fase 4, tarea 1**. Consulta la Web API de
SonarQube Cloud por los issues de **reglas externas LAIN** que los revisores marcaron como
**Aceptado** o **Falso positivo**, y genera `sonar-accepted.json`.

Ese archivo lo lee el suppressor (tarea 3) para ocultar en el IDE lo que ya se decidió en
Sonar. **No se commitea**: es un cache local (está en `.gitignore`).

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
escribir. Ante cualquier falla se conserva el anterior. Así el target de MSBuild de la
tarea 2 puede ignorar el código de salida y el build local sigue con el último cache
bueno.

## Estructura

| Ruta | Qué es |
|---|---|
| `src/Lainco.SonarSync/` | La herramienta. `net8.0`, **sin dependencias de NuGet**: `HttpClient` y `System.Text.Json` vienen con el runtime. Genera `sonar-sync.dll`. |
| `tests/Lainco.SonarSync.Tests/` | Tests xUnit. Reemplazan a Sonar con un `HttpMessageHandler` falso (`ServidorSonarFalso`): no salen a la red. |
| `Lainco.SonarSync.sln` | Solución con los dos proyectos. |

```bash
dotnet test tools/sonar-sync/Lainco.SonarSync.sln     # 26 tests
```

## Pendiente (resto de la Fase 4)

- **Tarea 2**: target de MSBuild que corre `sonar-sync` antes del build local, con cache
  de N horas. Ahí se decide cómo se distribuye la herramienta (dentro del paquete
  `Lainco.Analyzers` o aparte) y de dónde salen `--proyecto` y `--salida`.
- **Tareas 3 y 4**: el suppressor que lee este archivo y la propiedad
  `LaincoSuppressAccepted`.
- **Reglas de ESLint** (Fase 5): cuando existan, habrá que sumar `lainco/<regla>` al filtro.
