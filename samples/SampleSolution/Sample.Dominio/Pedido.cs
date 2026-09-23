namespace Sample.Dominio;

/// <summary>
/// VIOLACIÓN INTENCIONAL DE LAIN001.
///
/// El constructor sin parámetros es <c>public</c> y el tipo tiene otro constructor,
/// así que debería ser <c>protected</c>. Comparar con <see cref="Cliente"/>.
/// </summary>
public class Pedido
{
    private readonly IList<LineaPedido> lineas = new List<LineaPedido>();

    // >>> LAIN001: debería ser protected, porque no es el único constructor del tipo.
    public Pedido()
    {
    }

    public Pedido(Cliente cliente, DateTime fecha)
        : this()
    {
        Cliente = cliente;
        Fecha = fecha;
    }

    public virtual int Id { get; set; }

    public virtual Cliente Cliente { get; set; }

    public virtual DateTime Fecha { get; set; }

    public virtual string Observaciones { get; set; }

    public virtual IReadOnlyCollection<LineaPedido> Lineas => (IReadOnlyCollection<LineaPedido>)lineas;

    public virtual void AgregarLinea(LineaPedido linea)
    {
        lineas.Add(linea);
    }
}
