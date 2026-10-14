namespace Lainco.SonarSync;

/// <summary>
/// Un issue que los revisores aceptaron o marcaron como falso positivo en SonarQube.
///
/// Archivo, regla y mensaje son la clave con la que el suppressor reconoce el diagnóstico
/// en el IDE. No se guarda la línea a propósito: el mensaje lleva el nombre completamente
/// calificado del símbolo, así que el issue se reconoce aunque el código se mueva.
/// </summary>
/// <param name="Archivo">Ruta relativa a la raíz del proyecto de Sonar, con '/'.</param>
/// <param name="Regla">ID de la regla, sin el repositorio de Sonar (ej.: <c>LAIN004</c>).</param>
/// <param name="Mensaje">Mensaje del diagnóstico, tal como lo emitió el analyzer.</param>
/// <param name="Estado"><c>ACCEPTED</c> o <c>FALSE_POSITIVE</c>.</param>
internal sealed record IssueAceptado(string Archivo, string Regla, string Mensaje, string Estado);
