#!/usr/bin/env bash
# Pasos del workflow "Prueba de reglas" (.github/workflows/prueba-reglas.yml, entrega 6.5,
# decisión E4): compilar los repositorios con las reglas En prueba y mandarle los
# resultados a la app de catálogo. A Sonar no va nada.
#
#   prueba-reglas.sh analyzers <carpeta>
#       Baja SonarAnalyzer.CSharp (SONAR_ANALYZER_VERSION, o el último release de
#       SonarSource/sonar-dotnet) y el último release de Lainco.Analyzers (de
#       GITHUB_REPOSITORY), deja sus .dll en <carpeta> y las versiones en
#       <carpeta>/versiones.json.
#
#   prueba-reglas.sh abrir <versiones.json> <salida.json>
#       Abre una corrida en la app (POST /api/ci/prueba/corridas) y deja la respuesta en
#       <salida.json>: los repositorios, las reglas y el .globalconfig. Sin reglas En prueba
#       la respuesta no trae corrida.
#
#   prueba-reglas.sh analizar <corrida.json> <owner/repo> <solucion|""> <analyzers> <trabajo>
#       Clona el repositorio, lo compila con Prueba.targets y reduce los SARIF. Deja en
#       <trabajo>/resultado.json lo que hay que mandarle a la app: los resultados, o el error
#       si no se pudo (no compiló, no hay una única solución...).
#
#   prueba-reglas.sh enviar <corrida.json> <resultado.json>
#       Manda el resultado de un repositorio a la app
#       (POST /api/ci/prueba/corridas/{id}/resultados).
#
#   prueba-reglas.sh todo <trabajo>
#       Todo lo anterior: lo que corre el workflow. Un repositorio que no compila queda con su
#       error y la corrida sigue con los demás; si la app no recibe algún resultado, termina
#       con error (la corrida queda en curso y la próxima la da por fallida).
#
# Variables:
#   LAINCO_APP_URL          La URL de la app (https://...).
#   LAINCO_PRUEBA_TOKEN     Token de servicio de alcance "prueba" (app/README.md). Secreto.
#   PRUEBA_GITHUB_TOKEN     Para clonar los repositorios a probar (lectura de Contents).
#                           Si falta, GITHUB_TOKEN, que solo alcanza para este repositorio.
#   GITHUB_TOKEN            Para leer los releases. Lo pone el workflow.
#   GITHUB_REPOSITORY       El repositorio de Lainco.Analyzers. Lo pone el workflow.
#   SONAR_ANALYZER_VERSION  Versión de SonarAnalyzer.CSharp (ej. 10.35.0.4138). Conviene la
#                           que usa SonarQube Cloud. Si falta, la última.
#   PRUEBA_GIT_URL          De dónde clonar (por defecto https://github.com). Para probar
#                           el script a mano con repositorios locales.
#   GITHUB_API_URL          Por defecto https://api.github.com.
#
# Los tokens no se escriben en la consola ni en archivos: van en encabezados.

set -euo pipefail

DIR_PRUEBA="$(cd "$(dirname "${BASH_SOURCE[0]}")/../prueba" && pwd)"
API="${GITHUB_API_URL:-https://api.github.com}"
GIT_URL="${PRUEBA_GIT_URL:-https://github.com}"
# Una corrida no puede quedar colgada de un repositorio: 40 minutos por compilación.
LIMITE_DE_COMPILACION="${PRUEBA_LIMITE_DE_COMPILACION:-40m}"

error() {
  # Formato de anotación de GitHub Actions: se ve en el resumen de la corrida.
  echo "::error::$*" >&2
  exit 1
}

aviso() {
  echo "::warning::$*" >&2
}

requerir() {
  local nombre
  for nombre in "$@"; do
    [[ -n "${!nombre:-}" ]] || error "Falta la variable $nombre."
  done
}

# GET a la API de GitHub, con el token si hay.
api_github() {
  local args=(-fsSL -H "Accept: application/vnd.github+json")
  [[ -n "${GITHUB_TOKEN:-}" ]] && args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl "${args[@]}" "$API/$1"
}

# POST JSON a la app con el token de servicio. Escribe la respuesta en $2 y devuelve el código HTTP.
post_app() {
  local ruta="$1" salida="$2" cuerpo="$3"
  curl -sS -o "$salida" -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $LAINCO_PRUEBA_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary "@$cuerpo" \
    "${LAINCO_APP_URL%/}$ruta"
}

analyzers() {
  local carpeta="$1"
  requerir GITHUB_REPOSITORY
  mkdir -p "$carpeta"
  local temporal
  temporal="$(mktemp -d)"

  # SonarAnalyzer.CSharp: el .nupkg está en los releases de sonar-dotnet en GitHub.
  local release_sonar
  if [[ -n "${SONAR_ANALYZER_VERSION:-}" ]]; then
    release_sonar="$(api_github "repos/SonarSource/sonar-dotnet/releases/tags/$SONAR_ANALYZER_VERSION")" ||
      error "No hay un release $SONAR_ANALYZER_VERSION de SonarSource/sonar-dotnet."
  else
    release_sonar="$(api_github "repos/SonarSource/sonar-dotnet/releases/latest")" || error "No se pudo leer el último release de sonar-dotnet."
  fi
  local version_sonar url_sonar
  version_sonar="$(jq -r '.tag_name' <<<"$release_sonar")"
  url_sonar="$(jq -r --arg n "SonarAnalyzer.CSharp.$version_sonar.nupkg" '.assets[] | select(.name == $n) | .browser_download_url' <<<"$release_sonar")"
  [[ -n "$url_sonar" ]] || error "El release $version_sonar de sonar-dotnet no tiene SonarAnalyzer.CSharp.$version_sonar.nupkg."
  curl -fsSL -o "$temporal/sonar.nupkg" "$url_sonar"
  unzip -q -j -o "$temporal/sonar.nupkg" 'analyzers/SonarAnalyzer.CSharp.dll' -d "$carpeta"

  # Lainco.Analyzers: el .nupkg del último release de este repositorio. Sin el suppressor:
  # en la prueba cuenta todo.
  local release_lainco version_lainco url_lainco
  release_lainco="$(api_github "repos/$GITHUB_REPOSITORY/releases/latest")" || error "No se pudo leer el último release de $GITHUB_REPOSITORY."
  version_lainco="$(jq -r '.tag_name | ltrimstr("v")' <<<"$release_lainco")"
  url_lainco="$(jq -r '.assets[] | select(.name | test("^Lainco\\.Analyzers\\..*\\.nupkg$")) | .url' <<<"$release_lainco" | head -n1)"
  [[ -n "$url_lainco" ]] || error "El release v$version_lainco no tiene el .nupkg de Lainco.Analyzers."
  local args=(-fsSL -H "Accept: application/octet-stream")
  [[ -n "${GITHUB_TOKEN:-}" ]] && args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl "${args[@]}" -o "$temporal/lainco.nupkg" "$url_lainco"
  unzip -q -j -o "$temporal/lainco.nupkg" 'analyzers/dotnet/cs/Lainco.Analyzers.dll' -d "$carpeta"

  rm -rf "$temporal"
  jq -n --arg s "$version_sonar" --arg l "$version_lainco" '{sonarAnalyzer: $s, laincoAnalyzers: $l}' >"$carpeta/versiones.json"
  echo "Analyzers: SonarAnalyzer.CSharp $version_sonar, Lainco.Analyzers $version_lainco."
}

abrir() {
  local versiones="$1" salida="$2"
  requerir LAINCO_APP_URL LAINCO_PRUEBA_TOKEN
  local cuerpo codigo
  cuerpo="$(mktemp)"
  local workflow=""
  if [[ -n "${GITHUB_RUN_ID:-}" ]]; then
    workflow="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
  fi
  jq -n --slurpfile v "$versiones" --arg w "$workflow" '{versiones: $v[0]} + (if $w == "" then {} else {workflowUrl: $w} end)' >"$cuerpo"

  codigo="$(post_app /api/ci/prueba/corridas "$salida" "$cuerpo")"
  rm -f "$cuerpo"
  case "$codigo" in
    201) echo "Corrida $(jq -r '.corrida.id' "$salida"): $(jq '.reglas | length' "$salida") reglas en $(jq '.repositorios | length' "$salida") repositorios." ;;
    200) jq -r '.mensaje' "$salida" ;;
    *) error "La app no abrió la corrida (HTTP $codigo): $(head -c 500 "$salida")" ;;
  esac
}

# Deja en $trabajo/resultado.json un resultado con estado "error".
resultado_con_error() {
  local trabajo="$1" repositorio="$2" commit="$3" mensaje="$4"
  jq -n --arg r "$repositorio" --arg c "$commit" --arg e "$mensaje" \
    '{repositorio: $r, estado: "error", error: ($e | .[0:4000])} + (if $c == "" then {} else {commit: $c} end)' >"$trabajo/resultado.json"
  aviso "$repositorio: $mensaje"
}

analizar() {
  local corrida="$1" repositorio="$2" solucion="$3" carpeta_analyzers="$4" trabajo="$5"
  mkdir -p "$trabajo"
  trabajo="$(cd "$trabajo" && pwd)"
  carpeta_analyzers="$(cd "$carpeta_analyzers" && pwd)"
  local clon="$trabajo/repo" sarif="$trabajo/sarif" log="$trabajo/compilacion.log"
  rm -rf "$clon" "$sarif"
  mkdir -p "$sarif"

  local token="${PRUEBA_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
  local git_args=()
  if [[ -n "$token" && "$GIT_URL" == https://* ]]; then
    # Como actions/checkout: el token en un encabezado, nunca en la URL.
    git_args=(-c "http.extraHeader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$token" | base64 -w0)")
  fi
  if ! git "${git_args[@]}" clone --quiet --depth 1 "$GIT_URL/$repositorio.git" "$clon" 2>"$log"; then
    resultado_con_error "$trabajo" "$repositorio" "" "No se pudo clonar: $(tail -n 3 "$log" | tr '\n' ' ')"
    return 0
  fi
  local commit
  commit="$(git -C "$clon" rev-parse HEAD)"

  if [[ -z "$solucion" ]]; then
    local soluciones
    soluciones="$(git -C "$clon" ls-files '*.sln' '*.slnx')"
    if [[ "$(grep -c . <<<"$soluciones")" -ne 1 ]]; then
      resultado_con_error "$trabajo" "$repositorio" "$commit" \
        "Hay $(grep -c . <<<"$soluciones") soluciones; indicá cuál en PRUEBA_REPOSITORIOS (owner/repo:ruta/de/la.sln): $(tr '\n' ' ' <<<"$soluciones")"
      return 0
    fi
    solucion="$soluciones"
  fi
  if [[ ! -f "$clon/$solucion" ]]; then
    resultado_con_error "$trabajo" "$repositorio" "$commit" "No existe la solución $solucion."
    return 0
  fi

  jq -r '.globalconfig' "$corrida" >"$trabajo/prueba.globalconfig"
  echo "$repositorio ($commit): compilando $solucion..."
  if ! (cd "$clon" && timeout "$LIMITE_DE_COMPILACION" dotnet build "$solucion" --no-incremental -nologo -v q \
    -p:RestoreIgnoreFailedSources=true \
    -p:CustomAfterMicrosoftCommonTargets="$DIR_PRUEBA/Prueba.targets" \
    -p:LaincoPruebaAnalyzers="$carpeta_analyzers" \
    -p:LaincoPruebaGlobalconfig="$trabajo/prueba.globalconfig" \
    -p:LaincoPruebaSarif="$sarif") >"$log" 2>&1; then
    local errores
    errores="$(grep -E ': error [A-Z]+[0-9]+' "$log" | sed -E "s|$clon/||g" | sort -u | head -n 10 || true)"
    resultado_con_error "$trabajo" "$repositorio" "$commit" "No compiló: ${errores:-$(tail -n 5 "$log")}"
    return 0
  fi

  if ! node "$DIR_PRUEBA/reducir-sarif.mjs" --sarif "$sarif" --raiz "$clon" --repositorio "$repositorio" --commit "$commit" \
    --diagnosticos "$(jq -r '[.reglas[].diagnostico] | join(",")' "$corrida")" --salida "$trabajo/resultado.json" 2>"$trabajo/reduccion.log"; then
    resultado_con_error "$trabajo" "$repositorio" "$commit" "No se pudieron leer los resultados: $(cat "$trabajo/reduccion.log")"
    return 0
  fi
  cat "$trabajo/reduccion.log" >&2
}

enviar() {
  local corrida="$1" resultado="$2"
  requerir LAINCO_APP_URL LAINCO_PRUEBA_TOKEN
  local id respuesta codigo
  id="$(jq -r '.corrida.id' "$corrida")"
  respuesta="$(mktemp)"
  codigo="$(post_app "/api/ci/prueba/corridas/$id/resultados" "$respuesta" "$resultado")"
  if [[ "$codigo" != 2* ]]; then
    aviso "La app no recibió el resultado de $(jq -r '.repositorio' "$resultado") (HTTP $codigo): $(head -c 500 "$respuesta")"
    rm -f "$respuesta"
    return 1
  fi
  rm -f "$respuesta"
  echo "$(jq -r '.repositorio' "$resultado"): resultado enviado."
}

todo() {
  local trabajo="$1"
  mkdir -p "$trabajo"
  analyzers "$trabajo/analyzers"
  abrir "$trabajo/analyzers/versiones.json" "$trabajo/corrida.json"
  if [[ "$(jq -r '.corrida' "$trabajo/corrida.json")" == "null" ]]; then
    return 0
  fi

  local fallidos=0 repositorio solucion carpeta
  while IFS=$'\t' read -r repositorio solucion; do
    carpeta="$trabajo/repos/${repositorio//\//__}"
    analizar "$trabajo/corrida.json" "$repositorio" "$solucion" "$trabajo/analyzers" "$carpeta"
    enviar "$trabajo/corrida.json" "$carpeta/resultado.json" || fallidos=$((fallidos + 1))
  done < <(jq -r '.repositorios[] | [.repositorio, (.solucion // "")] | @tsv' "$trabajo/corrida.json")

  [[ "$fallidos" -eq 0 ]] || error "La app no recibió $fallidos resultados: la corrida queda incompleta."
}

comando="${1:-}"
shift || true
case "$comando" in
  analyzers) [[ $# -eq 1 ]] || error "Uso: $0 analyzers <carpeta>"; analyzers "$@" ;;
  abrir) [[ $# -eq 2 ]] || error "Uso: $0 abrir <versiones.json> <salida.json>"; abrir "$@" ;;
  analizar) [[ $# -eq 5 ]] || error "Uso: $0 analizar <corrida.json> <owner/repo> <solucion|\"\"> <analyzers> <trabajo>"; analizar "$@" ;;
  enviar) [[ $# -eq 2 ]] || error "Uso: $0 enviar <corrida.json> <resultado.json>"; enviar "$@" ;;
  todo) [[ $# -eq 1 ]] || error "Uso: $0 todo <trabajo>"; todo "$@" ;;
  *) error "Comando desconocido: '$comando'. Comandos: analyzers, abrir, analizar, enviar, todo." ;;
esac
