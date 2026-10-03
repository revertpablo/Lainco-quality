using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Lainco.Analyzers.Reglas;

/// <summary>
/// LAIN999 — REGLA TEMPORAL DEL SPIKE DE LA FASE 2. **No es una regla del catálogo.**
///
/// Existe solo para responder una pregunta: ¿SonarQube Cloud importa los issues
/// externos que nacen dentro de un proyecto de test? De eso depende el diseño de
/// LAIN003, que reporta sobre la ausencia de un test.
///
/// Dispara sobre cualquier tipo cuyo nombre termine en "Tests". La sample tiene uno en
/// el proyecto de tests y otro, puesto a propósito, en el proyecto de dominio: así la
/// misma regla produce un issue a cada lado del límite y se puede comparar cuál llega.
///
/// Se elimina al cerrar el spike, junto con su fila en AnalyzerReleases.Unshipped.md.
/// El ID LAIN999 queda quemado y no se reutiliza.
/// </summary>
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class SpikeIssuesEnTestsAnalyzer : DiagnosticAnalyzer
{
    /// <summary>ID de la regla temporal del spike.</summary>
    public const string Id = "LAIN999";

    private static readonly DiagnosticDescriptor Descriptor = new DiagnosticDescriptor(
        id: Id,
        title: "Spike: issue de prueba para medir la importación desde proyectos de test",
        messageFormat: "SPIKE LAIN999: el tipo '{0}' fue detectado por la regla temporal del spike",
        category: Categorias.Diseno,
        defaultSeverity: DiagnosticSeverity.Warning,
        isEnabledByDefault: true,
        description: "Regla temporal de la Fase 2. Se elimina al cerrar el spike.",
        helpLinkUri: Ayuda.Para(Id));

    /// <summary>Diagnósticos que produce este analyzer.</summary>
    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
        ImmutableArray.Create(Descriptor);

    /// <summary>Registra la acción sobre cada declaración de tipo.</summary>
    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();

        context.RegisterSyntaxNodeAction(Analizar, SyntaxKind.ClassDeclaration);
    }

    private static void Analizar(SyntaxNodeAnalysisContext context)
    {
        ClassDeclarationSyntax declaracion = (ClassDeclarationSyntax)context.Node;

        if (!declaracion.Identifier.ValueText.EndsWith("Tests"))
        {
            return;
        }

        if (context.SemanticModel.GetDeclaredSymbol(declaracion, context.CancellationToken)
            is not INamedTypeSymbol tipo)
        {
            return;
        }

        context.ReportDiagnostic(Diagnostic.Create(
            Descriptor,
            declaracion.Identifier.GetLocation(),
            Simbolos.NombreCompleto(tipo)));
    }
}
