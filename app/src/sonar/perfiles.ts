import {
  ErrorDeSonar,
  esObjeto,
  invalida,
  lista,
  texto,
  totalDe,
  type Conexion,
} from "./http";

/**
 * Quality Profiles de SonarQube Cloud (entrega 6.2, paso 2): lo que necesitan la
 * publicación (activar y desactivar reglas) y la reconciliación (qué hay activo, si el
 * perfil hereda de otro, qué perfil usa cada proyecto).
 *
 * Endpoints de la Web API:
 *
 * - `GET  api/qualityprofiles/search`: perfiles por lenguaje y nombre, o los que usa un
 *   proyecto.
 * - `GET  api/rules/search` con `qprofile` y `activation=true`: reglas activas de un
 *   perfil; `f=actives` agrega, por regla, la severidad y los parámetros en el perfil.
 * - `GET  api/components/search`: proyectos de la organización. En SonarQube Cloud no
 *   acepta `qualifiers` (solo devuelve proyectos); igual se descarta lo que no sea uno.
 * - `POST api/qualityprofiles/activate_rule` y `deactivate_rule`: reciben la clave del
 *   perfil, que ya identifica a la organización.
 *
 * Verificado contra respuestas grabadas de SonarQube Cloud el 2026-10-19
 * (tests/fixtures/sonar-perfiles/). En particular, la definición de la API dice que
 * `activate_rule` deprecó `severity` el 21/08/2026 y lo reemplazó por `impacts`: la
 * severidad de cada calidad del software (`MAINTAINABILITY=HIGH;SECURITY=MEDIUM`). Por eso
 * se activa con impactos; cuáles, lo decide `src/dominio/severidad.ts`.
 */

/** Un Quality Profile. */
export interface PerfilDeSonar {
  /** Clave interna del perfil: la que piden activate_rule y rules/search. */
  clave: string;
  nombre: string;
  lenguaje: string;
  /** Es el perfil por defecto del lenguaje en la organización. */
  esDefault: boolean;
  /** El perfil del que hereda reglas, si hereda. */
  heredaDe: { clave: string; nombre: string | null } | null;
  /** Lo trae Sonar ("Sonar way"): no se puede editar. */
  esDeSonar: boolean;
  reglasActivas: number;
}

/** Una regla activa en un perfil, con lo que el perfil le configura. */
export interface ReglaActiva {
  /** `csharpsquid:S2325`. */
  clave: string;
  severidad: string | null;
  /** Impactos con la severidad que les da el perfil, si Sonar los informa. */
  impactos: { calidad: string; severidad: string }[];
  /** Valores de los parámetros en el perfil. */
  parametros: Record<string, string>;
  /** Viene de un perfil padre en lugar de estar activada en este. */
  heredada: boolean;
}

export interface ProyectoDeSonar {
  clave: string;
  nombre: string;
}

/** Cómo se activa una regla: lo que decidió quien la incorporó. */
export interface Activacion {
  /**
   * Severidad por calidad del software: `{ calidad: "MAINTAINABILITY", severidad: "HIGH" }`.
   * Sin impactos, Sonar usa los de la regla.
   */
  impactos?: { calidad: string; severidad: string }[];
  /** Solo los parámetros con un valor elegido; los demás quedan con el de Sonar. */
  parametros?: Record<string, string>;
}

export interface ClientePerfiles {
  /**
   * El perfil de un lenguaje con ese nombre exacto. Si no existe, falla con
   * `noEncontrado`: publicar en otro perfil cambiaría lo que analiza Sonar.
   */
  buscarPerfil(lenguaje: string, nombre: string): Promise<PerfilDeSonar>;
  /** Todas las reglas activas de un perfil, recorriendo todas las páginas. Completa o falla. */
  reglasActivas(perfil: string): Promise<ReglaActiva[]>;
  /** Todos los proyectos de la organización. */
  proyectos(): Promise<ProyectoDeSonar[]>;
  /** Los perfiles que usa un proyecto: uno por lenguaje (el asignado o el default). */
  perfilesDelProyecto(proyecto: string): Promise<PerfilDeSonar[]>;
  /** Activa la regla en el perfil, o le cambia la severidad y los parámetros si ya estaba activa. */
  activarRegla(perfil: string, regla: string, activacion: Activacion): Promise<void>;
  /** Desactiva la regla en el perfil. */
  desactivarRegla(perfil: string, regla: string): Promise<void>;
}

/** La API no devuelve resultados más allá de este número, pagine como se pagine. */
const RESULTADOS_MAXIMOS = 10_000;

export function crearClientePerfiles(conexion: Conexion, tamanoDePagina: number): ClientePerfiles {
  /** Recorre todas las páginas de un listado, con los mismos controles que el catálogo. */
  async function todasLasPaginas<T>(
    que: string,
    pedirPagina: (pagina: number) => Promise<unknown>,
    leer: (cuerpo: Record<string, unknown>) => { elementos: T[]; clave: (t: T) => string },
  ): Promise<T[]> {
    const todos: T[] = [];
    const claves = new Set<string>();
    let totalEsperado: number | undefined;

    for (let pagina = 1; ; pagina++) {
      const cuerpo = await pedirPagina(pagina);
      if (!esObjeto(cuerpo)) {
        throw invalida(`al listar ${que} no es un objeto`);
      }
      const total = totalDe(cuerpo, que);
      const { elementos, clave } = leer(cuerpo);
      const cambio = (detalle: string) =>
        new ErrorDeSonar("inconsistente", `La lista de ${que} cambió mientras se consultaba (${detalle}). Hay que volver a intentar.`);

      if (total > RESULTADOS_MAXIMOS) {
        throw new ErrorDeSonar("demasiadosResultados", `SonarQube tiene ${total} ${que} y la API devuelve como máximo ${RESULTADOS_MAXIMOS}.`);
      }
      if (totalEsperado !== undefined && total !== totalEsperado) {
        throw cambio(`el total pasó de ${totalEsperado} a ${total}`);
      }
      totalEsperado = total;

      for (const elemento of elementos) {
        if (claves.has(clave(elemento))) {
          throw cambio(`${clave(elemento)} vino repetido`);
        }
        claves.add(clave(elemento));
        todos.push(elemento);
      }

      if (todos.length >= total) {
        if (todos.length > total) {
          throw cambio(`vinieron ${todos.length} y el total era ${total}`);
        }
        return todos;
      }
      if (elementos.length === 0) {
        throw cambio(`la página ${pagina} vino vacía con ${todos.length} de ${total}`);
      }
    }
  }

  return {
    async buscarPerfil(lenguaje, nombre) {
      const cuerpo = await conexion.pedir({
        ruta: "api/qualityprofiles/search",
        parametros: { language: lenguaje, qualityProfile: nombre },
        descripcion: `buscar el perfil '${nombre}' de '${lenguaje}'`,
        permiso: "ver los Quality Profiles",
      });
      // Se filtra acá también: no se depende de cómo compare nombres la API.
      const perfil = leerPerfiles(cuerpo).find((p) => p.nombre === nombre && p.lenguaje === lenguaje);
      if (!perfil) {
        throw new ErrorDeSonar(
          "noEncontrado",
          `No hay un Quality Profile '${nombre}' de '${lenguaje}' en la organización de SonarQube. Revisá la configuración de los perfiles (app/README.md, "SonarQube").`,
        );
      }
      return perfil;
    },

    reglasActivas(perfil) {
      return todasLasPaginas(
        `reglas activas del perfil ${perfil}`,
        (pagina) =>
          conexion.pedir({
            ruta: "api/rules/search",
            parametros: { qprofile: perfil, activation: "true", f: "actives", ps: String(tamanoDePagina), p: String(pagina) },
            descripcion: `traer la página ${pagina} de reglas activas del perfil ${perfil}`,
            permiso: "ver los Quality Profiles",
          }),
        (cuerpo) => ({ elementos: leerActivas(cuerpo, perfil), clave: (r) => r.clave }),
      );
    },

    async proyectos() {
      const componentes = await todasLasPaginas<ProyectoDeSonar & { esProyecto: boolean }>(
        "proyectos",
        (pagina) =>
          conexion.pedir({
            ruta: "api/components/search",
            parametros: { ps: String(tamanoDePagina), p: String(pagina) },
            descripcion: `traer la página ${pagina} de proyectos`,
            permiso: "ver los proyectos",
          }),
        (cuerpo) => ({ elementos: leerProyectos(cuerpo), clave: (p) => p.clave }),
      );
      // Se filtra después de paginar, para que los totales sigan cuadrando.
      return componentes.filter((c) => c.esProyecto).map(({ clave, nombre }) => ({ clave, nombre }));
    },

    async perfilesDelProyecto(proyecto) {
      return leerPerfiles(
        await conexion.pedir({
          ruta: "api/qualityprofiles/search",
          parametros: { project: proyecto },
          descripcion: `buscar los perfiles del proyecto ${proyecto}`,
          permiso: "ver los Quality Profiles",
        }),
      );
    },

    async activarRegla(perfil, regla, activacion) {
      const parametros: Record<string, string> = { key: perfil, rule: regla };
      if (activacion.impactos && activacion.impactos.length > 0) {
        parametros.impacts = formatoDeImpactos(regla, activacion.impactos);
      }
      const valores = Object.entries(activacion.parametros ?? {});
      if (valores.length > 0) {
        parametros.params = formatoDeParametros(regla, valores);
      }
      await conexion.pedir({
        metodo: "POST",
        ruta: "api/qualityprofiles/activate_rule",
        parametros,
        descripcion: `activar ${regla} en el perfil ${perfil}`,
        permiso: "administrar Quality Profiles",
        conOrganizacion: false,
      });
    },

    async desactivarRegla(perfil, regla) {
      await conexion.pedir({
        metodo: "POST",
        ruta: "api/qualityprofiles/deactivate_rule",
        parametros: { key: perfil, rule: regla },
        descripcion: `desactivar ${regla} en el perfil ${perfil}`,
        permiso: "administrar Quality Profiles",
        conOrganizacion: false,
      });
    },
  };
}

/** `MAINTAINABILITY=HIGH;SECURITY=MEDIUM`, el formato de `impacts` en activate_rule. */
function formatoDeImpactos(regla: string, impactos: { calidad: string; severidad: string }[]): string {
  const calidades = new Set<string>();
  for (const { calidad, severidad } of impactos) {
    if (!/^[A-Z_]+$/.test(calidad) || !/^[A-Z_]+$/.test(severidad)) {
      throw new Error(`El impacto ${calidad}=${severidad} de ${regla} no tiene un formato que Sonar acepte.`);
    }
    if (calidades.has(calidad)) {
      throw new Error(`El impacto ${calidad} de ${regla} viene dos veces.`);
    }
    calidades.add(calidad);
  }
  return impactos.map(({ calidad, severidad }) => `${calidad}=${severidad}`).join(";");
}

/**
 * `clave1=valor1;clave2=valor2`, el formato de `params` en activate_rule. Sonar separa por
 * `;` y no tiene forma de escaparlo: un valor con `;` se publicaría partido, así que se
 * rechaza antes de mandarlo.
 */
function formatoDeParametros(regla: string, valores: [string, string][]): string {
  for (const [clave, valor] of valores) {
    if (clave.includes(";") || clave.includes("=")) {
      throw new Error(`El parámetro '${clave}' de ${regla} tiene un nombre que Sonar no acepta.`);
    }
    if (valor.includes(";")) {
      throw new Error(`El valor del parámetro '${clave}' de ${regla} tiene ';', que Sonar no permite publicar.`);
    }
  }
  return valores.map(([clave, valor]) => `${clave}=${valor}`).join(";");
}

// ------------------------------------------------------------ lectura de las respuestas

function leerPerfiles(cuerpo: unknown): PerfilDeSonar[] {
  if (!esObjeto(cuerpo) || !Array.isArray(cuerpo.profiles)) {
    throw invalida("no trae la lista de perfiles");
  }
  return lista(cuerpo.profiles, "la lista de perfiles").map((p) => {
    const clave = texto(p.key);
    const nombre = texto(p.name);
    const lenguaje = texto(p.language);
    if (!clave || !nombre || !lenguaje) {
      throw invalida(`trae un perfil sin clave, nombre o lenguaje (${clave ?? nombre ?? "sin datos"})`);
    }
    const padre = texto(p.parentKey);
    return {
      clave,
      nombre,
      lenguaje,
      esDefault: p.isDefault === true,
      heredaDe: padre ? { clave: padre, nombre: texto(p.parentName) ?? null } : null,
      esDeSonar: p.isBuiltIn === true,
      reglasActivas: typeof p.activeRuleCount === "number" ? p.activeRuleCount : 0,
    };
  });
}

function leerActivas(cuerpo: Record<string, unknown>, perfil: string): ReglaActiva[] {
  if (!Array.isArray(cuerpo.rules)) {
    throw invalida("no trae la lista de reglas activas");
  }
  const activaciones = esObjeto(cuerpo.actives) ? cuerpo.actives : {};

  return lista(cuerpo.rules, "la lista de reglas activas").map((r) => {
    const clave = texto(r.key);
    if (!clave) {
      throw invalida("trae una regla activa sin clave");
    }
    // Una regla puede estar activa en varios perfiles; interesa la activación en este.
    const enEstePerfil = lista(activaciones[clave], `las activaciones de ${clave}`).find((a) => texto(a.qProfile) === perfil);
    if (!enEstePerfil) {
      throw invalida(`no dice cómo está activa ${clave} en el perfil ${perfil}`);
    }

    const parametros: Record<string, string> = {};
    for (const p of lista(enEstePerfil.params, `los parámetros de ${clave}`)) {
      const nombre = texto(p.key);
      const valor = texto(p.value);
      if (!nombre || valor === undefined) {
        throw invalida(`trae un parámetro incompleto en ${clave}`);
      }
      parametros[nombre] = valor;
    }

    const herencia = texto(enEstePerfil.inherit);
    return {
      clave,
      severidad: texto(enEstePerfil.severity) ?? null,
      impactos: lista(enEstePerfil.impacts, `los impactos de ${clave}`).map((i) => {
        const calidad = texto(i.softwareQuality);
        const severidad = texto(i.severity);
        if (!calidad || !severidad) {
          throw invalida(`trae un impacto incompleto en ${clave}`);
        }
        return { calidad, severidad };
      }),
      parametros,
      heredada: herencia === "INHERITED" || herencia === "OVERRIDES",
    };
  });
}

function leerProyectos(cuerpo: Record<string, unknown>): (ProyectoDeSonar & { esProyecto: boolean })[] {
  if (!Array.isArray(cuerpo.components)) {
    throw invalida("no trae la lista de proyectos");
  }
  return lista(cuerpo.components, "la lista de proyectos").map((c) => {
    const clave = texto(c.key);
    if (!clave) {
      throw invalida("trae un proyecto sin clave");
    }
    return { clave, nombre: texto(c.name) ?? clave, esProyecto: c.qualifier === undefined || c.qualifier === "TRK" };
  });
}
