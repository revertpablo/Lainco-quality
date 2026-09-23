namespace Sample.Dominio;

/// <summary>
/// VIOLACIÓN INTENCIONAL DE LAIN005.
///
/// <see cref="AplicarDescuento"/> es un método estático que no es un <c>operator</c>.
/// Comparar con <see cref="Importe"/>, cuyos operators sí están exceptuados.
/// </summary>
public class CalculadorDeTotales
{
    // >>> LAIN005: método estático que no es operator.
    public static decimal AplicarDescuento(decimal total, decimal porcentaje)
    {
        return total - (total * porcentaje / 100m);
    }

    /// <summary>
    /// Método de instancia: cumple LAIN005.
    /// </summary>
    public decimal CalcularTotal(Pedido pedido)
    {
        decimal total = 0m;

        foreach (LineaPedido linea in pedido.Lineas)
        {
            total += linea.Total;
        }

        return total;
    }
}
