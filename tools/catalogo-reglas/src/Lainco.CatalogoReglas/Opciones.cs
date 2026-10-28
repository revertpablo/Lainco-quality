using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Lainco.CatalogoReglas;

/// <summary>Opciones de línea de comandos. Todas son obligatorias: las pasa el build del paquete.</summary>
internal sealed class Opciones
{
    public const string Uso =
        "Uso: catalogo-reglas --analyzers <dll> --releases <carpeta> --documentacion <carpeta>\n" +
        "                     --paquete <nombre> --version <X.Y.Z> --salida <archivo>\n" +
        "\n" +
        "  --analyzers      El .dll con los analyzers.\n" +
        "  --releases       Carpeta con AnalyzerReleases.Shipped.md y AnalyzerReleases.Unshipped.md.\n" +
        "  --documentacion  Carpeta con la documentación de cada regla (<ID>.md).\n" +
        "  --paquete        Nombre del paquete NuGet.\n" +
        "  --version        Versión del paquete.\n" +
        "  --salida         Archivo a generar.";

    private static readonly string[] Nombres =
    {
        "--analyzers", "--releases", "--documentacion", "--paquete", "--version", "--salida",
    };

    // X.Y.Z, con sufijo de versión previa opcional (0.2.0-beta.1).
    private static readonly Regex FormaDeLaVersion = new(@"^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$", RegexOptions.CultureInvariant);

    private Opciones(IReadOnlyDictionary<string, string> valores)
    {
        Analyzers = valores["--analyzers"];
        Releases = valores["--releases"];
        Documentacion = valores["--documentacion"];
        Paquete = valores["--paquete"];
        Version = valores["--version"];
        Salida = valores["--salida"];
    }

    public string Analyzers { get; }

    public string Releases { get; }

    public string Documentacion { get; }

    public string Paquete { get; }

    public string Version { get; }

    public string Salida { get; }

    /// <summary>Interpreta los argumentos. Lanza <see cref="ErrorDeOpciones"/> si no son válidos.</summary>
    public static Opciones Leer(IReadOnlyList<string> argumentos)
    {
        Dictionary<string, string> valores = new(StringComparer.Ordinal);

        for (int i = 0; i < argumentos.Count; i++)
        {
            string nombre = argumentos[i];

            if (Array.IndexOf(Nombres, nombre) < 0)
            {
                throw new ErrorDeOpciones($"Opción desconocida: '{nombre}'.");
            }

            if (i + 1 >= argumentos.Count || argumentos[i + 1].StartsWith("--", StringComparison.Ordinal))
            {
                throw new ErrorDeOpciones($"Falta el valor de {nombre}.");
            }

            valores[nombre] = argumentos[++i];
        }

        foreach (string nombre in Nombres)
        {
            if (!valores.ContainsKey(nombre))
            {
                throw new ErrorDeOpciones($"Falta {nombre}.");
            }
        }

        if (!FormaDeLaVersion.IsMatch(valores["--version"]))
        {
            throw new ErrorDeOpciones($"--version tiene que tener la forma X.Y.Z: '{valores["--version"]}'.");
        }

        return new Opciones(valores);
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

/// <summary>Falta un archivo o no se puede leer: no es un problema de las reglas.</summary>
internal sealed class ErrorDeEntrada : Exception
{
    public ErrorDeEntrada(string mensaje)
        : base(mensaje)
    {
    }
}
