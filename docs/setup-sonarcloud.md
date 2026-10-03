# Configuración inicial de SonarQube Cloud (Fase 0, tarea 4)

**Estado: completada el 2026-10-03.** Los datos quedaron al final del documento.

Pasos manuales en la web de SonarQube Cloud. No se pueden automatizar desde el repo
porque crean la organización y las credenciales que después usa todo lo demás.

> Los nombres exactos de los menús cambian entre versiones de la interfaz. Lo que
> importa es el resultado de cada paso, descrito en la columna "Se verifica con".

## 1. Organización

| # | Paso | Se verifica con |
|---|---|---|
| 1.1 | Crear la organización de Lainco en SonarQube Cloud, vinculada a la organización de GitHub (decisión D1). | La organización aparece en el listado y muestra los repos de GitHub disponibles para importar. |
| 1.2 | Anotar la **clave de organización** (organization key). | Se necesita en la Fase 2 para `sonar.organization` y en la entrega 6.1 para la Web API. |
| 1.3 | **Desactivar el análisis automático** (Automatic Analysis). | El análisis lo dispara el pipeline de CI. Si queda activo, corre un análisis paralelo con el perfil por defecto de Sonar y contamina los resultados. |

## 2. Quality Profiles vacíos

Esto es lo que garantiza el principio rector: ninguna regla de Sonar activa hasta que
alguien del equipo la incorpore desde la app de catálogo (Fase 6).

| # | Paso | Se verifica con |
|---|---|---|
| 2.1 | Crear un Quality Profile de **C#** llamado `Lainco C#`, **sin heredar** de ningún perfil (crear nuevo, no "extender" ni "copiar" de `Sonar way`). | El perfil existe y muestra **0 reglas activas**. |
| 2.2 | Marcarlo como **Default** para C# en la organización. | Un proyecto nuevo de C# toma `Lainco C#`, no `Sonar way`. |
| 2.3 | Repetir 2.1 y 2.2 para **TypeScript**, con el nombre `Lainco Typescript`. | Ídem, 0 reglas activas y marcado como default. |

**Por qué "sin herencia" y no "copia de Sonar way con todo desactivado":** un perfil
heredado vuelve a traer las reglas cuando Sonar actualiza el perfil padre. La detección
de desvíos de la entrega 6.2 justamente alerta si alguien configura herencia.

## 3. Token para la app de catálogo

| # | Paso | Se verifica con |
|---|---|---|
| 3.1 | Crear un token de usuario con permiso para **administrar Quality Profiles** y **leer reglas**. | Se guarda como variable de entorno del proyecto de Vercel (entrega 6.1 y 6.2). |
| 3.2 | Crear un token aparte, de **solo lectura de issues**, para `tools/sonar-sync` de la Fase 4. | Menor privilegio: esa herramienta corre en las máquinas de los programadores. |

No commitear ninguno de los dos.

## 4. Qué queda para la Fase 2

Estos pasos **no** son de la Fase 0; se hacen al armar el pipeline:

- Crear el proyecto de Sonar para `samples/SampleSolution`.
- Asignarle el Quality Profile `Lainco C#`.
- Crear el Quality Gate que falle ante issues nuevos.
- Generar el token de análisis para GitHub Actions.

---

## Datos a completar

Anotar acá una vez hechos los pasos, para tenerlos a mano en las fases siguientes.

| Dato | Valor |
|---|---|
| Clave de organización | `revertpablo` |
| Repositorio | `https://github.com/revertpablo/Lainco-quality` (público) |
| Plan | Trial de Team plan, con **downgrade automático a Free el 17/10/2026**. Nada de lo que usamos es premium. |
| Quality Profile C# | `Lainco C#` — 0 reglas, Default ✓ |
| Quality Profile TypeScript | `Lainco Typescript` — 0 reglas, Default ✓ |
| Análisis automático desactivado | Se configura por proyecto al importarlo (Fase 2), no a nivel organización |

> **Cuenta de prueba.** La organización `revertpablo` y el repositorio son de una cuenta
> creada solo para validar la arquitectura. Al pasar a la cuenta definitiva de Lainco hay
> que actualizar: la clave de organización acá, el `RepositoryUrl` de
> `Lainco.Analyzers.Package.csproj` y el `BaseUrl` de `Convenciones.cs` (helpLinkUri).
