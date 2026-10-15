using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Lainco.Analyzers.Suppressor;

/// <summary>
/// Lector de JSON mínimo, para no depender de System.Text.Json dentro de un analyzer.
///
/// Devuelve objetos como <c>Dictionary&lt;string, object?&gt;</c>, arreglos como
/// <c>List&lt;object?&gt;</c>, textos como <c>string</c>, números como <c>double</c>,
/// <c>true</c>/<c>false</c> como <c>bool</c> y <c>null</c> como null. Ante cualquier
/// error lanza <see cref="FormatException"/>.
/// </summary>
internal sealed class LectorJson
{
    private readonly string texto;
    private int posicion;

    private LectorJson(string texto)
    {
        this.texto = texto;
    }

    public static object? Leer(string texto)
    {
        LectorJson lector = new(texto);
        object? valor = lector.LeerValor();

        lector.SaltearEspacios();
        if (lector.posicion != texto.Length)
        {
            throw lector.Error("contenido después del final");
        }

        return valor;
    }

    private object? LeerValor()
    {
        SaltearEspacios();

        if (posicion >= texto.Length)
        {
            throw Error("fin inesperado");
        }

        char actual = texto[posicion];
        switch (actual)
        {
            case '{':
                return LeerObjeto();
            case '[':
                return LeerArreglo();
            case '"':
                return LeerTexto();
            case 't':
                LeerPalabra("true");
                return true;
            case 'f':
                LeerPalabra("false");
                return false;
            case 'n':
                LeerPalabra("null");
                return null;
            default:
                if (actual == '-' || (actual >= '0' && actual <= '9'))
                {
                    return LeerNumero();
                }

                throw Error($"carácter inesperado '{actual}'");
        }
    }

    private Dictionary<string, object?> LeerObjeto()
    {
        Dictionary<string, object?> objeto = new(StringComparer.Ordinal);
        posicion++;

        SaltearEspacios();
        if (Siguiente() == '}')
        {
            posicion++;
            return objeto;
        }

        while (true)
        {
            SaltearEspacios();
            if (Siguiente() != '"')
            {
                throw Error("se esperaba el nombre de una propiedad");
            }

            string nombre = LeerTexto();

            SaltearEspacios();
            Esperar(':');

            objeto[nombre] = LeerValor();

            SaltearEspacios();
            char separador = Siguiente();
            posicion++;

            if (separador == '}')
            {
                return objeto;
            }

            if (separador != ',')
            {
                throw Error("se esperaba ',' o '}'");
            }
        }
    }

    private List<object?> LeerArreglo()
    {
        List<object?> lista = new();
        posicion++;

        SaltearEspacios();
        if (Siguiente() == ']')
        {
            posicion++;
            return lista;
        }

        while (true)
        {
            lista.Add(LeerValor());

            SaltearEspacios();
            char separador = Siguiente();
            posicion++;

            if (separador == ']')
            {
                return lista;
            }

            if (separador != ',')
            {
                throw Error("se esperaba ',' o ']'");
            }
        }
    }

    private string LeerTexto()
    {
        Esperar('"');
        StringBuilder resultado = new();

        while (true)
        {
            if (posicion >= texto.Length)
            {
                throw Error("texto sin cerrar");
            }

            char actual = texto[posicion++];

            if (actual == '"')
            {
                return resultado.ToString();
            }

            if (actual != '\\')
            {
                resultado.Append(actual);
                continue;
            }

            if (posicion >= texto.Length)
            {
                throw Error("escape incompleto");
            }

            char escape = texto[posicion++];
            switch (escape)
            {
                case '"': resultado.Append('"'); break;
                case '\\': resultado.Append('\\'); break;
                case '/': resultado.Append('/'); break;
                case 'b': resultado.Append('\b'); break;
                case 'f': resultado.Append('\f'); break;
                case 'n': resultado.Append('\n'); break;
                case 'r': resultado.Append('\r'); break;
                case 't': resultado.Append('\t'); break;
                case 'u':
                    if (posicion + 4 > texto.Length
                        || !int.TryParse(texto.Substring(posicion, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out int codigo))
                    {
                        throw Error("escape \\u inválido");
                    }

                    // Los pares sustitutos llegan como dos \u seguidos y se recomponen solos.
                    resultado.Append((char)codigo);
                    posicion += 4;
                    break;
                default:
                    throw Error($"escape inválido '\\{escape}'");
            }
        }
    }

    private double LeerNumero()
    {
        int inicio = posicion;

        while (posicion < texto.Length && "+-0123456789.eE".IndexOf(texto[posicion]) >= 0)
        {
            posicion++;
        }

        string numero = texto.Substring(inicio, posicion - inicio);

        if (!double.TryParse(numero, NumberStyles.Float, CultureInfo.InvariantCulture, out double valor))
        {
            throw Error($"número inválido '{numero}'");
        }

        return valor;
    }

    private void LeerPalabra(string palabra)
    {
        if (string.CompareOrdinal(texto, posicion, palabra, 0, palabra.Length) != 0)
        {
            throw Error($"se esperaba '{palabra}'");
        }

        posicion += palabra.Length;
    }

    private void Esperar(char esperado)
    {
        if (Siguiente() != esperado)
        {
            throw Error($"se esperaba '{esperado}'");
        }

        posicion++;
    }

    private char Siguiente()
    {
        if (posicion >= texto.Length)
        {
            throw Error("fin inesperado");
        }

        return texto[posicion];
    }

    private void SaltearEspacios()
    {
        while (posicion < texto.Length && char.IsWhiteSpace(texto[posicion]))
        {
            posicion++;
        }
    }

    private FormatException Error(string detalle)
    {
        return new FormatException($"JSON inválido en la posición {posicion}: {detalle}.");
    }
}
