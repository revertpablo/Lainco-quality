namespace Sample.Dominio;

/// <summary>
/// TEMPORAL — spike de la Fase 2.
///
/// Este tipo está en el proyecto de dominio (código de producción) pero su nombre
/// termina en "Tests", así que dispara LAIN999 igual que la clase de tests real.
/// Es el grupo de control del experimento: si a Sonar llega este issue y no el del
/// proyecto de tests, la causa es el proyecto de test y no la regla.
///
/// Se elimina al cerrar el spike.
/// </summary>
public class SpikeDominioTests
{
}
