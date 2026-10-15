using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Lainco.SonarSync;

/// <summary>
/// Formato y escritura de <c>sonar-accepted.json</c>, el archivo que lee el suppressor.
/// </summary>
internal static class ArchivoDeAceptados
{
    /// <summary>
    /// Versión del formato. Se incrementa si cambia la forma del archivo, para que el
    /// suppressor pueda detectar un archivo que no sabe leer.
    /// </summary>
    public const int Version = 1;

    private static readonly JsonSerializerOptions Formato = new()
    {
        WriteIndented = true,

        // El archivo lo lee el suppressor y, de vez en cuando, una persona: los acentos
        // y las comillas de los mensajes se guardan tal cual, sin escapar.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string Serializar(Opciones opciones, IEnumerable<IssueAceptado> issues, DateTimeOffset generado)
    {
        var contenido = new
        {
            version = Version,
            proyecto = opciones.Proyecto,
            rama = opciones.Rama,
            generado = generado.ToString("yyyy-MM-ddTHH:mm:sszzz", System.Globalization.CultureInfo.InvariantCulture),
            issues = issues
                .OrderBy(issue => issue.Archivo, StringComparer.Ordinal)
                .ThenBy(issue => issue.Regla, StringComparer.Ordinal)
                .ThenBy(issue => issue.Mensaje, StringComparer.Ordinal)
                .Select(issue => new
                {
                    archivo = issue.Archivo,
                    regla = issue.Regla,
                    mensaje = issue.Mensaje,
                    estado = issue.Estado,
                }),
        };

        return JsonSerializer.Serialize(contenido, Formato);
    }

    /// <summary>
    /// Escribe el archivo de forma atómica: primero un temporal y después se reemplaza el
    /// original. Un corte a mitad de camino nunca deja un archivo a medio escribir, que el
    /// suppressor no podría leer.
    /// </summary>
    /// <summary>
    /// Indica si el archivo existe y fue escrito hace menos de <paramref name="horas"/> horas.
    /// </summary>
    public static bool EstaVigente(string ruta, int horas, DateTimeOffset ahora)
    {
        if (!File.Exists(ruta))
        {
            return false;
        }

        DateTime escrito = File.GetLastWriteTimeUtc(ruta);
        return ahora.UtcDateTime - escrito < TimeSpan.FromHours(horas);
    }

    /// <summary>
    /// Toma el candado de escritura del archivo, para que una sola corrida a la vez
    /// consulte a Sonar. Devuelve null si otra corrida ya lo tiene. El candado se borra
    /// solo al liberarse.
    /// </summary>
    public static FileStream? TomarCandado(string ruta)
    {
        string completa = Path.GetFullPath(ruta);
        string? carpeta = Path.GetDirectoryName(completa);
        if (!string.IsNullOrEmpty(carpeta))
        {
            Directory.CreateDirectory(carpeta);
        }

        try
        {
            return new FileStream(
                completa + ".lock",
                FileMode.OpenOrCreate,
                FileAccess.ReadWrite,
                FileShare.None,
                bufferSize: 1,
                FileOptions.DeleteOnClose);
        }
        catch (IOException)
        {
            return null;
        }
    }

    public static void Escribir(string ruta, string contenido)
    {
        string completa = Path.GetFullPath(ruta);
        string? carpeta = Path.GetDirectoryName(completa);
        if (!string.IsNullOrEmpty(carpeta))
        {
            Directory.CreateDirectory(carpeta);
        }

        // Nombre único: si dos procesos llegan a escribir a la vez, no se pisan el temporal.
        string temporal = completa + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(temporal, contenido);
        File.Move(temporal, completa, overwrite: true);
    }
}
