using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.CodeAnalysis;

namespace Lainco.CatalogoReglas;

/// <summary>
/// La corrida completa: lee el .dll, los AnalyzerReleases y la documentación, y escribe el
/// catálogo. Los errores salen en el formato canónico de MSBuild
/// (<c>catalogo-reglas : error : ...</c>), así el build del paquete los muestra como errores.
/// </summary>
internal static class Generacion
{
    /// <summary>Se escribió el catálogo.</summary>
    public const int Exito = 0;

    /// <summary>Alguna regla no cumple las convenciones. No se escribió nada.</summary>
    public const int ReglasInvalidas = 1;

    /// <summary>Opciones inválidas o archivos que faltan. No se escribió nada.</summary>
    public const int ErrorDeEntrada = 2;

    private const string Prefijo = "catalogo-reglas : error : ";

    public static int Ejecutar(IReadOnlyList<string> argumentos, TextWriter log)
    {
        Opciones opciones;
        try
        {
            opciones = Opciones.Leer(argumentos);
        }
        catch (ErrorDeOpciones e)
        {
            log.WriteLine(Prefijo + e.Message);
            log.WriteLine(Opciones.Uso);
            return ErrorDeEntrada;
        }

        // Un catálogo viejo no puede quedar como si fuera de esta versión.
        if (File.Exists(opciones.Salida))
        {
            File.Delete(opciones.Salida);
        }

        ResultadoDelCatalogo resultado;
        try
        {
            resultado = Generador.Generar(new EntradaDelCatalogo(
                opciones.Paquete,
                opciones.Version,
                LectorDeAnalyzers.Descriptores(Path.GetFullPath(opciones.Analyzers)),
                ReleasesDeAnalyzers.ReglasVigentes(
                    Leer(Path.Combine(opciones.Releases, "AnalyzerReleases.Shipped.md")),
                    Leer(Path.Combine(opciones.Releases, "AnalyzerReleases.Unshipped.md"))),
                LectorDeDocumentacion(opciones.Documentacion)));
        }
        catch (Lainco.CatalogoReglas.ErrorDeEntrada e)
        {
            log.WriteLine(Prefijo + e.Message);
            return ErrorDeEntrada;
        }

        if (resultado.Catalogo is null)
        {
            foreach (string error in resultado.Errores)
            {
                log.WriteLine(Prefijo + error);
            }

            return ReglasInvalidas;
        }

        string? carpeta = Path.GetDirectoryName(Path.GetFullPath(opciones.Salida));
        if (carpeta is not null)
        {
            Directory.CreateDirectory(carpeta);
        }

        File.WriteAllText(opciones.Salida, EscritorDelCatalogo.Serializar(resultado.Catalogo));
        log.WriteLine($"catalogo-reglas: {resultado.Catalogo.Reglas.Count} reglas de {opciones.Paquete} {opciones.Version} en {opciones.Salida}");
        return Exito;
    }

    /// <summary>Lee <c>&lt;ID&gt;.md</c> de la carpeta de documentación; null si no existe.</summary>
    public static Func<string, string?> LectorDeDocumentacion(string carpeta)
    {
        return id =>
        {
            string ruta = Path.Combine(carpeta, id + ".md");
            return File.Exists(ruta) ? File.ReadAllText(ruta) : null;
        };
    }

    private static string Leer(string ruta)
    {
        if (!File.Exists(ruta))
        {
            throw new Lainco.CatalogoReglas.ErrorDeEntrada($"No existe {ruta}.");
        }

        return File.ReadAllText(ruta);
    }
}
