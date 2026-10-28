using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;

namespace Lainco.CatalogoReglas;

/// <summary>Lo que hace falta para generar el catálogo de un paquete de analyzers.</summary>
/// <param name="Paquete">Nombre del paquete NuGet.</param>
/// <param name="Version">Versión del paquete.</param>
/// <param name="Descriptores">Los descriptores de todos los analyzers del paquete.</param>
/// <param name="ReglasEnReleases">Las reglas vigentes según AnalyzerReleases.</param>
/// <param name="Documentacion">El markdown de la documentación de una regla, o null si no tiene.</param>
internal sealed record EntradaDelCatalogo(
    string Paquete,
    string Version,
    IReadOnlyList<DiagnosticDescriptor> Descriptores,
    IReadOnlySet<string> ReglasEnReleases,
    Func<string, string?> Documentacion);

/// <summary>El catálogo, o todo lo que impide generarlo.</summary>
internal sealed record ResultadoDelCatalogo(Catalogo? Catalogo, IReadOnlyList<string> Errores);

/// <summary>
/// Arma el catálogo de reglas Roslyn (entrega 6.4, paso 1) y verifica las convenciones de
/// CLAUDE.md para reglas propias. Junta todos los errores, para que quien agrega una regla
/// los vea de una vez.
/// </summary>
internal static class Generador
{
    private static readonly Regex FormaDelId = new("^LAIN[0-9]{3}$", RegexOptions.CultureInvariant);

    /// <summary>Genera el catálogo, o devuelve los errores si alguna regla no cumple.</summary>
    public static ResultadoDelCatalogo Generar(EntradaDelCatalogo entrada)
    {
        List<string> errores = new();
        List<ReglaDelCatalogo> reglas = new();

        if (entrada.Descriptores.Count == 0)
        {
            errores.Add("El assembly no tiene ninguna regla: ¿es el .dll de los analyzers?");
        }

        foreach (IGrouping<string, DiagnosticDescriptor> grupo in entrada.Descriptores
                     .GroupBy(d => d.Id, StringComparer.Ordinal)
                     .OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            // Dos analyzers pueden compartir un descriptor; dos descriptores con el mismo ID
            // y distinto contenido son un error.
            DiagnosticDescriptor[] distintos = grupo.Distinct().ToArray();
            if (distintos.Length > 1)
            {
                errores.Add($"{grupo.Key}: hay dos descriptores distintos con el mismo ID.");
                continue;
            }

            ReglaDelCatalogo? regla = Verificar(distintos[0], entrada, errores);
            if (regla is not null)
            {
                reglas.Add(regla);
            }
        }

        return errores.Count > 0
            ? new ResultadoDelCatalogo(null, errores)
            : new ResultadoDelCatalogo(
                new Catalogo(Catalogo.FormatoActual, "roslyn", entrada.Paquete, entrada.Version, "cs", reglas),
                errores);
    }

    private static ReglaDelCatalogo? Verificar(DiagnosticDescriptor descriptor, EntradaDelCatalogo entrada, List<string> errores)
    {
        string id = descriptor.Id;
        int antes = errores.Count;

        if (!FormaDelId.IsMatch(id))
        {
            errores.Add($"'{id}': el ID no tiene la forma LAIN### (LAIN y tres dígitos).");
            return null;
        }

        string titulo = Texto(descriptor.Title) ?? "";
        if (titulo.Length == 0)
        {
            errores.Add($"{id}: el descriptor no tiene título.");
        }

        string? severidad = Severidad(descriptor.DefaultSeverity);
        if (severidad is null)
        {
            errores.Add($"{id}: la severidad por defecto es 'error'. Tiene que ser 'warning' o menos: el que bloquea es el quality gate (ver CLAUDE.md).");
        }

        string documento = $"docs/rules/{id}.md";
        if (!descriptor.HelpLinkUri.EndsWith("/" + documento, StringComparison.Ordinal))
        {
            errores.Add($"{id}: el helpLinkUri tiene que llevar a {documento} (usar Ayuda.Para).");
        }

        if (!entrada.ReglasEnReleases.Contains(id))
        {
            errores.Add($"{id}: no está en AnalyzerReleases.Shipped.md ni en AnalyzerReleases.Unshipped.md.");
        }

        string? documentacion = entrada.Documentacion(id);
        if (documentacion is null)
        {
            errores.Add($"{id}: falta la documentación en {documento}.");
        }

        if (errores.Count > antes)
        {
            return null;
        }

        return new ReglaDelCatalogo(
            Clave: id,
            Titulo: titulo,
            Descripcion: Texto(descriptor.Description),
            Categoria: descriptor.Category,
            SeveridadPorDefecto: severidad!,
            HabilitadaPorDefecto: descriptor.IsEnabledByDefault,
            Ayuda: descriptor.HelpLinkUri,
            Documentacion: documentacion!.Replace("\r\n", "\n"));
    }

    /// <summary>La severidad con las palabras del <c>.globalconfig</c>; null si es <c>error</c>.</summary>
    private static string? Severidad(DiagnosticSeverity severidad)
    {
        return severidad switch
        {
            DiagnosticSeverity.Hidden => "silent",
            DiagnosticSeverity.Info => "suggestion",
            DiagnosticSeverity.Warning => "warning",
            _ => null,
        };
    }

    private static string? Texto(LocalizableString texto)
    {
        string valor = texto.ToString(CultureInfo.InvariantCulture).Trim();
        return valor.Length == 0 ? null : valor;
    }
}
