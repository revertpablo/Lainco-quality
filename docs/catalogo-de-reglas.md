# Catálogo de reglas propias — formato

El catálogo es un JSON con las reglas de un paquete de reglas propias. Lo genera el build
del paquete y se adjunta a cada release de GitHub; la app de catálogo lo lee para sumar
las reglas al inventario sin carga manual (entrega 6.4, decisión R1 en
`FASE-6-APP.md`, sección 8 ter).

El formato es **común a Roslyn y ESLint**:

| Paquete | Archivo | Quién lo genera |
|---|---|---|
| `Lainco.Analyzers` | `reglas-roslyn.json` | `tools/catalogo-reglas`, en el build de `Lainco.Analyzers.Package` |
| `@lainco/eslint-plugin` | `reglas-eslint.json` | El build del plugin, desde el `meta` de cada regla (Fase 5) |

## Ejemplo

```json
{
  "formato": 1,
  "origen": "roslyn",
  "paquete": "Lainco.Analyzers",
  "version": "0.1.0",
  "lenguaje": "cs",
  "reglas": [
    {
      "clave": "LAIN005",
      "titulo": "No se permiten métodos estáticos",
      "descripcion": "Los métodos estáticos no se pueden sobrescribir ni reemplazar en un test, ...",
      "categoria": "Diseño",
      "severidadPorDefecto": "warning",
      "habilitadaPorDefecto": true,
      "ayuda": "https://github.com/revertpablo/Lainco-quality/blob/main/docs/rules/LAIN005.md",
      "documentacion": "# LAIN005 — No se permiten métodos estáticos, salvo operators\n\n..."
    }
  ]
}
```

## Campos

| Campo | Tipo | Qué es |
|---|---|---|
| `formato` | número | Versión del formato. Hoy, `1`. Sube solo si un cambio rompe a quien lo lee (quitar o renombrar un campo, cambiar su significado); agregar un campo opcional no la cambia. La app rechaza un formato que no conoce. |
| `origen` | `"roslyn"` \| `"eslint"` | El motor de las reglas. Es el origen de la regla en la app. |
| `paquete` | texto | `Lainco.Analyzers` o `@lainco/eslint-plugin`. |
| `version` | texto | Versión del paquete que trae estas reglas (`X.Y.Z`, con sufijo de versión previa opcional). |
| `lenguaje` | `"cs"` \| `"ts"` | Con los códigos de lenguaje de la app (los de Sonar). |
| `reglas` | lista | Las reglas del paquete, **ordenadas por clave**. Una regla que deja de estar fue eliminada (su ID no se reutiliza). |

Cada regla:

| Campo | Tipo | Qué es |
|---|---|---|
| `clave` | texto | El ID: `LAIN###` en Roslyn, `lainco/<nombre-kebab>` en ESLint. |
| `titulo` | texto | El título de la regla (descriptor de Roslyn; `meta.docs.description` en ESLint). |
| `descripcion` | texto o `null` | La descripción corta, si la regla la tiene. |
| `categoria` | texto | La categoría (`Diseño`, `Persistencia`...). |
| `severidadPorDefecto` | `"silent"` \| `"suggestion"` \| `"warning"` | La severidad con la que se publica la regla al incorporarla (decisión R3), con las palabras del `.globalconfig`. **Nunca `error`**: el que bloquea es el quality gate (CLAUDE.md). En ESLint, `warn` es `warning`. |
| `habilitadaPorDefecto` | booleano | Si la regla corre sin que nadie la configure. |
| `ayuda` | texto | URL de la documentación publicada (`helpLinkUri` / `meta.docs.url`). |
| `documentacion` | texto | El markdown de `docs/rules/<ID>.md`, con finales de línea `\n`. |

El archivo es UTF-8 sin escapar los acentos, con sangría de dos espacios, finales de línea
`\n` y un salto al final: el mismo paquete da siempre el mismo archivo, se genere en
Windows o en Linux.

## Qué verifica el generador de Roslyn

El build del paquete **falla** si alguna regla no cumple las convenciones de CLAUDE.md, y
lista todas las que no cumplen:

- el ID no tiene la forma `LAIN###`;
- falta `docs/rules/<ID>.md`;
- el `helpLinkUri` no lleva a `docs/rules/<ID>.md`;
- la regla no está en `AnalyzerReleases.Shipped.md` ni en `AnalyzerReleases.Unshipped.md`
  (o figura como quitada);
- la severidad por defecto es `error`;
- el descriptor no tiene título, o dos descriptores distintos usan el mismo ID.
