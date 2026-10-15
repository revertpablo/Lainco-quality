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

    // ------------------------------------------------------------- vigencia del archivo

    [Fact]
    public async Task Con_el_archivo_vigente_no_consulta_ni_pide_token()
    {
        File.WriteAllText(Salida, "vigente");
        File.SetLastWriteTimeUtc(Salida, Momento.UtcDateTime.AddHours(-7));
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 0));
        StringWriter log = new();

        int codigo = await Ejecutar(null, servidor, log, "--vigencia-horas", "8");

        Assert.Equal(Sincronizacion.Exito, codigo);
        Assert.Empty(servidor.Pedidos);
        Assert.Equal("vigente", File.ReadAllText(Salida));
    }

    [Fact]
    public async Task Con_el_archivo_vencido_consulta_y_lo_reemplaza()
    {
        File.WriteAllText(Salida, "vencido");
        File.SetLastWriteTimeUtc(Salida, Momento.UtcDateTime.AddHours(-9));
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 0));
        StringWriter log = new();

        int codigo = await Ejecutar("token", servidor, log, "--vigencia-horas", "8");

        Assert.Equal(Sincronizacion.Exito, codigo);
        Assert.Single(servidor.Pedidos);
        Assert.Contains("\"version\"", File.ReadAllText(Salida));
    }

    [Fact]
    public async Task Sin_archivo_consulta_aunque_haya_vigencia()
    {
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 0));
        StringWriter log = new();

        int codigo = await Ejecutar("token", servidor, log, "--vigencia-horas", "8");

        Assert.Equal(Sincronizacion.Exito, codigo);
        Assert.Single(servidor.Pedidos);
        Assert.True(File.Exists(Salida));
    }

    [Fact]
    public async Task Con_vigencia_cero_consulta_siempre()
    {
        File.WriteAllText(Salida, "recien generado");
        File.SetLastWriteTimeUtc(Salida, Momento.UtcDateTime);
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 0));
        StringWriter log = new();

        int codigo = await Ejecutar("token", servidor, log, "--vigencia-horas", "0");

        Assert.Equal(Sincronizacion.Exito, codigo);
        Assert.Single(servidor.Pedidos);
    }

    // ------------------------------------------------------- varias corridas a la vez

    [Fact]
    public async Task Si_otra_corrida_esta_actualizando_no_consulta_y_termina_en_cero()
    {
        // Un build en paralelo dispara una corrida por proyecto: solo una consulta a
        // Sonar, las demás siguen con el archivo que haya.
        File.WriteAllText(Salida, "anterior");
        File.SetLastWriteTimeUtc(Salida, Momento.UtcDateTime.AddHours(-9));
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 0));
        StringWriter log = new();

        using (FileStream candado = new(Salida + ".lock", FileMode.Create, FileAccess.ReadWrite, FileShare.None))
        {
            int codigo = await Ejecutar("token", servidor, log, "--vigencia-horas", "8");

            Assert.Equal(Sincronizacion.Exito, codigo);
        }

        Assert.Empty(servidor.Pedidos);
        Assert.Equal("anterior", File.ReadAllText(Salida));
    }

    [Fact]
    public async Task Al_terminar_no_deja_el_candado()
    {
        StringWriter log = new();

        await Ejecutar("token", QueResponde(Pagina(1, 0)), log);

        Assert.Equal(new[] { "sonar-accepted.json" }, Directory.GetFiles(carpeta).Select(Path.GetFileName).ToArray());
    }

    // ------------------------------------------------------------ pausa tras una falla

    private string Falla => Salida + ".falla";

    [Fact]
    public async Task Tras_una_falla_las_corridas_automaticas_no_reintentan_por_15_minutos()
    {
        // Con Sonar caído, cada proyecto de la solución intentaría de nuevo en cada build.
        StringWriter log = new();
        ServidorSonarFalso caido = QueFallaCon(HttpStatusCode.ServiceUnavailable);

        int primera = await Ejecutar("token", caido, log, "--vigencia-horas", "8");
        int segunda = await Sincronizacion.EjecutarAsync(
            new[] { "--proyecto", Proyecto, "--salida", Salida, "--vigencia-horas", "8" },
            "token", caido, log, () => Momento.AddMinutes(14));

        Assert.Equal(Sincronizacion.ErrorDeSonar, primera);
        Assert.Equal(Sincronizacion.Exito, segunda);
        Assert.Single(caido.Pedidos);
        Assert.True(File.Exists(Falla));
    }

    [Fact]
    public async Task Pasada_la_pausa_vuelve_a_consultar()
    {
        StringWriter log = new();
        await Ejecutar("token", QueFallaCon(HttpStatusCode.ServiceUnavailable), log, "--vigencia-horas", "8");
        ServidorSonarFalso repuesto = QueResponde(Pagina(1, 0));

        int codigo = await Sincronizacion.EjecutarAsync(
            new[] { "--proyecto", Proyecto, "--salida", Salida, "--vigencia-horas", "8" },
            "token", repuesto, log, () => Momento.AddMinutes(16));

        Assert.Equal(Sincronizacion.Exito, codigo);
        Assert.Single(repuesto.Pedidos);
        Assert.False(File.Exists(Falla));
    }

    [Fact]
    public async Task Una_corrida_manual_ignora_la_pausa()
    {
        // Sin --vigencia-horas es una persona la que la corre: quiere el resultado ya,
        // por ejemplo después de corregir el token.
        StringWriter log = new();
        await Ejecutar("token", QueFallaCon(HttpStatusCode.Unauthorized), log, "--vigencia-horas", "8");
        ServidorSonarFalso repuesto = QueResponde(Pagina(1, 0));

        int codigo = await Ejecutar("token", repuesto, log);

        Assert.Equal(Sincronizacion.Exito, codigo);
        Assert.Single(repuesto.Pedidos);
        Assert.False(File.Exists(Falla));
    }
}
