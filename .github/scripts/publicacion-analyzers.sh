#!/usr/bin/env bash
# Pasos del workflow "Publicar Lainco.Analyzers" (.github/workflows/publicar-analyzers.yml)
# que conviene poder correr y probar a mano.
#
#   publicacion-analyzers.sh verificar-releases <version> [carpeta]
#       Falla si AnalyzerReleases no está listo para publicar <version>: no puede quedar
#       ninguna regla en Unshipped, ni haber en Shipped una sección de una versión posterior.
#       Las reglas nuevas se declaran en Unshipped mientras se desarrollan, y el cambio
#       que sube la versión las mueve a Shipped, bajo "## Release <version>". Una versión
#       que no cambia reglas (por ejemplo, la de un PR de la app que solo cambia severidades
#       en el .globalconfig) no lleva sección.
#
#   publicacion-analyzers.sh verificar-catalogo <version> <catalogo>
#       Falla si el catálogo no es de <version> o no tiene reglas.
#
#   publicacion-analyzers.sh notas <version> <catalogo>
#       Escribe en la salida las notas del release: las reglas del paquete, desde el catálogo.

set -euo pipefail

CARPETA_POR_DEFECTO="src/dotnet/Lainco.Analyzers"

error() {
  # Formato de anotación de GitHub Actions: se ve en el resumen de la corrida.
  echo "::error::$*" >&2
  exit 1
}

# Filas de tabla de reglas de un AnalyzerReleases: empiezan con un ID y una barra.
filas_de_reglas() {
  grep -E '^[[:space:]]*[A-Za-z]+[0-9]+[[:space:]]*\|' "$1" | tr -d '\r' || true
}

verificar_releases() {
  local version="$1" carpeta="${2:-$CARPETA_POR_DEFECTO}"
  local shipped="$carpeta/AnalyzerReleases.Shipped.md" unshipped="$carpeta/AnalyzerReleases.Unshipped.md"

  [[ -f "$shipped" ]] || error "No existe $shipped."
  [[ -f "$unshipped" ]] || error "No existe $unshipped."

  local pendientes
  pendientes="$(filas_de_reglas "$unshipped")"
  if [[ -n "$pendientes" ]]; then
    error "AnalyzerReleases.Unshipped.md todavía tiene reglas. Para publicar $version hay que moverlas a AnalyzerReleases.Shipped.md, bajo '## Release $version': $(echo "$pendientes" | cut -d'|' -f1 | tr -d ' ' | paste -sd, -)"
  fi

  local secciones posterior
  secciones="$(tr -d '\r' < "$shipped" | sed -nE 's/^##[[:space:]]+Release[[:space:]]+([^[:space:]]+)[[:space:]]*$/\1/p')"
  posterior="$(printf '%s\n' "$secciones" | while read -r otra; do
    if [[ -n "$otra" && "$otra" != "$version" && "$(printf '%s\n%s\n' "$version" "$otra" | sort -V | tail -n 1)" == "$otra" ]]; then
      echo "$otra"
    fi
  done | paste -sd, -)"
  if [[ -n "$posterior" ]]; then
    error "AnalyzerReleases.Shipped.md tiene secciones de versiones posteriores a $version ($posterior): ¿las reglas quedaron bajo otro número?"
  fi

  if grep -qxF "$version" <<<"$secciones"; then
    echo "AnalyzerReleases listo para $version."
  else
    echo "AnalyzerReleases listo para $version: no cambia reglas (no tiene sección en Shipped)."
  fi
}

verificar_catalogo() {
  local version="$1" catalogo="$2"
  [[ -f "$catalogo" ]] || error "No se generó el catálogo de reglas: $catalogo."
  local del_catalogo cantidad
  del_catalogo="$(jq -r '.version' "$catalogo")"
  [[ "$del_catalogo" == "$version" ]] || error "El catálogo es de la versión $del_catalogo, no de $version."
  cantidad="$(jq '.reglas | length' "$catalogo")"
  [[ "$cantidad" -gt 0 ]] || error "El catálogo no tiene reglas."
  echo "Catálogo de $version con $cantidad reglas."
}

notas() {
  local version="$1" catalogo="$2"
  cat <<NOTAS
Paquete NuGet \`Lainco.Analyzers\` $version, publicado en GitHub Packages.

## Reglas

| ID | Regla | Severidad por defecto |
|---|---|---|
$(jq -r '.reglas[] | "| [\(.clave)](\(.ayuda)) | \(.titulo) | \(.severidadPorDefecto) |"' "$catalogo")

La severidad con la que corre cada regla la fija el \`.globalconfig\` del paquete.

## Assets

- \`Lainco.Analyzers.$version.nupkg\`: el paquete, el mismo que está en GitHub Packages.
- \`reglas-roslyn.json\`: el catálogo de reglas que lee la app de catálogo (formato en \`docs/catalogo-de-reglas.md\`).
NOTAS
}

comando="${1:-}"
shift || true
case "$comando" in
  verificar-releases) [[ $# -ge 1 ]] || error "Uso: $0 verificar-releases <version> [carpeta]"; verificar_releases "$@" ;;
  verificar-catalogo) [[ $# -eq 2 ]] || error "Uso: $0 verificar-catalogo <version> <catalogo>"; verificar_catalogo "$@" ;;
  notas) [[ $# -eq 2 ]] || error "Uso: $0 notas <version> <catalogo>"; notas "$@" ;;
  *) error "Comando desconocido: '$comando'. Comandos: verificar-releases, verificar-catalogo, notas." ;;
esac