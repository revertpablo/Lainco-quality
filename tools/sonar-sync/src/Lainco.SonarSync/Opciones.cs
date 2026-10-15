using System;
using System.Collections.Generic;
using System.Globalization;

namespace Lainco.SonarSync;

/// <summary>
/// Opciones de línea de comandos. El token no es una opción: se lee de la variable de
/// entorno <see cref="Sincronizacion.VariableDelToken"/>, para que no quede en el
/// historial de la consola ni en los logs del build.
/// </summary>
internal sealed class Opciones
{
    public const string UrlPorDefecto = "https://sonarcloud.io";

    public const string SalidaPorDefecto = "sonar-accepted.json";

    public const string Uso =
        "Uso: sonar-sync --proyecto <clave> [--organizacion <clave>] [--rama <nombre>]\n" +
        "                [--url <url>] [--salida <ruta>] [--vigencia-horas <n>]\n" +
        "\n" +
        "  --proyecto      Clave del proyecto en SonarQube (obligatorio).\n" +
        "  --organizacion  Clave de la organización en SonarQube Cloud.\n" +
        "  --rama          Rama de la que se leen los issues. Por defecto, la principal.\n" +
        "  --url           URL del servidor. Por defecto, " + UrlPorDefecto + ".\n" +
        "  --salida        Archivo a generar. Por defecto, " + SalidaPorDefecto + ".\n" +
        "  --vigencia-horas  Si el archivo tiene menos de n horas, no se consulta. Sin esta\n" +
        "                  opción se consulta siempre.\n" +
        "  --ayuda         Muestra esta ayuda.\n" +
        "\n" +
        "El token se lee de la variable de entorno " + Sincronizacion.VariableDelToken + ".";

    private Opciones(string proyecto, string url, string? organizacion, string? rama, string salida, int? vigenciaHoras)
    {
        Proyecto = proyecto;
        Url = url;
        Organizacion = organizacion;
        Rama = rama;
        Salida = salida;
        VigenciaHoras = vigenciaHoras;
    }

    /// <summary>Clave del proyecto en SonarQube.</summary>
    public string Proyecto { get; }

    /// <summary>URL del servidor, sin barra final.</summary>
    public string Url { get; }

    /// <summary>Clave de la organización (SonarQube Cloud). Opcional.</summary>
    public string? Organizacion { get; }

    /// <summary>Rama de la que se leen los issues. Sin valor, la rama principal.</summary>
    public string? Rama { get; }

    /// <summary>Ruta del archivo a generar.</summary>
    public string Salida { get; }

    /// <summary>
    /// Antigüedad máxima, en horas, con la que el archivo existente se considera vigente y
    /// no se vuelve a consultar. Sin valor, se consulta siempre.
    /// </summary>
    public int? VigenciaHoras { get; }

    /// <summary>Interpreta los argumentos. Lanza <see cref="ErrorDeOpciones"/> si no son válidos.</summary>
    public static Opciones Leer(IReadOnlyList<string> argumentos)
    {
        Dictionary<string, string> valores = new(StringComparer.Ordinal);

        for (int i = 0; i < argumentos.Count; i++)
        {
            string nombre = argumentos[i];

            if (nombre is not ("--proyecto" or "--url" or "--organizacion" or "--rama" or "--salida" or "--vigencia-horas"))
            {
                throw new ErrorDeOpciones($"Opción desconocida: '{nombre}'.");
            }

            if (i + 1 >= argumentos.Count || argumentos[i + 1].StartsWith("--", StringComparison.Ordinal))
            {
                throw new ErrorDeOpciones($"Falta el valor de {nombre}.");
            }

            valores[nombre] = argumentos[++i];
        }

        if (!valores.TryGetValue("--proyecto", out string? proyecto))
        {
            throw new ErrorDeOpciones("Falta --proyecto: la clave del proyecto en SonarQube.");
        }

        string url = valores.TryGetValue("--url", out string? indicada) ? indicada : UrlPorDefecto;

        int? vigenciaHoras = null;
        if (valores.TryGetValue("--vigencia-horas", out string? vigencia))
        {
            if (!int.TryParse(vigencia, NumberStyles.None, CultureInfo.InvariantCulture, out int horas))
            {
                throw new ErrorDeOpciones($"--vigencia-horas debe ser un número entero de horas, 0 o más: '{vigencia}'.");
            }

            vigenciaHoras = horas;
        }

        return new Opciones(
            proyecto,
            url.TrimEnd('/'),
            valores.TryGetValue("--organizacion", out string? organizacion) ? organizacion : null,
            valores.TryGetValue("--rama", out string? rama) ? rama : null,
            valores.TryGetValue("--salida", out string? salida) ? salida : SalidaPorDefecto,
            vigenciaHoras);
    }
}

/// <summary>Los argumentos de línea de comandos no son válidos.</summary>
internal sealed class ErrorDeOpciones : Exception
{
    public ErrorDeOpciones(string mensaje)
        : base(mensaje)
    {
    }
}
