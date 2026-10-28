using Microsoft.CodeAnalysis;

namespace Lainco.CatalogoReglas.Tests;

/// <summary>Descriptores de prueba, con valores válidos salvo los que se indiquen.</summary>
internal static class Descriptores
{
    public static DiagnosticDescriptor Regla(
        string id,
        string titulo = "Título de la regla",
        string descripcion = "Descripción de la regla.",
        string categoria = "Diseño",
        DiagnosticSeverity severidad = DiagnosticSeverity.Warning,
        bool habilitada = false,
        string? ayuda = null)
    {
        return new DiagnosticDescriptor(
            id,
            titulo,
            "Mensaje '{0}'",
            categoria,
            severidad,
            habilitada,
            descripcion,
            ayuda ?? $"https://github.com/revertpablo/Lainco-quality/blob/main/docs/rules/{id}.md");
    }
}
