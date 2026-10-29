using System.Collections.Immutable;
using System.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Lainco.Analyzers.Reglas;

/// <summary>
/// LAIN001: el constructor sin parámetros debe ser <c>protected</c>, salvo que sea el
/// único constructor del tipo. Las entidades (<c>Lainco.Domain.IEntity</c>) que declaran
/// constructores tienen que tener uno sin parámetros.
///
/// Cuando un tipo tiene un constructor con parámetros, ese es el que deja el objeto en un
/// estado válido. El constructor sin parámetros queda para NHibernate (que lo usa desde el
/// proxy, una subclase) y no debe estar al alcance del resto del código. Una entidad lo
/// necesita siempre, porque NHibernate la materializa con él.
/// </summary>
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class ConstructorSinParametrosAnalyzer : DiagnosticAnalyzer
{
    /// <summary>ID de la regla. Nunca se reutiliza, aunque la regla se elimine.</summary>
    public const string Id = "LAIN001";

    /// <summary>La interfaz que marca a las entidades de NHibernate.</summary>
    public const string InterfazDeEntidad = "Lainco.Domain.IEntity";

    private const string Titulo = "El constructor sin parámetros debe ser protected si el tipo tiene otros constructores";

    private const string Descripcion =
        "Si un tipo tiene más de un constructor, el constructor sin parámetros debe ser " +
        "protected: los objetos se crean con los constructores que reciben sus datos. Una " +
        "entidad (Lainco.Domain.IEntity) que declara constructores tiene que tener uno sin " +
        "parámetros protected, que es el que usa NHibernate.";

    private static readonly DiagnosticDescriptor Descriptor = new DiagnosticDescriptor(
        id: Id,
        title: Titulo,
        messageFormat: "El constructor sin parámetros de '{0}' debe ser protected, porque el tipo tiene otros constructores",
        category: Categorias.Diseno,
        defaultSeverity: DiagnosticSeverity.Warning,
        // Nace apagada (decisión R6, entrega 6.4): la enciende el .globalconfig del paquete
        // cuando la regla se incorpora en la app de catálogo.
        isEnabledByDefault: false,
        description: Descripcion,
        helpLinkUri: Ayuda.Para(Id));

    // Misma regla, otro mensaje: la entidad no tiene constructor sin parámetros.
    private static readonly DiagnosticDescriptor DescriptorEntidadSinConstructor = new DiagnosticDescriptor(
        id: Id,
        title: Titulo,
        messageFormat: "La entidad '{0}' debe tener un constructor sin parámetros protected",
        category: Categorias.Diseno,
        defaultSeverity: DiagnosticSeverity.Warning,
        isEnabledByDefault: false,
        description: Descripcion,
        helpLinkUri: Ayuda.Para(Id));

    /// <summary>Diagnósticos que produce este analyzer.</summary>
    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
        ImmutableArray.Create(Descriptor, DescriptorEntidadSinConstructor);

    /// <summary>Registra la acción sobre cada tipo declarado.</summary>
    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();

        context.RegisterSymbolAction(Analizar, SymbolKind.NamedType);
    }

    private static void Analizar(SymbolAnalysisContext context)
    {
        INamedTypeSymbol tipo = (INamedTypeSymbol)context.Symbol;

        // Solo clases (y record classes). En un struct, el constructor sin parámetros
        // explícito tiene que ser público.
        if (tipo.TypeKind != TypeKind.Class)
        {
            return;
        }

        // Los constructores escritos en el código, incluido el constructor primario. Quedan
        // afuera los que genera el compilador (el implícito y el de copia de un record), que
        // no tienen sintaxis.
        ImmutableArray<IMethodSymbol> declarados = tipo.InstanceConstructors
            .Where(c => !c.DeclaringSyntaxReferences.IsEmpty)
            .ToImmutableArray();

        IMethodSymbol? sinParametros = declarados.FirstOrDefault(c => c.Parameters.IsEmpty);

        // Una entidad sin constructores declarados tiene el implícito; si declara alguno,
        // uno tiene que ser sin parámetros.
        if (sinParametros == null && !declarados.IsEmpty && EsEntidad(tipo))
        {
            context.ReportDiagnostic(Diagnostic.Create(
                DescriptorEntidadSinConstructor,
                tipo.Locations.FirstOrDefault(l => l.IsInSource) ?? Location.None,
                Simbolos.NombreCompleto(tipo)));
            return;
        }

        if (declarados.Length < 2
            || sinParametros == null
            || EsAccesibilidadPermitida(tipo, sinParametros.DeclaredAccessibility))
        {
            return;
        }

        context.ReportDiagnostic(Diagnostic.Create(
            Descriptor,
            sinParametros.Locations.FirstOrDefault(l => l.IsInSource) ?? Location.None,
            Simbolos.NombreCompleto(tipo)));
    }

    /// <summary>
    /// Implementa <c>Lainco.Domain.IEntity</c>: directamente, a través de su clase base o de
    /// otra interfaz. La genérica <c>IEntity&lt;T&gt;</c> no cuenta.
    /// </summary>
    private static bool EsEntidad(INamedTypeSymbol tipo)
    {
        return tipo.AllInterfaces.Any(i =>
            i.Arity == 0 && Simbolos.NombreCompleto(i) == InterfazDeEntidad);
    }

    /// <summary>
    /// <c>protected</c> siempre. En una clase sealed también <c>private</c>: ahí son
    /// equivalentes, y <c>protected</c> hace que el compilador avise (CS0628).
    /// </summary>
    private static bool EsAccesibilidadPermitida(INamedTypeSymbol tipo, Accessibility accesibilidad)
    {
        return accesibilidad == Accessibility.Protected
               || (tipo.IsSealed && accesibilidad == Accessibility.Private);
    }
}
