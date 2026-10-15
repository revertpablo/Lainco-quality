using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace Lainco.SonarSync;

/// <summary>
/// Una corrida completa: lee las opciones y el token, consulta SonarQube y escribe el
/// archivo. Devuelve el código de salida del proceso.
///
/// Si algo falla, el archivo anterior queda como estaba. Quien invoca la herramienta (el
/// target de MSBuild de la Fase 4) decide qué hacer con el código de salida; el build
/// local no debe fallar por esto.
/// </summary>
internal static class Sincronizacion
{
    /// <summary>Variable de entorno con el token personal de SonarQube.</summary>
    public const string VariableDelToken = "LAINCO_SONAR_TOKEN";

    /// <summary>El archivo se generó.</summary>
    public const int Exito = 0;

    /// <summary>Faltan opciones o el token: no se consultó a SonarQube.</summary>
    public const int ErrorDeConfiguracion = 1;

    /// <summary>SonarQube falló o no respondió: el archivo anterior quedó intacto.</summary>
    public const int ErrorDeSonar = 2;

    private static readonly TimeSpan Espera = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Después de una falla, las corridas automáticas (las del build, que pasan
    /// --vigencia-horas) no reintentan durante este tiempo. Sin la pausa, con Sonar caído
    /// cada proyecto de la solución volvería a intentar en cada build.
    /// </summary>
    public static readonly TimeSpan PausaTrasFalla = TimeSpan.FromMinutes(15);

    public static async Task<int> EjecutarAsync(
        IReadOnlyList<string> argumentos,
        string? token,
        HttpMessageHandler manejador,
        TextWriter log,
        Func<DateTimeOffset> reloj)
    {
        if (argumentos.Count == 1 && argumentos[0] is ("--ayuda" or "-h" or "--help"))
        {
            log.WriteLine(Opciones.Uso);
            return Exito;
        }

        Opciones opciones;
        try
        {
            opciones = Opciones.Leer(argumentos);
        }
        catch (ErrorDeOpciones error)
        {
            log.WriteLine("sonar-sync: " + error.Message);
            log.WriteLine();
            log.WriteLine(Opciones.Uso);
            return ErrorDeConfiguracion;
        }

        // El archivo vigente se resuelve antes que el token: quien no tiene token pero
        // tiene un archivo reciente (copiado, o de otra corrida) no necesita nada más.
        if (Vigente(opciones, reloj))
        {
            log.WriteLine($"sonar-sync: {opciones.Salida} tiene menos de {opciones.VigenciaHoras} horas; no se consulta.");
            return Exito;
        }

        if (string.IsNullOrWhiteSpace(token))
        {
            log.WriteLine(
                $"sonar-sync: falta el token. Definí la variable de entorno {VariableDelToken} " +
                "con un token personal de SonarQube de solo lectura.");
            return ErrorDeConfiguracion;
        }

        using FileStream? candado = ArchivoDeAceptados.TomarCandado(opciones.Salida);
        if (candado == null)
        {
            log.WriteLine($"sonar-sync: otra corrida está actualizando {opciones.Salida}; se sigue con el archivo actual.");
            return Exito;
        }

        // Mientras se esperaba el candado, otra corrida pudo haber terminado.
        if (Vigente(opciones, reloj))
        {
            return Exito;
        }

        string marcaDeFalla = opciones.Salida + ".falla";

        if (opciones.VigenciaHoras != null && EnPausa(marcaDeFalla, reloj()))
        {
            return Exito;
        }

        using HttpClient http = new(manejador, disposeHandler: false) { Timeout = Espera };
        ClienteSonar cliente = new(http, opciones, token!);

        IReadOnlyList<IssueAceptado> issues;
        try
        {
            issues = await cliente.BuscarAceptadosAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (ErrorDeSonar error)
        {
            File.WriteAllText(marcaDeFalla, error.Message);
            File.SetLastWriteTimeUtc(marcaDeFalla, reloj().UtcDateTime);

            log.WriteLine("sonar-sync: " + error.Message + " No se modificó " + opciones.Salida + ".");
            return ErrorDeSonar;
        }

        ArchivoDeAceptados.Escribir(opciones.Salida, ArchivoDeAceptados.Serializar(opciones, issues, reloj()));
        File.Delete(marcaDeFalla);

        log.WriteLine($"sonar-sync: {issues.Count} {(issues.Count == 1 ? "issue aceptado" : "issues aceptados")} " +
                      $"de '{opciones.Proyecto}' en {opciones.Salida}.");
        return Exito;
    }

    private static bool EnPausa(string marcaDeFalla, DateTimeOffset ahora)
    {
        return File.Exists(marcaDeFalla)
            && ahora.UtcDateTime - File.GetLastWriteTimeUtc(marcaDeFalla) < PausaTrasFalla;
    }

    private static bool Vigente(Opciones opciones, Func<DateTimeOffset> reloj)
    {
        return opciones.VigenciaHoras is int horas
            && ArchivoDeAceptados.EstaVigente(opciones.Salida, horas, reloj());
    }
}
