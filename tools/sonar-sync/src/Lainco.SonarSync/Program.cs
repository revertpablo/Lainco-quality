using System;
using System.Net.Http;
using System.Threading.Tasks;

namespace Lainco.SonarSync;

/// <summary>Punto de entrada de <c>sonar-sync</c>.</summary>
internal static class Program
{
    /// <summary>
    /// Genera <c>sonar-accepted.json</c> con los issues LAIN aceptados o marcados como falso
    /// positivo en SonarQube. Ver <see cref="Sincronizacion"/> por los códigos de salida.
    /// </summary>
    public static async Task<int> Main(string[] args)
    {
        using HttpClientHandler manejador = new();

        return await Sincronizacion.EjecutarAsync(
            args,
            Environment.GetEnvironmentVariable(Sincronizacion.VariableDelToken),
            manejador,
            Console.Error,
            () => DateTimeOffset.UtcNow);
    }
}
