using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Lainco.Analyzers.Reglas;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Testing;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Testing;
using Xunit;

namespace Lainco.Analyzers.Tests;

/// <summary>
/// La base del paquete (Fase 8) apaga todo lo que el compilador puede informar como
/// advertencia, y el .globalconfig de las reglas enciende solo lo incorporado. La base son
/// dos archivos: Lainco.Analyzers.Base.globalconfig (analyzers) y
/// Lainco.Analyzers.Base.Compilador.globalconfig (CS####), que con LaincoCompiladorEnLocal
/// queda afuera en los builds locales. Estos tests usan los archivos reales y un
/// .globalconfig de reglas armado en el test, con el mismo nombre que en el paquete
/// (global_level 0).
/// </summary>
public class BaseGlobalconfigTests
{
    private const string Base = "Lainco.Analyzers.Base.globalconfig";
    private const string BaseDelCompilador = "Lainco.Analyzers.Base.Compilador.globalconfig";

    private const string CodigoConAdvertencias = """
        #nullable enable
        namespace Dominio
        {
            public class Articulo
            {
                public string Descripcion { get; set; } = "sin descripción";

                public string Nombre { get; set; }

                public void Calcular()
                {
                    int sinUso;
                }
            }
        }
        """;

    [Fact]
    public void La_base_apaga_todas_las_advertencias_del_compilador()
    {
        // ErrorCode es interno de Roslyn: los WRN_ son las advertencias del compilador, y
        // su valor es el número del CS####.
        Type errorCode = typeof(CSharpCompilation).Assembly.GetType("Microsoft.CodeAnalysis.CSharp.ErrorCode", throwOnError: true)!;
        IEnumerable<string> advertencias = Enum.GetNames(errorCode)
            .Where(nombre => nombre.StartsWith("WRN_", StringComparison.Ordinal))
            .Select(nombre => $"CS{(int)Enum.Parse(errorCode, nombre):D4}")
            .Distinct();

        HashSet<string> apagadas = Apagadas(BaseDelCompilador);

        string[] faltan = advertencias.Where(id => !apagadas.Contains(id)).OrderBy(id => id).ToArray();
        Assert.True(
            faltan.Length == 0,
            $"{BaseDelCompilador} no apaga estas advertencias del compilador: {string.Join(", ", faltan)}. Agregarlas con severidad 'none'.");
    }

    [Fact]
    public void La_base_apaga_los_analyzers_en_bloque_y_tiene_menos_prioridad_que_las_reglas()
    {
        string[] lineas = Lineas(Base);

        Assert.Contains("dotnet_analyzer_diagnostic.severity = none", lineas);
        Assert.Empty(Apagadas(Base));
        SoloApagaConMenosPrioridad(lineas);
    }

    [Fact]
    public void La_base_del_compilador_solo_apaga_advertencias_del_compilador()
    {
        string[] lineas = Lineas(BaseDelCompilador);

        Assert.DoesNotContain(lineas, linea => linea.StartsWith("dotnet_analyzer_diagnostic", StringComparison.Ordinal));
        Assert.All(Apagadas(BaseDelCompilador), id => Assert.StartsWith("CS", id, StringComparison.Ordinal));
        SoloApagaConMenosPrioridad(lineas);
    }

    private static void SoloApagaConMenosPrioridad(string[] lineas)
    {
        Assert.Contains("is_global = true", lineas);
        Assert.Contains("global_level = -1", lineas);
        Regex severidad = new(@"\.severity\s*=\s*(?<valor>\S+)$");
        Assert.All(
            lineas.Select(linea => severidad.Match(linea)).Where(coincidencia => coincidencia.Success),
            coincidencia => Assert.Equal("none", coincidencia.Groups["valor"].Value));
    }

    [Fact]
    public async Task Con_la_base_solo_aparecen_las_reglas_encendidas()
    {
        // Descripcion: LAIN004, encendida por el .globalconfig de las reglas.
        // Nombre (CS8618) y sinUso (CS0168): advertencias del compilador, apagadas por la base.
        await VerificarAsync<InicializacionInlineDePropertyAnalyzer>(
            ReglasEncendidas("LAIN004"),
            Verificador<InicializacionInlineDePropertyAnalyzer>
                .Diagnostico(InicializacionInlineDePropertyAnalyzer.Id)
                .WithLocation(6, 23)
                .WithArguments("Dominio.Articulo.Descripcion"));
    }

    [Fact]
    public async Task Sin_reglas_encendidas_no_aparece_nada()
    {
        await VerificarAsync<MetodoEstaticoAnalyzer>("is_global = true\n");
    }

    [Fact]
    public async Task Sin_la_base_del_compilador_sus_advertencias_aparecen_y_los_analyzers_siguen_apagados()
    {
        // Un build local con LaincoCompiladorEnLocal=true: el .props deja afuera la base del
        // compilador. LAIN005 corre (es el analyzer del test) y sigue sin aparecer.
        await VerificarAsync<MetodoEstaticoAnalyzer>(
            "is_global = true\n",
            incluirBaseDelCompilador: false,
            DiagnosticResult.CompilerWarning("CS1591").WithLocation(4, 18),
            DiagnosticResult.CompilerWarning("CS1591").WithLocation(6, 23),
            DiagnosticResult.CompilerWarning("CS1591").WithLocation(8, 23),
            DiagnosticResult.CompilerWarning("CS8618").WithSpan(8, 23, 8, 29).WithSpan(8, 23, 8, 29),
            DiagnosticResult.CompilerWarning("CS1591").WithLocation(10, 21),
            DiagnosticResult.CompilerWarning("CS0168").WithLocation(12, 17));
    }

    [Fact]
    public async Task Las_reglas_pueden_encender_una_advertencia_del_compilador()
    {
        // La app puede incorporar un CS#### (Fase 8): su severidad por ID le gana a la base.
        await VerificarAsync<MetodoEstaticoAnalyzer>(
            ReglasEncendidas("CS0168"),
            DiagnosticResult.CompilerWarning("CS0168").WithLocation(12, 17));
    }

    /// <summary>Un .globalconfig de reglas como el que genera la app, con las claves dadas en 'warning'.</summary>
    private static string ReglasEncendidas(params string[] ids)
    {
        return "is_global = true\n" + string.Concat(ids.Select(id => $"dotnet_diagnostic.{id}.severity = warning\n"));
    }

    /// <summary>
    /// Compila <see cref="CodigoConAdvertencias"/> con la base y las reglas dadas, y verifica
    /// los diagnósticos, incluidas las advertencias del compilador.
    /// </summary>
    /// <remarks>
    /// El framework enciende por línea de comandos todas las reglas del analyzer que prueba,
    /// aunque nazcan apagadas, y eso les gana a los .globalconfig. Por eso los casos que no
    /// esperan LAIN004 usan un analyzer que no dispara en este código (LAIN005: no hay
    /// métodos estáticos).
    /// </remarks>
    private static Task VerificarAsync<TAnalyzer>(string reglas, params DiagnosticResult[] esperados)
        where TAnalyzer : DiagnosticAnalyzer, new()
    {
        return VerificarAsync<TAnalyzer>(reglas, incluirBaseDelCompilador: true, esperados);
    }

    private static async Task VerificarAsync<TAnalyzer>(string reglas, bool incluirBaseDelCompilador, params DiagnosticResult[] esperados)
        where TAnalyzer : DiagnosticAnalyzer, new()
    {
        CSharpAnalyzerTest<TAnalyzer, DefaultVerifier> test = new()
        {
            TestCode = CodigoConAdvertencias,
            ReferenceAssemblies = ReferenceAssemblies.Net.Net80,

            // Sin esto el framework ignora las advertencias del compilador, que es justo lo
            // que hay que ver.
            CompilerDiagnostics = CompilerDiagnostics.Warnings,
        };

        test.TestState.AnalyzerConfigFiles.Add(("/" + Base, File.ReadAllText(Ruta(Base))));
        if (incluirBaseDelCompilador)
        {
            test.TestState.AnalyzerConfigFiles.Add(("/" + BaseDelCompilador, File.ReadAllText(Ruta(BaseDelCompilador))));
        }

        test.TestState.AnalyzerConfigFiles.Add(("/Lainco.Analyzers.globalconfig", reglas));
        test.ExpectedDiagnostics.AddRange(esperados);

        await test.RunAsync();
    }

    /// <summary>Los IDs que el archivo pone en 'none' uno por uno.</summary>
    private static HashSet<string> Apagadas(string archivo)
    {
        Regex apagada = new(@"^dotnet_diagnostic\.(?<id>[A-Z]+[0-9]+)\.severity\s*=\s*none$");
        return Lineas(archivo)
            .Select(linea => apagada.Match(linea))
            .Where(coincidencia => coincidencia.Success)
            .Select(coincidencia => coincidencia.Groups["id"].Value)
            .ToHashSet(StringComparer.Ordinal);
    }

    private static string[] Lineas(string archivo)
    {
        return File.ReadAllLines(Ruta(archivo))
            .Select(linea => linea.Trim())
            .Where(linea => linea.Length > 0 && !linea.StartsWith('#'))
            .ToArray();
    }

    /// <summary>El archivo real del paquete, copiado a la salida de los tests (ver el .csproj).</summary>
    private static string Ruta(string archivo)
    {
        return Path.Combine(AppContext.BaseDirectory, archivo);
    }
}
