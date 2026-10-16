using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Threading;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Lainco.Analyzers.Reglas;

/// <summary>
/// LAIN005: no se permiten métodos estáticos, salvo operators.
///
/// Un método estático no se puede sobrescribir ni reemplazar en un test, y ata a quien
/// lo llama a una implementación concreta. Quedan fuera de la regla (decisión D5):
/// <list type="bullet">
///   <item>los operators, que el lenguaje exige estáticos;</item>
///   <item>el <c>Main</c> que es punto de entrada de la aplicación, que lo exige el runtime;</item>
///   <item>los extension methods sobre tipos que no pertenecen al proyecto, que son la
///   única forma de agregar comportamiento a un tipo que no se controla;</item>
///   <item>los métodos que son fuente de datos de un <c>[MemberData]</c> de xUnit, que el
///   framework exige estáticos.</item>
/// </list>
/// Cualquier otra excepción se acepta en SonarQube, no en el código.
/// </summary>
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class MetodoEstaticoAnalyzer : DiagnosticAnalyzer
{
    /// <summary>ID de la regla. Nunca se reutiliza, aunque la regla se elimine.</summary>
    public const string Id = "LAIN005";

    private static readonly DiagnosticDescriptor Descriptor = new DiagnosticDescriptor(
        id: Id,
        title: "No se permiten métodos estáticos",
        messageFormat: "Método estático '{0}' no permitido",
        category: Categorias.Diseno,
        defaultSeverity: DiagnosticSeverity.Warning,
        isEnabledByDefault: true,
        description: "Los métodos estáticos no se pueden sobrescribir ni reemplazar en un " +
                     "test, y atan a quien los llama a una implementación concreta. El " +
                     "comportamiento va en métodos de instancia. Se exceptúan los operators, " +
                     "el Main que es punto de entrada, los extension methods sobre tipos " +
                     "que no pertenecen al proyecto y las fuentes de datos de [MemberData] " +
                     "de xUnit. Cualquier otra excepción la aceptan los revisores en SonarQube.",
        helpLinkUri: Ayuda.Para(Id));

    /// <summary>Diagnósticos que produce este analyzer.</summary>
    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
        ImmutableArray.Create(Descriptor);

    /// <summary>Registra la acción sobre cada método declarado en la compilación.</summary>
    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();

        context.RegisterCompilationStartAction(inicio =>
        {
            // El punto de entrada se resuelve una vez por compilación. En una biblioteca
            // es null: ahí un 'Main' es un método estático más.
            IMethodSymbol? puntoDeEntrada = inicio.Compilation.GetEntryPoint(inicio.CancellationToken);

            // Las fuentes de [MemberData] se buscan recién cuando aparece el primer método
            // estático candidato, y una sola vez por compilación. Si el proyecto no
            // referencia xUnit, no hay nada que buscar.
            INamedTypeSymbol? memberData = inicio.Compilation.GetTypeByMetadataName(FuentesDeDatos.AtributoMemberData);
            Compilation compilacion = inicio.Compilation;
            CancellationToken cancelacion = inicio.CancellationToken;
            Lazy<HashSet<IMethodSymbol>> fuentesDeDatos = new Lazy<HashSet<IMethodSymbol>>(() =>
                FuentesDeDatos.Buscar(compilacion, memberData, cancelacion));

            inicio.RegisterSymbolAction(
                simbolo => Analizar(simbolo, puntoDeEntrada, fuentesDeDatos),
                SymbolKind.Method);
        });
    }

    private static void Analizar(
        SymbolAnalysisContext context,
        IMethodSymbol? puntoDeEntrada,
        Lazy<HashSet<IMethodSymbol>> fuentesDeDatos)
    {
        IMethodSymbol metodo = (IMethodSymbol)context.Symbol;

        // 'Ordinary' deja afuera operators y conversiones (UserDefinedOperator,
        // Conversion), constructores estáticos, accessors de properties, funciones
        // locales y lambdas: la regla es solo sobre métodos del tipo.
        if (!metodo.IsStatic || metodo.MethodKind != MethodKind.Ordinary)
        {
            return;
        }

        // Métodos que genera el compilador, como el Main de los top-level statements.
        if (metodo.IsImplicitlyDeclared)
        {
            return;
        }

        // En un método 'partial', Roslyn entrega por separado la declaración y la
        // implementación. Se reporta solo sobre la declaración, para no duplicar el issue.
        if (metodo.PartialDefinitionPart != null)
        {
            return;
        }

        if (SymbolEqualityComparer.Default.Equals(metodo, puntoDeEntrada))
        {
            return;
        }

        if (metodo.IsExtensionMethod && ExtiendeUnTipoExterno(metodo, context.Compilation))
        {
            return;
        }

        if (fuentesDeDatos.Value.Contains(metodo))
        {
            return;
        }

        context.ReportDiagnostic(Diagnostic.Create(
            Descriptor,
            metodo.Locations[0],
            Simbolos.NombreCompleto(metodo)));
    }

    /// <summary>
    /// Indica si el extension method extiende un tipo al que se le podría agregar el
    /// método. Es el criterio de la excepción: un extension method se escribe porque no se
    /// puede modificar el tipo; si el tipo es del proyecto, el método va en el tipo.
    /// </summary>
    private static bool ExtiendeUnTipoExterno(IMethodSymbol metodo, Compilation compilacion)
    {
        return !EsModificableEnElProyecto(
            metodo.Parameters[0].Type,
            compilacion,
            new HashSet<ITypeParameterSymbol>(SymbolEqualityComparer.Default));
    }

    /// <summary>
    /// Indica si al tipo se le pueden agregar métodos en el proyecto que se compila. Los
    /// tipos de otros proyectos de la misma solución cuentan como externos: el analyzer ve
    /// un proyecto por vez.
    /// </summary>
    private static bool EsModificableEnElProyecto(
        ITypeSymbol tipo,
        Compilation compilacion,
        HashSet<ITypeParameterSymbol> visitados)
    {
        // Un arreglo (Pedido[], T[]) es un tipo de .NET, aunque sus elementos sean del
        // proyecto.
        if (tipo is IArrayTypeSymbol)
        {
            return false;
        }

        // 'this T': depende de sus restricciones. Sin restricciones, o con restricciones
        // que no son tipos (class, struct, new()), no apunta a ningún tipo del proyecto.
        // Con 'where T : Pedido' o 'where T : U' (y U : Pedido), sí.
        if (tipo is ITypeParameterSymbol parametro)
        {
            if (!visitados.Add(parametro))
            {
                return false;
            }

            return parametro.ConstraintTypes.Any(
                restriccion => EsModificableEnElProyecto(restriccion, compilacion, visitados));
        }

        // Un tipo genérico construido (IEnumerable<Pedido>, IComparable<Pedido>) pertenece
        // al ensamblado de su definición, no al de sus argumentos de tipo. Una colección
        // propia (Pedidos : IEnumerable<Pedido>) es del proyecto y dispara.
        return SymbolEqualityComparer.Default.Equals(tipo.ContainingAssembly, compilacion.Assembly);
    }

    /// <summary>
    /// Métodos estáticos del proyecto que un <c>[MemberData]</c> de xUnit usa como fuente
    /// de datos. xUnit los exige estáticos, así que la regla no puede aplicarse sobre ellos.
    /// </summary>
    private static class FuentesDeDatos
    {
        public const string AtributoMemberData = "Xunit.MemberDataAttribute";

        public static HashSet<IMethodSymbol> Buscar(
            Compilation compilacion,
            INamedTypeSymbol? memberData,
            CancellationToken cancelacion)
        {
            HashSet<IMethodSymbol> fuentes = new HashSet<IMethodSymbol>(SymbolEqualityComparer.Default);

            if (memberData == null)
            {
                return fuentes;
            }

            Stack<INamespaceOrTypeSymbol> pendientes = new Stack<INamespaceOrTypeSymbol>();
            pendientes.Push(compilacion.Assembly.GlobalNamespace);

            while (pendientes.Count > 0)
            {
                cancelacion.ThrowIfCancellationRequested();

                INamespaceOrTypeSymbol actual = pendientes.Pop();

                if (actual is INamespaceSymbol espacio)
                {
                    foreach (INamespaceOrTypeSymbol miembro in espacio.GetMembers())
                    {
                        pendientes.Push(miembro);
                    }

                    continue;
                }

                INamedTypeSymbol tipo = (INamedTypeSymbol)actual;

                foreach (INamedTypeSymbol anidado in tipo.GetTypeMembers())
                {
                    pendientes.Push(anidado);
                }

                foreach (IMethodSymbol test in tipo.GetMembers().OfType<IMethodSymbol>())
                {
                    foreach (AttributeData atributo in test.GetAttributes())
                    {
                        if (EsMemberData(atributo.AttributeClass, memberData))
                        {
                            Registrar(atributo, tipo, fuentes);
                        }
                    }
                }
            }

            return fuentes;
        }

        private static bool EsMemberData(INamedTypeSymbol? clase, INamedTypeSymbol memberData)
        {
            for (INamedTypeSymbol? actual = clase; actual != null; actual = actual.BaseType)
            {
                if (SymbolEqualityComparer.Default.Equals(actual, memberData))
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// Resuelve el miembro al que apunta el atributo como lo hace xUnit: por nombre, en
        /// el tipo indicado con <c>MemberType</c> o, si no hay, en la clase del test, y en
        /// las bases de ese tipo.
        /// </summary>
        private static void Registrar(
            AttributeData atributo,
            INamedTypeSymbol claseDelTest,
            HashSet<IMethodSymbol> fuentes)
        {
            if (atributo.ConstructorArguments.Length == 0
                || atributo.ConstructorArguments[0].Value is not string nombre)
            {
                return;
            }

            INamedTypeSymbol tipo = claseDelTest;

            foreach (KeyValuePair<string, TypedConstant> argumento in atributo.NamedArguments)
            {
                if (argumento.Key == "MemberType" && argumento.Value.Value is INamedTypeSymbol indicado)
                {
                    tipo = indicado;
                }
            }

            for (INamedTypeSymbol? actual = tipo; actual != null; actual = actual.BaseType)
            {
                foreach (IMethodSymbol fuente in actual.GetMembers(nombre).OfType<IMethodSymbol>())
                {
                    if (fuente.IsStatic)
                    {
                        fuentes.Add(fuente.OriginalDefinition);
                    }
                }
            }
        }
    }
}
