# LAIN005 — No se permiten métodos estáticos, salvo operators

| | |
|---|---|
| **Categoría** | Diseño |
| **Severidad por defecto** | Warning |
| **Lenguaje** | C# |
| **Origen** | Regla propia (Roslyn) |

## Qué detecta

Métodos declarados `static` en clases, structs, records e interfaces:

```csharp
public static decimal AplicarDescuento(decimal total, decimal porcentaje)
```

## Por qué

Un método estático no se puede sobrescribir, no se puede reemplazar en un test y ata a
quien lo llama a una implementación concreta. Cuando el comportamiento vive en un método
de instancia, se puede inyectar, reemplazar por otro y testear por separado.

Esta regla contradice a propósito a `CA1822` y a `csharpsquid:S2325`, que piden convertir
en estáticos los métodos que no usan datos de instancia. Lainco sigue el criterio opuesto
(ver `docs/CONCEPTO.md`), así que esas dos reglas no se activan.

## Ejemplos

### Incorrecto

```csharp
public class CalculadorDeTotales
{
    // LAIN005
    public static decimal AplicarDescuento(decimal total, decimal porcentaje)
    {
        return total - (total * porcentaje / 100m);
    }
}

public static class ExtensionesDePedido
{
    // LAIN005: Pedido es un tipo del proyecto; el comportamiento va en Pedido
    public static bool EsGrande(this Pedido pedido)
    {
        return pedido.Total > 1000m;
    }
}
```

### Correcto

```csharp
public class CalculadorDeTotales
{
    public decimal AplicarDescuento(decimal total, decimal porcentaje)
    {
        return total - (total * porcentaje / 100m);
    }
}

public class Pedido
{
    public decimal Total { get; set; }

    public bool EsGrande()
    {
        return Total > 1000m;
    }
}
```

## Excepciones de la regla

Estos casos no se reportan (decisión D5, más las fuentes de datos de xUnit):

| Caso | Por qué | Ejemplo |
|---|---|---|
| **Operators**, incluidas las conversiones `implicit` / `explicit`. | El lenguaje los exige estáticos. | `public static Importe operator +(Importe a, Importe b)` |
| **El `Main` que es punto de entrada** de la aplicación, también si es `async`. | Lo exige el runtime. | `public static void Main(string[] args)` |
| **Extension methods sobre tipos que no pertenecen al proyecto.** | Son la única forma de agregar comportamiento a un tipo que no se controla. | `public static string Recortado(this string texto)` |
| **Fuentes de datos de `[MemberData]`** (xUnit). | xUnit las exige estáticas. | `public static IEnumerable<object[]> Importes()` |

Detalle de las tres últimas:

- **`Main`**: se exceptúa solo el método que el compilador elige como punto de entrada.
  Un `Main` estático en una biblioteca, o en un ejecutable que no lo usa como entrada,
  dispara como cualquier otro método.
- **Extension methods**: el tipo extendido es el del parámetro `this`. Es externo si está
  definido fuera del proyecto que se compila: .NET, paquetes NuGet **y también otros
  proyectos de la misma solución**, porque el analyzer ve un proyecto por vez. Se
  consideran casos particulares:

  | Parámetro `this` | Tipo que se evalúa | Resultado |
  |---|---|---|
  | `this string` | `string` | Externo, no dispara. |
  | `this IEnumerable<Pedido>` | `IEnumerable<T>`, no `Pedido` | Externo, no dispara. |
  | `this decimal?` | `Nullable<T>` | Externo, no dispara. |
  | `this Pedido` (Pedido en el mismo proyecto) | `Pedido` | Propio, **dispara**. |
  | `this Pedido[]` | `Pedido`, no el arreglo | Propio, **dispara**. |
  | `this T` (genérico) | Ninguno concreto: puede ser cualquier tipo, también uno propio | **Dispara**. |

- **Fuentes de `[MemberData]`**: se exceptúa el método al que apunta algún
  `[MemberData]` del proyecto, resuelto como lo hace xUnit: por nombre (`nameof(...)` o
  texto), en el tipo indicado con `MemberType` o, si no hay, en la clase del test, y en
  las clases base de ese tipo. Los demás métodos estáticos de una clase de tests, como
  los auxiliares, **disparan**. Solo se reconoce xUnit (`Xunit.MemberDataAttribute` y
  sus derivados); `TestCaseSource` de NUnit y `DynamicData` de MSTest no están cubiertos.

## Qué no detecta

La regla es sobre **métodos del tipo**. Estos miembros estáticos quedan fuera:

| Caso | Ejemplo |
|---|---|
| Properties estáticas. | `public static int Reintentos { get; set; }` |
| Campos estáticos. | `private static readonly int reintentos;` |
| Constructores estáticos. | `static Configuracion() { ... }` |
| Funciones locales `static`, declaradas dentro de un método. | `static int Incrementar(int x) => x + 1;` |
| Lambdas `static`. | `Func<int, int> doble = static x => x * 2;` |
| El `Main` que genera el compilador para los top-level statements. | `Console.WriteLine("Hola");` en `Program.cs` |
| Código generado (archivos `*.g.cs`, `[GeneratedCode]`). | — |

## Casos que sí detecta y conviene tener presentes

- **Métodos `partial`**: se reporta una sola vez, sobre la declaración.
- **Métodos estáticos de interfaces** (`static abstract` / `static virtual`) y sus
  implementaciones: disparan.
- **Métodos `extern`** (`[DllImport]`, `[LibraryImport]`): disparan.
- **Proyectos de test**: también se analizan (ver
  `decisiones/spike-issues-en-tests.md`). Fuera de las fuentes de `[MemberData]`, los
  métodos estáticos de los tests disparan como en cualquier otro proyecto.

## Mensaje

```
Método estático 'Sample.Dominio.CalculadorDeTotales.AplicarDescuento' no permitido
```

El mensaje lleva el nombre completamente calificado del método. Es lo que permite a
SonarQube reconocer un issue ya aceptado aunque el código se mueva de línea. Las
sobrecargas de un mismo método comparten el mensaje.

## Otras excepciones

Fuera de las excepciones de arriba, la regla no admite otras en el código. Si un caso
concreto lo justifica, se acepta el issue en SonarQube con la justificación del revisor.
**No** se usa `#pragma warning disable` ni `[SuppressMessage]` (ver CLAUDE.md,
"Gobernanza").

## Implementación

- Analyzer: `src/dotnet/Lainco.Analyzers/Reglas/MetodoEstaticoAnalyzer.cs`
- Tests: `src/dotnet/Lainco.Analyzers.Tests/LAIN005Tests.cs`
- Violación de ejemplo: `samples/SampleSolution/Sample.Dominio/CalculadorDeTotales.cs`
- Contraejemplos: `samples/SampleSolution/Sample.Dominio/Importe.cs` (operators) y
  `samples/SampleSolution/Sample.Dominio/ExtensionesDeDecimal.cs` (extension method
  sobre un tipo de .NET)
