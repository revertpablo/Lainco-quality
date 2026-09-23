namespace Sample.Dominio;

/// <summary>
/// VIOLACIÓN INTENCIONAL DE LAIN002.
///
/// El tipo tiene dos constructores con código y ninguno encadena al otro:
/// la lógica de inicialización está duplicada. Uno de los dos debería
/// encadenar con <c>: this(...)</c>.
/// </summary>
public class LineaPedido
{
    protected LineaPedido()
    {
    }

    // >>> LAIN002: primer constructor con código.
    public LineaPedido(Articulo articulo, int cantidad)
    {
        Articulo = articulo;
        Cantidad = cantidad;
        PrecioUnitario = 0m;
    }

    // >>> LAIN002: segundo constructor con código, sin encadenar al anterior.
    public LineaPedido(Articulo articulo, int cantidad, decimal precioUnitario)
    {
        Articulo = articulo;
        Cantidad = cantidad;
        PrecioUnitario = precioUnitario;
    }

    public virtual int Id { get; set; }

    public virtual Articulo Articulo { get; set; }

    public virtual int Cantidad { get; set; }

    public virtual decimal PrecioUnitario { get; set; }

    public virtual decimal Total => Cantidad * PrecioUnitario;
}
