# Publicación de paquetes

Decisión D7: **NuGet en GitHub Packages**, **npm en npmjs.com** (scope `@lainco`).

Hasta que se publique la primera versión, la sample consume el paquete desde el feed
local `artifacts/nupkg`, configurado en `samples/SampleSolution/nuget.config`.

---

## NuGet — `Lainco.Analyzers` en GitHub Packages

### Cómo se publica

Lo publica el workflow **Publicar Lainco.Analyzers**
(`.github/workflows/publicar-analyzers.yml`, entrega 6.4, decisión R4). **Publicar es subir
la versión**: cada vez que llega a `main` un cambio de los analyzers, de lo que viaja en el
paquete o de `docs/rules/`, el workflow lee la versión del paquete (`<Version>` de
`Lainco.Analyzers.Package.csproj`) y:

- si esa versión ya tiene su release `vX.Y.Z`, no hace nada: el cambio sale en la próxima;
- si no, verifica `AnalyzerReleases`, corre los tests, empaqueta, publica el `.nupkg` en
  GitHub Packages y crea el release `vX.Y.Z` con dos assets: el `.nupkg` y
  `reglas-roslyn.json`, el catálogo de reglas que lee la app (`catalogo-de-reglas.md`).

Usa el `GITHUB_TOKEN` del workflow (permisos `contents: write` y `packages: write`): no
hace falta ningún token personal para publicar. Se puede correr a mano desde la pestaña
Actions (*Run workflow*), por ejemplo para completar una publicación que falló.

Una versión con sufijo (`0.2.0-beta.1`) se publica como versión previa: el release no pasa
a ser el último, y la app no la toma.

### Subir la versión

En el mismo cambio (a mano, o el PR que abre la app al incorporar una regla propia):

1. Subir `<Version>` en `src/dotnet/Lainco.Analyzers.Package/Lainco.Analyzers.Package.csproj`.
2. Mover las filas de `AnalyzerReleases.Unshipped.md` a `AnalyzerReleases.Shipped.md`,
   bajo `## Release X.Y.Z`. El workflow **no publica** si quedan reglas en Unshipped o si
   falta la sección de la versión (`.github/scripts/publicacion-analyzers.sh
   verificar-releases X.Y.Z` lo verifica a mano).

Mientras se desarrolla una regla nueva, se declara en Unshipped (lo exige el release
tracking de Roslyn) y se mergea sin subir la versión: no se publica nada hasta que alguien
la suba.

Reglas de versionado:

- Parche (`0.1.1`): cambios de severidad en el `.globalconfig` (los PRs de la app) y
  arreglos.
- Menor (`0.2.0`): reglas nuevas.
- Un ID de regla **nunca** se reutiliza, aunque la regla se elimine.

### Si una publicación falla a mitad de camino

- **Falló antes de publicar** (verificación, tests, empaquetado): no quedó nada publicado.
  Se arregla y se vuelve a pushear (o *Run workflow*).
- **Se publicó el paquete pero falló el release**: *Run workflow*. El push del paquete se
  saltea (`--skip-duplicate`) y se crea el release.
- **Quedó el tag `vX.Y.Z` sin release**: el workflow no publica sobre un tag suelto. Borrar
  el tag y volver a correrlo.

### Antes de cambiar de repositorio

Hoy todo apunta a la **cuenta de prueba**, `https://github.com/revertpablo/Lainco-quality`:
`RepositoryUrl` de `Lainco.Analyzers.Package.csproj` (GitHub Packages lo usa para vincular
el paquete al repositorio: si no coincide, el push se rechaza) y `BaseUrl` de
`Convenciones.cs` (el `helpLinkUri` de las reglas). Al pasar a la cuenta definitiva de
Lainco hay que actualizar **los dos**.

### Consumir desde un repositorio

GitHub Packages pide autenticación para bajar paquetes NuGet, aunque el repositorio sea
público. Cada programador necesita un Personal Access Token (classic) con `read:packages`,
y en CI alcanza el `GITHUB_TOKEN` con `packages: read`.

Registrar el feed (una sola vez por máquina; el token nunca va al repositorio):

```bash
dotnet nuget add source "https://nuget.pkg.github.com/revertpablo/index.json" \
  --name github-lainco \
  --username <USUARIO> \
  --password "$GITHUB_TOKEN" \
  --store-password-in-clear-text
```

Y la referencia al paquete, en el `Directory.Build.props` del repositorio:

```xml
<ItemGroup>
  <PackageReference Include="Lainco.Analyzers" Version="0.1.0" PrivateAssets="all" />
</ItemGroup>
```

`PrivateAssets="all"` evita que la referencia se propague a los consumidores: cada
repositorio referencia el paquete por su cuenta y elige su versión.

### Publicar a mano

Solo si el workflow no está disponible. Hace falta un PAT (classic) con `write:packages`:

```bash
dotnet pack src/dotnet/Lainco.Analyzers.Package -c Release -o artifacts/nupkg
dotnet nuget push "artifacts/nupkg/Lainco.Analyzers.<VERSION>.nupkg" \
  --source "https://nuget.pkg.github.com/revertpablo/index.json" \
  --api-key "$GITHUB_TOKEN"
```

Y crear el release `v<VERSION>` con `Lainco.Analyzers.<VERSION>.nupkg` y
`reglas-roslyn.json` como assets, o la app no ve la versión.

---

## npm — `@lainco/eslint-plugin` en npmjs.com

Recién hace falta en la **Fase 5**. Dos puntos a decidir antes:

| Punto | Detalle |
|---|---|
| Público o privado | En npmjs.com, un paquete con scope `@lainco` es **público y gratuito** por defecto. Para publicarlo privado hace falta una organización paga. |
| Reservar el scope | Conviene crear la organización `lainco` en npmjs.com antes de que la tome otro, aunque todavía no se publique nada. |

---

## Feed local (desarrollo)

Para probar un cambio en los analyzers sin publicar:

```bash
# Empaquetar con una versión de prueba
dotnet pack src/dotnet/Lainco.Analyzers.Package -c Release -o artifacts/nupkg \
  -p:Version=0.1.1-prueba

# Apuntar la sample a esa versión en samples/SampleSolution/Directory.Build.props
```

Importante: NuGet cachea los paquetes por versión en `~/.nuget/packages`. Si se
reempaqueta **la misma versión** con contenido distinto, hay que limpiar el cache:

```bash
rm -rf ~/.nuget/packages/lainco.analyzers/<VERSION>
```

Por eso conviene usar sufijos de prueba (`-prueba`, `-alpha.1`) en lugar de repisar una
versión ya empaquetada.
