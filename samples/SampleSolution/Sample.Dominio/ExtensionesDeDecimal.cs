namespace Sample.Dominio;

/// <summary>
/// Contraejemplo (caso negativo) de LAIN005: un extension method sobre un tipo que no
/// pertenece al proyecto (<c>decimal</c>, de .NET) es la única forma de agregarle
/// comportamiento, y está exceptuado de la regla.
///
/// Comparar con <see cref="CalculadorDeTotales.AplicarDescuento"/>, que sí viola LAIN005.
/// </summary>
public static class ExtensionesDeDecimal
{
    public static decimal RedondeadoAMoneda(this decimal valor)
    {
        return decimal.Round(valor, 2, MidpointRounding.AwayFromZero);
    }
}
