using System.Text.Json;

namespace Lainco.SonarSync.Tests;

public class ArchivoDeAceptadosTests
{
    private static readonly DateTimeOffset Momento = new(2026, 10, 14, 21, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Serializa_los_issues_ordenados_con_los_datos_del_origen()
    {
        Opciones opciones = Opciones.Leer(new[] { "--proyecto", "p", "--rama", "main" });
        IssueAceptado[] issues =
        {
            new("b/B.cs", "LAIN005", "Método estático 'B.Calcular' no permitido", "ACCEPTED"),
            new("a/A.cs", "LAIN004", "La property 'A.Nombre' no debe inicializarse en la declaración", "FALSE_POSITIVE"),
        };

        string json = ArchivoDeAceptados.Serializar(opciones, issues, Momento);

        using JsonDocument documento = JsonDocument.Parse(json);
        JsonElement raiz = documento.RootElement;
        Assert.Equal(1, raiz.GetProperty("version").GetInt32());
        Assert.Equal("p", raiz.GetProperty("proyecto").GetString());
        Assert.Equal("main", raiz.GetProperty("rama").GetString());
        Assert.Equal("2026-10-14T21:00:00+00:00", raiz.GetProperty("generado").GetString());

        JsonElement[] lista = raiz.GetProperty("issues").EnumerateArray().ToArray();
        Assert.Equal(2, lista.Length);
        Assert.Equal("a/A.cs", lista[0].GetProperty("archivo").GetString());
        Assert.Equal("LAIN004", lista[0].GetProperty("regla").GetString());
        Assert.Equal("La property 'A.Nombre' no debe inicializarse en la declaración", lista[0].GetProperty("mensaje").GetString());
        Assert.Equal("FALSE_POSITIVE", lista[0].GetProperty("estado").GetString());
        Assert.Equal("b/B.cs", lista[1].GetProperty("archivo").GetString());
    }

    [Fact]
    public void El_texto_se_guarda_legible_sin_escapar_acentos_ni_comillas()
    {
        Opciones opciones = Opciones.Leer(new[] { "--proyecto", "p" });
        IssueAceptado[] issues = { new("A.cs", "LAIN005", "Método estático 'A.B' no permitido", "ACCEPTED") };

        string json = ArchivoDeAceptados.Serializar(opciones, issues, Momento);

        Assert.Contains("Método estático 'A.B' no permitido", json);
    }

    [Fact]
    public void Escribir_reemplaza_el_archivo_existente_sin_dejar_temporales()
    {
        string carpeta = Directory.CreateTempSubdirectory("sonar-sync-").FullName;
        try
        {
            string ruta = Path.Combine(carpeta, "sonar-accepted.json");
            File.WriteAllText(ruta, "viejo");

            ArchivoDeAceptados.Escribir(ruta, "nuevo");

            Assert.Equal("nuevo", File.ReadAllText(ruta));
            Assert.Single(Directory.GetFiles(carpeta));
        }
        finally
        {
            Directory.Delete(carpeta, recursive: true);
        }
    }

    [Fact]
    public void Escribir_crea_la_carpeta_si_no_existe()
    {
        string carpeta = Directory.CreateTempSubdirectory("sonar-sync-").FullName;
        try
        {
            string ruta = Path.Combine(carpeta, "cache", "sonar-accepted.json");

            ArchivoDeAceptados.Escribir(ruta, "{}");

            Assert.Equal("{}", File.ReadAllText(ruta));
        }
        finally
        {
            Directory.Delete(carpeta, recursive: true);
        }
    }
}
