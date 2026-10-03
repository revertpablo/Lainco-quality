# Publicación de paquetes

Decisión D7: **NuGet en GitHub Packages**, **npm en npmjs.com** (scope `@lainco`).

Hasta que se publique la primera versión, la sample consume el paquete desde el feed
local `artifacts/nupkg`, configurado en `samples/SampleSolution/nuget.config`.

---

## NuGet — `Lainco.Analyzers` en GitHub Packages

### Antes de la primera publicación

| # | Paso | Nota |
|---|---|---|
| 1 | Confirmar la URL del repositorio en GitHub. | Hoy apunta a la **cuenta de prueba**: `https://github.com/revertpablo/Lainco-quality`, en `RepositoryUrl` de `Lainco.Analyzers.Package.csproj` y en `BaseUrl` de `Convenciones.cs` (el `helpLinkUri` de las reglas). Al pasar a la cuenta definitiva de Lainco hay que actualizar **los dos**. |
| 2 | Crear un Personal Access Token (classic) con permiso `write:packages`. | GitHub Packages para NuGet no acepta tokens de solo `read:packages` para publicar. |
| 3 | Verificar que `RepositoryUrl` apunte al repo de la organización. | GitHub Packages usa ese campo para vincular el paquete al repositorio. Si no coincide, el push se rechaza. |

### Publicar a mano

```bash
# 1. Empaquetar
dotnet pack src/dotnet/Lainco.Analyzers.Package -c Release -o artifacts/nupkg

# 2. Registrar el feed (una sola vez por máquina)
dotnet nuget add source "https://nuget.pkg.github.com/<ORGANIZACION>/index.json" \
  --name github-lainco \
  --username <USUARIO> \
  --password "$GITHUB_TOKEN" \
  --store-password-in-clear-text

# 3. Publicar
dotnet nuget push "artifacts/nupkg/Lainco.Analyzers.<VERSION>.nupkg" \
  --source github-lainco \
  --api-key "$GITHUB_TOKEN"
```

> El token nunca va al repositorio. `nuget.config` con credenciales queda fuera de git;
> el `nuget.config` que sí está versionado (el de la sample) no tiene credenciales.

### Consumir desde un repositorio

Agregar el feed al `nuget.config` del repo y la referencia al paquete en su
`Directory.Build.props`:

```xml
<ItemGroup>
  <PackageReference Include="Lainco.Analyzers" Version="0.1.0" PrivateAssets="all" />
</ItemGroup>
```

`PrivateAssets="all"` evita que la referencia se propague a los consumidores: cada
repositorio referencia el paquete por su cuenta y elige su versión.

### Versionado

- `0.1.0` es la primera versión, con LAIN004 únicamente.
- Al publicar una versión, mover las filas de `AnalyzerReleases.Unshipped.md` a
  `AnalyzerReleases.Shipped.md` bajo el encabezado de esa versión. El analyzer
  `RS2002` falla el build si no se hace.
- Un ID de regla **nunca** se reutiliza, aunque la regla se elimine.

### Automatización

La publicación desde CI se arma en la **Fase 2**, junto con el resto del pipeline de
GitHub Actions (decisión D1). Hasta entonces, el flujo es manual.

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
