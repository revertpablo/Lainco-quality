namespace Sample.Dominio;

/// <summary>
/// Contraejemplo (caso negativo) de LAIN005: los <c>operator</c> son estáticos por
/// exigencia del lenguaje y están explícitamente exceptuados de la regla.
/// </summary>
public class Importe
{
    public Importe(decimal valor)
    {
        Valor = valor;
    }

    public decimal Valor { get; }

    public static Importe operator +(Importe izquierda, Importe derecha)
    {
        return new Importe(izquierda.Valor + derecha.Valor);
    }

    public static Importe operator -(Importe izquierda, Importe derecha)
    {
        return new Importe(izquierda.Valor - derecha.Valor);
    }
}
