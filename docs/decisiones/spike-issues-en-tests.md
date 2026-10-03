# Spike — ¿SonarQube Cloud importa issues nacidos en proyectos de test?

Fase 2, tarea 4. Ejecutado el **2026-10-03**.

## Por qué se hizo

LAIN003 exige que cada entidad mapeada en NHibernate tenga un test que asigne todas sus
properties persistidas. La violación es **la ausencia de un test**, así que el
diagnóstico natural nace dentro del proyecto de tests.

Eso choca con dos comportamientos conocidos de Sonar: el scanner clasifica los proyectos
de test aparte de los de producción, y varias métricas excluyen el código de test. Si los
issues de proyectos de test no llegaran a Sonar, o llegaran pero no contaran, LAIN003 no
podría diseñarse como estaba pensada.

## Cómo se midió

Regla temporal **LAIN999**, que dispara sobre cualquier tipo cuyo nombre termine en
`Tests`. Se la hizo disparar a ambos lados del límite para poder comparar:

| Archivo | Proyecto | Rol en el experimento |
|---|---|---|
| `Sample.Dominio/SpikeDominioTests.cs` | `Sample.Dominio` (MAIN) | Grupo de control. |
| `Sample.Tests/MapeoDeEntidadesTests.cs` | `Sample.Tests` (TEST) | Archivo preexistente. |
| `Sample.Tests/SpikeNuevoEnTests.cs` | `Sample.Tests` (TEST) | Archivo **nuevo**, para medir `new_violations`. |

Con la misma regla a los dos lados, un resultado parcial señala al proyecto de test y no
a un error de la regla.

## Resultados

**1. El scanner reconoce el proyecto de test.** Del log del análisis:

```
INFO: Found 3 MSBuild C# projects: 2 MAIN projects. 1 TEST project.
```

No es que lo haya tratado como código de producción por accidente: lo clasificó bien y
aun así importó el issue.

**2. Los issues de proyectos de test se importan.** Las tres violaciones llegaron, con
la misma forma que las de código de producción:

```
external_roslyn:LAIN999 | Sample.Tests/MapeoDeEntidadesTests.cs
external_roslyn:LAIN999 | Sample.Dominio/SpikeDominioTests.cs
external_roslyn:LAIN004 | Sample.Dominio/Articulo.cs
```

**3. Cuentan en `violations`.** La métrica total subió a 3 y después a 4, incluyendo los
de archivos de test.

**4. Cuentan en `new_violations`**, que es la métrica que usa un quality gate sobre
código nuevo. Al agregar `SpikeNuevoEnTests.cs` —archivo nuevo dentro del proyecto de
tests— la medida pasó de **1 a 2**.

| Análisis | Issues totales | `new_violations` |
|---|---|---|
| 1 — solo LAIN004 | 1 | 1 |
| 2 — se suma LAIN999 en dominio y en test | 3 | 1 |
| 3 — se suma LAIN999 en archivo **nuevo** de test | 4 | **2** |

El salto del análisis 3 es el dato que importa: un issue nacido en un archivo de test
**puede** entrar al código nuevo y, por lo tanto, bloquear el quality gate.

El análisis 2 explica por qué esto necesitaba una segunda medición: ahí se agregaron dos
issues y `new_violations` siguió en 1, porque ese commit **no modificó**
`MapeoDeEntidadesTests.cs`. Para Sonar, un issue viejo en un archivo que no cambió no es
código nuevo, sin importar que la regla sea nueva. Es el comportamiento esperado, pero
de no haberlo separado se podría haber concluido —mal— que los archivos de test no
cuentan.

## Conclusión

**LAIN003 se puede diseñar como estaba previsto en `docs/PLAN.md`:** reportando el
diagnóstico dentro del proyecto de tests. El issue llega a Sonar, se gestiona igual que
cualquier otro y puede hacer fallar el quality gate.

### Consecuencias para el diseño de LAIN003

- El diagnóstico se reporta **en el proyecto de tests**, no sobre la entidad. Si se
  reportara sobre la entidad, el programador que agrega la entidad vería el error en un
  archivo que sí tocó, pero la corrección hay que hacerla en otro lado.
- **La ubicación concreta importa para el quality gate.** Un issue sobre un archivo de
  test que no cambió no entra al código nuevo. Si LAIN003 reporta sobre un archivo
  preexistente (por ejemplo, la clase de tests de la entidad), agregar una entidad nueva
  sin su test podría no bloquear nada. Hay que elegir una ubicación que cambie junto con
  la causa, o aceptar que el bloqueo llegue recién cuando alguien toque ese archivo.
  **Decidir al implementar LAIN003 (Fase 3).**
- Sigue en pie la limitación ya anotada en el plan: LAIN003 necesita análisis a nivel
  compilación, así que en el IDE solo se ve con análisis de solución completa.

## Observación adicional

Hay una discrepancia entre dos lecturas de la API que conviene tener presente al
construir la app de catálogo (Fase 6): la métrica `new_violations` y el filtro
`issues/search?inNewCodePeriod=true` no devolvieron lo mismo (1 contra 3 en el análisis
2). Parecen usar criterios distintos —código modificado en el período contra fecha de
creación del issue—. **No usar los dos indistintamente**; para lo que haga el quality
gate, la referencia es la métrica.

## Limpieza

La regla LAIN999 y las clases del spike se eliminaron al cerrar este documento. El ID
**LAIN999 queda quemado** y no se reutiliza, según la convención de `CLAUDE.md`.
