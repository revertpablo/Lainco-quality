# LAIN004 — No se permite inicialización inline de properties

| | |
|---|---|
| **Categoría** | Diseño |
| **Severidad por defecto** | Warning |
| **Lenguaje** | C# |
| **Origen** | Regla propia (Roslyn) |

## Qué detecta

Properties que fijan su valor en la declaración con `=`:

```csharp
public string Descripcion { get; set; } = "sin descripción";
```

## Por qué

El valor inicial de una property es parte de la construcción del objeto, y la
construcción se lee en el constructor. Repartirla entre la declaración y el constructor
obliga a mirar dos lugares para saber con qué valor arranca un objeto.

Además, un inicializador inline no puede depender de los parámetros del constructor, así
que en cuanto el valor deja de ser constante hay que moverlo igual. Que esté desde el
principio en el constructor evita esa migración.

En entidades de NHibernate hay una razón extra: el inicializador corre también cuando
NHibernate materializa la entidad desde la base, pisando el valor persistido con el
valor por defecto antes de que el mapeo asigne el real. Es una fuente de bugs difíciles
de ver.

## Ejemplos

### Incorrecto

```csharp
public class Articulo
{
    // LAIN004
    public string Descripcion { get; set; } = "sin descripción";

    // LAIN004: también aplica a properties de solo lectura y a 'init'
    public int Cantidad { get; } = 1;
}
```

### Correcto

```csharp
public class Articulo
{
    public Articulo(string descripcion)
    {
        Descripcion = descripcion;
        Cantidad = 1;
    }

    public string Descripcion { get; set; }

    public int Cantidad { get; }
}
```

## Qué no detecta

Estos casos **no** son inicialización inline y la regla los ignora:

| Caso | Ejemplo |
|---|---|
| Property con cuerpo de expresión: calcula en cada lectura, no inicializa. | `public decimal Total => Cantidad * Precio;` |
| Property con `get`/`set` con cuerpo. | `public string Nombre { get { return nombre; } }` |
| Campos con inicializador. La regla es sobre properties. | `private readonly IList<Linea> lineas = new List<Linea>();` |
| Parámetros posicionales de un `record`: el valor lo asigna el constructor generado. | `public record Comprobante(string Tipo);` |
| Properties de interfaces, que no admiten inicializador. | `string Descripcion { get; set; }` |

## Casos que sí detecta y conviene tener presentes

- **Properties estáticas**: `public static int Reintentos { get; set; } = 3;` dispara.
  Es consistente con LAIN005, que además prohíbe los miembros estáticos.
- **`init`**: `public string Tipo { get; init; } = "A";` dispara. Un `init` sigue siendo
  una property con inicializador.

## Mensaje

```
La property 'Lainco.Dico.Articulo.Descripcion' no debe inicializarse en la declaración
```

El mensaje lleva el nombre completamente calificado de la property. Es lo que permite a
SonarQube reconocer un issue ya aceptado aunque el código se mueva de línea.

## Excepciones

No hay excepciones en la regla. Si un caso concreto lo justifica, se acepta el issue en
SonarQube con la justificación del revisor. **No** se usa `#pragma warning disable` ni
`[SuppressMessage]` (ver CLAUDE.md, "Gobernanza").

## Implementación

- Analyzer: `src/dotnet/Lainco.Analyzers/Reglas/InicializacionInlineDePropertyAnalyzer.cs`
- Tests: `src/dotnet/Lainco.Analyzers.Tests/LAIN004Tests.cs`
- Violación de ejemplo: `samples/SampleSolution/Sample.Dominio/Articulo.cs`
