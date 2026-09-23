using Microsoft.CodeAnalysis;

namespace Lainco.Analyzers;

/// <summary>
/// Categorías de diagnóstico usadas por las reglas LAIN.
/// </summary>
internal static class Categorias
{
    public const string Diseno = "Diseño";

    public const string Persistencia = "Persistencia";
}

/// <summary>
/// Construye el <c>helpLinkUri</c> de cada regla a partir de su ID.
/// Apunta a la documentación en <c>docs/rules/</c> del repositorio.
/// </summary>
internal static class Ayuda
{
    private const string BaseUrl =
        "https://github.com/lainco/lainco-quality/blob/main/docs/rules";

    public static string Para(string idDeRegla)
    {
        return BaseUrl + "/" + idDeRegla + ".md";
    }
}

/// <summary>
/// Formato con el que se escriben los símbolos en los mensajes de diagnóstico.
///
/// Los mensajes deben llevar el nombre completamente calificado del símbolo: es lo que
/// permite a SonarQube reconocer un issue ya aceptado aunque el código cambie de línea
/// (ver CLAUDE.md, "Convenciones para reglas propias").
/// </summary>
internal static class Simbolos
{
    public static readonly SymbolDisplayFormat Formato = new SymbolDisplayFormat(
        globalNamespaceStyle: SymbolDisplayGlobalNamespaceStyle.Omitted,
        typeQualificationStyle: SymbolDisplayTypeQualificationStyle.NameAndContainingTypesAndNamespaces,
        memberOptions: SymbolDisplayMemberOptions.IncludeContainingType);

    public static string NombreCompleto(ISymbol simbolo)
    {
        return simbolo.ToDisplayString(Formato);
    }
}
