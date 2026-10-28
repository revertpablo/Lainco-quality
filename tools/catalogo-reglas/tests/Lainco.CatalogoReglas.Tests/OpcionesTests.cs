namespace Lainco.CatalogoReglas.Tests;

public class OpcionesTests
{
    private static readonly string[] Completas =
    {
        "--analyzers", "bin/Lainco.Analyzers.dll",
        "--releases", "src/dotnet/Lainco.Analyzers",
        "--documentacion", "docs/rules",
        "--paquete", "Lainco.Analyzers",
        "--version", "0.1.0",
        "--salida", "artifacts/reglas-roslyn.json",
    };

    [Fact]
    public void Lee_todas_las_opciones()
    {
        Opciones opciones = Opciones.Leer(Completas);

        Assert.Equal("bin/Lainco.Analyzers.dll", opciones.Analyzers);
        Assert.Equal("src/dotnet/Lainco.Analyzers", opciones.Releases);
        Assert.Equal("docs/rules", opciones.Documentacion);
        Assert.Equal("Lainco.Analyzers", opciones.Paquete);
        Assert.Equal("0.1.0", opciones.Version);
        Assert.Equal("artifacts/reglas-roslyn.json", opciones.Salida);
    }

    [Theory]
    [InlineData("--analyzers")]
    [InlineData("--releases")]
    [InlineData("--documentacion")]
    [InlineData("--paquete")]
    [InlineData("--version")]
    [InlineData("--salida")]
    public void Todas_son_obligatorias(string faltante)
    {
        List<string> argumentos = Completas.ToList();
        int posicion = argumentos.IndexOf(faltante);
        argumentos.RemoveRange(posicion, 2);

        ErrorDeOpciones error = Assert.Throws<ErrorDeOpciones>(() => Opciones.Leer(argumentos));

        Assert.Contains(faltante, error.Message);
    }

    [Fact]
    public void Una_opcion_desconocida_falla()
    {
        ErrorDeOpciones error = Assert.Throws<ErrorDeOpciones>(() => Opciones.Leer(Completas.Append("--otra").Append("x").ToArray()));

        Assert.Contains("--otra", error.Message);
    }

    [Fact]
    public void Una_opcion_sin_valor_falla()
    {
        ErrorDeOpciones error = Assert.Throws<ErrorDeOpciones>(() => Opciones.Leer(new[] { "--analyzers", "--releases", "x" }));

        Assert.Contains("--analyzers", error.Message);
    }

    [Theory]
    [InlineData("1.0")]
    [InlineData("v1.0.0")]
    [InlineData("1.0.0.0")]
    public void Una_version_que_no_es_X_Y_Z_falla(string version)
    {
        string[] argumentos = Completas.ToArray();
        argumentos[Array.IndexOf(argumentos, "--version") + 1] = version;

        ErrorDeOpciones error = Assert.Throws<ErrorDeOpciones>(() => Opciones.Leer(argumentos));

        Assert.Contains("--version", error.Message);
    }

    [Fact]
    public void Acepta_una_version_previa()
    {
        string[] argumentos = Completas.ToArray();
        argumentos[Array.IndexOf(argumentos, "--version") + 1] = "0.2.0-beta.1";

        Assert.Equal("0.2.0-beta.1", Opciones.Leer(argumentos).Version);
    }
}
