using System.Threading.Tasks;
using Lainco.Analyzers.Reglas;
using Microsoft.CodeAnalysis.Testing;
using Xunit;

namespace Lainco.Analyzers.Tests;

/// <summary>
/// LAIN005: no se permiten métodos estáticos, salvo operators.
///
/// Quedan fuera de la regla el <c>Main</c> que es punto de entrada de la aplicación y los
/// extension methods sobre tipos que no pertenecen al proyecto (decisión D5), y los métodos
/// que son fuente de datos de un <c>[MemberData]</c> de xUnit, que el framework exige estáticos.
/// </summary>
public class LAIN005Tests
{
    private static DiagnosticResult Esperado(int linea, int columna, string simbolo)
    {
        return Verificador<MetodoEstaticoAnalyzer>
            .Diagnostico(MetodoEstaticoAnalyzer.Id)
            .WithLocation(linea, columna)
            .WithArguments(simbolo);
    }

    /// <summary>
    /// Declaración mínima de <c>Xunit.MemberDataAttribute</c>, con la misma firma que la de
    /// xUnit. Se agrega al final del código de los tests de xUnit para no depender del
    /// paquete: el analyzer reconoce el atributo por su nombre completo.
    /// </summary>
    private const string AtributoMemberData = """

        namespace Xunit
        {
            [System.AttributeUsage(System.AttributeTargets.Method, AllowMultiple = true)]
            public class MemberDataAttribute : System.Attribute
            {
                public MemberDataAttribute(string memberName, params object[] parameters)
                {
                }

                public System.Type MemberType { get; set; }
            }
        }
        """;

    // ---------------------------------------------------------------- casos positivos

    [Fact]
    public async Task Metodo_estatico_publico_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class CalculadorDeTotales
                {
                    public static decimal AplicarDescuento(decimal total, decimal porcentaje)
                    {
                        return total - (total * porcentaje / 100m);
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 31, "Dominio.CalculadorDeTotales.AplicarDescuento"));
    }

    [Fact]
    public async Task Metodo_estatico_privado_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total(decimal subtotal)
                    {
                        return Redondear(subtotal);
                    }

                    private static decimal Redondear(decimal valor)
                    {
                        return decimal.Round(valor, 2);
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(10, 32, "Dominio.Pedido.Redondear"));
    }

    [Fact]
    public async Task Cada_metodo_de_una_clase_estatica_dispara_por_separado()
    {
        const string codigo = """
            namespace Dominio
            {
                public static class Fechas
                {
                    public static int Anio(System.DateTime fecha)
                    {
                        return fecha.Year;
                    }

                    public static int Mes(System.DateTime fecha)
                    {
                        return fecha.Month;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 27, "Dominio.Fechas.Anio"),
            Esperado(10, 27, "Dominio.Fechas.Mes"));
    }

    [Fact]
    public async Task Metodo_estatico_de_struct_y_de_record_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public struct Coordenada
                {
                    public static Coordenada Origen()
                    {
                        return new Coordenada();
                    }
                }

                public record Comprobante(string Tipo)
                {
                    public static Comprobante Factura()
                    {
                        return new Comprobante("A");
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 34, "Dominio.Coordenada.Origen"),
            Esperado(13, 35, "Dominio.Comprobante.Factura"));
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
                        public static Linea Vacia()
                        {
                            return new Linea();
                        }
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(7, 33, "Dominio.Ventas.Pedido.Linea.Vacia"));
    }

    [Fact]
    public async Task Metodo_estatico_parcial_dispara_una_sola_vez()
    {
        const string codigo = """
            namespace Dominio
            {
                public partial class Articulo
                {
                    public static partial string Normalizar(string codigo);
                }

                public partial class Articulo
                {
                    public static partial string Normalizar(string codigo)
                    {
                        return codigo.Trim();
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 38, "Dominio.Articulo.Normalizar"));
    }

    [Fact]
    public async Task Metodo_estatico_abstracto_de_interfaz_y_su_implementacion_disparan()
    {
        const string codigo = """
            namespace Dominio
            {
                public interface IFabrica<T>
                {
                    static abstract T Crear();
                }

                public class Articulo : IFabrica<Articulo>
                {
                    public static Articulo Crear()
                    {
                        return new Articulo();
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 27, "Dominio.IFabrica.Crear"),
            Esperado(10, 32, "Dominio.Articulo.Crear"));
    }

    [Fact]
    public async Task Extension_method_sobre_un_tipo_del_proyecto_dispara()
    {
        // Si el tipo es nuestro, el comportamiento va en el tipo, no en una extensión.
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public static class ExtensionesDePedido
                {
                    public static bool EsGrande(this Pedido pedido)
                    {
                        return pedido.Total > 1000m;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(10, 28, "Dominio.ExtensionesDePedido.EsGrande"));
    }

    [Fact]
    public async Task Extension_method_sobre_un_arreglo_de_un_tipo_del_proyecto_no_dispara()
    {
        // Un arreglo es un tipo de .NET: no se le pueden agregar métodos de instancia,
        // aunque sus elementos sean del proyecto. Mismo criterio que IEnumerable<Pedido>.
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public static class ExtensionesDePedido
                {
                    public static int Cantidad(this Pedido[] pedidos)
                    {
                        return pedidos.Length;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Extension_method_sobre_un_arreglo_de_arreglos_de_un_tipo_del_proyecto_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public static class ExtensionesDePedido
                {
                    public static int Cantidad(this Pedido[][] lotes)
                    {
                        return lotes.Length;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Metodo_estatico_comun_con_un_arreglo_de_un_tipo_del_proyecto_dispara()
    {
        // La excepción es solo para extension methods: sin 'this', el arreglo no cambia nada.
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public static class Calculos
                {
                    public static int Cantidad(Pedido[] pedidos)
                    {
                        return pedidos.Length;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(10, 27, "Dominio.Calculos.Cantidad"));
    }

    [Fact]
    public async Task Extension_method_generico_sin_restricciones_no_dispara()
    {
        // 'this T' sin restricciones no extiende ningún tipo del proyecto en particular.
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public interface IEntidad
                {
                }

                public static class Extensiones
                {
                    public static T Validado<T>(this T valor)
                    {
                        return valor;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Extension_method_generico_con_restricciones_que_no_son_tipos_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public interface IEntidad
                {
                }

                public static class Extensiones
                {
                    public static T Validado<T>(this T valor) where T : class, new()
                    {
                        return valor;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Extension_method_generico_restringido_a_una_clase_del_proyecto_dispara()
    {
        // 'where T : Pedido': el método se podría agregar a Pedido.
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public interface IEntidad
                {
                }

                public static class Extensiones
                {
                    public static T Validado<T>(this T valor) where T : Pedido
                    {
                        return valor;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(14, 25, "Dominio.Extensiones.Validado"));
    }

    [Fact]
    public async Task Extension_method_generico_restringido_a_una_interfaz_del_proyecto_dispara()
    {
        // 'where T : IEntidad': el método se podría agregar a IEntidad (o a quienes la implementan).
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public interface IEntidad
                {
                }

                public static class Extensiones
                {
                    public static T Validado<T>(this T valor) where T : System.IComparable, IEntidad
                    {
                        return valor;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(14, 25, "Dominio.Extensiones.Validado"));
    }

    [Fact]
    public async Task Extension_method_generico_restringido_por_otro_parametro_de_tipo_del_proyecto_dispara()
    {
        // 'where T : U' y 'where U : Pedido': T termina restringido a Pedido.
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public interface IEntidad
                {
                }

                public static class Extensiones
                {
                    public static T Validado<T, U>(this T valor) where T : U where U : Pedido
                    {
                        return valor;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(14, 25, "Dominio.Extensiones.Validado"));
    }

    [Fact]
    public async Task Extension_method_generico_restringido_a_un_tipo_externo_con_argumento_del_proyecto_no_dispara()
    {
        // Se mira el tipo de la restricción (IComparable<T>, de .NET), no sus argumentos:
        // mismo criterio que 'this IEnumerable<Pedido>'.
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public interface IEntidad
                {
                }

                public static class Extensiones
                {
                    public static T Validado<T>(this T valor) where T : System.IComparable<Pedido>
                    {
                        return valor;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Extension_method_sobre_un_arreglo_generico_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public interface IEntidad
                {
                }

                public static class Extensiones
                {
                    public static int Cantidad<T>(this T[] valores) where T : Pedido
                    {
                        return valores.Length;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Extension_method_sobre_una_coleccion_del_proyecto_dispara()
    {
        // Pedidos es del proyecto: el método se le puede agregar, aunque sea una colección.
        // Las colecciones de .NET (IEnumerable<Pedido>, List<Pedido>) no disparan.
        const string codigo = """
            namespace Dominio
            {
                using System.Collections;
                using System.Collections.Generic;

                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public class Pedidos : IEnumerable<Pedido>
                {
                    private readonly List<Pedido> pedidos = new List<Pedido>();

                    public IEnumerator<Pedido> GetEnumerator() => pedidos.GetEnumerator();

                    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
                }

                public static class Extensiones
                {
                    public static int Cantidad(this Pedidos pedidos)
                    {
                        return 0;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(22, 27, "Dominio.Extensiones.Cantidad"));
    }

    [Fact]
    public async Task Extension_method_generico_restringido_a_una_coleccion_del_proyecto_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                using System.Collections;
                using System.Collections.Generic;

                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public class Pedidos : IEnumerable<Pedido>
                {
                    private readonly List<Pedido> pedidos = new List<Pedido>();

                    public IEnumerator<Pedido> GetEnumerator() => pedidos.GetEnumerator();

                    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
                }

                public static class Extensiones
                {
                    public static T Validado<T>(this T pedidos) where T : Pedidos
                    {
                        return pedidos;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(22, 25, "Dominio.Extensiones.Validado"));
    }

    [Fact]
    public async Task Metodo_Main_en_una_biblioteca_dispara()
    {
        // En una biblioteca no hay punto de entrada: un 'Main' es un método estático más.
        const string codigo = """
            namespace Dominio
            {
                public class Programa
                {
                    public static void Main(string[] args)
                    {
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo,
            Esperado(5, 28, "Dominio.Programa.Main"));
    }

    [Fact]
    public async Task Metodo_estatico_auxiliar_de_un_ejecutable_dispara()
    {
        // La excepción es solo para el Main: el resto de los métodos estáticos del
        // ejecutable siguen sujetos a la regla.
        const string codigo = """
            namespace Aplicacion
            {
                public class Programa
                {
                    public static void Main(string[] args)
                    {
                        Configurar();
                    }

                    private static void Configurar()
                    {
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarEjecutableAsync(
            codigo,
            Esperado(10, 29, "Aplicacion.Programa.Configurar"));
    }

    [Fact]
    public async Task Metodo_estatico_de_una_clase_de_tests_que_no_es_fuente_de_datos_dispara()
    {
        // La excepción es para las fuentes de [MemberData], no para cualquier método
        // estático de una clase de tests.
        const string codigo = """
            using System.Collections.Generic;
            using Xunit;

            namespace Tests
            {
                public class PedidoTests
                {
                    [MemberData(nameof(Importes))]
                    public void Calcula(decimal importe)
                    {
                    }

                    public static IEnumerable<object[]> Importes()
                    {
                        yield return new object[] { Redondear(1m) };
                    }

                    private static decimal Redondear(decimal valor)
                    {
                        return decimal.Round(valor, 2);
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(
            codigo + AtributoMemberData,
            Esperado(18, 32, "Tests.PedidoTests.Redondear"));
    }

    // ---------------------------------------------------------------- casos negativos

    [Fact]
    public async Task Metodo_de_instancia_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public class CalculadorDeTotales
                {
                    public decimal AplicarDescuento(decimal total, decimal porcentaje)
                    {
                        return total - (total * porcentaje / 100m);
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Operators_no_disparan()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Importe
                {
                    public Importe(decimal valor)
                    {
                        Valor = valor;
                    }

                    public decimal Valor { get; }

                    public static Importe operator +(Importe izquierda, Importe derecha)
                    {
                        return new Importe(izquierda.Valor + derecha.Valor);
                    }

                    public static bool operator ==(Importe izquierda, Importe derecha)
                    {
                        return Equals(izquierda, derecha);
                    }

                    public static bool operator !=(Importe izquierda, Importe derecha)
                    {
                        return !Equals(izquierda, derecha);
                    }

                    public override bool Equals(object obj)
                    {
                        return obj is Importe otro && otro.Valor == Valor;
                    }

                    public override int GetHashCode()
                    {
                        return Valor.GetHashCode();
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Operators_de_conversion_no_disparan()
    {
        const string codigo = """
            namespace Dominio
            {
                public class Importe
                {
                    public Importe(decimal valor)
                    {
                        Valor = valor;
                    }

                    public decimal Valor { get; }

                    public static implicit operator decimal(Importe importe)
                    {
                        return importe.Valor;
                    }

                    public static explicit operator Importe(decimal valor)
                    {
                        return new Importe(valor);
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Main_punto_de_entrada_no_dispara()
    {
        const string codigo = """
            namespace Aplicacion
            {
                public class Programa
                {
                    public static void Main(string[] args)
                    {
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarEjecutableAsync(codigo);
    }

    [Fact]
    public async Task Main_asincronico_punto_de_entrada_no_dispara()
    {
        const string codigo = """
            using System.Threading.Tasks;

            namespace Aplicacion
            {
                public class Programa
                {
                    public static async Task<int> Main(string[] args)
                    {
                        await Task.Yield();
                        return 0;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarEjecutableAsync(codigo);
    }

    [Fact]
    public async Task Top_level_statements_no_disparan()
    {
        // El compilador genera un Main estático implícito: no está escrito en el código.
        const string codigo = """
            System.Console.WriteLine("Hola");
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarEjecutableAsync(codigo);
    }

    [Fact]
    public async Task Extension_method_sobre_un_tipo_del_framework_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public static class ExtensionesDeTexto
                {
                    public static string Recortado(this string texto)
                    {
                        return texto.Trim();
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Extension_method_sobre_una_interfaz_externa_de_tipos_del_proyecto_no_dispara()
    {
        // El tipo extendido es IEnumerable<T>, que no es del proyecto, aunque el
        // argumento de tipo sí lo sea.
        const string codigo = """
            using System.Collections.Generic;
            using System.Linq;

            namespace Dominio
            {
                public class Pedido
                {
                    public decimal Total { get; set; }
                }

                public static class ExtensionesDePedidos
                {
                    public static decimal SumaDeTotales(this IEnumerable<Pedido> pedidos)
                    {
                        return pedidos.Sum(pedido => pedido.Total);
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Extension_method_sobre_un_tipo_nullable_del_framework_no_dispara()
    {
        const string codigo = """
            namespace Dominio
            {
                public static class ExtensionesDeDecimal
                {
                    public static decimal OCero(this decimal? valor)
                    {
                        return valor ?? 0m;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Otros_miembros_estaticos_no_disparan()
    {
        // La regla es sobre métodos: properties, campos y constructores estáticos
        // quedan fuera.
        const string codigo = """
            namespace Dominio
            {
                public class Configuracion
                {
                    private static readonly int reintentosPorDefecto;

                    static Configuracion()
                    {
                        reintentosPorDefecto = 3;
                    }

                    public static int Reintentos { get; set; }

                    public int Leer()
                    {
                        return reintentosPorDefecto + Reintentos;
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Funciones_locales_y_lambdas_estaticas_no_disparan()
    {
        // No son métodos del tipo: viven dentro de un método de instancia.
        const string codigo = """
            using System;

            namespace Dominio
            {
                public class Calculador
                {
                    public int Calcular(int valor)
                    {
                        Func<int, int> doble = static x => x * 2;

                        return doble(Incrementar(valor));

                        static int Incrementar(int x)
                        {
                            return x + 1;
                        }
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo);
    }

    [Fact]
    public async Task Fuente_de_datos_de_MemberData_no_dispara()
    {
        const string codigo = """
            using System.Collections.Generic;
            using Xunit;

            namespace Tests
            {
                public class PedidoTests
                {
                    [MemberData(nameof(Importes))]
                    public void Calcula(decimal importe)
                    {
                    }

                    public static IEnumerable<object[]> Importes()
                    {
                        yield return new object[] { 1m };
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo + AtributoMemberData);
    }

    [Fact]
    public async Task Fuente_de_datos_de_MemberData_con_el_nombre_como_texto_no_dispara()
    {
        const string codigo = """
            using System.Collections.Generic;
            using Xunit;

            namespace Tests
            {
                public class PedidoTests
                {
                    [MemberData("Importes")]
                    public void Calcula(decimal importe)
                    {
                    }

                    public static IEnumerable<object[]> Importes()
                    {
                        yield return new object[] { 1m };
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo + AtributoMemberData);
    }

    [Fact]
    public async Task Fuente_de_datos_de_MemberData_con_parametros_no_dispara()
    {
        const string codigo = """
            using System.Collections.Generic;
            using Xunit;

            namespace Tests
            {
                public class PedidoTests
                {
                    [MemberData(nameof(Importes), 3)]
                    public void Calcula(decimal importe)
                    {
                    }

                    public static IEnumerable<object[]> Importes(int cantidad)
                    {
                        for (int i = 0; i < cantidad; i++)
                        {
                            yield return new object[] { (decimal)i };
                        }
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo + AtributoMemberData);
    }

    [Fact]
    public async Task Fuente_de_datos_en_otra_clase_indicada_con_MemberType_no_dispara()
    {
        const string codigo = """
            using System.Collections.Generic;
            using Xunit;

            namespace Tests
            {
                public class DatosDePedido
                {
                    public static IEnumerable<object[]> Importes()
                    {
                        yield return new object[] { 1m };
                    }
                }

                public class PedidoTests
                {
                    [MemberData(nameof(DatosDePedido.Importes), MemberType = typeof(DatosDePedido))]
                    public void Calcula(decimal importe)
                    {
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo + AtributoMemberData);
    }

    [Fact]
    public async Task Fuente_de_datos_heredada_de_una_clase_base_no_dispara()
    {
        // Sin MemberType, xUnit busca el miembro en la clase del test y en sus bases.
        const string codigo = """
            using System.Collections.Generic;
            using Xunit;

            namespace Tests
            {
                public abstract class TestsConDatos
                {
                    public static IEnumerable<object[]> Importes()
                    {
                        yield return new object[] { 1m };
                    }
                }

                public class PedidoTests : TestsConDatos
                {
                    [MemberData(nameof(Importes))]
                    public void Calcula(decimal importe)
                    {
                    }
                }
            }
            """;

        await Verificador<MetodoEstaticoAnalyzer>.VerificarAsync(codigo + AtributoMemberData);
    }
}
