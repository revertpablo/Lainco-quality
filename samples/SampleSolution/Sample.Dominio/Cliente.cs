namespace Sample.Dominio;

/// <summary>
/// Entidad de referencia: cumple todas las reglas LAIN.
/// Sirve de contraejemplo (caso negativo) para LAIN001, LAIN002 y LAIN004.
/// </summary>
public class Cliente
{
    private readonly IList<Pedido> pedidos = new List<Pedido>();

    /// <summary>
    /// Constructor sin parámetros <c>protected</c>, para los proxies de NHibernate.
    /// Cumple LAIN001: no es el único constructor del tipo, así que debe ser protected.
    /// </summary>
    protected Cliente()
    {
    }

    /// <summary>
    /// Único constructor con código del tipo. Cumple LAIN002.
    /// </summary>
    public Cliente(string razonSocial, string cuit)
    {
        RazonSocial = razonSocial;
        Cuit = cuit;
    }

    public virtual int Id { get; set; }

    public virtual string RazonSocial { get; set; }

    public virtual string Cuit { get; set; }

    /// <summary>
    /// La colección se expone como solo lectura: la entidad no entrega su lista mutable.
    /// (Es la norma de diseño LAIN-D012 del ejemplo de la Fase 7.)
    /// </summary>
    public virtual IReadOnlyCollection<Pedido> Pedidos => (IReadOnlyCollection<Pedido>)pedidos;

    public virtual void AgregarPedido(Pedido pedido)
    {
        pedidos.Add(pedido);
    }
}
