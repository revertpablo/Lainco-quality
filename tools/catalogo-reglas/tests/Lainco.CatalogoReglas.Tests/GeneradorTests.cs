using Microsoft.CodeAnalysis;
using static Lainco.CatalogoReglas.Tests.Descriptores;

namespace Lainco.CatalogoReglas.Tests;

public class GeneradorTests
{
    private static EntradaDelCatalogo Entrada(
        IEnumerable<DiagnosticDescriptor> descriptores,
        IEnumerable<string>? enReleases = null,
        IReadOnlyDictionary<string, string>? documentacion = null)
    {
        DiagnosticDescriptor[] lista = descriptores.ToArray();
        return new EntradaDelCatalogo(
            Paquete: "Lainco.Analyzers",
            Version: "0.1.0",
            Descriptores: lista,
            ReglasEnReleases: (enReleases ?? lista.Select(d => d.Id)).ToHashSet(),
            Documentacion: id => documentacion is null
                ? $"# {id}\n\nDocumentación de {id}.\n"
                : documentacion.GetValueOrDefault(id));
    }

    [Fact]
    public void Arma_el_catalogo_con_los_datos_del_descriptor_y_su_documentacion()
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(
            new[]
            {
                Regla("LAIN005", titulo: "No se permiten métodos estáticos", descripcion: "Los estáticos atan.", categoria: "Diseño"),
                Regla("LAIN004", titulo: "Sin inicialización inline", severidad: DiagnosticSeverity.Info),
            },
            documentacion: new Dictionary<string, string>
            {
                ["LAIN004"] = "# LAIN004\r\n\r\nTexto.\r\n",
                ["LAIN005"] = "# LAIN005\n",
            }));

        Assert.Empty(resultado.Errores);
        Catalogo catalogo = resultado.Catalogo!;
        Assert.Equal(Catalogo.FormatoActual, catalogo.Formato);
        Assert.Equal("roslyn", catalogo.Origen);
        Assert.Equal("Lainco.Analyzers", catalogo.Paquete);
        Assert.Equal("0.1.0", catalogo.Version);
        Assert.Equal("cs", catalogo.Lenguaje);

        // Ordenadas por ID.
        Assert.Equal(new[] { "LAIN004", "LAIN005" }, catalogo.Reglas.Select(r => r.Clave));

        ReglaDelCatalogo lain004 = catalogo.Reglas[0];
        Assert.Equal("suggestion", lain004.SeveridadPorDefecto);
        Assert.False(lain004.HabilitadaPorDefecto);
        // La documentación queda con finales de línea de Unix, la genere Windows o Linux.
        Assert.Equal("# LAIN004\n\nTexto.\n", lain004.Documentacion);

        ReglaDelCatalogo lain005 = catalogo.Reglas[1];
        Assert.Equal("No se permiten métodos estáticos", lain005.Titulo);
        Assert.Equal("Los estáticos atan.", lain005.Descripcion);
        Assert.Equal("Diseño", lain005.Categoria);
        Assert.Equal("warning", lain005.SeveridadPorDefecto);
        Assert.False(lain005.HabilitadaPorDefecto);
        Assert.Equal("https://github.com/revertpablo/Lainco-quality/blob/main/docs/rules/LAIN005.md", lain005.Ayuda);
    }

    [Fact]
    public void Las_severidades_usan_las_palabras_del_globalconfig()
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(new[]
        {
            Regla("LAIN001", severidad: DiagnosticSeverity.Hidden),
            Regla("LAIN002", severidad: DiagnosticSeverity.Info),
            Regla("LAIN003", severidad: DiagnosticSeverity.Warning),
        }));

        Assert.Equal(new[] { "silent", "suggestion", "warning" }, resultado.Catalogo!.Reglas.Select(r => r.SeveridadPorDefecto));
    }

    [Fact]
    public void Una_descripcion_vacia_queda_en_null()
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(new[] { Regla("LAIN004", descripcion: "  ") }));

        Assert.Null(resultado.Catalogo!.Reglas[0].Descripcion);
    }

    [Fact]
    public void Un_descriptor_repetido_por_dos_analyzers_aparece_una_vez()
    {
        DiagnosticDescriptor lain004 = Regla("LAIN004");

        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(new[] { lain004, Regla("LAIN004") }));

        Assert.Single(resultado.Catalogo!.Reglas);
    }

    [Fact]
    public void Un_mismo_ID_con_dos_descriptores_distintos_falla()
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(new[] { Regla("LAIN004", titulo: "Uno"), Regla("LAIN004", titulo: "Otro") }));

        Assert.Null(resultado.Catalogo);
        Assert.Contains(resultado.Errores, e => e.Contains("LAIN004") && e.Contains("dos descriptores"));
    }

    [Theory]
    [InlineData("LAIN04")]
    [InlineData("LAIN0004")]
    [InlineData("lain004")]
    [InlineData("CA1822")]
    public void Un_ID_que_no_es_LAIN_y_tres_digitos_falla(string id)
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(new[] { Regla(id) }));

        Assert.Null(resultado.Catalogo);
        Assert.Contains(resultado.Errores, e => e.Contains($"'{id}'") && e.Contains("LAIN###"));
    }

    [Fact]
    public void Una_regla_sin_documentacion_falla()
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(
            new[] { Regla("LAIN004"), Regla("LAIN005") },
            documentacion: new Dictionary<string, string> { ["LAIN004"] = "# LAIN004\n" }));

        Assert.Null(resultado.Catalogo);
        Assert.Equal(new[] { "LAIN005: falta la documentación en docs/rules/LAIN005.md." }, resultado.Errores);
    }

    [Fact]
    public void Una_regla_que_no_esta_en_AnalyzerReleases_falla()
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(new[] { Regla("LAIN004"), Regla("LAIN006") }, enReleases: new[] { "LAIN004" }));

        Assert.Null(resultado.Catalogo);
        Assert.Contains(resultado.Errores, e => e.StartsWith("LAIN006:") && e.Contains("AnalyzerReleases"));
    }

    [Fact]
    public void Una_regla_con_severidad_error_falla()
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(new[] { Regla("LAIN004", severidad: DiagnosticSeverity.Error) }));

        Assert.Null(resultado.Catalogo);
        Assert.Contains(resultado.Errores, e => e.StartsWith("LAIN004:") && e.Contains("'error'"));
    }

    [Fact]
    public void Una_regla_habilitada_por_defecto_falla()
    {
        // Decisión R6 (entrega 6.4): las reglas propias nacen apagadas; las enciende el
        // .globalconfig cuando se incorporan en la app.
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(new[] { Regla("LAIN004", habilitada: true) }));

        Assert.Null(resultado.Catalogo);
        Assert.Contains(resultado.Errores, e => e.StartsWith("LAIN004:") && e.Contains("isEnabledByDefault: false"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("https://github.com/revertpablo/Lainco-quality/blob/main/docs/rules/LAIN005.md")]
    [InlineData("https://ejemplo.com/LAIN004")]
    public void Un_link_de_ayuda_que_no_lleva_a_su_documentacion_falla(string ayuda)
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(new[] { Regla("LAIN004", ayuda: ayuda) }));

        Assert.Null(resultado.Catalogo);
        Assert.Contains(resultado.Errores, e => e.StartsWith("LAIN004:") && e.Contains("docs/rules/LAIN004.md"));
    }

    [Fact]
    public void Un_titulo_vacio_falla()
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(new[] { Regla("LAIN004", titulo: "") }));

        Assert.Null(resultado.Catalogo);
        Assert.Contains(resultado.Errores, e => e.StartsWith("LAIN004:") && e.Contains("título"));
    }

    [Fact]
    public void Sin_reglas_falla()
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(Array.Empty<DiagnosticDescriptor>()));

        Assert.Null(resultado.Catalogo);
        Assert.Contains(resultado.Errores, e => e.Contains("ninguna regla"));
    }

    [Fact]
    public void Junta_todos_los_errores_en_lugar_de_parar_en_el_primero()
    {
        ResultadoDelCatalogo resultado = Generador.Generar(Entrada(
            new[] { Regla("LAIN004", severidad: DiagnosticSeverity.Error), Regla("LAIN005") },
            enReleases: new[] { "LAIN004" },
            documentacion: new Dictionary<string, string>()));

        Assert.Equal(4, resultado.Errores.Count);
    }
}
