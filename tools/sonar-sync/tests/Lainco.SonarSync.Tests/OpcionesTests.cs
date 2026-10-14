namespace Lainco.SonarSync.Tests;

public class OpcionesTests
{
    [Fact]
    public void Con_solo_el_proyecto_usa_los_valores_por_defecto()
    {
        Opciones opciones = Opciones.Leer(new[] { "--proyecto", "revertpablo_Lainco-quality" });

        Assert.Equal("revertpablo_Lainco-quality", opciones.Proyecto);
        Assert.Equal("https://sonarcloud.io", opciones.Url);
        Assert.Equal("sonar-accepted.json", opciones.Salida);
        Assert.Null(opciones.Rama);
        Assert.Null(opciones.Organizacion);
    }

    [Fact]
    public void Lee_todas_las_opciones()
    {
        Opciones opciones = Opciones.Leer(new[]
        {
            "--proyecto", "p",
            "--url", "https://sonar.lainco.local/",
            "--organizacion", "lainco",
            "--rama", "develop",
            "--salida", "cache/sonar-accepted.json",
        });

        Assert.Equal("p", opciones.Proyecto);
        Assert.Equal("https://sonar.lainco.local", opciones.Url);
        Assert.Equal("lainco", opciones.Organizacion);
        Assert.Equal("develop", opciones.Rama);
        Assert.Equal("cache/sonar-accepted.json", opciones.Salida);
    }

    [Fact]
    public void Sin_proyecto_falla()
    {
        ErrorDeOpciones error = Assert.Throws<ErrorDeOpciones>(() => Opciones.Leer(new[] { "--rama", "main" }));

        Assert.Contains("--proyecto", error.Message);
    }

    [Fact]
    public void Una_opcion_desconocida_falla()
    {
        ErrorDeOpciones error = Assert.Throws<ErrorDeOpciones>(
            () => Opciones.Leer(new[] { "--proyecto", "p", "--token", "secreto" }));

        Assert.Contains("--token", error.Message);
    }

    [Fact]
    public void Una_opcion_sin_valor_falla()
    {
        ErrorDeOpciones error = Assert.Throws<ErrorDeOpciones>(
            () => Opciones.Leer(new[] { "--proyecto" }));

        Assert.Contains("--proyecto", error.Message);
    }
}
