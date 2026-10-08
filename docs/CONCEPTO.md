# Lainco Quality — la idea

Documento conceptual. Explica **qué se está construyendo y por qué**, sin entrar en
implementación. Si lo leés entero entendés la maquinaria completa; después, `PLAN.md`
cuenta cómo se construye y `ESTADO.md` dónde estamos.

No hace falta saber nada del proyecto para leerlo. Tampoco hace falta conocer las reglas
concretas: **las reglas no son el punto, la maquinaria sí.**

---

## El problema

SonarQube trae varios cientos de reglas activas por defecto. El problema no es la
cantidad: es que ese conjunto **expresa una forma de diseñar que no es la de Lainco**.
Al apuntarle un proyecto, aparecen tres clases de desajuste.

### 1. Reglas que contradicen cómo diseña Lainco

Algunas reglas piden exactamente lo contrario de lo que el equipo decidió hacer.

El caso testigo: Sonar marca como problema que un método no use el estado de su objeto,
y pide convertirlo en `static`. Lainco sostiene lo opuesto — **no usar métodos
estáticos**. No es un capricho: los métodos estáticos no se pueden sobrescribir, no se
pueden reemplazar en un test y atan el código a una implementación concreta.

Esa regla no es un falso positivo que haya que ajustar. Es una regla correcta **para otro
criterio de diseño**, y aplicarla empujaría el código en la dirección contraria a la que
el equipo quiere.

### 2. Reglas razonables que, aplicadas temprano, impiden programar bien

Otras no están equivocadas, pero el momento en que avisan sí.

El ejemplo claro es el código repetido. Que no haya duplicación es una buena meta **al
final**. Exigirla desde la primera repetición obliga a inventar una abstracción antes de
entender el problema — y una abstracción prematura, elegida con dos casos a la vista,
suele ser peor que la repetición que vino a evitar. Después cuesta mucho más
desarmarla que haber esperado.

La regla no sobra; sobra su urgencia.

### 3. Reglas que Lainco quiere y Sonar no tiene

Y al revés: el criterio del equipo incluye cosas que ninguna herramienta trae de fábrica.

- Todos los métodos y properties de un objeto deben ser `virtual`.
- No se usa `sealed`.

Son decisiones coherentes entre sí y con el resto de la arquitectura: nada queda cerrado
a ser extendido, sustituido o interceptado. Ninguna de las dos existe en el catálogo de
Sonar, así que hay que escribirlas.

### El efecto de convivir con ese desajuste

Mientras el conjunto de reglas no responda al criterio del equipo, pasa siempre lo mismo:
como la mayoría de los avisos no le importa a nadie, se deja de mirar la herramienta, y
los que sí importaban quedan enterrados entre los que no. El que necesita avanzar silencia
el aviso en el código —un `#pragma`, un `[SuppressMessage]`, un comentario vacío— y esa
decisión queda escondida en un archivo, tomada por una persona sola, sin justificación.
Y el conjunto activo cambia solo cada vez que el proveedor actualiza su perfil por
defecto, sin que nadie lo haya decidido ni revisado.

## La idea, en una frase

> **Ninguna regla está activa si alguien del equipo no la eligió explícitamente, y esa
> decisión queda registrada, con autor y justificación.**

Dicho de otro modo: **la herramienta tiene que responder a la forma de diseñar de
Lainco, y no al revés.** Las reglas que contradicen el criterio del equipo se descartan,
las que sirven pero molestan temprano se incorporan cuando corresponda, y las que faltan
se escriben. Quien decide, en los tres casos, es el equipo.

Todo el resto del diseño es consecuencia de tomarse esa frase en serio.

El punto de partida lo muestra bien: los perfiles de reglas de SonarQube se crean
**vacíos**, con cero reglas. No se parte del conjunto por defecto para ir sacando; se
parte de la nada y se va agregando lo que alguien decidió agregar. La carga de la prueba
se invierte.

---

## La maquinaria

Cuatro piezas. Lo importante es cómo se reparten las responsabilidades: **cada cosa pasa
en un solo lugar.**

### 1. Dónde nacen los issues

Las reglas vienen de orígenes distintos, pero todas terminan en el mismo circuito:

| Origen | Qué aporta |
|---|---|
| Reglas de SonarQube | El catálogo del proveedor: bugs, vulnerabilidades, code smells. |
| Reglas propias | Las normas de diseño de Lainco que se pueden expresar como código: un analyzer para .NET, un plugin de ESLint para TypeScript. |
| Normas evaluadas por IA | Las normas que requieren juicio y no se pueden programar. Un modelo las evalúa sobre el código de cada PR. |
| Hallazgos de revisores | Lo que una persona detecta revisando y quiere dejar registrado formalmente, no en un comentario que se pierde. |
| Warnings del compilador | Lo que ya grita el compilador y hoy nadie gobierna. |

### 2. Dónde se gestionan

**Un solo lugar: SonarQube Cloud.** Todo issue, venga de donde venga, se ve, se discute y
se resuelve ahí. Mismos estados, mismos permisos, mismo tablero.

Esto es lo que resuelve el problema 2 de más arriba. Si un issue no corresponde, no se
silencia en el código: **un revisor lo acepta en Sonar, con justificación.** La excepción
deja de ser una línea escondida en un archivo y pasa a ser una decisión visible, con
nombre y fecha. Suprimir issues desde el código queda prohibido.

### 3. Quién decide qué está activo

Una **aplicación de catálogo de reglas**, que es la fuente de verdad. Contiene todas las
reglas disponibles de todos los orígenes, y el estado de cada una:

```
Pendiente de analizar  →  A revisar  →  En prueba  →  Incorporada
                                                   →  Descartada
```

- **Pendiente de analizar** — nadie la miró. Estado inicial de todas.
- **A revisar** — alguien la analizó y hace falta decidir.
- **En prueba** — se está midiendo cuántos issues levantaría sobre el código real, **sin
  afectar a nadie todavía**. Se puede ver una muestra y marcar cuáles son falsos
  positivos antes de decidir.
- **Incorporada** — activa. Cuenta para bloquear.
- **Descartada** — no se usa, con justificación obligatoria.

Dos detalles que no son caprichos:

- **No se puede saltar de "Pendiente" a "Incorporada".** Toda regla que empieza a
  bloquear pasó antes por revisión o por prueba.
- **Hay dos roles.** Cualquiera puede analizar y mandar reglas a prueba; solo los
  revisores pueden incorporar o descartar. Lo que afecta a todo el equipo lo decide
  alguien habilitado para eso.

Sonar y las herramientas **no deciden nada**: ejecutan lo que la app dice.

### 4. Cómo vuelve al programador

Una decisión que no llega al IDE no sirve: el programador se entera tarde, cuando el PR
ya falló.

- Las reglas propias viajan en **paquetes** (NuGet y npm) que cada repositorio referencia.
  El paquete trae los analyzers **y las severidades decididas**. Cambiar una severidad en
  la app y publicar una versión cambia lo que ven todos los repos, sin tocar
  configuración en ninguno.
- Y al revés: cuando un revisor **acepta** un issue en Sonar, ese issue **desaparece del
  IDE** del programador. Una herramienta aparte sincroniza las aceptaciones y las oculta
  localmente. Es el reemplazo honesto del `#pragma`: mismo efecto práctico, pero la
  decisión está registrada y es de quien corresponde.

> Esa ocultación **solo pasa en la máquina del programador, nunca en el servidor de
> integración.** El issue se sigue reportando siempre; lo que cambia es que ya está
> aceptado. Si se ocultara también en el servidor, se perdería el registro de que existe.

---

## El recorrido de un issue

Ata las cuatro piezas:

1. Alguien escribe código que viola una regla **incorporada**.
2. **Lo ve en el IDE mientras escribe**, con un mensaje que nombra exactamente qué símbolo
   está mal y un enlace a la documentación de la regla.
3. Si igual lo sube, el análisis del PR lo reporta y **el PR queda bloqueado**.
4. Si corresponde arreglarlo, lo arregla.
5. Si no corresponde —es un caso legítimo—, pide que lo revisen. **Un revisor lo acepta
   en Sonar, con justificación.**
6. El issue deja de bloquear y **desaparece del IDE de todos**.
7. La aceptación queda registrada para siempre, y **sobrevive a que el código se mueva de
   lugar**.

El paso 7 es el que sostiene todo lo demás, y es más difícil de lo que parece.

---

## Tres restricciones que explican el diseño

Si algo del proyecto parece raro, casi siempre es por una de estas tres. Las tres están
verificadas con pruebas reales, no asumidas.

### 1. Sonar no deja crear issues desde afuera

No hay forma de dar de alta un issue por API: los issues **solo nacen de un análisis**. Y
si un análisis deja de reportar un issue, Sonar lo da por corregido y lo cierra, perdiendo
su estado —incluida una aceptación.

Consecuencia: todo hallazgo que no venga de una regla automática —el de la IA, el del
revisor— hay que **volver a emitirlo en cada análisis** mientras siga vigente. De ahí
viene buena parte de la complejidad de esa parte del sistema.

### 2. Los issues se reconocen por su mensaje

Sonar vuelve a identificar un issue entre corridas por el archivo, la regla y el
**texto del mensaje**. No por la línea, que cambia todo el tiempo.

Consecuencia: el mensaje de cada regla **debe incluir el nombre completo del símbolo
afectado** y nada variable. No "falta inicializar" sino "la property
`Ventas.Pedido.Fecha` no debe inicializarse en la declaración". Así una aceptación
sobrevive a que el código se mueva.

### 3. Los issues de reglas propias no mueven los indicadores de Sonar

Las reglas propias entran a Sonar como *issues externos*. Se ven, se gestionan y se
cuentan — pero **no afectan las calificaciones** (A, B, C...) que Sonar calcula.

Consecuencia: la condición que bloquea un PR tiene que contar issues, no mirar
calificaciones. Si se usara la configuración recomendada por Sonar, el PR pasaría en
verde con la violación adentro, sin ningún síntoma visible.

---

## Qué no es esto

- **No reemplaza el code review.** Automatiza lo que se puede verificar siempre igual,
  para que la revisión humana se ocupe de lo que requiere criterio.
- **No se trata de las reglas que hay hoy.** Las que existen son un punto de partida; lo
  que importa es que cualquier regla futura entre por el mismo circuito.
- **No es una herramienta más.** Es, sobre todo, un acuerdo sobre quién decide qué, con
  herramientas que lo hacen cumplir.

---

## Por dónde seguir

| Documento | Qué cuenta |
|---|---|
| `ESTADO.md` | Dónde estamos parados y qué sigue. **Leer segundo.** |
| `../CLAUDE.md` | Las convenciones de trabajo y la arquitectura técnica. |
| `PLAN.md` | Las fases, con tareas y criterios de aceptación. |
| `decisiones/` | Los experimentos que se hicieron y qué midieron. |
| `FASE-6.md`, `FASE-7.md` | Diseño detallado de la app de catálogo y de los hallazgos de IA. |

---
