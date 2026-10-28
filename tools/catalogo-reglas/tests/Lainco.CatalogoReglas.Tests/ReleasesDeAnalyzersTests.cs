namespace Lainco.CatalogoReglas.Tests;

public class ReleasesDeAnalyzersTests
{
    private const string Encabezado =
        "Rule ID | Category | Severity | Notes\n" +
        "--------|----------|----------|------\n";

    [Fact]
    public void Las_reglas_nuevas_sin_publicar_estan_vigentes()
    {
        string unshipped =
            "; Reglas todavía no publicadas.\n" +
            "\n" +
            "### New Rules\n" +
            "\n" +
            Encabezado +
            "LAIN004 | Diseño   | Warning  | No se permite inicialización inline.\n" +
            "LAIN005 | Diseño   | Warning  | No se permiten métodos estáticos.\n";

        IReadOnlySet<string> vigentes = ReleasesDeAnalyzers.ReglasVigentes("", unshipped);

        Assert.Equal(new[] { "LAIN004", "LAIN005" }, vigentes.Order());
    }

    [Fact]
    public void Suma_las_versiones_publicadas_y_descuenta_las_reglas_quitadas()
    {
        string shipped =
            "; Reglas ya publicadas.\n" +
            "\n" +
            "## Release 0.1.0\n" +
            "\n" +
            "### New Rules\n" +
            "\n" +
            Encabezado +
            "LAIN004 | Diseño | Warning | x\n" +
            "LAIN005 | Diseño | Warning | x\n" +
            "\n" +
            "## Release 0.2.0\n" +
            "\n" +
            "### Removed Rules\n" +
            "\n" +
            Encabezado +
            "LAIN004 | Diseño | Warning | x\n" +
            "\n" +
            "### Changed Rules\n" +
            "\n" +
            "Rule ID | New Category | New Severity | Old Category | Old Severity | Notes\n" +
            "--------|--------------|--------------|--------------|--------------|------\n" +
            "LAIN005 | Diseño | Info | Diseño | Warning | x\n";
        string unshipped =
            "### New Rules\n" +
            "\n" +
            Encabezado +
            "LAIN007 | Persistencia | Warning | x\n";

        IReadOnlySet<string> vigentes = ReleasesDeAnalyzers.ReglasVigentes(shipped, unshipped);

        Assert.Equal(new[] { "LAIN005", "LAIN007" }, vigentes.Order());
    }

    [Fact]
    public void Acepta_los_finales_de_linea_de_Windows()
    {
        string unshipped = "### New Rules\r\n\r\n" + Encabezado.Replace("\n", "\r\n") + "LAIN004 | Diseño | Warning | x\r\n";

        Assert.Equal(new[] { "LAIN004" }, ReleasesDeAnalyzers.ReglasVigentes("", unshipped));
    }

    [Fact]
    public void Sin_archivos_no_hay_reglas()
    {
        Assert.Empty(ReleasesDeAnalyzers.ReglasVigentes("", ""));
    }
}
