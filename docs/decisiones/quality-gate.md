# Quality Gate — configuración y por qué

Fase 2, tarea 1. Verificado el **2026-10-03** con el PR #1.

## Configuración

Gate `Lainco`, asignado al proyecto. **Una sola condición:**

| Where | Metric | Operator | Value |
|---|---|---|---|
| On New Code | Issues (`new_violations`) | is greater than | 0 |

## Por qué no se usan las condiciones de `Sonar way`

### Los ratings ignoran los issues externos

El gate por defecto mide *ratings* (Reliability, Security, Maintainability). **No sirven
para nuestras reglas.** Medido en el PR #1:

```
new_violations            : 1      ← la violación de LAIN004
new_maintainability_rating: 1.0    ← A, como si no hubiera nada
```

El issue tiene impacto declarado `MAINTAINABILITY / MEDIUM` y aun así el rating quedó en
A. Los issues externos (`external_roslyn`) cuentan en las métricas de **conteo** de
issues, pero no mueven los ratings.

Consecuencia directa: **un gate armado sobre ratings habría dado OK con la violación
adentro.** Un gate que no bloquea nada, sin ningún síntoma visible.

### La cobertura rompería el gate por el motivo equivocado

La sample no reporta cobertura. Una condición sobre `new_coverage` haría fallar el gate
siempre, y no se podría distinguir un fallo legítimo por una regla LAIN de uno por falta
de datos de cobertura.

## Verificación (PR #1)

| Qué | Resultado |
|---|---|
| Gate del PR | **ERROR** — `new_violations GT 0 -> actual=1` |
| Check en GitHub | `SonarCloud Code Analysis` → **fail** |
| Comentario en el PR | SonarCloud publicó "Quality Gate failed" |
| Issue detectado | `external_roslyn:LAIN004` en `PruebaQualityGate.cs:28` |

## Pendiente: el check no bloquea el merge

El PR quedó en estado `UNSTABLE` (checks en rojo) pero **`MERGEABLE`**: GitHub permite
mergearlo igual, porque no hay ninguna regla que exija el check.

Para que el gate bloquee de verdad hay que agregar **branch protection** sobre `main`
(disponible sin costo en repositorios públicos):

- Require status checks to pass before merging
- Marcar **`SonarCloud Code Analysis`** como check requerido

> El job de GitHub Actions (`Análisis de la sample`) termina en **verde** aunque el gate
> falle. Es correcto: el scanner envía los resultados y termina; el gate se evalúa
> después, del lado de Sonar. El check que importa es el que publica SonarCloud, no el
> del workflow. La alternativa sería `sonar.qualitygate.wait=true` en el scanner, que
> hace esperar al job — más lento, y redundante si se usa branch protection.

## Respuesta parcial a D7.5 (Fase 7)

La decisión D7.5 pregunta si los hallazgos de IA deberían contar para el quality gate, y
anota que las condiciones trabajan sobre métricas agregadas y no filtran por motor.

Lo medido acá aporta la mitad de la respuesta: **existe una separación, pero es entre
reglas nativas de Sonar y reglas externas**, no entre motores externos. Los ratings solo
reflejan las reglas de Sonar; las métricas de conteo reflejan todo.

**Lo que sigue abierto:** eso no permite distinguir `lainco-ia` de `external_roslyn`,
que son los dos externos. Si se quiere que los hallazgos de IA se vean pero no bloqueen,
la separación por métrica no alcanza. D7.5 sigue sin resolver.
