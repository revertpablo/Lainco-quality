using System;
using System.Collections.Immutable;
using System.Globalization;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Text;

namespace Lainco.Analyzers.Suppressor;

/// <summary>
/// Oculta los diagnósticos LAIN que los revisores aceptaron o marcaron como falso positivo
/// en SonarQube (Fase 4, tarea 3).
///
/// Lee <c>sonar-accepted.json</c>, que genera <c>tools/sonar-sync</c> y que el .targets
/// del paquete agrega como <c>AdditionalFiles</c>. Un diagnóstico se suprime si coincide
/// con un issue del archivo en <b>archivo + regla + mensaje</b>. No se usa la línea: el
/// mensaje lleva el nombre completamente calificado del símbolo, así que el issue se
/// reconoce aunque el código se mueva.
///
/// Si el archivo no está, no se puede leer o es de otra versión del formato, no se suprime
/// nada: el programador ve todos los issues, que es lo seguro.
/// </summary>
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class SupresorDeAceptados : DiagnosticSuppressor
{
    /// <summary>Nombre del archivo de aceptados entre los <c>AdditionalFiles</c>.</summary>
    public const string NombreDelArchivo = "sonar-accepted.json";

    /// <summary>
    /// Raíz del análisis de Sonar, contra la que se calculan las rutas relativas. La pasa
    /// el .targets del paquete con <c>CompilerVisibleProperty</c>. Si no está, se usa la
    /// carpeta del archivo de aceptados.
    /// </summary>
    public const string PropiedadRaiz = "build_property.LaincoSonarRaiz";

    /// <summary>
    /// Reglas que el suppressor puede ocultar. Roslyn exige declarar de antemano cada ID
    /// suprimible: una regla nueva se agrega acá (un test verifica que no falte ninguna).
    /// </summary>
    private static readonly string[] Reglas =
    {
        "LAIN001", "LAIN002", "LAIN003", "LAIN004", "LAIN005", "LAIN006",
    };

    private static readonly ImmutableDictionary<string, SuppressionDescriptor> SupresionPorRegla =
        Reglas.ToImmutableDictionary(
            regla => regla,
            regla => new SuppressionDescriptor(
                id: "LAINS" + regla.Substring("LAIN".Length),
                suppressedDiagnosticId: regla,
                justification: "Issue aceptado o marcado como falso positivo en SonarQube por un revisor."));

    // El archivo se lee una vez por versión de su contenido: el IDE pide supresiones
    // muchas veces por compilación, y entre compilaciones reutiliza el mismo SourceText
    // mientras el archivo no cambie.
    private static readonly ConditionalWeakTable<SourceText, Lectura> Leidos = new();

    /// <summary>Supresiones que puede reportar: una por regla LAIN.</summary>
    public override ImmutableArray<SuppressionDescriptor> SupportedSuppressions { get; } =
        SupresionPorRegla.Values.ToImmutableArray();

    /// <summary>Suprime los diagnósticos LAIN que coinciden con un issue aceptado.</summary>
    public override void ReportSuppressions(SuppressionAnalysisContext context)
    {
        AdditionalText? texto = context.Options.AdditionalFiles.FirstOrDefault(archivo =>
            string.Equals(Rutas.NombreDeArchivo(archivo.Path), NombreDelArchivo, StringComparison.OrdinalIgnoreCase));

        if (texto == null)
        {
            return;
        }

        ArchivoDeAceptados? aceptados = Leer(texto, context.CancellationToken);
        if (aceptados == null || aceptados.EstaVacio)
        {
            return;
        }

        string raiz =
            context.Options.AnalyzerConfigOptionsProvider.GlobalOptions.TryGetValue(PropiedadRaiz, out string? indicada)
            && !string.IsNullOrWhiteSpace(indicada)
                ? indicada
                : Rutas.Carpeta(texto.Path);

        foreach (Diagnostic diagnostico in context.ReportedDiagnostics)
        {
            if (!SupresionPorRegla.TryGetValue(diagnostico.Id, out SuppressionDescriptor? supresion))
            {
                continue;
            }

            string? archivo = diagnostico.Location.SourceTree?.FilePath;
            if (string.IsNullOrEmpty(archivo))
            {
                continue;
            }

            string? relativa = Rutas.Relativa(archivo!, raiz);
            if (relativa == null)
            {
                continue;
            }

            string mensaje = diagnostico.GetMessage(CultureInfo.InvariantCulture);

            if (aceptados.Contiene(relativa, diagnostico.Id, mensaje))
            {
                context.ReportSuppression(Suppression.Create(supresion, diagnostico));
            }
        }
    }

    private static ArchivoDeAceptados? Leer(AdditionalText texto, CancellationToken cancelacion)
    {
        SourceText? contenido = texto.GetText(cancelacion);
        if (contenido == null)
        {
            return null;
        }

        return Leidos.GetValue(contenido, leido => new Lectura(ArchivoDeAceptados.Leer(leido.ToString()))).Archivo;
    }

    /// <summary>Envoltorio para poder guardar en el cache también un archivo que no se pudo leer.</summary>
    private sealed class Lectura
    {
        public Lectura(ArchivoDeAceptados? archivo)
        {
            Archivo = archivo;
        }

        public ArchivoDeAceptados? Archivo { get; }
    }
}
