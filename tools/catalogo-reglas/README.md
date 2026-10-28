# catalogo-reglas — el catálogo de las reglas Roslyn

Herramienta de línea de comandos de la **Fase 6, entrega 6.4, paso 1**. Lee las reglas de
`Lainco.Analyzers.dll` y genera `reglas-roslyn.json`, el catálogo que la app usa para sumar
las reglas propias al inventario. El formato está en
[`docs/catalogo-de-reglas.md`](../../docs/catalogo-de-reglas.md).

En el día a día **no se corre a mano**: la corre el build de `Lainco.Analyzers.Package`
después de compilar, y deja el catálogo junto al `.nupkg`:

```bash
dotnet pack src/dotnet/Lainco.Analyzers.Package -c Release -o artifacts/nupkg
# artifacts/nupkg/Lainco.Analyzers.0.1.0.nupkg
# artifacts/nupkg/reglas-roslyn.json
```

Con `dotnet build` queda en `src/dotnet/Lainco.Analyzers.Package/bin/<Configuración>/`.
Con `-p:GenerarCatalogoDeReglas=false` no se genera.

## Qué hace

1. Carga el `.dll`, instancia cada analyzer (los tipos con `[DiagnosticAnalyzer]`, sin los
   suppressors) y junta sus `SupportedDiagnostics`.
2. Lee `AnalyzerReleases.Shipped.md` y `AnalyzerReleases.Unshipped.md`: las reglas
   agregadas en alguna versión y no quitadas después.
3. Lee `docs/rules/<ID>.md` de cada regla.
4. Verifica las convenciones de `CLAUDE.md` (ver el formato) y escribe el JSON.

Si alguna regla no cumple, no escribe nada (y borra el catálogo de una corrida anterior),
y lista los problemas en el formato de error de MSBuild, así el build los muestra:

```
catalogo-reglas : error : LAIN006: falta la documentación en docs/rules/LAIN006.md.
```

## Uso a mano

```bash
dotnet run --project tools/catalogo-reglas/src/Lainco.CatalogoReglas -- \
    --analyzers src/dotnet/Lainco.Analyzers/bin/Release/netstandard2.0/Lainco.Analyzers.dll \
    --releases src/dotnet/Lainco.Analyzers \
    --documentacion docs/rules \
    --paquete Lainco.Analyzers --version 0.1.0 \
    --salida reglas-roslyn.json
```

Todas las opciones son obligatorias. Códigos de salida: `0` se escribió el catálogo; `1`
alguna regla no cumple; `2` opciones inválidas o falta un archivo.

## Tests

```bash
dotnet test tools/catalogo-reglas
```

Además de los casos armados a mano, `CatalogoDeLaincoAnalyzersTests` genera el catálogo de
las reglas de verdad (el `.dll`, los AnalyzerReleases y `docs/rules` del repositorio): una
regla nueva sin documentación o sin declarar falla ahí antes que en el build del paquete.

La herramienta usa `Microsoft.CodeAnalysis.CSharp` en la **misma versión** que
`Lainco.Analyzers` (hoy 4.8.0): si una sube, la otra también.
