using System;

namespace Lainco.CatalogoReglas;

/// <summary>Punto de entrada de <c>catalogo-reglas</c>.</summary>
internal static class Program
{
    /// <summary>
    /// Genera el catálogo de reglas de un paquete de analyzers. Ver <see cref="Generacion"/>
    /// por los códigos de salida.
    /// </summary>
    public static int Main(string[] args)
    {
        return Generacion.Ejecutar(args, Console.Out);
    }
}
