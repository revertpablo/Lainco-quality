using System.Net;
using static Lainco.SonarSync.Tests.ServidorSonarFalso;

namespace Lainco.SonarSync.Tests;

/// <summary>
/// La corrida completa, como la ve quien la invoca (el target de MSBuild de la tarea 2):
/// código de salida y archivo resultante.
/// </summary>
public class SincronizacionTests : IDisposable
{
    private static readonly DateTimeOffset Momento = new(2026, 10, 14, 21, 0, 0, TimeSpan.Zero);

    private readonly string carpeta = Directory.CreateTempSubdirectory("sonar-sync-").FullName;

    private string Salida => Path.Combine(carpeta, "sonar-accepted.json");

    public void Dispose()
    {
        Directory.Delete(carpeta, recursive: true);
    }

    private Task<int> Ejecutar(string? token, HttpMessageHandler servidor, StringWriter log, params string[] extra)
    {
        string[] argumentos = new[] { "--proyecto", Proyecto, "--salida", Salida }.Concat(extra).ToArray();
        return Sincronizacion.EjecutarAsync(argumentos, token, servidor, log, () => Momento);
    }

    [Fact]
    public async Task Con_respuesta_correcta_escribe_el_archivo_y_termina_en_cero()
    {
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 1,
            Issue("external_roslyn:LAIN004", "Sample.Dominio/Articulo.cs", "m")));
        StringWriter log = new();

        int codigo = await Ejecutar("token", servidor, log);

        Assert.Equal(Sincronizacion.Exito, codigo);
        Assert.Contains("\"LAIN004\"", File.ReadAllText(Salida));
        Assert.Contains("1 issue", log.ToString());
    }

    [Fact]
    public async Task Sin_token_no_consulta_ni_escribe_y_termina_con_error_de_configuracion()
    {
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 0));
        StringWriter log = new();

        int codigo = await Ejecutar(null, servidor, log);

        Assert.Equal(Sincronizacion.ErrorDeConfiguracion, codigo);
        Assert.Empty(servidor.Pedidos);
        Assert.False(File.Exists(Salida));
        Assert.Contains(Sincronizacion.VariableDelToken, log.ToString());
    }

    [Fact]
    public async Task Con_opciones_invalidas_termina_con_error_de_configuracion()
    {
        StringWriter log = new();

        int codigo = await Sincronizacion.EjecutarAsync(
            new[] { "--rama", "main" }, "token", QueResponde(Pagina(1, 0)), log, () => Momento);

        Assert.Equal(Sincronizacion.ErrorDeConfiguracion, codigo);
        Assert.Contains("--proyecto", log.ToString());
    }

    [Fact]
    public async Task Con_ayuda_muestra_el_uso_sin_consultar_y_termina_en_cero()
    {
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 0));
        StringWriter log = new();

        int codigo = await Sincronizacion.EjecutarAsync(new[] { "--ayuda" }, null, servidor, log, () => Momento);

        Assert.Equal(Sincronizacion.Exito, codigo);
        Assert.Empty(servidor.Pedidos);
        Assert.Contains("--proyecto", log.ToString());
    }

    [Fact]
    public async Task Sin_red_conserva_el_archivo_anterior_y_termina_con_error_de_Sonar()
    {
        File.WriteAllText(Salida, "anterior");
        ServidorSonarFalso servidor = new(_ => throw new HttpRequestException("sin red"));
        StringWriter log = new();

        int codigo = await Ejecutar("token", servidor, log);

        Assert.Equal(Sincronizacion.ErrorDeSonar, codigo);
        Assert.Equal("anterior", File.ReadAllText(Salida));
    }

    [Fact]
    public async Task Con_error_de_la_API_conserva_el_archivo_anterior_y_termina_con_error_de_Sonar()
    {
        File.WriteAllText(Salida, "anterior");
        StringWriter log = new();

        int codigo = await Ejecutar("token", QueFallaCon(HttpStatusCode.Unauthorized), log);

        Assert.Equal(Sincronizacion.ErrorDeSonar, codigo);
        Assert.Equal("anterior", File.ReadAllText(Salida));
        Assert.Contains("token", log.ToString());
    }

    [Fact]
    public async Task El_token_nunca_aparece_en_el_log()
    {
        StringWriter log = new();

        await Ejecutar("token-secreto-123", QueFallaCon(HttpStatusCode.Unauthorized), log);
        await Ejecutar("token-secreto-123", QueResponde(Pagina(1, 0)), log);

        Assert.DoesNotContain("token-secreto-123", log.ToString());
    }
}
