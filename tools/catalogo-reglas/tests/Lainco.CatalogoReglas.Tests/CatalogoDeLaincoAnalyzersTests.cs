using System.Runtime.CompilerServices;
using Lainco.Analyzers.Reglas;

namespace Lainco.CatalogoReglas.Tests;

/// <summary>
/// El catálogo de las reglas de verdad: el .dll de Lainco.Analyzers, sus AnalyzerReleases y
/// docs/rules del repositorio. Si alguien agrega una regla sin documentación o sin
/// declararla, falla acá antes que en el build del paquete.
/// </summary>
public class CatalogoDeLaincoAnalyzersTests
{
    // Desde la ubicación de este archivo: no depende de dónde quedó compilado el test.
    private static string Raiz([CallerFilePath] string esteArchivo = "")
    {
        DirectoryInfo? carpeta = new FileInfo(esteArchivo).Directory;
        while (carpeta is not null && !File.Exists(Path.Combine(carpeta.FullName, "CLAUDE.md")))
        {
            carpeta = carpeta.Parent;
        }

        return carpeta?.FullName ?? throw new InvalidOperationException("No se encontró la raíz del repositorio.");
    }

    [Fact]
    public void Las_reglas_de_Lainco_Analyzers_cumplen_todo_y_estan_en_el_catalogo()
    {
        string raiz = Raiz();
        string releases = Path.Combine(raiz, "src", "dotnet", "Lainco.Analyzers");

        ResultadoDelCatalogo resultado = Generador.Generar(new EntradaDelCatalogo(
            Paquete: "Lainco.Analyzers",
            Version: "0.1.0",
            Descriptores: LectorDeAnalyzers.Descriptores(typeof(MetodoEstaticoAnalyzer).Assembly.Location),
            ReglasEnReleases: ReleasesDeAnalyzers.ReglasVigentes(
                File.ReadAllText(Path.Combine(releases, "AnalyzerReleases.Shipped.md")),
                File.ReadAllText(Path.Combine(releases, "AnalyzerReleases.Unshipped.md"))),
            Documentacion: Generacion.LectorDeDocumentacion(Path.Combine(raiz, "docs", "rules"))));

        Assert.Empty(resultado.Errores);
        Assert.Contains("LAIN004", resultado.Catalogo!.Reglas.Select(r => r.Clave));
        Assert.Contains("LAIN005", resultado.Catalogo.Reglas.Select(r => r.Clave));
        Assert.All(resultado.Catalogo.Reglas, r => Assert.Equal("warning", r.SeveridadPorDefecto));
        Assert.All(resultado.Catalogo.Reglas, r => Assert.False(r.HabilitadaPorDefecto));
    }

    [Fact]
    public void El_lector_no_trae_los_suppressors_ni_tipos_abstractos()
    {
        IReadOnlyList<Microsoft.CodeAnalysis.DiagnosticDescriptor> descriptores =
            LectorDeAnalyzers.Descriptores(typeof(MetodoEstaticoAnalyzer).Assembly.Location);

        Assert.All(descriptores, d => Assert.StartsWith("LAIN", d.Id));
    }
}
