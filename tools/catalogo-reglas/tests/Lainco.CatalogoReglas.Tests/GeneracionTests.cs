using Lainco.Analyzers.Reglas;

namespace Lainco.CatalogoReglas.Tests;

/// <summary>
/// La corrida completa, como la ve el target de MSBuild del paquete: carga el .dll de
/// verdad de Lainco.Analyzers, lee los archivos y escribe el catálogo. Los AnalyzerReleases
/// y la documentación son de prueba, para poder romperlos.
/// </summary>
public class GeneracionTests : IDisposable
{
    private readonly string carpeta = Directory.CreateTempSubdirectory("catalogo-reglas-").FullName;

    private readonly StringWriter log = new();

    public GeneracionTests()
    {
        Directory.CreateDirectory(Path.Combine(carpeta, "releases"));
        Directory.CreateDirectory(Path.Combine(carpeta, "rules"));
        File.WriteAllText(Path.Combine(carpeta, "releases", "AnalyzerReleases.Shipped.md"), "; nada publicado\n");
        File.WriteAllText(
            Path.Combine(carpeta, "releases", "AnalyzerReleases.Unshipped.md"),
            "### New Rules\n\nRule ID | Category | Severity | Notes\n--------|----------|----------|------\n" +
            "LAIN001 | Diseño | Warning | x\nLAIN004 | Diseño | Warning | x\nLAIN005 | Diseño | Warning | x\n");
        File.WriteAllText(Path.Combine(carpeta, "rules", "LAIN001.md"), "# LAIN001\n");
        File.WriteAllText(Path.Combine(carpeta, "rules", "LAIN004.md"), "# LAIN004\n");
        File.WriteAllText(Path.Combine(carpeta, "rules", "LAIN005.md"), "# LAIN005\n");
    }

    public void Dispose()
    {
        Directory.Delete(carpeta, recursive: true);
    }

    private string Salida => Path.Combine(carpeta, "salida", "reglas-roslyn.json");

    private int Ejecutar(string? analyzers = null)
    {
        return Generacion.Ejecutar(
            new[]
            {
                "--analyzers", analyzers ?? typeof(MetodoEstaticoAnalyzer).Assembly.Location,
                "--releases", Path.Combine(carpeta, "releases"),
                "--documentacion", Path.Combine(carpeta, "rules"),
                "--paquete", "Lainco.Analyzers",
                "--version", "0.1.0",
                "--salida", Salida,
            },
            log);
    }

    [Fact]
    public void Con_todo_en_orden_escribe_el_catalogo_y_termina_en_cero()
    {
        int codigo = Ejecutar();

        Assert.Equal(Generacion.Exito, codigo);
        string json = File.ReadAllText(Salida);
        Assert.Contains("\"clave\": \"LAIN001\"", json);
        Assert.Contains("\"clave\": \"LAIN004\"", json);
        Assert.Contains("\"clave\": \"LAIN005\"", json);
        Assert.Contains("3 reglas", log.ToString());
    }

    [Fact]
    public void Si_una_regla_no_cumple_lo_dice_en_formato_de_error_de_MSBuild_y_no_escribe_nada()
    {
        File.Delete(Path.Combine(carpeta, "rules", "LAIN005.md"));

        int codigo = Ejecutar();

        Assert.Equal(Generacion.ReglasInvalidas, codigo);
        Assert.Contains("catalogo-reglas : error : LAIN005: falta la documentación", log.ToString());
        Assert.False(File.Exists(Salida));
    }

    [Fact]
    public void Si_falla_borra_el_catalogo_de_una_corrida_anterior()
    {
        Assert.Equal(Generacion.Exito, Ejecutar());
        File.Delete(Path.Combine(carpeta, "rules", "LAIN004.md"));

        Assert.Equal(Generacion.ReglasInvalidas, Ejecutar());

        Assert.False(File.Exists(Salida));
    }

    [Fact]
    public void Un_assembly_que_no_existe_es_un_error_de_entrada()
    {
        int codigo = Ejecutar(Path.Combine(carpeta, "no-existe.dll"));

        Assert.Equal(Generacion.ErrorDeEntrada, codigo);
        Assert.Contains("catalogo-reglas : error : ", log.ToString());
        Assert.Contains("no-existe.dll", log.ToString());
    }

    [Fact]
    public void Una_carpeta_de_releases_sin_los_archivos_es_un_error_de_entrada()
    {
        File.Delete(Path.Combine(carpeta, "releases", "AnalyzerReleases.Unshipped.md"));

        Assert.Equal(Generacion.ErrorDeEntrada, Ejecutar());
        Assert.Contains("AnalyzerReleases.Unshipped.md", log.ToString());
    }

    [Fact]
    public void Opciones_invalidas_muestran_el_uso()
    {
        int codigo = Generacion.Ejecutar(new[] { "--otra", "x" }, log);

        Assert.Equal(Generacion.ErrorDeEntrada, codigo);
        Assert.Contains("Uso: catalogo-reglas", log.ToString());
    }
}
