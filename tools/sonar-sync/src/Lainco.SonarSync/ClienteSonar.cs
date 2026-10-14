using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Lainco.SonarSync;

/// <summary>
/// Consulta <c>api/issues/search</c> de SonarQube por los issues aceptados o marcados como
/// falso positivo, y se queda con los de reglas externas LAIN.
/// </summary>
internal sealed class ClienteSonar
{
    /// <summary>Máximo de issues por página que admite la API.</summary>
    public const int TamanoDePagina = 500;

    /// <summary>
    /// Máximo de issues que la API devuelve por consulta, sumando todas las páginas.
    /// </summary>
    public const int LimiteDeLaApi = 10000;

    // Reglas propias importadas como issues externos: 'external_roslyn:LAIN004'. Las
    // reglas de Sonar (csharpsquid:...) y los analyzers del SDK (external_roslyn:CA...)
    // no son de esta herramienta.
    private static readonly Regex ReglaLain = new(@"^external_[^:]+:(LAIN\d{3})$", RegexOptions.CultureInvariant);

    private readonly HttpClient http;
    private readonly Opciones opciones;
    private readonly string token;

    public ClienteSonar(HttpClient http, Opciones opciones, string token)
    {
        this.http = http;
        this.opciones = opciones;
        this.token = token;
    }

    /// <summary>
    /// Devuelve los issues LAIN aceptados o falsos positivos, recorriendo todas las
    /// páginas. Lanza <see cref="ErrorDeSonar"/> si la API falla o no responde.
    /// </summary>
    public async Task<IReadOnlyList<IssueAceptado>> BuscarAceptadosAsync(CancellationToken cancelacion)
    {
        List<IssueAceptado> aceptados = new();
        int pagina = 1;
        int leidos = 0;
        int total;

        do
        {
            using JsonDocument respuesta = await PedirPaginaAsync(pagina, cancelacion).ConfigureAwait(false);
            JsonElement raiz = respuesta.RootElement;

            total = raiz.GetProperty("paging").GetProperty("total").GetInt32();

            if (total > LimiteDeLaApi)
            {
                throw new ErrorDeSonar(
                    $"La consulta devuelve {total} issues y la API no entrega más de {LimiteDeLaApi}. " +
                    "El archivo quedaría incompleto, así que no se genera.");
            }

            int enEstaPagina = 0;

            foreach (JsonElement issue in raiz.GetProperty("issues").EnumerateArray())
            {
                enEstaPagina++;

                IssueAceptado? aceptado = Convertir(issue);
                if (aceptado != null)
                {
                    aceptados.Add(aceptado);
                }
            }

            // Una página vacía corta el recorrido aunque 'total' diga otra cosa: los
            // issues pueden cambiar de estado mientras se pagina.
            if (enEstaPagina == 0)
            {
                break;
            }

            leidos += enEstaPagina;
            pagina++;
        }
        while (leidos < total);

        return aceptados;
    }

    private async Task<JsonDocument> PedirPaginaAsync(int pagina, CancellationToken cancelacion)
    {
        string url = opciones.Url + "/api/issues/search" +
            "?componentKeys=" + Uri.EscapeDataString(opciones.Proyecto) +
            "&issueStatuses=ACCEPTED,FALSE_POSITIVE" +
            "&ps=" + TamanoDePagina +
            "&p=" + pagina;

        if (opciones.Rama != null)
        {
            url += "&branch=" + Uri.EscapeDataString(opciones.Rama);
        }

        if (opciones.Organizacion != null)
        {
            url += "&organization=" + Uri.EscapeDataString(opciones.Organizacion);
        }

        using HttpRequestMessage pedido = new(HttpMethod.Get, url);
        pedido.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        HttpResponseMessage respuesta;
        try
        {
            respuesta = await http.SendAsync(pedido, cancelacion).ConfigureAwait(false);
        }
        catch (HttpRequestException error)
        {
            throw new ErrorDeSonar($"No se pudo conectar con {opciones.Url}: {error.Message.TrimEnd('.')}.");
        }
        catch (TaskCanceledException) when (!cancelacion.IsCancellationRequested)
        {
            throw new ErrorDeSonar($"{opciones.Url} no respondió a tiempo.");
        }

        using (respuesta)
        {
            switch (respuesta.StatusCode)
            {
                case HttpStatusCode.OK:
                    break;

                case HttpStatusCode.Unauthorized:
                    throw new ErrorDeSonar(
                        $"SonarQube rechazó el token. Revisá la variable {Sincronizacion.VariableDelToken}.");

                case HttpStatusCode.Forbidden:
                    throw new ErrorDeSonar(
                        $"El token no tiene permiso para ver los issues del proyecto '{opciones.Proyecto}'.");

                case HttpStatusCode.NotFound:
                    throw new ErrorDeSonar(
                        $"SonarQube no encontró el proyecto '{opciones.Proyecto}' (o la rama indicada).");

                default:
                    throw new ErrorDeSonar(
                        $"SonarQube respondió {(int)respuesta.StatusCode} ({respuesta.ReasonPhrase}).");
            }

            string contenido = await respuesta.Content.ReadAsStringAsync(cancelacion).ConfigureAwait(false);

            try
            {
                return JsonDocument.Parse(contenido);
            }
            catch (JsonException)
            {
                throw new ErrorDeSonar("SonarQube devolvió una respuesta que no es JSON.");
            }
        }
    }

    private IssueAceptado? Convertir(JsonElement issue)
    {
        string? regla = Texto(issue, "rule");
        if (regla == null)
        {
            return null;
        }

        Match coincidencia = ReglaLain.Match(regla);
        if (!coincidencia.Success)
        {
            return null;
        }

        string? componente = Texto(issue, "component");
        string? mensaje = Texto(issue, "message");
        if (componente == null || mensaje == null)
        {
            return null;
        }

        return new IssueAceptado(
            RutaRelativa(componente),
            coincidencia.Groups[1].Value,
            mensaje,
            Estado(issue));
    }

    /// <summary>
    /// El componente viene como 'clave-del-proyecto:ruta/al/archivo.cs'. La ruta es
    /// relativa a la raíz del análisis, que es lo que necesita el suppressor.
    /// </summary>
    private string RutaRelativa(string componente)
    {
        string prefijo = opciones.Proyecto + ":";

        return componente.StartsWith(prefijo, StringComparison.Ordinal)
            ? componente.Substring(prefijo.Length)
            : componente.Substring(componente.IndexOf(':') + 1);
    }

    /// <summary>
    /// 'issueStatus' es el campo actual. Si no viene, se deduce de 'resolution', el
    /// campo anterior: WONTFIX es como la API llamaba a los aceptados.
    /// </summary>
    private static string Estado(JsonElement issue)
    {
        string? estado = Texto(issue, "issueStatus");
        if (estado != null)
        {
            return estado;
        }

        return Texto(issue, "resolution") == "FALSE-POSITIVE" ? "FALSE_POSITIVE" : "ACCEPTED";
    }

    private static string? Texto(JsonElement objeto, string propiedad)
    {
        return objeto.TryGetProperty(propiedad, out JsonElement valor) && valor.ValueKind == JsonValueKind.String
            ? valor.GetString()
            : null;
    }
}

/// <summary>La API de SonarQube falló, rechazó el pedido o no respondió.</summary>
internal sealed class ErrorDeSonar : Exception
{
    public ErrorDeSonar(string mensaje)
        : base(mensaje)
    {
    }
}
