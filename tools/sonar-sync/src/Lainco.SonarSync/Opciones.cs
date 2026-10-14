using System;
using System.Collections.Generic;

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
        "                [--url <url>] [--salida <ruta>]\n" +
        "\n" +
        "  --proyecto      Clave del proyecto en SonarQube (obligatorio).\n" +
        "  --organizacion  Clave de la organización en SonarQube Cloud.\n" +
        "  --rama          Rama de la que se leen los issues. Por defecto, la principal.\n" +
        "  --url           URL del servidor. Por defecto, " + UrlPorDefecto + ".\n" +
        "  --salida        Archivo a generar. Por defecto, " + SalidaPorDefecto + ".\n" +
        "  --ayuda         Muestra esta ayuda.\n" +
        "\n" +
        "El token se lee de la variable de entorno " + Sincronizacion.VariableDelToken + ".";

    private Opciones(string proyecto, string url, string? organizacion, string? rama, string salida)
    {
        Proyecto = proyecto;
        Url = url;
        Organizacion = organizacion;
        Rama = rama;
        Salida = salida;
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

    /// <summary>Interpreta los argumentos. Lanza <see cref="ErrorDeOpciones"/> si no son válidos.</summary>
    public static Opciones Leer(IReadOnlyList<string> argumentos)
    {
        Dictionary<string, string> valores = new(StringComparer.Ordinal);

        for (int i = 0; i < argumentos.Count; i++)
        {
            string nombre = argumentos[i];

            if (nombre is not ("--proyecto" or "--url" or "--organizacion" or "--rama" or "--salida"))
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

        return new Opciones(
            proyecto,
            url.TrimEnd('/'),
            valores.TryGetValue("--organizacion", out string? organizacion) ? organizacion : null,
            valores.TryGetValue("--rama", out string? rama) ? rama : null,
            valores.TryGetValue("--salida", out string? salida) ? salida : SalidaPorDefecto);
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
