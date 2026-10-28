using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Lainco.CatalogoReglas;

/// <summary>
/// Escribe el catálogo en JSON: campos en camelCase y en el orden documentado, acentos sin
/// escapar, finales de línea <c>\n</c> y un salto al final. El mismo catálogo da siempre el
/// mismo archivo, se genere en Windows o en Linux.
/// </summary>
internal static class EscritorDelCatalogo
{
    private static readonly JsonSerializerOptions Opciones = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static string Serializar(Catalogo catalogo)
    {
        return JsonSerializer.Serialize(catalogo, Opciones).Replace("\r\n", "\n") + "\n";
    }
}
