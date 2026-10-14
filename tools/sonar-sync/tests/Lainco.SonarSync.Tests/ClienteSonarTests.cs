using System.Net;
using static Lainco.SonarSync.Tests.ServidorSonarFalso;

namespace Lainco.SonarSync.Tests;

public class ClienteSonarTests
{
    private static Opciones OpcionesDePrueba(params string[] extra)
    {
        return Opciones.Leer(new[] { "--proyecto", Proyecto }.Concat(extra).ToArray());
    }

    private static Task<IReadOnlyList<IssueAceptado>> Buscar(ServidorSonarFalso servidor, Opciones opciones)
    {
        ClienteSonar cliente = new(new HttpClient(servidor), opciones, "token-de-prueba");
        return cliente.BuscarAceptadosAsync(CancellationToken.None);
    }

    private static Dictionary<string, string> Parametros(HttpRequestMessage pedido)
    {
        return pedido.RequestUri!.Query.TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(par => par.Split('=', 2))
            .ToDictionary(par => par[0], par => Uri.UnescapeDataString(par[1]));
    }

    [Fact]
    public async Task Consulta_los_issues_aceptados_y_falsos_positivos_del_proyecto()
    {
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 0));

        await Buscar(servidor, OpcionesDePrueba());

        HttpRequestMessage pedido = Assert.Single(servidor.Pedidos);
        Assert.Equal("https://sonarcloud.io/api/issues/search", pedido.RequestUri!.GetLeftPart(UriPartial.Path));

        Dictionary<string, string> parametros = Parametros(pedido);
        Assert.Equal(Proyecto, parametros["componentKeys"]);
        Assert.Equal("ACCEPTED,FALSE_POSITIVE", parametros["issueStatuses"]);
        Assert.Equal("500", parametros["ps"]);
        Assert.Equal("1", parametros["p"]);
        Assert.False(parametros.ContainsKey("branch"));
        Assert.False(parametros.ContainsKey("organization"));
    }

    [Fact]
    public async Task Envia_el_token_como_Bearer()
    {
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 0));

        await Buscar(servidor, OpcionesDePrueba());

        HttpRequestMessage pedido = Assert.Single(servidor.Pedidos);
        Assert.Equal("Bearer", pedido.Headers.Authorization!.Scheme);
        Assert.Equal("token-de-prueba", pedido.Headers.Authorization.Parameter);
    }

    [Fact]
    public async Task Agrega_la_rama_y_la_organizacion_cuando_se_indican()
    {
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 0));

        await Buscar(servidor, OpcionesDePrueba("--rama", "develop", "--organizacion", "revertpablo"));

        Dictionary<string, string> parametros = Parametros(Assert.Single(servidor.Pedidos));
        Assert.Equal("develop", parametros["branch"]);
        Assert.Equal("revertpablo", parametros["organization"]);
    }

    [Fact]
    public async Task Devuelve_solo_issues_de_reglas_externas_LAIN()
    {
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 4,
            Issue("external_roslyn:LAIN004", "Sample.Dominio/Articulo.cs", "La property 'Sample.Dominio.Articulo.Descripcion' no debe inicializarse en la declaración"),
            Issue("csharpsquid:S2325", "Sample.Dominio/Articulo.cs", "Make 'Calcular' a static method."),
            Issue("external_roslyn:CA1822", "Sample.Dominio/Articulo.cs", "Member 'Calcular' does not access instance data"),
            Issue("external_roslyn:LAIN005", "Sample.Dominio/CalculadorDeTotales.cs", "Método estático 'Sample.Dominio.CalculadorDeTotales.AplicarDescuento' no permitido")));

        IReadOnlyList<IssueAceptado> issues = await Buscar(servidor, OpcionesDePrueba());

        Assert.Equal(new[] { "LAIN004", "LAIN005" }, issues.Select(issue => issue.Regla).ToArray());
    }

    [Fact]
    public async Task Devuelve_la_ruta_relativa_del_archivo_y_el_mensaje()
    {
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 1,
            Issue("external_roslyn:LAIN004",
                  "samples/SampleSolution/Sample.Dominio/Articulo.cs",
                  "La property 'Sample.Dominio.Articulo.Descripcion' no debe inicializarse en la declaración")));

        IReadOnlyList<IssueAceptado> issues = await Buscar(servidor, OpcionesDePrueba());

        IssueAceptado issue = Assert.Single(issues);
        Assert.Equal("samples/SampleSolution/Sample.Dominio/Articulo.cs", issue.Archivo);
        Assert.Equal("La property 'Sample.Dominio.Articulo.Descripcion' no debe inicializarse en la declaración", issue.Mensaje);
    }

    [Fact]
    public async Task Toma_el_estado_de_issueStatus_y_si_falta_de_resolution()
    {
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 4,
            Issue("external_roslyn:LAIN001", "A.cs", "a", issueStatus: "ACCEPTED", resolution: "WONTFIX"),
            Issue("external_roslyn:LAIN002", "B.cs", "b", issueStatus: "FALSE_POSITIVE", resolution: "FALSE-POSITIVE"),
            Issue("external_roslyn:LAIN003", "C.cs", "c", issueStatus: null, resolution: "WONTFIX"),
            Issue("external_roslyn:LAIN004", "D.cs", "d", issueStatus: null, resolution: "FALSE-POSITIVE")));

        IReadOnlyList<IssueAceptado> issues = await Buscar(servidor, OpcionesDePrueba());

        Assert.Equal(
            new[] { "ACCEPTED", "FALSE_POSITIVE", "ACCEPTED", "FALSE_POSITIVE" },
            issues.Select(issue => issue.Estado).ToArray());
    }

    [Fact]
    public async Task Recorre_todas_las_paginas()
    {
        ServidorSonarFalso servidor = new(pedido =>
        {
            string pagina = Parametros(pedido)["p"];
            return pagina == "1"
                ? Json(Pagina(1, 501, Enumerable.Range(1, 500)
                    .Select(i => Issue("external_roslyn:LAIN004", $"A{i}.cs", "m"))
                    .ToArray()))
                : Json(Pagina(2, 501, Issue("external_roslyn:LAIN005", "B.cs", "m")));
        });

        IReadOnlyList<IssueAceptado> issues = await Buscar(servidor, OpcionesDePrueba());

        Assert.Equal(2, servidor.Pedidos.Count);
        Assert.Equal(501, issues.Count);
        Assert.Equal("LAIN005", issues[500].Regla);
    }

    [Fact]
    public async Task Un_token_rechazado_es_un_error_que_menciona_el_token()
    {
        ServidorSonarFalso servidor = QueFallaCon(HttpStatusCode.Unauthorized);

        ErrorDeSonar error = await Assert.ThrowsAsync<ErrorDeSonar>(() => Buscar(servidor, OpcionesDePrueba()));

        Assert.Contains("token", error.Message);
    }

    [Fact]
    public async Task Un_proyecto_inexistente_es_un_error_que_menciona_el_proyecto()
    {
        ServidorSonarFalso servidor = QueFallaCon(HttpStatusCode.NotFound);

        ErrorDeSonar error = await Assert.ThrowsAsync<ErrorDeSonar>(() => Buscar(servidor, OpcionesDePrueba()));

        Assert.Contains(Proyecto, error.Message);
    }

    [Fact]
    public async Task Mas_resultados_que_el_limite_de_la_API_es_un_error()
    {
        // La API no devuelve más de 10.000 issues por consulta: en vez de generar un
        // archivo incompleto en silencio, la herramienta falla.
        ServidorSonarFalso servidor = QueResponde(Pagina(1, 10_001));

        ErrorDeSonar error = await Assert.ThrowsAsync<ErrorDeSonar>(() => Buscar(servidor, OpcionesDePrueba()));

        Assert.Contains("10000", error.Message);
        Assert.Empty(servidor.Pedidos.Skip(1));
    }
}
