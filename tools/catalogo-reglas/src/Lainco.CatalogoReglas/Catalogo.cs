using System.Collections.Generic;

namespace Lainco.CatalogoReglas;

/// <summary>
/// El catálogo de reglas de un paquete de reglas propias, en el formato común a Roslyn y
/// ESLint (docs/catalogo-de-reglas.md). Lo lee la app de catálogo para sumar las reglas al
/// inventario.
/// </summary>
/// <param name="Formato">Versión del formato. Cambia solo si un cambio rompe a quien lo lee.</param>
/// <param name="Origen"><c>roslyn</c> o <c>eslint</c>.</param>
/// <param name="Paquete">Nombre del paquete: <c>Lainco.Analyzers</c>.</param>
/// <param name="Version">Versión del paquete que trae estas reglas.</param>
/// <param name="Lenguaje">Lenguaje de las reglas, con los códigos de la app: <c>cs</c> o <c>ts</c>.</param>
/// <param name="Reglas">Las reglas, ordenadas por clave.</param>
internal sealed record Catalogo(
    int Formato,
    string Origen,
    string Paquete,
    string Version,
    string Lenguaje,
    IReadOnlyList<ReglaDelCatalogo> Reglas)
{
    /// <summary>La versión del formato que escribe esta herramienta.</summary>
    public const int FormatoActual = 1;
}

/// <summary>Una regla del catálogo.</summary>
/// <param name="Clave">ID de la regla: <c>LAIN004</c>.</param>
/// <param name="Titulo">Título del descriptor.</param>
/// <param name="Descripcion">Descripción del descriptor, o null si no tiene.</param>
/// <param name="Categoria">Categoría del descriptor: <c>Diseño</c>.</param>
/// <param name="SeveridadPorDefecto">
/// Con las palabras del <c>.globalconfig</c>: <c>silent</c>, <c>suggestion</c> o
/// <c>warning</c>. Nunca <c>error</c> (convención de CLAUDE.md).
/// </param>
/// <param name="HabilitadaPorDefecto">Si la regla corre sin que nadie la configure. En Roslyn, siempre false (decisión R6).</param>
/// <param name="Ayuda">El <c>helpLinkUri</c>: la documentación publicada.</param>
/// <param name="Documentacion">El markdown de <c>docs/rules/&lt;ID&gt;.md</c>, con finales de línea <c>\n</c>.</param>
internal sealed record ReglaDelCatalogo(
    string Clave,
    string Titulo,
    string? Descripcion,
    string Categoria,
    string SeveridadPorDefecto,
    bool HabilitadaPorDefecto,
    string Ayuda,
    string Documentacion);
