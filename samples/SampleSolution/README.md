# SampleSolution — solución de prueba con violaciones conocidas

Solución chica que existe para probar el circuito de Lainco Quality de punta a punta:
IDE → build → SonarScanner → SonarQube Cloud → aceptación de issues → supresión local.

Contiene **a propósito** al menos una violación de cada regla LAIN, más contraejemplos
correctos para verificar que los analyzers no produzcan falsos positivos.

## Proyectos

| Proyecto | Rol |
|---|---|
| `Sample.Dominio` | Entidades y servicios de dominio. |
| `Sample.Mapeos` | Mapeos Fluent NHibernate (`ClassMap<T>`, decisión D2) y un repositorio. |
| `Sample.Tests` | Tests de properties persistidas, que es lo que exige LAIN003. |

`net8.0` para los tres. Nullable deshabilitado en `Directory.Build.props`: las entidades
se construyen por reflexión y el análisis de nulabilidad solo agregaría advertencias del
compilador que no corresponden a ninguna regla LAIN.

**Estado actual (Lainco.Analyzers 0.3.0):** compila con **1 advertencia**, LAIN001 en
`Pedido.cs`: es la única regla que el `.globalconfig` del paquete enciende hoy (LAIN004 y
LAIN005 nacen apagadas y la app no las incorporó). Ninguna advertencia del compilador ni de
los analyzers del SDK: las apaga la base del paquete (ver "Qué apaga el paquete" en
`docs/nuevo-repositorio.md`). Esa es la situación deseada: las únicas advertencias que deben
aparecer son las reglas que el equipo eligió.

La sample referencia el paquete `Lainco.Analyzers` desde `Directory.Build.props`, y lo
resuelve del feed local `artifacts/nupkg` (ver `nuget.config`). Para regenerarlo:

```bash
dotnet pack src/dotnet/Lainco.Analyzers.Package -c Release -o artifacts/nupkg
```

## Violaciones intencionales

Cada una está marcada en el código con un comentario `// >>> LAINxxx`.

| Regla | Archivo | Línea | Qué viola |
|---|---|---|---|
| LAIN001 | `Sample.Dominio/Pedido.cs` | 14 | Constructor sin parámetros `public` existiendo otro constructor; debería ser `protected`. |
| LAIN002 | `Sample.Dominio/LineaPedido.cs` | 16, 24 | Dos constructores con código y ninguno encadena al otro. |
| LAIN003 | `Sample.Tests/MapeoDeEntidadesTests.cs` | 85 | `Deposito` está mapeada en `DepositoMap` pero no tiene test que asigne sus properties persistidas. |
| LAIN004 | `Sample.Dominio/Articulo.cs` | 25 | `Descripcion` se inicializa inline (`{ get; set; } = "..."`). |
| LAIN005 | `Sample.Dominio/CalculadorDeTotales.cs` | 11 | `AplicarDescuento` es un método estático que no es un `operator`. |
| LAIN006 | `Sample.Mapeos/RepositorioDePedidos.cs` | 23 | `ToList()` sobre `IQueryable<Pedido>` (query a base de datos). |

> Las líneas se van a mover a medida que el código evolucione. La marca `// >>> LAINxxx`
> es la referencia estable; buscá por ella antes que por el número de línea.

## Contraejemplos (casos negativos)

Existen para verificar que los analyzers **no** disparen donde no corresponde.

| Regla | Dónde | Por qué no viola |
|---|---|---|
| LAIN001 | `Cliente.cs` | El constructor sin parámetros es `protected`. |
| LAIN002 | `Cliente.cs` | Un solo constructor con código. |
| LAIN002 | `Pedido.cs` | El constructor con código encadena con `: this()`. |
| LAIN003 | `Cliente`, `Pedido`, `LineaPedido`, `Articulo` | Tienen su test en `MapeoDeEntidadesTests`. |
| LAIN004 | Todas las demás properties | Se inicializan en el constructor. |
| LAIN005 | `Importe.cs` | Sus miembros estáticos son `operator`, exceptuados por la regla. |
| LAIN005 | `CalculadorDeTotales.CalcularTotal` | Es método de instancia. |
| LAIN005 | `ExtensionesDeDecimal.cs` | Extension method sobre `decimal`, un tipo que no pertenece al proyecto: exceptuado (D5). |
| LAIN006 | `RepositorioDePedidos.BuscarPorId` | Resuelve en el motor con `SingleOrDefault`. |
| LAIN006 | `RepositorioDePedidos.LineasOrdenadas` | El `ToList()` es sobre una colección en memoria. |

## Casos que dependen de decisiones abiertas

| Caso | Decisión | Situación |
|---|---|---|
| `Pedido()` está vacío y el otro constructor encadena **a él**, no al revés. Si LAIN002 exige que todos encadenen al constructor *con código*, este caso también violaría LAIN002. | D3 / D4 | Al resolverlas, revisar si hay que ajustar `Pedido.cs` o documentarlo como segunda violación esperada. |
| `LineaPedido` tiene un constructor `protected` sin parámetros además de los dos con código. | D3 | Si el `protected` sin parámetros no queda exceptuado, suma una violación más. |

## Cómo se usa en cada fase

| Fase | Uso |
|---|---|
| 1 | Referencia el paquete `Lainco.Analyzers` desde `Directory.Build.props`; la violación de LAIN004 debe verse en el IDE. |
| 2 | Es el proyecto que se analiza en Sonar. El spike de issues en proyectos de test se hace sobre `Sample.Tests`. |
| 3 | Cada regla nueva debe detectar su violación acá, en IDE y en Sonar. |
| 4 | Se acepta un issue en Sonar y se verifica que desaparezca del IDE. |

## Comandos

```bash
dotnet build      # 3 advertencias: LAIN004 ×2 en Articulo.cs, LAIN005 en CalculadorDeTotales.cs
dotnet test       # 4 tests
```
