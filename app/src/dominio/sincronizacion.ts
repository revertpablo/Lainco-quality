import { createHash } from "node:crypto";

import { Estado, type MotivoAviso } from "./valores";

/**
 * Comparación del catálogo de reglas de un origen (hoy, Sonar) con lo almacenado
 * (FASE-6.md, sección 3). No hace I/O: recibe las dos listas y devuelve qué crear, qué
 * actualizar, qué marcar y qué avisar. La escritura está en src/sincronizacion/.
 *
 * - **Nueva**: está en Sonar y no en la base. Se crea en Pendiente de analizar.
 * - **Modificada**: cambió algo de lo que define la regla (descripción, parámetros o
 *   severidad por defecto). Se actualiza y se marca. Si estaba Incorporada o En prueba,
 *   avisa: hay que revisar si el cambio afecta la decisión.
 * - **Actualizada**: cambió solo metadata (nombre, tags, tipo, clean code, impactos). Se
 *   actualiza sin marcarla ni avisar.
 * - **Deprecada**: Sonar la marca DEPRECATED, o ya no aparece (eliminada). Se marca. Si
 *   estaba Incorporada, avisa: hay que decidir si se reemplaza por otra.
 * - **Reactivada**: estaba deprecada y vuelve a estar lista en Sonar.
 */

/** Una regla como la trae el origen. Coincide con `ReglaDeSonar` de src/sonar/cliente.ts. */
export interface ReglaDelOrigen {
  clave: string;
  nombre: string;
  lenguaje: string;
  /** `READY`, `BETA` o `DEPRECATED`. */
  estado: string;
  tipo: string | null;
  severidad: string | null;
  tags: string[];
  atributoCleanCode: string | null;
  impactos: { calidad: string; severidad: string }[];
  parametros: { clave: string; descripcion?: string; tipo?: string; valorDefault?: string }[];
  descripcion: string;
}

/** Una regla como está en la base, con su estado en el ciclo de vida. */
export interface ReglaAlmacenada {
  id: string;
  clave: string;
  lenguaje: string;
  nombre: string;
  tipo: string | null;
  severidadDefault: string | null;
  tags: string[];
  atributoCleanCode: string | null;
  impactos: { calidad: string; severidad: string }[] | null;
  parametros: { clave: string; descripcion?: string; tipo?: string; valorDefault?: string }[] | null;
  descripcion: string;
  hashDescripcion: string;
  deprecada: boolean;
  estado: Estado;
}


export interface ResultadoDeComparacion {
  nuevas: ReglaDelOrigen[];
  modificadas: { id: string; regla: ReglaDelOrigen }[];
  actualizadas: { id: string; regla: ReglaDelOrigen }[];
  deprecadas: { id: string; motivo: "deprecada" | "eliminada" }[];
  reactivadas: { id: string }[];
  avisos: { reglaId: string; motivo: MotivoAviso }[];
}

/**
 * Huella de lo que define a la regla: descripción, parámetros y severidad por defecto. Si
 * cambia, la regla está "modificada". Se guarda en `regla.hashDescripcion`.
 */
export function huellaDeRegla(regla: Pick<ReglaDelOrigen, "descripcion" | "parametros" | "severidad">): string {
  const contenido = canonico({
    descripcion: regla.descripcion,
    parametros: ordenarParametros(regla.parametros),
    severidad: regla.severidad,
  });
  return createHash("sha256").update(contenido).digest("hex");
}

/**
 * @param lenguajes los lenguajes que se consultaron en el origen. Solo las reglas
 *   almacenadas de esos lenguajes pueden darse por eliminadas.
 */
export function compararCatalogo(
  almacenadas: readonly ReglaAlmacenada[],
  delOrigen: readonly ReglaDelOrigen[],
  lenguajes: readonly string[],
): ResultadoDeComparacion {
  const porClave = new Map<string, ReglaDelOrigen>();
  for (const regla of delOrigen) {
    if (porClave.has(regla.clave)) {
      throw new Error(`La regla ${regla.clave} vino repetida del origen.`);
    }
    porClave.set(regla.clave, regla);
  }

  // Un lenguaje que vuelve vacío y tiene reglas guardadas es casi seguro un problema del
  // origen o de la configuración. Darlas a todas por eliminadas sería peor que no hacer nada.
  for (const lenguaje of lenguajes) {
    const guardadas = almacenadas.some((r) => r.lenguaje === lenguaje && !r.deprecada);
    const recibidas = delOrigen.some((r) => r.lenguaje === lenguaje);
    if (guardadas && !recibidas) {
      throw new Error(
        `El origen no devolvió ninguna regla de '${lenguaje}', que tiene reglas guardadas. No se marca nada.`,
      );
    }
  }

  const resultado: ResultadoDeComparacion = {
    nuevas: [],
    modificadas: [],
    actualizadas: [],
    deprecadas: [],
    reactivadas: [],
    avisos: [],
  };

  const vistas = new Set<string>();

  for (const guardada of almacenadas) {
    const regla = porClave.get(guardada.clave);
    vistas.add(guardada.clave);

    if (!regla) {
      if (lenguajes.includes(guardada.lenguaje) && !guardada.deprecada) {
        marcarDeprecada(resultado, guardada, "eliminada");
      }
      continue;
    }

    if (huellaDeRegla(regla) !== guardada.hashDescripcion) {
      resultado.modificadas.push({ id: guardada.id, regla });
      if (guardada.estado === Estado.Incorporada || guardada.estado === Estado.EnPrueba) {
        resultado.avisos.push({ reglaId: guardada.id, motivo: "modificada" });
      }
    } else if (cambioLaMetadata(guardada, regla)) {
      resultado.actualizadas.push({ id: guardada.id, regla });
    }

    const deprecadaEnOrigen = regla.estado === "DEPRECATED";
    if (deprecadaEnOrigen && !guardada.deprecada) {
      marcarDeprecada(resultado, guardada, "deprecada");
    } else if (!deprecadaEnOrigen && guardada.deprecada) {
      resultado.reactivadas.push({ id: guardada.id });
    }
  }

  for (const regla of delOrigen) {
    if (!vistas.has(regla.clave)) {
      resultado.nuevas.push(regla);
    }
  }

  return resultado;
}

function marcarDeprecada(
  resultado: ResultadoDeComparacion,
  guardada: ReglaAlmacenada,
  motivo: "deprecada" | "eliminada",
) {
  resultado.deprecadas.push({ id: guardada.id, motivo });
  if (guardada.estado === Estado.Incorporada) {
    resultado.avisos.push({ reglaId: guardada.id, motivo });
  }
}

function cambioLaMetadata(guardada: ReglaAlmacenada, regla: ReglaDelOrigen): boolean {
  return (
    guardada.nombre !== regla.nombre ||
    guardada.tipo !== regla.tipo ||
    guardada.atributoCleanCode !== regla.atributoCleanCode ||
    canonico([...guardada.tags].sort()) !== canonico([...regla.tags].sort()) ||
    canonico(ordenarImpactos(guardada.impactos ?? [])) !== canonico(ordenarImpactos(regla.impactos)) ||
    // Los parámetros y la descripción están en la huella; si la huella coincide pero lo
    // guardado difiere (por ejemplo, una descripción de parámetro), se actualiza igual.
    canonico(ordenarParametros(guardada.parametros ?? [])) !== canonico(ordenarParametros(regla.parametros)) ||
    guardada.descripcion !== regla.descripcion ||
    guardada.severidadDefault !== regla.severidad
  );
}

function ordenarParametros(parametros: ReglaDelOrigen["parametros"]) {
  return [...parametros].sort((a, b) => a.clave.localeCompare(b.clave));
}

function ordenarImpactos(impactos: ReglaDelOrigen["impactos"]) {
  return [...impactos].sort((a, b) => a.calidad.localeCompare(b.calidad) || a.severidad.localeCompare(b.severidad));
}

/**
 * JSON con las claves de los objetos ordenadas. Postgres guarda los jsonb con otro orden
 * de claves, y el orden no tiene que contar como cambio.
 */
function canonico(valor: unknown): string {
  return JSON.stringify(valor, (_clave, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
