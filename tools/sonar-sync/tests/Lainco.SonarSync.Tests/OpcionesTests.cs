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
        Assert.Null(opciones.VigenciaHoras);
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
            "--vigencia-horas", "8",
        });

        Assert.Equal("p", opciones.Proyecto);
        Assert.Equal("https://sonar.lainco.local", opciones.Url);
        Assert.Equal("lainco", opciones.Organizacion);
        Assert.Equal("develop", opciones.Rama);
        Assert.Equal("cache/sonar-accepted.json", opciones.Salida);
        Assert.Equal(8, opciones.VigenciaHoras);
    }

    [Fact]
    public void Una_vigencia_que_no_es_un_numero_entero_no_negativo_falla()
    {
        foreach (string valor in new[] { "ocho", "-1", "1.5" })
        {
            ErrorDeOpciones error = Assert.Throws<ErrorDeOpciones>(
                () => Opciones.Leer(new[] { "--proyecto", "p", "--vigencia-horas", valor }));

            Assert.Contains("--vigencia-horas", error.Message);
        }
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
