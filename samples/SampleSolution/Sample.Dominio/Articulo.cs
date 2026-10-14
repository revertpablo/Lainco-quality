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
    public virtual string Resumen { get; set; } = "-";    
    public virtual string ImagenUrl { get; set; }    

    public virtual decimal PrecioLista { get; set; }

    // >>> LAIN004: inicialización inline de property.
    public virtual string Descripcion { get; set; } = "sin descripción";
    public virtual decimal PrecioContado { get; set; }
    public virtual string Sku { get; set; }
    
}
//agregue una segunda violacion y la detectó como nuevo issue -> OK
//Desde entonces, empecé a intercambiar lineas, y en cada analisis a pesar de estar aceptado, me lo muestra en el contador como accepted issues a una de ellas