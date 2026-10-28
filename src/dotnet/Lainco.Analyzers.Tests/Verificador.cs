using System.Threading.Tasks;
using Microsoft.CodeAnalysis;
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
    /// El código se compila como biblioteca.
    /// </summary>
    public static Task VerificarAsync(string codigo, params DiagnosticResult[] esperados)
    {
        return VerificarAsync(codigo, OutputKind.DynamicallyLinkedLibrary, esperados);
    }

    /// <summary>
    /// Igual que <see cref="VerificarAsync(string, DiagnosticResult[])"/>, pero compila el
    /// código como aplicación de consola. Hace falta para las reglas que dependen del
    /// punto de entrada (<c>Main</c>), que una biblioteca no tiene.
    /// </summary>
    public static Task VerificarEjecutableAsync(string codigo, params DiagnosticResult[] esperados)
    {
        return VerificarAsync(codigo, OutputKind.ConsoleApplication, esperados);
    }

    private static async Task VerificarAsync(
        string codigo,
        OutputKind tipoDeSalida,
        DiagnosticResult[] esperados)
    {
        CSharpAnalyzerTest<TAnalyzer, DefaultVerifier> test = new()
        {
            TestCode = codigo,

            // Por defecto el framework de testing compila contra .NET Framework, donde
            // 'init' y 'record' no existen sin IsExternalInit. Las reglas LAIN se aplican
            // sobre código moderno, así que los tests compilan contra .NET 8.
            ReferenceAssemblies = ReferenceAssemblies.Net.Net80,
        };

        test.TestState.OutputKind = tipoDeSalida;

        // Las reglas LAIN nacen apagadas (decisión R6): las enciende el .globalconfig del
        // paquete. El test las enciende igual, con un .globalconfig.
        test.TestState.AnalyzerConfigFiles.Add(("/.globalconfig", Encendido.GlobalconfigPara(new TAnalyzer())));

        test.ExpectedDiagnostics.AddRange(esperados);

        await test.RunAsync();
    }
}

/// <summary>
/// Las reglas LAIN nacen apagadas (decisión R6 de la entrega 6.4): las enciende el
/// .globalconfig del paquete cuando se incorporan en la app de catálogo. Los tests las
/// encienden de la misma forma.
/// </summary>
internal static class Encendido
{
    /// <summary>Un .globalconfig que enciende las reglas de los analyzers con su severidad por defecto.</summary>
    public static string GlobalconfigPara(params DiagnosticAnalyzer[] analyzers)
    {
        System.Text.StringBuilder configuracion = new("is_global = true\n");
        foreach (DiagnosticDescriptor descriptor in analyzers.SelectMany(a => a.SupportedDiagnostics))
        {
            configuracion.Append("dotnet_diagnostic.").Append(descriptor.Id).Append(".severity = ")
                .Append(descriptor.DefaultSeverity == DiagnosticSeverity.Warning ? "warning" : "suggestion").Append('\n');
        }

        return configuracion.ToString();
    }
}
