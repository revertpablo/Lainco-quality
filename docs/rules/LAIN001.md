# LAIN001 — El constructor sin parámetros debe ser protected si el tipo tiene otros constructores

| | |
|---|---|
| **Categoría** | Diseño |
| **Severidad por defecto** | Warning |
| **Lenguaje** | C# |
| **Origen** | Regla propia (Roslyn) |

## Qué detecta

Dos casos:

1. Clases con más de un constructor cuyo constructor sin parámetros no es `protected`.
2. **Entidades** (clases que implementan `Lainco.Domain.IEntity`) que declaran
   constructores, pero ninguno sin parámetros.

El primer caso:

```csharp
public Pedido()
{
}

public Pedido(Cliente cliente, DateTime fecha)
    : this()
{
    ...
}
```

## Por qué

Cuando un tipo tiene un constructor que recibe sus datos, ese es el que deja el objeto en
un estado válido. El constructor sin parámetros existe para NHibernate, que materializa
la entidad desde la base y genera proxies que heredan del tipo: para eso alcanza con que
sea `protected`. Si es público, cualquier parte del código puede crear un objeto a medio
armar y saltear las validaciones del constructor con datos.

Si el constructor sin parámetros es el **único** del tipo, no hay otra forma de crear el
objeto y la regla no se aplica.

Una entidad lo necesita siempre, aunque tenga constructores con parámetros: sin él,
NHibernate no puede materializarla. Por eso, si una entidad declara constructores, uno
tiene que ser sin parámetros (y, por el primer caso, `protected`).

## Entidades

Es entidad toda clase que implementa `Lainco.Domain.IEntity`:

- directamente (`class Pedido : IEntity`);
- a través de su clase base (`class Pedido : Entidad`, con `Entidad : IEntity`);
- a través de otra interfaz (`class Pedido : IAgregado`, con `IAgregado : IEntity`).

Cuenta solo esa interfaz, con ese namespace. Una `IEntity` de otro namespace o la genérica
`IEntity<T>` no hacen entidad a una clase.

| Entidad | Resultado |
|---|---|
| Sin constructores declarados (tiene el implícito) | Correcto. |
| Un único constructor, sin parámetros, aunque sea `public` | Correcto: la excepción del único constructor vale también para las entidades. |
| `protected` sin parámetros y otros constructores | Correcto. |
| Solo constructores con parámetros (uno o varios, o un constructor primario) | LAIN001, con el mensaje de entidad. |
| Sin parámetros `public` y otros constructores | LAIN001, con el mensaje general (una sola vez). |

Las clases **abstractas** también: una base `Entidad : IEntity` con solo constructores con
parámetros dispara, porque sus subclases mapeadas necesitan encadenar a un constructor sin
parámetros.

## Ejemplos

### Incorrecto

```csharp
public class Pedido
{
    // LAIN001
    public Pedido()
    {
    }

    public Pedido(Cliente cliente, DateTime fecha)
        : this()
    {
        Cliente = cliente;
        Fecha = fecha;
    }
}
```

### Correcto

```csharp
public class Pedido
{
    protected Pedido()
    {
    }

    public Pedido(Cliente cliente, DateTime fecha)
        : this()
    {
        Cliente = cliente;
        Fecha = fecha;
    }
}
```

## Cómo cuenta los constructores

- Cuentan los constructores de instancia **escritos en el código**, incluido el
  constructor primario (`class Pedido(int numero)`, `record Comprobante(string Tipo)`).
- No cuentan los que genera el compilador: el constructor implícito de una clase sin
  constructores y el constructor de copia de un `record`.
- No cuenta el constructor estático.
- Un constructor con todos sus parámetros opcionales (`Pedido(int numero = 0)`) **no** es
  un constructor sin parámetros.
- En una clase `partial`, cuentan los constructores de todas sus partes.

## Accesibilidades

| Accesibilidad del constructor sin parámetros | Resultado |
|---|---|
| `protected` | Correcto. |
| `public`, `internal`, `protected internal` | LAIN001. |
| `private protected` | LAIN001: el proxy de NHibernate está en otro ensamblado y no lo ve. |
| `private` | LAIN001, salvo en una clase `sealed`. |

En una clase `sealed`, `protected` y `private` son equivalentes (y el compilador avisa con
CS0628 si se usa `protected`), así que se acepta cualquiera de los dos. Una entidad de
NHibernate no puede ser `sealed`, porque sus proxies heredan de ella.

## Qué no detecta

| Caso | Por qué |
|---|---|
| Structs y record structs. | El constructor sin parámetros explícito de un struct tiene que ser público. |
| Interfaces. | No tienen constructores. |

## Mensajes

```
El constructor sin parámetros de 'Sample.Dominio.Pedido' debe ser protected, porque el tipo tiene otros constructores
La entidad 'Sample.Dominio.Pedido' debe tener un constructor sin parámetros protected
```

El primero se marca sobre el constructor sin parámetros; el segundo, sobre el nombre de la
clase. La regla declara un descriptor por mensaje, con el mismo ID y los mismos datos
(título, descripción, categoría, severidad): el catálogo de reglas los acepta así
(`docs/catalogo-de-reglas.md`). Los dos mensajes llevan el nombre completamente calificado
del tipo. Es lo que permite a
SonarQube reconocer un issue ya aceptado aunque el código se mueva de línea.

## Excepciones

No hay excepciones en la regla. Si un caso concreto lo justifica, se acepta el issue en
SonarQube con la justificación del revisor. **No** se usa `#pragma warning disable` ni
`[SuppressMessage]` (ver CLAUDE.md, "Gobernanza").

## Implementación

- Analyzer: `src/dotnet/Lainco.Analyzers/Reglas/ConstructorSinParametrosAnalyzer.cs`
- Tests: `src/dotnet/Lainco.Analyzers.Tests/LAIN001Tests.cs`
- Violación de ejemplo: `samples/SampleSolution/Sample.Dominio/Pedido.cs`
