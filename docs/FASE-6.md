# Fase 6 — Inventario y catálogo de reglas

Documento de diseño detallado. Complementa la sección "Fase 6" de `docs/PLAN.md`.

**Esta fase corre en paralelo con las fases 1 a 5.** Su primera entrega (6.1) solo necesita la organización de SonarQube Cloud y los Quality Profiles vacíos creados en la Fase 0; no depende de los analyzers ni de ESLint. Las entregas posteriores se van enganchando a medida que las otras fases avanzan (ver sección 13).

---

## 1. Objetivo

Tener un **inventario completo de todas las reglas disponibles**, de cualquier origen, y gestionar la decisión sobre cada una: cuáles se incorporan, cuáles se descartan, cuáles se prueban y cuáles esperan revisión.

El punto de partida es deliberado:

- **Quality Profiles de Sonar vacíos**, sin herencia de "Sonar way". Ninguna regla de Sonar está activa.
- **Inventario con todas las reglas** de Sonar para C# y TypeScript, en estado "Pendiente de analizar".

A partir de ahí, cada regla que se activa lo hace porque alguien del equipo lo decidió y dejó registrado por qué. La app es la **fuente de verdad**: Sonar, el paquete de analyzers y la configuración de ESLint solo ejecutan lo que la app decide.

---

## 2. Orígenes de reglas

| Origen | Fuente del inventario | Disponible desde |
|---|---|---|
| **Sonar** | Web API de SonarQube Cloud (`api/rules/search`) | Entrega 6.1 |
| **Roslyn propias** | Metadata del assembly de `Lainco.Analyzers` | Entrega 6.4 (requiere Fase 3) |
| **ESLint propias** | `meta` de las reglas de `@lainco/eslint-plugin` | Entrega 6.4 (requiere Fase 5) |
| **Normas de IA** | Archivos `normas/*.yaml` del repositorio | Entrega 6.6 (junto con Fase 7) |

Todas conviven en el mismo inventario, con el mismo ciclo de vida.

---

## 3. Sincronización con Sonar

Job periódico (diario, y ejecutable a demanda desde la app).

1. Consulta `api/rules/search` por cada lenguaje gestionado (`cs`, `ts`), paginando con el tamaño máximo de página que permita la API, y pidiendo los campos necesarios: clave, nombre, descripción, tipo, severidad, tags, atributos de clean code e impactos, parámetros, estado y fecha de creación.
2. Compara con lo almacenado:
   - **Regla nueva** → se crea en estado "Pendiente de analizar" y se marca como nueva desde la última sincronización.
   - **Regla modificada** (cambió la descripción, los parámetros o la severidad por defecto) → se actualiza y se marca "modificada". Si estaba Incorporada o En prueba, genera un aviso para revisar si el cambio afecta la decisión.
   - **Regla deprecada o eliminada en Sonar** → se marca. Si estaba Incorporada, genera un aviso: hay que decidir si se reemplaza por otra regla.
3. Registra cada corrida en un log de sincronización: fecha, reglas nuevas, modificadas y deprecadas.

> Verificar en la documentación de la Web API de SonarQube Cloud los nombres exactos de parámetros y campos (organización, lenguajes, campos adicionales, tamaño de página) antes de implementar.

---

## 4. Ciclo de vida

### Estados

| Estado | Significado |
|---|---|
| **Pendiente de analizar** | Nadie la miró todavía. Estado inicial de toda regla nueva. |
| **A revisar** | Alguien la analizó y requiere decisión del equipo. |
| **En prueba** | Se está midiendo su efecto sobre el código real, sin afectar el quality gate. |
| **Incorporada** | Activa. Cuenta para el quality gate. |
| **Descartada** | No se usa. Con justificación obligatoria. |

### Transiciones permitidas

| Desde | Hacia | Requisitos |
|---|---|---|
| Pendiente de analizar | A revisar | — |
| Pendiente de analizar | Descartada | Justificación. Admite transición masiva. |
| Pendiente de analizar | En prueba | — |
| A revisar | En prueba | — |
| A revisar | Incorporada | Justificación y severidad. Rol decisor. |
| A revisar | Descartada | Justificación. Rol decisor. |
| En prueba | Incorporada | Justificación, severidad y resultados de prueba disponibles. Rol decisor. |
| En prueba | Descartada | Justificación. Rol decisor. |
| En prueba | A revisar | — |
| Incorporada | Descartada | Justificación. Rol decisor. (Retiro de una regla activa.) |
| Incorporada | En prueba | Justificación. Rol decisor. (Por ejemplo, tras un cambio de la regla en Sonar.) |
| Descartada | A revisar | Justificación. (Reabrir una decisión.) |

**No se puede pasar de "Pendiente de analizar" directo a "Incorporada":** toda regla que entra al quality gate pasa antes por revisión o por prueba.

### Roles

- **Analista:** cualquier miembro del equipo. Puede mover reglas entre Pendiente, A revisar y En prueba, y descartar masivamente desde Pendiente.
- **Decisor:** los revisores. Únicos habilitados para Incorporar, Descartar desde A revisar o En prueba, y retirar reglas activas.

Con un equipo chico, una misma persona puede tener ambos roles; lo importante es que las decisiones que afectan el gate queden asociadas a alguien con rol decisor.

### Decisión al incorporar

- **Severidad** con la que se incorpora (puede diferir de la default de Sonar).
- **Parámetros**, para las reglas que los tienen (por ejemplo, un umbral de complejidad).
- **Justificación.**

---

## 5. Carga inicial y triage masivo

La primera sincronización trae varios cientos de reglas (solo para C# son más de 460). Trabajarlas de a una no es viable; la app necesita herramientas específicas para esta etapa.

### Filtros y vistas

- Por lenguaje, tipo (bug, vulnerabilidad, code smell, security hotspot), severidad, tags, atributos de clean code, estado, origen.
- Por "nuevas desde la última sincronización" y "modificadas".
- Por sugerencia de la IA (sección 6) y su nivel de confianza.
- Vistas guardadas (por ejemplo, "Bugs de C# pendientes", "Sugeridas para descartar con alta confianza").

### Operaciones masivas

- Transición masiva de las reglas seleccionadas, con **una justificación común** registrada en cada decisión.
- Las transiciones masivas solo se permiten hacia A revisar, En prueba o Descartada. **Nunca hacia Incorporada**: cada regla que entra al gate se decide individualmente.

### Tablero de progreso

- Porcentaje de reglas triageadas por lenguaje y tipo.
- Reglas en cada estado, por origen.
- Reglas en A revisar o En prueba hace más de N días.

### Orden sugerido para el triage inicial

1. **Descarte masivo de lo que no aplica**: reglas de frameworks o tecnologías que no usan (se identifican por tags).
2. **Bugs y vulnerabilidades**: suelen ser las de mayor valor y menor controversia.
3. **Code smells**: acá están los choques con las normas de diseño propias, así que es donde más pesa la pre-clasificación de la IA y la revisión de conflictos.

---

## 6. Pre-clasificación asistida por IA

Una primera pasada automática sobre las reglas pendientes, para que el equipo parta de una propuesta en lugar de una hoja en blanco.

### Entrada

- Descripción completa de la regla (texto, ejemplos de código correcto e incorrecto).
- Las **normas de diseño del equipo**, desde su fuente documentada, versionadas.
- El listado de reglas ya Incorporadas (propias y de Sonar), para detectar conflictos y equivalencias.

### Salida (JSON Schema obligatorio)

```json
{
  "regla": "csharpsquid:S2325",
  "estadoSugerido": "Descartada",
  "justificacion": "Pide convertir en estáticos métodos que no usan datos de instancia; contradice la norma de no usar métodos estáticos.",
  "conflictos": ["LAIN005"],
  "equivalencias": [],
  "confianza": 0.95
}
```

### Reglas de uso

- La sugerencia se guarda **aparte del estado**: nunca cambia el estado por sí misma.
- En la UI se muestra junto a la regla, con su justificación y los conflictos detectados.
- El usuario puede aceptarla con un clic, o en masa sobre una vista filtrada. Al aceptarla, la decisión queda registrada **a nombre del usuario**, con una marca "basada en sugerencia de IA".
- Las restricciones de la sección 4 aplican igual: una sugerencia de "Incorporada" solo puede llevar la regla a A revisar en masa; la incorporación sigue siendo individual y de un decisor.
- Cache por `(clave de regla, hash de la descripción, versión de las normas, versión del prompt y modelo)`. Si cambian las normas de diseño, se re-sugiere todo lo pendiente.

---

## 7. Relaciones entre reglas

| Tipo | Significado | Efecto |
|---|---|---|
| **Conflicto** | Cumplir una implica violar la otra (ej.: S2325 y LAIN005). | Bloquea incorporar una regla que choca con otra ya Incorporada, salvo override con justificación de un decisor. |
| **Equivalencia** | Detectan lo mismo. | Advierte al incorporar una regla equivalente a otra ya activa, para evitar issues duplicados. |
| **Complementa** | Cubren aspectos relacionados. | Informativo. |

Las relaciones se cargan manualmente o se aceptan desde las sugerencias de la IA. Son bidireccionales y cruzan orígenes: una regla de Sonar puede tener conflicto con una regla Roslyn propia o con una norma de IA.

---

## 8. Estado "En prueba"

Probar una regla no puede afectar el quality gate de producción. Tampoco conviene un segundo proyecto en Sonar con un perfil de prueba, porque SonarQube Cloud suma las líneas de todos los proyectos y eso duplicaría la facturación.

### Mecanismo

1. La app genera una **configuración de prueba** con solo las reglas En prueba activas:
   - Reglas de Sonar para C#: `.globalconfig` para el paquete NuGet `SonarAnalyzer.CSharp`, que contiene las reglas de Sonar para C# como analyzers Roslyn, con los mismos IDs (`Sxxxx`).
   - Reglas de Sonar para TypeScript: configuración para `eslint-plugin-sonarjs`.
   - Reglas propias nuevas: configuración para los paquetes propios.
2. Un **job de CI programado** (por ejemplo, nocturno) corre sobre la rama principal de los repositorios seleccionados, con esa configuración, y genera reportes SARIF / JSON de ESLint.
3. El job sube los resultados a la app. **No se envía nada a Sonar.**

### Mapeo de claves

- C#: los IDs de `SonarAnalyzer.CSharp` coinciden con las claves de Sonar (`S2325` ↔ `csharpsquid:S2325`).
- TypeScript: los nombres de regla de `eslint-plugin-sonarjs` no coinciden con las claves de Sonar. Hay que construir y mantener un mapeo; verificar si el plugin expone la clave de Sonar en su metadata para generarlo automáticamente.
- Algunas reglas de Sonar no existen en estos paquetes (por ejemplo, las que dependen de análisis que solo hace el motor de Sonar). Se marcan como **"no probable localmente"**: pueden pasar de A revisar a Incorporada sin prueba.

### Qué muestra la app por regla en prueba

- Cantidad de issues que levantaría, total y por repositorio.
- Evolución entre corridas.
- Una muestra de issues con enlace al código, donde el equipo puede marcar cada uno como válido o falso positivo, para estimar la tasa de falsos positivos antes de decidir.
- Período mínimo de prueba configurable antes de habilitar la incorporación.

---

## 9. Publicación de decisiones

### Reglas de Sonar

- Al incorporar: `api/qualityprofiles/activate_rule` con la severidad y los parámetros decididos.
- Al descartar o retirar: `api/qualityprofiles/deactivate_rule`.
- Las operaciones se encolan con reintentos, y se registra el resultado.
- **Job de reconciliación** periódico: compara el estado deseado (la app) con el real (el perfil en Sonar) y corrige o alerta ante diferencias.

### Reglas propias (Roslyn y ESLint)

- La app genera el `.globalconfig` del paquete de analyzers y la configuración de `@lainco/eslint-config` a partir de las decisiones.
- **No publica directamente:** abre un PR en el repositorio `lainco-quality` con el cambio de configuración. Al mergearse, el CI publica la nueva versión de los paquetes. Así el cambio de reglas queda revisado y versionado como cualquier otro cambio de código.

### Normas de IA

- Al incorporar o poner en prueba una norma, el revisor IA de la Fase 7 empieza a evaluarla. Al descartarla, sus hallazgos activos se descartan.

---

## 10. Detección de desvíos

La app alerta cuando:

- Una regla está activa en el Quality Profile de Sonar sin estar Incorporada en la app (alguien la activó a mano), o al revés.
- El Quality Profile tiene configurada herencia de otro perfil.
- Un proyecto de Sonar usa un Quality Profile distinto del gestionado.
- (Posterior) Un repositorio referencia una versión desactualizada del paquete de analyzers o de la configuración de ESLint.

---

## 11. Modelo de datos

**Regla**

| Campo | Descripción |
|---|---|
| `id` | Interno. |
| `origen` | `sonar` / `roslyn` / `eslint` / `norma_ia`. |
| `clave` | Clave del origen (`csharpsquid:S2325`, `LAIN005`, `lainco/no-...`, `LAIN-D012`). |
| `lenguaje` | `cs` / `ts`. |
| `nombre`, `descripcion` | Texto de la regla. |
| `tipo`, `severidadDefault`, `tags` | Metadata del origen. |
| `parametros` | Definición de parámetros, si tiene. |
| `hashDescripcion` | Para detectar modificaciones. |
| `deprecada` | Sí/no, con fecha. |
| `probableLocalmente` | Sí/no, para el estado En prueba. |
| `primeraSincronizacion`, `ultimaModificacion` | Fechas. |

**EstadoRegla:** regla, estado actual, severidad asignada, valores de parámetros.

**Decision:** regla, estado anterior, estado nuevo, autor, fecha, justificación, `basadaEnSugerencia` (sí/no), `operacionMasiva` (id de lote, si corresponde).

**SugerenciaIA:** regla, estado sugerido, justificación, conflictos, equivalencias, confianza, versión de normas, versión del evaluador, fecha.

**Relacion:** regla A, regla B, tipo, origen (manual / sugerencia IA aceptada), autor.

**CorridaPrueba:** fecha, repositorios, configuración usada.

**ResultadoPrueba:** corrida, regla, repositorio, cantidad de issues.

**MuestraPrueba:** resultado, ubicación, fragmento de código, evaluación (válido / falso positivo / sin evaluar), evaluador.

**Sincronizacion:** fecha, origen, reglas nuevas, modificadas, deprecadas.

**Publicacion:** decisión, destino (Sonar / PR de configuración), estado, intentos, resultado.

---

## 12. Integraciones y permisos

- **SonarQube Cloud:** token con permiso para administrar Quality Profiles (para activar y desactivar reglas) y lectura de reglas. Guardado como secreto del backend.
- **Repositorio `lainco-quality`:** token con permiso para crear ramas y PRs.
- **Proveedor de IA:** para la pre-clasificación (sección 6).
- **CI:** token de servicio para que el job de prueba suba resultados.

---

## 13. Entregas incrementales

| Entrega | Contenido | Depende de |
|---|---|---|
| **6.1 Inventario de Sonar** | Sincronización, ciclo de vida, roles, historial, filtros, operaciones masivas, tablero de progreso. | Fase 0 (organización y perfiles vacíos en Sonar). **Arranca en paralelo con la Fase 1.** |
| **6.2 Publicación a Sonar** | Activación / desactivación en el Quality Profile, reconciliación, detección de desvíos en Sonar. | 6.1 |
| **6.3 IA y relaciones** | Pre-clasificación por IA, relaciones, bloqueo por conflictos. | 6.1 |
| **6.4 Reglas propias** | Inventario de reglas Roslyn y ESLint; generación de configuración y PR automático. | 6.2, Fase 3 (Roslyn), Fase 5 (ESLint) |
| **6.5 En prueba** | Configuración de prueba, job de CI, resultados, muestras y tasa de falsos positivos. | 6.2, Fase 2 |
| **6.6 Normas de IA** | Normas como cuarto origen; integración con el revisor IA. | 6.4, Fase 7 |

### Criterios de aceptación

**6.1**
- La primera sincronización carga todas las reglas de C# y TypeScript en "Pendiente de analizar".
- Una segunda sincronización sin cambios en Sonar no crea ni modifica nada.
- Se pueden descartar masivamente las reglas de un tag, con una justificación que queda en cada decisión.
- No se puede incorporar en masa ni pasar de Pendiente a Incorporada.
- El historial de una regla muestra todas sus decisiones con autor y justificación.

**6.2**
- Incorporar una regla la activa en el perfil de Sonar con la severidad elegida; descartarla la desactiva.
- Activar una regla a mano en Sonar genera una alerta de desvío.

**6.3**
- La IA sugiere Descartada para S2325 y detecta el conflicto con LAIN005.
- Intentar incorporar una regla en conflicto con otra incorporada se bloquea salvo override justificado.

**6.4**
- Publicar una versión nueva de `Lainco.Analyzers` agrega sus reglas al inventario sin carga manual.
- Incorporar una regla propia abre un PR con el cambio en el `.globalconfig`.

**6.5**
- Una regla de Sonar En prueba muestra cantidad de issues por repositorio sin que aparezca nada en Sonar.
- Se pueden marcar muestras como falso positivo y la app calcula la tasa.

---

## 14. Decisiones pendientes

| # | Decisión | Opciones |
|---|---|---|
| D8 | Stack de la app | A definir. |
| D6.1 | Quiénes tienen rol decisor | Lista de personas / equipo de la plataforma de repos. |
| D6.2 | Fuente de las normas de diseño para la pre-clasificación | Documentación existente del equipo (exportada y versionada) / archivo en el repo. |
| D6.3 | Proveedor y modelo de IA | Compartir la decisión D7.1 de la Fase 7. |
| D6.4 | Período mínimo de prueba | Ej.: dos semanas o N corridas. |
| D6.5 | Repositorios incluidos en el job de prueba | Todos / selección. |
| D6.6 | Frecuencia de sincronización con Sonar | Diaria / semanal. |
