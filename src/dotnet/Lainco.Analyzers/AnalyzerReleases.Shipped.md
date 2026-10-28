; Reglas ya publicadas, por versión del paquete.
; https://github.com/dotnet/roslyn-analyzers/blob/main/src/Microsoft.CodeAnalysis.Analyzers/ReleaseTrackingAnalyzers.Help.md
;
; El cambio que sube la versión del paquete mueve acá las filas de
; AnalyzerReleases.Unshipped.md, bajo "## Release <versión>". El workflow de publicación
; no publica si quedan reglas sin mover (ver docs/publicacion-de-paquetes.md).

## Release 0.1.0

### New Rules

Rule ID | Category | Severity | Notes
--------|----------|----------|-------------------------------------------------------
LAIN004 | Diseño   | Warning  | No se permite inicialización inline de properties.
LAIN005 | Diseño   | Warning  | No se permiten métodos estáticos, salvo operators.
