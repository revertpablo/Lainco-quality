using Sample.Dominio;

namespace Sample.Tests;

/// <summary>
/// Tests que LAIN003 exige: por cada entidad mapeada, un test que asigne valores a
/// todas sus properties persistidas.
///
/// Falta a propósito el test de <see cref="Deposito"/>, que está mapeada en
/// <c>Sample.Mapeos.DepositoMap</c>. Esa ausencia es la violación de LAIN003.
/// </summary>
public class MapeoDeEntidadesTests
{
    [Fact]
    public void Cliente_asigna_todas_sus_properties_persistidas()
    {
        Cliente cliente = new Cliente("Lainco S.A.", "30-11111111-7");
        Pedido pedido = new Pedido(cliente, new DateTime(2026, 1, 15));

        cliente.Id = 1;
        cliente.RazonSocial = "Lainco S.A.";
        cliente.Cuit = "30-11111111-7";
        cliente.AgregarPedido(pedido);

        Assert.Equal(1, cliente.Id);
        Assert.Equal("Lainco S.A.", cliente.RazonSocial);
        Assert.Equal("30-11111111-7", cliente.Cuit);
        Assert.Single(cliente.Pedidos);
    }

    [Fact]
    public void Pedido_asigna_todas_sus_properties_persistidas()
    {
        Cliente cliente = new Cliente("Lainco S.A.", "30-11111111-7");
        Articulo articulo = new Articulo("ART-001", "Artículo de prueba");
        LineaPedido linea = new LineaPedido(articulo, 2, 150m);

        Pedido pedido = new Pedido(cliente, new DateTime(2026, 1, 15));
        pedido.Id = 7;
        pedido.Cliente = cliente;
        pedido.Fecha = new DateTime(2026, 1, 15);
        pedido.Observaciones = "Entrega urgente";
        pedido.AgregarLinea(linea);

        Assert.Equal(7, pedido.Id);
        Assert.Same(cliente, pedido.Cliente);
        Assert.Equal(new DateTime(2026, 1, 15), pedido.Fecha);
        Assert.Equal("Entrega urgente", pedido.Observaciones);
        Assert.Single(pedido.Lineas);
    }

    [Fact]
    public void LineaPedido_asigna_todas_sus_properties_persistidas()
    {
        Articulo articulo = new Articulo("ART-001", "Artículo de prueba");

        LineaPedido linea = new LineaPedido(articulo, 2, 150m);
        linea.Id = 3;
        linea.Articulo = articulo;
        linea.Cantidad = 2;
        linea.PrecioUnitario = 150m;

        Assert.Equal(3, linea.Id);
        Assert.Same(articulo, linea.Articulo);
        Assert.Equal(2, linea.Cantidad);
        Assert.Equal(150m, linea.PrecioUnitario);
        Assert.Equal(300m, linea.Total);
    }

    [Fact]
    public void Articulo_asigna_todas_sus_properties_persistidas()
    {
        Articulo articulo = new Articulo("ART-001", "Artículo de prueba");
        articulo.Id = 42;
        articulo.Codigo = "ART-001";
        articulo.Descripcion = "Artículo de prueba";
        articulo.PrecioLista = 99.90m;

        Assert.Equal(42, articulo.Id);
        Assert.Equal("ART-001", articulo.Codigo);
        Assert.Equal("Artículo de prueba", articulo.Descripcion);
        Assert.Equal(99.90m, articulo.PrecioLista);
    }

    // >>> LAIN003: falta a propósito Deposito_asigna_todas_sus_properties_persistidas().
}
