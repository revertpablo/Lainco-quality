using System.Threading.Tasks;
using Lainco.Analyzers.Reglas;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Testing;
using Xunit;

namespace Lainco.Analyzers.Tests;

/// <summary>
/// LAIN001: el constructor sin parámetros debe ser <c>protected</c>, salvo que sea el
/// único constructor del tipo.
/// </summary>
public class LAIN001Tests
{
    // La regla tiene dos mensajes (dos descriptores con el mismo ID), así que el resultado
    // esperado se arma con el ID y el mensaje completo.
    private static DiagnosticResult Esperado(int linea, int columna, string tipo)
    {
        return new DiagnosticResult(ConstructorSinParametrosAnalyzer.Id, DiagnosticSeverity.Warning)
            .WithMessage($"El constructor sin parámetros de '{tipo}' debe ser protected, porque el tipo tiene otros constructores")
            .WithLocation(linea, columna);
    }

    private static DiagnosticResult EsperadoEntidadSinConstructor(int linea, int columna, string tipo)
    {
        return new DiagnosticResult(ConstructorSinParametrosAnalyzer.Id, DiagnosticSeverity.Warning)
            .WithMessage($"La entidad '{tipo}' debe tener un constructor sin parámetros protected")
            .WithLocation(linea, columna);
    }

    /// <summary>
    /// Agrega al final del código la interfaz que marca a las entidades. Va al final para no
    /// mover las líneas de los diagnósticos esperados.
    /// </summary>
    private static string ConIEntity(string codigo)
    {
        return codigo + """

            namespace Lainco.Domain
            {
                public interface IEntity
                {
                }
            }
            """;
    }

    // ---------------------------------------------------------------- casos positivos

    [Fact]
    public async Task Publico_con_otro_constructor_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public Pedido()
                    {
                    }

                    public Pedido(int numero)
                        : this()
                    {
                        Numero = numero;
                    }

                    public int Numero { get; set; }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 16, "Dominio.Pedido"));
    }

    [Theory]
    [InlineData("internal", 18)]
    [InlineData("protected internal", 28)]
    [InlineData("private protected", 27)]
    public async Task Otra_accesibilidad_que_no_es_protected_dispara(string accesibilidad, int columna)
    {
        string codigo = $$"""
            namespace Dominio
            {
                public class Pedido
                {
                    {{accesibilidad}} Pedido()
                    {
                    }

                    public Pedido(int numero)
                        : this()
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, columna, "Dominio.Pedido"));
    }

    [Fact]
    public async Task Privado_en_una_clase_que_no_es_sealed_dispara()
    {
        // Un constructor privado impide que NHibernate genere el proxy (que hereda del tipo).
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    private Pedido()
                    {
                    }

                    public Pedido(int numero)
                        : this()
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 17, "Dominio.Pedido"));
    }

    [Fact]
    public async Task Publico_con_constructor_primario_dispara()
    {
        // El constructor primario cuenta como otro constructor del tipo.
        const string codigo = """
            namespace Dominio
            {
                public class Pedido(int numero)
                {
                    public Pedido()
                        : this(0)
                    {
                    }

                    public int Numero => numero;
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 16, "Dominio.Pedido"));
    }

    [Fact]
    public async Task Record_posicional_con_constructor_sin_parametros_publico_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public record Comprobante(string Tipo)
                {
                    public Comprobante()
                        : this("A")
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 16, "Dominio.Comprobante"));
    }

    [Fact]
    public async Task Clase_partial_con_los_constructores_en_partes_distintas_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public partial class Pedido
                {
                    public Pedido()
                    {
                    }
                }

                public partial class Pedido
                {
                    public Pedido(int numero)
                        : this()
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 16, "Dominio.Pedido"));
    }

    [Fact]
    public async Task Clase_abstracta_con_constructor_sin_parametros_publico_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public abstract class Entidad
                {
                    public Entidad()
                    {
                    }

                    public Entidad(int id)
                        : this()
                    {
                        Id = id;
                    }

                    public int Id { get; set; }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 16, "Dominio.Entidad"));
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
                        public Linea()
                        {
                        }

                        public Linea(int cantidad)
                            : this()
                        {
                        }
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            codigo,
            Esperado(7, 20, "Dominio.Ventas.Pedido.Linea"));
    }

    // ---------------------------------------------------------------- casos negativos

    [Fact]
    public async Task Protected_con_otro_constructor_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Cliente
                {
                    protected Cliente()
                    {
                    }

                    public Cliente(string nombre)
                        : this()
                    {
                        Nombre = nombre;
                    }

                    public string Nombre { get; set; }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Unico_constructor_publico_sin_parametros_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Cliente
                {
                    public Cliente()
                    {
                        Nombre = "";
                    }

                    public string Nombre { get; set; }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Tipo_sin_constructores_declarados_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Cliente
                {
                    public string Nombre { get; set; }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Solo_constructores_con_parametros_en_un_tipo_que_no_es_entidad_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Cliente
                {
                    public Cliente(string nombre)
                    {
                        Nombre = nombre;
                    }

                    public Cliente(string nombre, int edad)
                        : this(nombre)
                    {
                    }

                    public string Nombre { get; set; }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task El_constructor_estatico_no_cuenta_como_otro_constructor()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Cliente
                {
                    static Cliente()
                    {
                    }

                    public Cliente()
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task El_constructor_con_todos_los_parametros_opcionales_no_es_sin_parametros()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Cliente
                {
                    public Cliente(int edad = 0)
                    {
                    }

                    public Cliente(string nombre)
                        : this(0)
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Struct_no_dispara()
    {
        // En un struct el constructor sin parámetros explícito tiene que ser público.
        const string codigo = """
            namespace Dominio
            {
                public struct Importe
                {
                    public Importe()
                    {
                        Valor = 0m;
                    }

                    public Importe(decimal valor)
                    {
                        Valor = valor;
                    }

                    public decimal Valor { get; }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task El_constructor_de_copia_que_genera_un_record_no_cuenta()
    {
        const string codigo = """
            namespace Dominio
            {
                public record Comprobante
                {
                    public Comprobante()
                    {
                        Tipo = "A";
                    }

                    public string Tipo { get; init; }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Privado_en_una_clase_sealed_no_dispara()
    {
        // En una clase sealed, 'protected' equivale a 'private' (y el compilador avisa con
        // CS0628), así que se acepta cualquiera de los dos.
        const string codigo = """
            namespace Dominio
            {
                public sealed class Cliente
                {
                    private Cliente()
                    {
                    }

                    public Cliente(string nombre)
                        : this()
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Publico_en_una_clase_sealed_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public sealed class Cliente
                {
                    public Cliente()
                    {
                    }

                    public Cliente(string nombre)
                        : this()
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 16, "Dominio.Cliente"));
    }

    // ------------------------------------------------- entidades (Lainco.Domain.IEntity)

    [Fact]
    public async Task Entidad_con_solo_constructores_con_parametros_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido : Lainco.Domain.IEntity
                {
                    public Pedido(int numero)
                    {
                    }

                    public Pedido(int numero, string observaciones)
                        : this(numero)
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            ConIEntity(codigo),
            EsperadoEntidadSinConstructor(3, 18, "Dominio.Pedido"));
    }

    [Fact]
    public async Task Entidad_con_un_unico_constructor_con_parametros_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido : Lainco.Domain.IEntity
                {
                    public Pedido(int numero)
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            ConIEntity(codigo),
            EsperadoEntidadSinConstructor(3, 18, "Dominio.Pedido"));
    }

    [Fact]
    public async Task Entidad_por_herencia_de_una_clase_base_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public abstract class Entidad : Lainco.Domain.IEntity
                {
                    protected Entidad()
                    {
                    }
                }

                public class Pedido : Entidad
                {
                    public Pedido(int numero)
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            ConIEntity(codigo),
            EsperadoEntidadSinConstructor(10, 18, "Dominio.Pedido"));
    }

    [Fact]
    public async Task Entidad_por_una_interfaz_que_hereda_de_IEntity_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public interface IAgregado : Lainco.Domain.IEntity
                {
                }

                public class Pedido : IAgregado
                {
                    public Pedido(int numero)
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            ConIEntity(codigo),
            EsperadoEntidadSinConstructor(7, 18, "Dominio.Pedido"));
    }

    [Fact]
    public async Task Entidad_abstracta_sin_constructor_sin_parametros_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public abstract class Entidad : Lainco.Domain.IEntity
                {
                    protected Entidad(int id)
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            ConIEntity(codigo),
            EsperadoEntidadSinConstructor(3, 27, "Dominio.Entidad"));
    }

    [Fact]
    public async Task Entidad_con_constructor_primario_y_sin_constructor_sin_parametros_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido(int numero) : Lainco.Domain.IEntity
                {
                    public int Numero => numero;
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            ConIEntity(codigo),
            EsperadoEntidadSinConstructor(3, 18, "Dominio.Pedido"));
    }

    [Fact]
    public async Task Entidad_con_constructor_sin_parametros_publico_y_otro_dispara_una_sola_vez()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido : Lainco.Domain.IEntity
                {
                    public Pedido()
                    {
                    }

                    public Pedido(int numero)
                        : this()
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(
            ConIEntity(codigo),
            Esperado(5, 16, "Dominio.Pedido"));
    }

    [Fact]
    public async Task Entidad_con_constructor_sin_parametros_protected_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido : Lainco.Domain.IEntity
                {
                    protected Pedido()
                    {
                    }

                    public Pedido(int numero)
                        : this()
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(ConIEntity(codigo));
    }

    [Fact]
    public async Task Entidad_sin_constructores_declarados_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido : Lainco.Domain.IEntity
                {
                    public int Numero { get; set; }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(ConIEntity(codigo));
    }

    [Fact]
    public async Task Entidad_con_un_unico_constructor_sin_parametros_publico_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido : Lainco.Domain.IEntity
                {
                    public Pedido()
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(ConIEntity(codigo));
    }

    [Fact]
    public async Task IEntity_de_otro_namespace_no_marca_entidades()
    {
        const string codigo = """
            namespace Otro
            {
                public interface IEntity
                {
                }
            }

            namespace Dominio
            {
                public class Pedido : Otro.IEntity
                {
                    public Pedido(int numero)
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task IEntity_generica_no_marca_entidades()
    {
        const string codigo = """
            namespace Lainco.Domain
            {
                public interface IEntity<TId>
                {
                }
            }

            namespace Dominio
            {
                public class Pedido : Lainco.Domain.IEntity<int>
                {
                    public Pedido(int numero)
                    {
                    }
                }
            }
            """;

        await Verificador<ConstructorSinParametrosAnalyzer>.VerificarAsync(codigo);
    }
}
