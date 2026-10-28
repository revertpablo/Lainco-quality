namespace Lainco.CatalogoReglas.Tests;

public class EscritorDelCatalogoTests
{
    private static readonly Catalogo Ejemplo = new(
        Formato: 1,
        Origen: "roslyn",
        Paquete: "Lainco.Analyzers",
        Version: "0.1.0",
        Lenguaje: "cs",
        Reglas: new[]
        {
            new ReglaDelCatalogo(
                Clave: "LAIN005",
                Titulo: "No se permiten métodos estáticos",
                Descripcion: null,
                Categoria: "Diseño",
                SeveridadPorDefecto: "warning",
                HabilitadaPorDefecto: true,
                Ayuda: "https://github.com/revertpablo/Lainco-quality/blob/main/docs/rules/LAIN005.md",
                Documentacion: "# LAIN005 — Métodos estáticos\n\nUsa `static` y \"comillas\" <b>.\n"),
        });

    [Fact]
    public void Escribe_el_formato_documentado()
    {
        string json = EscritorDelCatalogo.Serializar(Ejemplo);

        Assert.Equal(
            "{\n" +
            "  \"formato\": 1,\n" +
            "  \"origen\": \"roslyn\",\n" +
            "  \"paquete\": \"Lainco.Analyzers\",\n" +
            "  \"version\": \"0.1.0\",\n" +
            "  \"lenguaje\": \"cs\",\n" +
            "  \"reglas\": [\n" +
            "    {\n" +
            "      \"clave\": \"LAIN005\",\n" +
            "      \"titulo\": \"No se permiten métodos estáticos\",\n" +
            "      \"descripcion\": null,\n" +
            "      \"categoria\": \"Diseño\",\n" +
            "      \"severidadPorDefecto\": \"warning\",\n" +
            "      \"habilitadaPorDefecto\": true,\n" +
            "      \"ayuda\": \"https://github.com/revertpablo/Lainco-quality/blob/main/docs/rules/LAIN005.md\",\n" +
            "      \"documentacion\": \"# LAIN005 — Métodos estáticos\\n\\nUsa `static` y \\\"comillas\\\" <b>.\\n\"\n" +
            "    }\n" +
            "  ]\n" +
            "}\n",
            json);
    }

    [Fact]
    public void Escribir_dos_veces_lo_mismo_da_el_mismo_archivo()
    {
        Assert.Equal(EscritorDelCatalogo.Serializar(Ejemplo), EscritorDelCatalogo.Serializar(Ejemplo));
    }
}
