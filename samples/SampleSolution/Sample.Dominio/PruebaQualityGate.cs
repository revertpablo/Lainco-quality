namespace Sample.Dominio;

/// <summary>
/// TEMPORAL — prueba del quality gate (Fase 2, tarea 1).
///
/// Archivo nuevo con una violación nueva de LAIN004, para verificar dos cosas en un PR:
///   1. que el quality gate falle ante un issue nuevo;
///   2. si un issue externo mueve o no el new_maintainability_rating.
///
/// Esta rama no se mergea: se descarta al terminar la prueba.
/// </summary>
public class PruebaQualityGate
{
    protected PruebaQualityGate()
    {
    }

    public PruebaQualityGate(string codigo)
    {
        Codigo = codigo;
    }

    public virtual int Id { get; set; }

    public virtual string Codigo { get; set; }

    // Violación nueva de LAIN004.
    public virtual string Estado { get; set; } = "pendiente";
}
