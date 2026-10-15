using System;

namespace Lainco.Analyzers.Suppressor;

/// <summary>
/// Operaciones sobre rutas hechas sobre el texto, sin tocar el disco (un analyzer no debe
/// hacer IO). Las rutas de Sonar usan '/'; las de Windows, '\'.
/// </summary>
internal static class Rutas
{
    public static string Normalizar(string ruta)
    {
        return ruta.Replace('\\', '/');
    }

    /// <summary>
    /// Ruta de <paramref name="archivo"/> relativa a <paramref name="raiz"/>, con '/'.
    /// Devuelve null si el archivo no está dentro de la raíz. No distingue mayúsculas: en
    /// Windows la misma carpeta puede llegar escrita de dos formas.
    /// </summary>
    public static string? Relativa(string archivo, string raiz)
    {
        string normalizado = Normalizar(archivo);
        string prefijo = Normalizar(raiz);

        if (!prefijo.EndsWith("/", StringComparison.Ordinal))
        {
            prefijo += "/";
        }

        return normalizado.StartsWith(prefijo, StringComparison.OrdinalIgnoreCase)
            ? normalizado.Substring(prefijo.Length)
            : null;
    }

    /// <summary>Carpeta que contiene el archivo, terminada en '/'.</summary>
    public static string Carpeta(string ruta)
    {
        string normalizada = Normalizar(ruta);
        int barra = normalizada.LastIndexOf('/');
        return barra < 0 ? string.Empty : normalizada.Substring(0, barra + 1);
    }

    public static string NombreDeArchivo(string ruta)
    {
        string normalizada = Normalizar(ruta);
        return normalizada.Substring(normalizada.LastIndexOf('/') + 1);
    }
}
