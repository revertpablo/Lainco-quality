import { impactosParaPublicar, type Impacto } from "./severidad";
import { TipoDesvio, type Lenguaje } from "./valores";

/**
 * Reconciliación (entrega 6.2, paso 5; FASE-6.md, sección 10): qué diferencias hay entre
 * lo que dice la app y lo que hay en el Quality Profile de un lenguaje. Sin base ni red:
 * recibe las dos fotos y devuelve los desvíos.
 *
 * La app es la fuente de verdad, pero no corrige sola (decisión P1): cada diferencia es un
 * desvío que un decisor corrige desde la app.
 */

/** El perfil gestionado, como lo ve Sonar. */
export interface FotoDelPerfil {
  clave: string;
  nombre: string;
  esDefault: boolean;
  heredaDe: { clave: string; nombre: string | null } | null;
}

/** Una regla activa en el perfil. */
export interface ActivaEnSonar {
  clave: string;
  impactos: Impacto[];
  parametros: Record<string, string>;
}

/** Una regla de Sonar Incorporada en la app: lo que tendría que estar activo. */
export interface IncorporadaEnLaApp {
  clave: string;
  reglaId: string;
  /** Severidad elegida al incorporar. */
  severidad: string | null;
  /** Valores elegidos al incorporar. */
  parametros: Record<string, string>;
  /** Impactos de la regla en Sonar: a qué calidades va la severidad elegida. */
  impactosDeLaRegla: Impacto[];
  /** Valor por defecto de cada parámetro de la regla, para los que no se eligieron. */
  parametrosPorDefecto: Record<string, string>;
}

/** Un proyecto y el perfil que usa para este lenguaje. */
export interface ProyectoEnSonar {
  clave: string;
  nombre: string;
  perfil: { clave: string; nombre: string } | null;
}

export interface EntradaDeReconciliacion {
  lenguaje: Lenguaje;
  perfil: FotoDelPerfil;
  activas: readonly ActivaEnSonar[];
  incorporadas: readonly IncorporadaEnLaApp[];
  proyectos: readonly ProyectoEnSonar[];
  /** Clave de Sonar → id en el inventario, para ubicar una regla activada a mano. */
  reglaIdPorClave: ReadonlyMap<string, string>;
  /**
   * Reglas con una publicación pendiente: la diferencia ya está por resolverse, así que no
   * es un desvío (todavía).
   */
  conPublicacionPendiente: ReadonlySet<string>;
}

export interface DesvioDetectado {
  tipo: TipoDesvio;
  lenguaje: Lenguaje;
  /** Qué tiene la diferencia: la clave de la regla, del proyecto o el nombre del perfil. */
  clave: string;
  reglaId: string | null;
  detalle: { esperado?: unknown; encontrado?: unknown };
}

export function compararPerfil(entrada: EntradaDeReconciliacion): DesvioDetectado[] {
  const { lenguaje, perfil } = entrada;
  const desvios: DesvioDetectado[] = [];
  const desvio = (tipo: TipoDesvio, clave: string, reglaId: string | null, detalle: DesvioDetectado["detalle"]) =>
    desvios.push({ tipo, lenguaje, clave, reglaId, detalle });

  // El perfil.
  if (perfil.heredaDe) {
    desvio(TipoDesvio.PerfilConHerencia, perfil.nombre, null, {
      esperado: "sin herencia",
      encontrado: perfil.heredaDe.nombre ?? perfil.heredaDe.clave,
    });
  }
  if (!perfil.esDefault) {
    desvio(TipoDesvio.PerfilNoEsDefault, perfil.nombre, null, { esperado: "default", encontrado: "no es el default" });
  }

  // Los proyectos.
  for (const proyecto of entrada.proyectos) {
    if (proyecto.perfil?.clave !== perfil.clave) {
      desvio(TipoDesvio.ProyectoConOtroPerfil, proyecto.clave, null, {
        esperado: perfil.nombre,
        encontrado: proyecto.perfil?.nombre ?? "ninguno",
      });
    }
  }

  // Las reglas.
  const activas = new Map(entrada.activas.map((a) => [a.clave, a]));
  const incorporadas = new Map(entrada.incorporadas.map((i) => [i.clave, i]));
  const pendiente = (reglaId: string | null | undefined) => reglaId != null && entrada.conPublicacionPendiente.has(reglaId);

  for (const activa of entrada.activas) {
    const reglaId = entrada.reglaIdPorClave.get(activa.clave) ?? null;
    if (!incorporadas.has(activa.clave) && !pendiente(reglaId)) {
      desvio(TipoDesvio.ActivaSinIncorporar, activa.clave, reglaId, {
        esperado: "inactiva",
        encontrado: { impactos: activa.impactos, parametros: activa.parametros },
      });
    }
  }

  for (const incorporada of entrada.incorporadas) {
    if (pendiente(incorporada.reglaId)) continue;
    const activa = activas.get(incorporada.clave);
    if (!activa) {
      desvio(TipoDesvio.IncorporadaInactiva, incorporada.clave, incorporada.reglaId, {
        esperado: { severidad: incorporada.severidad, parametros: incorporada.parametros },
        encontrado: "inactiva",
      });
      continue;
    }

    const impactosEsperados = impactosParaPublicar(incorporada.severidad, incorporada.impactosDeLaRegla);
    const impactosDistintos = impactosEsperados.filter(
      (e) => activa.impactos.find((a) => a.calidad === e.calidad)?.severidad !== e.severidad,
    );
    if (impactosDistintos.length > 0) {
      desvio(TipoDesvio.SeveridadDistinta, incorporada.clave, incorporada.reglaId, {
        esperado: impactosEsperados,
        encontrado: activa.impactos,
      });
    }

    // Los elegidos tienen que estar como se eligieron; los demás, con el valor de Sonar.
    const parametrosEsperados = { ...incorporada.parametrosPorDefecto, ...incorporada.parametros };
    const parametrosDistintos = Object.entries(parametrosEsperados).filter(([clave, valor]) => activa.parametros[clave] !== valor);
    if (parametrosDistintos.length > 0) {
      desvio(TipoDesvio.ParametrosDistintos, incorporada.clave, incorporada.reglaId, {
        esperado: Object.fromEntries(parametrosDistintos),
        encontrado: Object.fromEntries(parametrosDistintos.map(([clave]) => [clave, activa.parametros[clave] ?? null])),
      });
    }
  }

  return desvios;
}

/** Los tipos de desvío que se corrigen publicando la regla otra vez (paso 5). */
export const DESVIOS_QUE_SE_CORRIGEN_PUBLICANDO: readonly TipoDesvio[] = [
  TipoDesvio.ActivaSinIncorporar,
  TipoDesvio.IncorporadaInactiva,
  TipoDesvio.SeveridadDistinta,
  TipoDesvio.ParametrosDistintos,
];
