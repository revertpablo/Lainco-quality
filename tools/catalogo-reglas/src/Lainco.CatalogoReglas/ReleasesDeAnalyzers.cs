using System;
using System.Collections.Generic;

namespace Lainco.CatalogoReglas;

/// <summary>
/// Lee <c>AnalyzerReleases.Shipped.md</c> y <c>AnalyzerReleases.Unshipped.md</c>: las
/// reglas declaradas, versión por versión.
/// https://github.com/dotnet/roslyn-analyzers/blob/main/src/Microsoft.CodeAnalysis.Analyzers/ReleaseTrackingAnalyzers.Help.md
/// </summary>
internal static class ReleasesDeAnalyzers
{
    private enum Seccion
    {
        Ninguna,
        Nuevas,
        Quitadas,
        Cambiadas,
    }

    /// <summary>
    /// Las reglas vigentes: las agregadas en alguna versión (o sin publicar todavía) que no
    /// se quitaron después. Se recorre lo publicado en orden y después lo sin publicar.
    /// </summary>
    public static IReadOnlySet<string> ReglasVigentes(string shipped, string unshipped)
    {
        HashSet<string> vigentes = new(StringComparer.Ordinal);
        Recorrer(shipped, vigentes);
        Recorrer(unshipped, vigentes);
        return vigentes;
    }

    private static void Recorrer(string contenido, HashSet<string> vigentes)
    {
        Seccion seccion = Seccion.Ninguna;

        foreach (string cruda in contenido.Split('\n'))
        {
            string linea = cruda.Trim();

            if (linea.Length == 0 || linea.StartsWith(';'))
            {
                continue;
            }

            if (linea.StartsWith("##", StringComparison.Ordinal))
            {
                // "## Release X" corta la sección; "### New Rules" y compañía la abren.
                seccion = linea.TrimStart('#').Trim() switch
                {
                    "New Rules" => Seccion.Nuevas,
                    "Removed Rules" => Seccion.Quitadas,
                    "Changed Rules" => Seccion.Cambiadas,
                    _ => Seccion.Ninguna,
                };
                continue;
            }

            if (seccion == Seccion.Ninguna || !linea.Contains('|'))
            {
                continue;
            }

            string id = linea.Substring(0, linea.IndexOf('|')).Trim();

            // El encabezado de la tabla y la línea de guiones.
            if (id == "Rule ID" || id.Trim('-').Length == 0)
            {
                continue;
            }

            if (seccion == Seccion.Nuevas)
            {
                vigentes.Add(id);
            }
            else if (seccion == Seccion.Quitadas)
            {
                vigentes.Remove(id);
            }
        }
    }
}
