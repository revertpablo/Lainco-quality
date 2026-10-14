using System.Net;
using System.Text;
using System.Text.Json;

namespace Lainco.SonarSync.Tests;

/// <summary>
/// Reemplaza a SonarQube Cloud en los tests: registra cada pedido y responde con lo que
/// indique el test, sin salir a la red.
/// </summary>
internal sealed class ServidorSonarFalso : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, HttpResponseMessage> responder;

    public ServidorSonarFalso(Func<HttpRequestMessage, HttpResponseMessage> responder)
    {
        this.responder = responder;
    }

    public List<HttpRequestMessage> Pedidos { get; } = new();

    /// <summary>Responde siempre la misma página.</summary>
    public static ServidorSonarFalso QueResponde(string json)
    {
        return new ServidorSonarFalso(_ => Json(json));
    }

    /// <summary>Responde siempre el mismo código de estado, sin cuerpo útil.</summary>
    public static ServidorSonarFalso QueFallaCon(HttpStatusCode codigo)
    {
        return new ServidorSonarFalso(_ => new HttpResponseMessage(codigo)
        {
            Content = new StringContent("{\"errors\":[{\"msg\":\"error\"}]}", Encoding.UTF8, "application/json"),
        });
    }

    public static HttpResponseMessage Json(string json)
    {
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
    }

    /// <summary>
    /// Arma una página de <c>api/issues/search</c> con la forma que devuelve SonarQube Cloud.
    /// </summary>
    public static string Pagina(int pagina, int total, params object[] issues)
    {
        return JsonSerializer.Serialize(new
        {
            total,
            p = pagina,
            ps = 500,
            paging = new { pageIndex = pagina, pageSize = 500, total },
            issues,
        });
    }

    /// <summary>Un issue como lo devuelve la API, con los campos que usa la herramienta.</summary>
    public static object Issue(
        string regla,
        string archivo,
        string mensaje,
        string? issueStatus = "ACCEPTED",
        string? resolution = "WONTFIX")
    {
        return new
        {
            key = Guid.NewGuid().ToString("N"),
            rule = regla,
            component = Proyecto + ":" + archivo,
            project = Proyecto,
            message = mensaje,
            status = "RESOLVED",
            resolution,
            issueStatus,
        };
    }

    public const string Proyecto = "revertpablo_Lainco-quality";

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        Pedidos.Add(request);
        return Task.FromResult(responder(request));
    }
}
