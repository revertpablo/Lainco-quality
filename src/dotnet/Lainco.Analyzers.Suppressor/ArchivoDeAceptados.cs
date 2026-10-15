using System;
using System.Collections.Generic;

namespace Lainco.Analyzers.Suppressor;

/// <summary>
/// Contenido de <c>sonar-accepted.json</c>: el conjunto de issues aceptados, listo para
/// consultar por archivo + regla + mensaje.
/// </summary>
internal sealed class ArchivoDeAceptados
{
    /// <summary>Versión del formato que sabe leer. La escribe <c>tools/sonar-sync</c>.</summary>
    public const int Version = 1;

    private readonly HashSet<string> claves;

    private ArchivoDeAceptados(HashSet<string> claves)
    {
        this.claves = claves;
    }

    public bool EstaVacio => claves.Count == 0;

    /// <summary>
    /// Interpreta el contenido del archivo. Devuelve null si no es JSON válido, si no es
    /// de la versión que se sabe leer, o si no tiene la lista de issues. Nunca lanza
    /// excepciones: un analyzer que falla aparece en el IDE como AD0001.
    /// </summary>
    public static ArchivoDeAceptados? Leer(string contenido)
    {
        object? raiz;
        try
        {
            raiz = LectorJson.Leer(contenido);
        }
        catch (FormatException)
        {
            return null;
        }

        if (raiz is not Dictionary<string, object?> objeto
            || !objeto.TryGetValue("version", out object? version)
            || version is not double numero
            || numero != Version
            || !objeto.TryGetValue("issues", out object? issues)
            || issues is not List<object?> lista)
        {
            return null;
        }

        HashSet<string> claves = new(StringComparer.Ordinal);

        foreach (object? elemento in lista)
        {
            if (elemento is Dictionary<string, object?> issue
                && issue.TryGetValue("archivo", out object? archivo) && archivo is string ruta
                && issue.TryGetValue("regla", out object? regla) && regla is string id
                && issue.TryGetValue("mensaje", out object? mensaje) && mensaje is string texto)
            {
                claves.Add(Clave(ruta, id, texto));
            }
        }

        return new ArchivoDeAceptados(claves);
    }

    /// <summary>
    /// Indica si hay un issue aceptado con ese archivo (ruta relativa), regla y mensaje.
    /// La ruta no distingue mayúsculas ni el tipo de barra; regla y mensaje sí.
    /// </summary>
    public bool Contiene(string archivo, string regla, string mensaje)
    {
        return claves.Contains(Clave(archivo, regla, mensaje));
    }

    private static string Clave(string archivo, string regla, string mensaje)
    {
        return Rutas.Normalizar(archivo).ToUpperInvariant() + "\u0000" + regla + "\u0000" + mensaje;
    }
}
