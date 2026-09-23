using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Lainco.Analyzers.Reglas;

/// <summary>
/// LAIN004: no se permite inicialización inline de properties.
///
/// El valor inicial de una property se fija en el constructor, donde se ve junto con
/// el resto de la inicialización del objeto y puede depender de los parámetros.
/// </summary>
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class InicializacionInlineDePropertyAnalyzer : DiagnosticAnalyzer
{
    /// <summary>ID de la regla. Nunca se reutiliza, aunque la regla se elimine.</summary>
    public const string Id = "LAIN004";

    private static readonly DiagnosticDescriptor Descriptor = new DiagnosticDescriptor(
        id: Id,
        title: "No se permite inicialización inline de properties",
        messageFormat: "La property '{0}' no debe inicializarse en la declaración",
        category: Categorias.Diseno,
        defaultSeverity: DiagnosticSeverity.Warning,
        isEnabledByDefault: true,
        description: "El valor inicial de una property debe asignarse en el constructor, " +
                     "no en su declaración.",
        helpLinkUri: Ayuda.Para(Id));

    /// <summary>Diagnósticos que produce este analyzer.</summary>
    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
        ImmutableArray.Create(Descriptor);

    /// <summary>Registra la acción sobre cada declaración de property.</summary>
    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();

        context.RegisterSyntaxNodeAction(Analizar, SyntaxKind.PropertyDeclaration);
    }

    private static void Analizar(SyntaxNodeAnalysisContext context)
    {
        PropertyDeclarationSyntax declaracion = (PropertyDeclarationSyntax)context.Node;

        // Solo interesa la inicialización con '='. Las properties con cuerpo de
        // expresión ('=> ...') no inicializan: calculan en cada lectura.
        if (declaracion.Initializer == null)
        {
            return;
        }

        if (context.SemanticModel.GetDeclaredSymbol(declaracion, context.CancellationToken)
            is not IPropertySymbol property)
        {
            return;
        }

        context.ReportDiagnostic(Diagnostic.Create(
            Descriptor,
            declaracion.Identifier.GetLocation(),
            Simbolos.NombreCompleto(property)));
    }
}
