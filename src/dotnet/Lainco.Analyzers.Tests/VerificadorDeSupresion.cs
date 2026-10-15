using System.Collections.Generic;
using System.Threading.Tasks;
using Lainco.Analyzers.Reglas;
using Lainco.Analyzers.Suppressor;
using Microsoft.CodeAnalysis.CSharp.Testing;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Testing;

namespace Lainco.Analyzers.Tests;

/// <summary>
/// Corre las reglas LAIN junto con el suppressor, con un <c>sonar-accepted.json</c> como
/// archivo adicional, y verifica qué diagnósticos quedan suprimidos.
/// </summary>
internal static class VerificadorDeSupresion
{
    /// <summary>Carpeta del archivo de código de los tests: el framework lo llama /0/Test0.cs.</summary>
    public const string CarpetaDelCodigo = "/0/";

    /// <summary>Un diagnóstico esperado, indicando si debe quedar suprimido.</summary>
    public static DiagnosticResult Diagnostico(string id, int linea, int columna, string simbolo, bool suprimido)
    {
        return new DiagnosticResult(id, Microsoft.CodeAnalysis.DiagnosticSeverity.Warning)
            .WithLocation(linea, columna)
            .WithArguments(simbolo)
            .WithIsSuppressed(suprimido);
    }

    /// <param name="codigo">Código a analizar, en /0/Test0.cs.</param>
    /// <param name="aceptados">Contenido de sonar-accepted.json, o null si no hay archivo.</param>
    /// <param name="rutaDeAceptados">Ruta del archivo de aceptados.</param>
    /// <param name="raiz">Valor de la propiedad LaincoSonarRaiz, o null si no está definida.</param>
    public static async Task VerificarAsync(
        string codigo,
        string? aceptados,
        string rutaDeAceptados,
        string? raiz,
        params DiagnosticResult[] esperados)
    {
        Prueba test = new()
        {
            TestCode = codigo,
            ReferenceAssemblies = ReferenceAssemblies.Net.Net80,
        };

        if (aceptados != null)
        {
            test.TestState.AdditionalFiles.Add((rutaDeAceptados, aceptados));
        }

        if (raiz != null)
        {
            test.TestState.AnalyzerConfigFiles.Add((
                "/.globalconfig",
                "is_global = true\nbuild_property.LaincoSonarRaiz = " + raiz + "\n"));
        }

        test.ExpectedDiagnostics.AddRange(esperados);

        await test.RunAsync();
    }

    /// <summary>
    /// El suppressor solo actúa sobre diagnósticos que otro analyzer emitió: la prueba
    /// corre las reglas LAIN y el suppressor juntos.
    /// </summary>
    private sealed class Prueba : CSharpAnalyzerTest<SupresorDeAceptados, DefaultVerifier>
    {
        protected override IEnumerable<DiagnosticAnalyzer> GetDiagnosticAnalyzers()
        {
            yield return new SupresorDeAceptados();
            yield return new InicializacionInlineDePropertyAnalyzer();
            yield return new MetodoEstaticoAnalyzer();
        }
    }
}
