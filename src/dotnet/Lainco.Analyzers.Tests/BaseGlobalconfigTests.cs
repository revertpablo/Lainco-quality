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
/// La base del paquete (Lainco.Analyzers.Base.globalconfig, Fase 8) apaga todo lo que el
/// compilador puede informar como advertencia, y el .globalconfig de las reglas enciende
/// solo lo incorporado. Estos tests usan el archivo real de la base y un .globalconfig de
/// reglas armado en el test, con el mismo nombre que en el paquete (global_level 0).
/// </summary>
public class BaseGlobalconfigTests
{
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

        HashSet<string> apagadas = ApagadasEnLaBase();

        string[] faltan = advertencias.Where(id => !apagadas.Contains(id)).OrderBy(id => id).ToArray();
        Assert.True(
            faltan.Length == 0,
            $"Lainco.Analyzers.Base.globalconfig no apaga estas advertencias del compilador: {string.Join(", ", faltan)}. Agregarlas con severidad 'none'.");
    }

    [Fact]
    public void La_base_apaga_los_analyzers_en_bloque_y_tiene_menos_prioridad_que_las_reglas()
    {
        string[] lineas = LineasDeLaBase();

        Assert.Contains("is_global = true", lineas);
        Assert.Contains("global_level = -1", lineas);
        Assert.Contains("dotnet_analyzer_diagnostic.severity = none", lineas);
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
    private static async Task VerificarAsync<TAnalyzer>(string reglas, params DiagnosticResult[] esperados)
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

        test.TestState.AnalyzerConfigFiles.Add(("/Lainco.Analyzers.Base.globalconfig", File.ReadAllText(RutaDeLaBase())));
        test.TestState.AnalyzerConfigFiles.Add(("/Lainco.Analyzers.globalconfig", reglas));
        test.ExpectedDiagnostics.AddRange(esperados);

        await test.RunAsync();
    }

    private static HashSet<string> ApagadasEnLaBase()
    {
        Regex apagada = new(@"^dotnet_diagnostic\.(?<id>[A-Z]+[0-9]+)\.severity\s*=\s*none$");
        return LineasDeLaBase()
            .Select(linea => apagada.Match(linea))
            .Where(coincidencia => coincidencia.Success)
            .Select(coincidencia => coincidencia.Groups["id"].Value)
            .ToHashSet(StringComparer.Ordinal);
    }

    private static string[] LineasDeLaBase()
    {
        return File.ReadAllLines(RutaDeLaBase())
            .Select(linea => linea.Trim())
            .Where(linea => linea.Length > 0 && !linea.StartsWith('#'))
            .ToArray();
    }

    /// <summary>El archivo real del paquete, copiado a la salida de los tests (ver el .csproj).</summary>
    private static string RutaDeLaBase()
    {
        return Path.Combine(AppContext.BaseDirectory, "Lainco.Analyzers.Base.globalconfig");
    }
}
