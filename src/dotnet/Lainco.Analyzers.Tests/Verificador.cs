using System.Threading.Tasks;
using Microsoft.CodeAnalysis.CSharp.Testing;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Testing;

namespace Lainco.Analyzers.Tests;

/// <summary>
/// Envoltorio de <c>CSharpAnalyzerTest</c> para no repetir la configuración en cada
/// test. Toda regla nueva se testea a través de acá.
/// </summary>
internal static class Verificador<TAnalyzer>
    where TAnalyzer : DiagnosticAnalyzer, new()
{
    /// <summary>
    /// Declara un diagnóstico esperado de la regla indicada.
    /// La ubicación y los argumentos del mensaje se encadenan en cada test.
    /// </summary>
    public static DiagnosticResult Diagnostico(string id)
    {
        return CSharpAnalyzerVerifier<TAnalyzer, DefaultVerifier>.Diagnostic(id);
    }

    /// <summary>
    /// Verifica que el código produzca exactamente los diagnósticos esperados.
    /// Sin diagnósticos esperados, verifica que el analyzer no dispare (caso negativo).
    /// </summary>
    public static async Task VerificarAsync(string codigo, params DiagnosticResult[] esperados)
    {
        CSharpAnalyzerTest<TAnalyzer, DefaultVerifier> test = new()
        {
            TestCode = codigo,

            // Por defecto el framework de testing compila contra .NET Framework, donde
            // 'init' y 'record' no existen sin IsExternalInit. Las reglas LAIN se aplican
            // sobre código moderno, así que los tests compilan contra .NET 8.
            ReferenceAssemblies = ReferenceAssemblies.Net.Net80,
        };

        test.ExpectedDiagnostics.AddRange(esperados);

        await test.RunAsync();
    }
}
