using System.Threading.Tasks;
using Lainco.Analyzers.Reglas;
using Microsoft.CodeAnalysis.Testing;
using Xunit;

namespace Lainco.Analyzers.Tests;

/// <summary>
/// LAIN004: no se permite inicialización inline de properties.
/// </summary>
public class LAIN004Tests
{
    private static DiagnosticResult Esperado(int linea, int columna, string simbolo)
    {
        return Verificador<InicializacionInlineDePropertyAnalyzer>
            .Diagnostico(InicializacionInlineDePropertyAnalyzer.Id)
            .WithLocation(linea, columna)
            .WithArguments(simbolo);
    }

    // ---------------------------------------------------------------- casos positivos

    [Fact]
    public async Task Property_con_inicializador_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Articulo
                {
                    public string Descripcion { get; set; } = "sin descripción";
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 23, "Dominio.Articulo.Descripcion"));
    }

    [Fact]
    public async Task Property_de_solo_lectura_con_inicializador_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Articulo
                {
                    public int Cantidad { get; } = 1;
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 20, "Dominio.Articulo.Cantidad"));
    }

    [Fact]
    public async Task Cada_property_inicializada_dispara_por_separado()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Articulo
                {
                    public string Codigo { get; set; } = "";
                    public string Descripcion { get; set; }
                    public decimal Precio { get; set; } = 0m;
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 23, "Dominio.Articulo.Codigo"),
            Esperado(7, 24, "Dominio.Articulo.Precio"));
    }

    [Fact]
    public async Task El_mensaje_usa_el_nombre_completamente_calificado_del_tipo_anidado()
    {
        const string codigo = """
            namespace Dominio.Ventas
            {
                public class Pedido
                {
                    public class Linea
                    {
                        public int Cantidad { get; set; } = 1;
                    }
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(
            codigo,
            Esperado(7, 24, "Dominio.Ventas.Pedido.Linea.Cantidad"));
    }

    [Fact]
    public async Task Property_estatica_con_inicializador_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Configuracion
                {
                    public static int Reintentos { get; set; } = 3;
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 27, "Dominio.Configuracion.Reintentos"));
    }

    [Fact]
    public async Task Property_de_record_con_inicializador_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public record Comprobante
                {
                    public string Tipo { get; init; } = "A";
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 23, "Dominio.Comprobante.Tipo"));
    }

    // ---------------------------------------------------------------- casos negativos

    [Fact]
    public async Task Property_sin_inicializador_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Articulo
                {
                    public string Descripcion { get; set; }
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Property_inicializada_en_el_constructor_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Articulo
                {
                    public Articulo()
                    {
                        Descripcion = "sin descripción";
                    }

                    public string Descripcion { get; set; }
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Property_con_cuerpo_de_expresion_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Linea
                {
                    public decimal Cantidad { get; set; }
                    public decimal Precio { get; set; }
                    public decimal Total => Cantidad * Precio;
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Property_con_getter_y_setter_con_cuerpo_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Articulo
                {
                    private string descripcion;

                    public string Descripcion
                    {
                        get { return descripcion; }
                        set { descripcion = value; }
                    }
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Campo_con_inicializador_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Articulo
                {
                    private readonly string descripcion = "sin descripción";

                    public string Descripcion { get; set; }

                    public string Leer()
                    {
                        return descripcion;
                    }
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Parametro_posicional_de_record_no_dispara()
    {
        // Los parámetros posicionales generan properties sin inicializador inline:
        // el valor lo asigna el constructor generado.
        const string codigo = """
            namespace Dominio
            {
                public record Comprobante(string Tipo, int Numero);
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Property_de_interfaz_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public interface IArticulo
                {
                    string Descripcion { get; set; }
                }
            }
            """;

        await Verificador<InicializacionInlineDePropertyAnalyzer>.VerificarAsync(codigo);
    }
}
