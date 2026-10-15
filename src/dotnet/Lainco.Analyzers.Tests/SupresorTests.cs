using System;
using System.Linq;
using System.Threading.Tasks;
using Lainco.Analyzers.Reglas;
using Lainco.Analyzers.Suppressor;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Testing;
using Xunit;
using static Lainco.Analyzers.Tests.VerificadorDeSupresion;

namespace Lainco.Analyzers.Tests;

/// <summary>
/// Suppressor de issues aceptados (Fase 4, tarea 3): oculta los diagnósticos que coinciden
/// en archivo + regla + mensaje con un issue aceptado o falso positivo de SonarQube.
/// </summary>
public class SupresorTests
{
    private const string Aceptados = "/0/sonar-accepted.json";

    private const string Articulo = """
        namespace Dominio
        {
            public class Articulo
            {
                public string Codigo { get; set; } = "";
                public string Descripcion { get; set; } = "sin descripción";
            }
        }
        """;

    private const string MensajeDeDescripcion =
        "La property 'Dominio.Articulo.Descripcion' no debe inicializarse en la declaración";

    private static string Archivo(params (string Archivo, string Regla, string Mensaje, string Estado)[] issues)
    {
        string lista = string.Join(",\n", issues.Select(issue =>
            "    {\n" +
            $"      \"archivo\": \"{issue.Archivo}\",\n" +
            $"      \"regla\": \"{issue.Regla}\",\n" +
            $"      \"mensaje\": \"{issue.Mensaje}\",\n" +
            $"      \"estado\": \"{issue.Estado}\"\n" +
            "    }"));

        return "{\n" +
               "  \"version\": 1,\n" +
               "  \"proyecto\": \"p\",\n" +
               "  \"rama\": null,\n" +
               "  \"generado\": \"2026-10-15T12:00:00+00:00\",\n" +
               "  \"issues\": [\n" + lista + "\n  ]\n" +
               "}";
    }

    private static DiagnosticResult Codigo(bool suprimido) =>
        Diagnostico("LAIN004", 5, 23, "Dominio.Articulo.Codigo", suprimido);

    private static DiagnosticResult Descripcion(bool suprimido) =>
        Diagnostico("LAIN004", 6, 23, "Dominio.Articulo.Descripcion", suprimido);

    // --------------------------------------------------------------- se suprime

    [Fact]
    public async Task Un_issue_aceptado_se_suprime_y_los_demas_no()
    {
        string aceptados = Archivo(("Test0.cs", "LAIN004", MensajeDeDescripcion, "ACCEPTED"));

        await VerificarAsync(Articulo, aceptados, Aceptados, raiz: null,
            Codigo(suprimido: false),
            Descripcion(suprimido: true));
    }

    [Fact]
    public async Task Un_falso_positivo_tambien_se_suprime()
    {
        string aceptados = Archivo(("Test0.cs", "LAIN004", MensajeDeDescripcion, "FALSE_POSITIVE"));

        await VerificarAsync(Articulo, aceptados, Aceptados, raiz: null,
            Codigo(suprimido: false),
            Descripcion(suprimido: true));
    }

    [Fact]
    public async Task Se_suprime_aunque_el_codigo_se_haya_movido_de_linea()
    {
        // El archivo no guarda la línea: el mensaje identifica al símbolo.
        const string movido = """
            namespace Dominio
            {
                public class Articulo
                {
                    public string Codigo { get; set; } = "";



                    public string Descripcion { get; set; } = "sin descripción";
                }
            }
            """;
        string aceptados = Archivo(("Test0.cs", "LAIN004", MensajeDeDescripcion, "ACCEPTED"));

        await VerificarAsync(movido, aceptados, Aceptados, raiz: null,
            Codigo(suprimido: false),
            Diagnostico("LAIN004", 9, 23, "Dominio.Articulo.Descripcion", suprimido: true));
    }

    [Fact]
    public async Task Suprime_issues_de_cualquier_regla_LAIN()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Calculador
                {
                    public static int Doble(int x)
                    {
                        return x * 2;
                    }
                }
            }
            """;
        string aceptados = Archivo(("Test0.cs", "LAIN005", "Método estático 'Dominio.Calculador.Doble' no permitido", "ACCEPTED"));

        await VerificarAsync(codigo, aceptados, Aceptados, raiz: null,
            Diagnostico("LAIN005", 5, 27, "Dominio.Calculador.Doble", suprimido: true));
    }

    [Fact]
    public async Task Las_rutas_son_relativas_a_LaincoSonarRaiz_cuando_esta_definida()
    {
        // El archivo de aceptados puede estar en cualquier carpeta; las rutas que trae
        // son relativas a la raíz del análisis de Sonar.
        string aceptados = Archivo(("0/Test0.cs", "LAIN004", MensajeDeDescripcion, "ACCEPTED"));

        await VerificarAsync(Articulo, aceptados, "/cache/sonar-accepted.json", raiz: "/",
            Codigo(suprimido: false),
            Descripcion(suprimido: true));
    }

    // ------------------------------------------------------------- no se suprime

    [Fact]
    public async Task Sin_archivo_de_aceptados_no_suprime_nada()
    {
        await VerificarAsync(Articulo, aceptados: null, Aceptados, raiz: null,
            Codigo(suprimido: false),
            Descripcion(suprimido: false));
    }

    [Fact]
    public async Task El_mismo_mensaje_en_otro_archivo_no_se_suprime()
    {
        string aceptados = Archivo(("Otro.cs", "LAIN004", MensajeDeDescripcion, "ACCEPTED"));

        await VerificarAsync(Articulo, aceptados, Aceptados, raiz: null,
            Codigo(suprimido: false),
            Descripcion(suprimido: false));
    }

    [Fact]
    public async Task El_mismo_mensaje_de_otra_regla_no_se_suprime()
    {
        string aceptados = Archivo(("Test0.cs", "LAIN005", MensajeDeDescripcion, "ACCEPTED"));

        await VerificarAsync(Articulo, aceptados, Aceptados, raiz: null,
            Codigo(suprimido: false),
            Descripcion(suprimido: false));
    }

    [Fact]
    public async Task Si_cambia_el_simbolo_el_issue_ya_no_coincide()
    {
        // Renombrar la property es otro issue: el revisor lo tiene que volver a aceptar.
        string aceptados = Archivo((
            "Test0.cs", "LAIN004",
            "La property 'Dominio.Articulo.DescripcionVieja' no debe inicializarse en la declaración",
            "ACCEPTED"));

        await VerificarAsync(Articulo, aceptados, Aceptados, raiz: null,
            Codigo(suprimido: false),
            Descripcion(suprimido: false));
    }

    [Fact]
    public async Task Un_archivo_que_no_es_JSON_no_suprime_nada_ni_falla()
    {
        // Si el analyzer lanzara una excepción, el framework reportaría AD0001 y el test fallaría.
        await VerificarAsync(Articulo, "esto no es json {", Aceptados, raiz: null,
            Codigo(suprimido: false),
            Descripcion(suprimido: false));
    }

    [Fact]
    public async Task Un_archivo_de_otra_version_del_formato_no_suprime_nada()
    {
        string aceptados = Archivo(("Test0.cs", "LAIN004", MensajeDeDescripcion, "ACCEPTED"))
            .Replace("\"version\": 1", "\"version\": 2");

        await VerificarAsync(Articulo, aceptados, Aceptados, raiz: null,
            Codigo(suprimido: false),
            Descripcion(suprimido: false));
    }

    [Fact]
    public async Task Un_archivo_adicional_con_otro_nombre_no_se_usa()
    {
        string aceptados = Archivo(("Test0.cs", "LAIN004", MensajeDeDescripcion, "ACCEPTED"));

        await VerificarAsync(Articulo, aceptados, "/0/otro.json", raiz: null,
            Codigo(suprimido: false),
            Descripcion(suprimido: false));
    }

    // ------------------------------------------------------------------ detalles

    [Fact]
    public void Las_rutas_de_Windows_se_comparan_con_barras_normales_y_sin_distinguir_mayusculas()
    {
        Assert.Equal(
            "samples/SampleSolution/Sample.Dominio/Articulo.cs",
            Rutas.Relativa(@"C:\Lainco\Github\Lainco-quality\samples\SampleSolution\Sample.Dominio\Articulo.cs",
                           @"c:\lainco\github\Lainco-quality\"));

        Assert.Equal("src/A.cs", Rutas.Relativa("/repo/src/A.cs", "/repo"));
        Assert.Null(Rutas.Relativa("/otro/src/A.cs", "/repo/"));
    }

    [Fact]
    public void El_lector_tolera_escapes_y_campos_desconocidos()
    {
        const string json = """
            {
              "version": 1.0,
              "extra": { "lista": [1, -2.5e3, true, false, null, { "x": [] }] },
              "issues": [
                {
                  "archivo": "a\\b.cs",
                  "regla": "LAIN004",
                  "mensaje": "Comillas \" y acento \u00e9 y salto\n",
                  "estado": "ACCEPTED",
                  "otro": 3
                }
              ]
            }
            """;

        ArchivoDeAceptados? archivo = ArchivoDeAceptados.Leer(json);

        Assert.NotNull(archivo);
        Assert.True(archivo!.Contiene("a\\b.cs", "LAIN004", "Comillas \" y acento é y salto\n"));
        Assert.False(archivo.Contiene("a\\b.cs", "LAIN004", "otro mensaje"));
    }

    [Fact]
    public void Un_JSON_truncado_se_descarta()
    {
        Assert.Null(ArchivoDeAceptados.Leer("{ \"version\": 1, \"issues\": [ { \"archivo\": \"a"));
        Assert.Null(ArchivoDeAceptados.Leer("{ \"version\": 1 } basura"));
        Assert.Null(ArchivoDeAceptados.Leer(""));
    }

    [Fact]
    public void Cada_regla_LAIN_tiene_su_supresion()
    {
        // Una regla nueva sin su SuppressionDescriptor no se podría ocultar en el IDE.
        string[] reglas = typeof(MetodoEstaticoAnalyzer).Assembly.GetTypes()
            .Where(tipo => typeof(DiagnosticAnalyzer).IsAssignableFrom(tipo) && !tipo.IsAbstract)
            .SelectMany(tipo => ((DiagnosticAnalyzer)Activator.CreateInstance(tipo)!).SupportedDiagnostics)
            .Select(descriptor => descriptor.Id)
            .Distinct()
            .ToArray();

        string[] suprimibles = new SupresorDeAceptados().SupportedSuppressions
            .Select(supresion => supresion.SuppressedDiagnosticId)
            .ToArray();

        Assert.NotEmpty(reglas);
        Assert.All(reglas, regla => Assert.Contains(regla, suprimibles));
    }
}
