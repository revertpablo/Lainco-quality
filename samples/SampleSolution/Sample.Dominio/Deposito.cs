namespace Sample.Dominio;

/// <summary>
/// VIOLACIÓN INTENCIONAL DE LAIN003.
///
/// La entidad está mapeada en <c>Sample.Mapeos.DepositoMap</c>, pero el proyecto
/// de tests no tiene ningún test que asigne valores a todas sus properties
/// persistidas. Comparar con las demás entidades, que sí lo tienen en
/// <c>Sample.Tests.MapeoDeEntidadesTests</c>.
///
/// El tipo en sí cumple el resto de las reglas: la violación es la ausencia del test.
/// </summary>
public class Deposito
{
    protected Deposito()
    {
    }

    public Deposito(string codigo, string nombre)
    {
        Codigo = codigo;
        Nombre = nombre;
    }

    public virtual int Id { get; set; }

    public virtual string Codigo { get; set; }

    public virtual string Nombre { get; set; }

    public virtual string Direccion { get; set; }

    public virtual bool Activo { get; set; }
}
