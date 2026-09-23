namespace Sample.Dominio;

/// <summary>
/// VIOLACIÓN INTENCIONAL DE LAIN004.
///
/// <see cref="Descripcion"/> se inicializa inline. El valor inicial debe fijarse
/// en el constructor, no en la declaración de la property.
/// </summary>
public class Articulo
{
    protected Articulo()
    {
    }

    public Articulo(string codigo, string descripcion)
    {
        Codigo = codigo;
        Descripcion = descripcion;
    }

    public virtual int Id { get; set; }

    public virtual string Codigo { get; set; }

    // >>> LAIN004: inicialización inline de property.
    public virtual string Descripcion { get; set; } = "sin descripción";

    public virtual decimal PrecioLista { get; set; }
}
