using NHibernate;
using NHibernate.Linq;
using Sample.Dominio;

namespace Sample.Mapeos;

/// <summary>
/// VIOLACIÓN INTENCIONAL DE LAIN006.
///
/// <see cref="BuscarPorCliente"/> materializa con <c>ToList()</c> una query a base de
/// datos: trae todas las filas al proceso en lugar de dejar que el filtro y la
/// paginación los resuelva el motor.
/// </summary>
public class RepositorioDePedidos
{
    private readonly ISession session;

    public RepositorioDePedidos(ISession session)
    {
        this.session = session;
    }

    // >>> LAIN006: ToList() sobre IQueryable<Pedido> (query a base de datos).
    public IList<Pedido> BuscarPorCliente(int clienteId)
    {
        return session.Query<Pedido>()
            .Where(p => p.Cliente.Id == clienteId)
            .ToList();
    }

    /// <summary>
    /// Cumple LAIN006: la query se resuelve en el motor y devuelve un solo resultado.
    /// </summary>
    public Pedido BuscarPorId(int id)
    {
        return session.Query<Pedido>()
            .SingleOrDefault(p => p.Id == id);
    }

    /// <summary>
    /// Contraejemplo (caso negativo) de LAIN006: el <c>ToList()</c> es sobre una
    /// colección en memoria, no sobre una query a base.
    /// </summary>
    public IList<LineaPedido> LineasOrdenadas(Pedido pedido)
    {
        return pedido.Lineas
            .OrderBy(l => l.Id)
            .ToList();
    }
}
