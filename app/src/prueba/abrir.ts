import { and, eq, isNull, or, sql } from "drizzle-orm";

import type { Db } from "@/db/cliente";
import { corridaPrueba, estadoRegla, regla, reglaEnCorrida, repositorioEnCorrida } from "@/db/esquema";
import { ErrorDePrueba, generarGlobalconfigDePrueba, idDeDiagnostico } from "@/dominio/prueba";
import { Estado, EstadoCorrida, Lenguaje, Origen } from "@/dominio/valores";

import type { RepositorioAProbar } from "./configuracion";

/**
 * Abrir una corrida del job de prueba (entrega 6.5, paso 3, decisión E4). El job la pide al
 * empezar; la app decide qué se prueba y dónde, y le devuelve el `.globalconfig` con el que
 * compilar.
 *
 * Entran las reglas En prueba que el job puede correr: de C#, no deprecadas; de Sonar, las
 * que no se sabe que no están en SonarAnalyzer.CSharp (E7: null es "todavía no se sabe").
 * Sin ninguna, no abre corrida.
 *
 * Una corrida anterior que siga en curso pasa a fallida: si el job pide otra, aquella ya no
 * va a terminar (el job anterior se cortó antes de mandar todos los resultados).
 */

/** Identifica el lock de la apertura de corridas (pg_advisory_xact_lock). */
const LOCK_DE_APERTURA = 6_500_301;

export interface ReglaDeLaCorrida {
  id: string;
  clave: string;
  /** El ID con el que el compilador la reporta (S2325, LAIN001). */
  diagnostico: string;
}

export interface CorridaAbierta {
  corrida: { id: string; iniciadaEn: Date } | null;
  reglas: ReglaDeLaCorrida[];
  repositorios: RepositorioAProbar[];
  globalconfig: string | null;
}

export async function abrirCorrida({
  db,
  tokenId,
  repositorios,
  workflowUrl,
  versiones = {},
  ahora = new Date(),
}: {
  db: Db;
  tokenId: string;
  /** De PRUEBA_REPOSITORIOS (src/prueba/configuracion.ts). */
  repositorios: readonly RepositorioAProbar[];
  workflowUrl?: string;
  versiones?: { sonarAnalyzer?: string; laincoAnalyzers?: string };
  ahora?: Date;
}): Promise<CorridaAbierta> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_DE_APERTURA})`);

    await tx
      .update(corridaPrueba)
      .set({ estado: EstadoCorrida.Fallida, terminadaEn: ahora, error: `No terminó: el job abrió otra corrida el ${ahora.toISOString()}.` })
      .where(eq(corridaPrueba.estado, EstadoCorrida.EnCurso));

    const candidatas = await tx
      .select({ id: regla.id, origen: regla.origen, clave: regla.clave })
      .from(regla)
      .innerJoin(estadoRegla, eq(estadoRegla.reglaId, regla.id))
      .where(
        and(
          eq(estadoRegla.estado, Estado.EnPrueba),
          eq(regla.lenguaje, Lenguaje.CSharp),
          isNull(regla.deprecadaEn),
          or(
            eq(regla.origen, Origen.Roslyn),
            and(eq(regla.origen, Origen.Sonar), or(isNull(regla.probableLocalmente), eq(regla.probableLocalmente, true))),
          ),
        ),
      );

    // Solo las que el compilador reporta con un ID conocido (una clave Roslyn que no es
    // LAIN### no se puede probar), en el orden del .globalconfig.
    const reglas = candidatas
      .flatMap((r) => {
        try {
          return [{ ...r, diagnostico: idDeDiagnostico(r) }];
        } catch (error) {
          if (error instanceof ErrorDePrueba) {
            return [];
          }
          throw error;
        }
      })
      .sort((a, b) => (a.diagnostico < b.diagnostico ? -1 : a.diagnostico > b.diagnostico ? 1 : 0));

    if (reglas.length === 0) {
      return { corrida: null, reglas: [], repositorios: [], globalconfig: null };
    }

    const [corrida] = await tx
      .insert(corridaPrueba)
      .values({
        iniciadaEn: ahora,
        tokenId,
        workflowUrl: workflowUrl ?? null,
        versionSonarAnalyzer: versiones.sonarAnalyzer ?? null,
        versionLaincoAnalyzers: versiones.laincoAnalyzers ?? null,
      })
      .returning({ id: corridaPrueba.id, iniciadaEn: corridaPrueba.iniciadaEn });
    await tx.insert(reglaEnCorrida).values(reglas.map((r) => ({ corridaId: corrida.id, reglaId: r.id })));
    await tx.insert(repositorioEnCorrida).values(repositorios.map(({ repositorio }) => ({ corridaId: corrida.id, repositorio })));

    return {
      corrida,
      reglas: reglas.map(({ id, clave, diagnostico }) => ({ id, clave, diagnostico })),
      repositorios: [...repositorios],
      globalconfig: generarGlobalconfigDePrueba(reglas),
    };
  });
}
