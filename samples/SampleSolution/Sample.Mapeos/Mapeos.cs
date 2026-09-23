using FluentNHibernate.Mapping;
using Sample.Dominio;

namespace Sample.Mapeos;

/// <summary>
/// Mapeos Fluent NHibernate (decisión D2 del plan: <c>ClassMap&lt;T&gt;</c>).
///
/// El analyzer de LAIN003 lee estos mapeos para saber qué entidades están
/// persistidas y cuáles son sus properties persistidas.
/// </summary>
public class ClienteMap : ClassMap<Cliente>
{
    public ClienteMap()
    {
        Table("Clientes");
        Id(x => x.Id);
        Map(x => x.RazonSocial);
        Map(x => x.Cuit);
        HasMany(x => x.Pedidos).KeyColumn("ClienteId");
    }
}

public class PedidoMap : ClassMap<Pedido>
{
    public PedidoMap()
    {
        Table("Pedidos");
        Id(x => x.Id);
        References(x => x.Cliente).Column("ClienteId");
        Map(x => x.Fecha);
        Map(x => x.Observaciones);
        HasMany(x => x.Lineas).KeyColumn("PedidoId");
    }
}

public class LineaPedidoMap : ClassMap<LineaPedido>
{
    public LineaPedidoMap()
    {
        Table("LineasPedido");
        Id(x => x.Id);
        References(x => x.Articulo).Column("ArticuloId");
        Map(x => x.Cantidad);
        Map(x => x.PrecioUnitario);
    }
}

public class ArticuloMap : ClassMap<Articulo>
{
    public ArticuloMap()
    {
        Table("Articulos");
        Id(x => x.Id);
        Map(x => x.Codigo);
        Map(x => x.Descripcion);
        Map(x => x.PrecioLista);
    }
}

/// <summary>
/// Este mapeo es el que hace que <see cref="Deposito"/> viole LAIN003:
/// la entidad queda persistida, pero no tiene test de properties.
/// </summary>
public class DepositoMap : ClassMap<Deposito>
{
    public DepositoMap()
    {
        Table("Depositos");
        Id(x => x.Id);
        Map(x => x.Codigo);
        Map(x => x.Nombre);
        Map(x => x.Direccion);
        Map(x => x.Activo);
    }
}
