using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Lainco.CatalogoReglas;

/// <summary>
/// Lee los descriptores de las reglas de un .dll de analyzers: instancia cada analyzer
/// (los tipos con <see cref="DiagnosticAnalyzerAttribute"/>) y junta sus
/// <see cref="DiagnosticAnalyzer.SupportedDiagnostics"/>. Los suppressors no declaran
/// reglas propias y se saltean.
/// </summary>
internal static class LectorDeAnalyzers
{
    /// <summary>Los descriptores, en el orden en que aparecen. Lanza <see cref="ErrorDeEntrada"/> si el .dll no se puede leer.</summary>
    public static IReadOnlyList<DiagnosticDescriptor> Descriptores(string rutaDelAssembly)
    {
        Assembly assembly;
        Type[] tipos;
        try
        {
            assembly = Assembly.LoadFrom(rutaDelAssembly);
            tipos = assembly.GetTypes();
        }
        catch (Exception e) when (e is System.IO.IOException or BadImageFormatException or ReflectionTypeLoadException)
        {
            throw new ErrorDeEntrada($"No se pudo cargar el assembly de analyzers '{rutaDelAssembly}': {e.Message}");
        }

        List<DiagnosticDescriptor> descriptores = new();
        foreach (Type tipo in tipos.Where(EsAnalyzer).OrderBy(t => t.FullName, StringComparer.Ordinal))
        {
            DiagnosticAnalyzer analyzer = (DiagnosticAnalyzer)Activator.CreateInstance(tipo)!;
            descriptores.AddRange(analyzer.SupportedDiagnostics);
        }

        return descriptores;
    }

    private static bool EsAnalyzer(Type tipo)
    {
        return !tipo.IsAbstract
               && typeof(DiagnosticAnalyzer).IsAssignableFrom(tipo)
               && !typeof(DiagnosticSuppressor).IsAssignableFrom(tipo)
               && tipo.GetCustomAttribute<DiagnosticAnalyzerAttribute>() is not null;
    }
}
