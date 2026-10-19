import { and, asc, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Estado, Origen } from "@/dominio/valores";
import type { ClienteSonar, ReglaDeSonar } from "@/sonar/cliente";
import { ErrorDeSonar } from "@/sonar/cliente";

import { hayGrabacion, reglasGrabadas } from "../sonar/grabacion";

/**
 * Job `sincronizar-sonar` contra una base real (entrega 6.1, paso 6). Las reglas de Sonar
 * son las de la grabación de SonarQube Cloud (tests/fixtures/sonar/), así que la primera
 * corrida carga el catálogo real completo.
 *
 * Criterios del paso: "Primera corrida carga todas las reglas de cs y ts en Pendiente; la
 * segunda no cambia nada."
 *
 * Necesita DATABASE_URL_PRUEBAS (ver tests/auth/usuarios.test.ts). **Borra todas las
 * reglas de Sonar, los avisos y las sincronizaciones de esa base.**
 */

const url = process.env.DATABASE_URL_PRUEBAS;

describe.skipIf(!url || !hayGrabacion)("sincronización con Sonar contra la base", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { aviso, decision, desvio, estadoRegla, publicacion, regla, sincronizacion, usuario } = await import("@/db/esquema");
  const { sincronizarSonar } = await import("@/sincronizacion/sincronizarSonar");

  const db = () => obtenerDb();

  let grabadas: Record<string, ReglaDeSonar[]>;
  let total: number;

  /** Un Sonar falso que devuelve la grabación; `cambiar` la modifica antes de devolverla. */
  function sonar(cambiar: (reglas: ReglaDeSonar[]) => ReglaDeSonar[] = (r) => r): Pick<ClienteSonar, "buscarReglas"> {
    return { buscarReglas: async (lenguaje) => cambiar(structuredClone(grabadas[lenguaje])) };
  }

  async function limpiar() {
    await db().delete(aviso);
    // Solo lo de reglas de Sonar: otros tests usan la misma base en paralelo. Primero las
    // publicaciones, que apuntan a las decisiones y a los desvíos (entrega 6.2).
    const deSonar = db().select({ id: regla.id }).from(regla).where(eq(regla.origen, Origen.Sonar));
    await db().delete(publicacion).where(inArray(publicacion.reglaId, deSonar));
    await db().delete(desvio).where(inArray(desvio.reglaId, deSonar));
    await db().delete(decision).where(inArray(decision.reglaId, deSonar));
    await db().delete(regla).where(eq(regla.origen, Origen.Sonar));
    await db().delete(sincronizacion);
  }

  /** Todo lo que la sincronización escribe, para comparar antes y después. */
  async function foto() {
    return {
      reglas: await db().select().from(regla).where(eq(regla.origen, Origen.Sonar)).orderBy(asc(regla.clave)),
      estados: await db()
        .select({ estado: estadoRegla })
        .from(estadoRegla)
        .innerJoin(regla, eq(regla.id, estadoRegla.reglaId))
        .where(eq(regla.origen, Origen.Sonar))
        .orderBy(asc(estadoRegla.reglaId)),
      avisos: await db().select().from(aviso).orderBy(asc(aviso.id)),
    };
  }

  async function idDe(clave: string) {
    const [fila] = await db().select({ id: regla.id }).from(regla).where(eq(regla.clave, clave));
    return fila.id;
  }

  async function ponerEnEstado(clave: string, estado: Estado) {
    await db().update(estadoRegla).set({ estado }).where(eq(estadoRegla.reglaId, await idDe(clave)));
  }

  beforeAll(async () => {
    grabadas = { cs: await reglasGrabadas("cs"), ts: await reglasGrabadas("ts") };
    total = grabadas.cs.length + grabadas.ts.length;
  });
  beforeEach(limpiar);
  afterAll(async () => {
    await limpiar();
    await db().$client.end();
  });

  it("la primera corrida carga todas las reglas de cs y ts en Pendiente de analizar", async () => {
    const resumen = await sincronizarSonar({ db: db(), sonar: sonar() });

    expect(resumen).toMatchObject({ estado: "ok", nuevas: total, modificadas: 0, deprecadas: 0, avisos: 0 });

    const porLenguaje = await db()
      .select({ lenguaje: regla.lenguaje, cantidad: count() })
      .from(regla)
      .where(eq(regla.origen, Origen.Sonar))
      .groupBy(regla.lenguaje)
      .orderBy(asc(regla.lenguaje));
    expect(porLenguaje).toEqual([
      { lenguaje: "cs", cantidad: grabadas.cs.length },
      { lenguaje: "ts", cantidad: grabadas.ts.length },
    ]);

    const estados = await db()
      .select({ estado: estadoRegla.estado, cantidad: count() })
      .from(estadoRegla)
      .innerJoin(regla, eq(regla.id, estadoRegla.reglaId))
      .where(eq(regla.origen, Origen.Sonar))
      .groupBy(estadoRegla.estado);
    expect(estados).toEqual([{ estado: Estado.PendienteDeAnalizar, cantidad: total }]);

    // Las que Sonar ya da como deprecadas entran marcadas.
    const deprecadasEnSonar = [...grabadas.cs, ...grabadas.ts].filter((r) => r.estado === "DEPRECATED").length;
    const [{ marcadas }] = await db()
      .select({ marcadas: count() })
      .from(regla)
      .where(and(eq(regla.origen, Origen.Sonar), isNotNull(regla.deprecadaEn)));
    expect(marcadas).toBe(deprecadasEnSonar);

    // Todas quedan asociadas a la corrida que las trajo (filtro "nuevas").
    const [{ deEstaCorrida }] = await db()
      .select({ deEstaCorrida: count() })
      .from(regla)
      .where(eq(regla.altaEnSincronizacionId, resumen.id));
    expect(deEstaCorrida).toBe(total);

    const [corrida] = await db().select().from(sincronizacion).where(eq(sincronizacion.id, resumen.id));
    expect(corrida).toMatchObject({ origen: "sonar", estado: "ok", nuevas: total, modificadas: 0, deprecadas: 0, error: null });
    expect(corrida.terminadaEn).not.toBeNull();
  });

  it("los datos de cada regla quedan como los trae Sonar", async () => {
    await sincronizarSonar({ db: db(), sonar: sonar() });

    const deSonar = grabadas.cs.find((r) => r.clave === "csharpsquid:S2325")!;
    const [guardada] = await db().select().from(regla).where(eq(regla.clave, "csharpsquid:S2325"));
    expect(guardada).toMatchObject({
      origen: "sonar",
      lenguaje: "cs",
      nombre: deSonar.nombre,
      descripcion: deSonar.descripcion,
      tipo: deSonar.tipo,
      severidadDefault: deSonar.severidad,
      tags: deSonar.tags,
      atributoCleanCode: deSonar.atributoCleanCode,
      impactos: deSonar.impactos,
      parametros: deSonar.parametros,
      deprecadaEn: null,
    });
  });

  it("la segunda corrida, sin cambios en Sonar, no crea ni modifica nada", async () => {
    await sincronizarSonar({ db: db(), sonar: sonar() });
    const antes = await foto();

    const resumen = await sincronizarSonar({ db: db(), sonar: sonar() });

    expect(resumen).toMatchObject({ estado: "ok", nuevas: 0, modificadas: 0, deprecadas: 0, actualizadas: 0, avisos: 0 });
    expect(await foto()).toEqual(antes);
    // La corrida sí queda registrada.
    expect(await db().select({ id: sincronizacion.id }).from(sincronizacion)).toHaveLength(2);
  });

  it("aplica los cambios de Sonar y avisa por las reglas en uso", async () => {
    const primera = await sincronizarSonar({ db: db(), sonar: sonar() });
    const reactivable = grabadas.cs.find((r) => r.estado === "DEPRECATED")!.clave;
    const [modificada, eliminada, deprecada, conOtrosTags] = grabadas.cs
      .filter((r) => r.estado !== "DEPRECATED" && r.clave !== "csharpsquid:S2325")
      .slice(0, 4)
      .map((r) => r.clave);
    await ponerEnEstado("csharpsquid:S2325", Estado.Incorporada);
    await ponerEnEstado(modificada, Estado.EnPrueba);
    await ponerEnEstado(eliminada, Estado.Incorporada);

    const resumen = await sincronizarSonar({
      db: db(),
      sonar: sonar((reglas) =>
        reglas
          .filter((r) => r.clave !== eliminada)
          .map((r) => {
            if (r.clave === "csharpsquid:S2325") return { ...r, severidad: "BLOCKER" };
            if (r.clave === modificada) return { ...r, descripcion: `${r.descripcion}<p>Agregado</p>` };
            if (r.clave === deprecada) return { ...r, estado: "DEPRECATED" };
            if (r.clave === conOtrosTags) return { ...r, tags: [...r.tags, "lainco-prueba"] };
            if (r.clave === reactivable) return { ...r, estado: "READY" };
            return r;
          }),
      ),
    });

    expect(resumen).toMatchObject({
      estado: "ok",
      nuevas: 0,
      modificadas: 3, // S2325, la de descripción nueva y la reactivada
      deprecadas: 2, // la eliminada y la deprecada
      actualizadas: 1, // la de tags
      avisos: 3, // S2325 (Incorporada), la modificada (En prueba), la eliminada (Incorporada)
    });

    const [s2325] = await db().select().from(regla).where(eq(regla.clave, "csharpsquid:S2325"));
    expect(s2325.severidadDefault).toBe("BLOCKER");
    expect(s2325.modificadaEnSincronizacionId).toBe(resumen.id);
    expect(s2325.altaEnSincronizacionId).toBe(primera.id);

    const [tags] = await db().select().from(regla).where(eq(regla.clave, conOtrosTags));
    expect(tags.tags).toContain("lainco-prueba");
    expect(tags.modificadaEnSincronizacionId).toBeNull();

    for (const clave of [eliminada, deprecada]) {
      const [fila] = await db().select().from(regla).where(eq(regla.clave, clave));
      expect(fila.deprecadaEn, clave).not.toBeNull();
    }
    const [reactivada] = await db().select().from(regla).where(eq(regla.clave, reactivable));
    expect(reactivada.deprecadaEn).toBeNull();

    const avisos = await db()
      .select({ clave: regla.clave, motivo: aviso.motivo, sincronizacionId: aviso.sincronizacionId })
      .from(aviso)
      .innerJoin(regla, eq(regla.id, aviso.reglaId))
      .orderBy(asc(regla.clave));
    expect(avisos).toEqual(
      [
        { clave: "csharpsquid:S2325", motivo: "modificada", sincronizacionId: resumen.id },
        { clave: modificada, motivo: "modificada", sincronizacionId: resumen.id },
        { clave: eliminada, motivo: "eliminada", sincronizacionId: resumen.id },
      ].sort((a, b) => a.clave.localeCompare(b.clave)),
    );

    // El estado del ciclo de vida no lo toca la sincronización.
    const [estado] = await db()
      .select({ estado: estadoRegla.estado })
      .from(estadoRegla)
      .where(eq(estadoRegla.reglaId, await idDe("csharpsquid:S2325")));
    expect(estado.estado).toBe(Estado.Incorporada);
  });

  it("si Sonar falla, la corrida queda con error y no se escribe nada", async () => {
    const resumen = await sincronizarSonar({
      db: db(),
      sonar: {
        buscarReglas: async (lenguaje) => {
          if (lenguaje === "ts") throw new ErrorDeSonar("servidor", "SonarQube no respondió bien.");
          return grabadas.cs;
        },
      },
    });

    expect(resumen).toMatchObject({ estado: "error", nuevas: 0, error: "SonarQube no respondió bien." });
    const [corrida] = await db().select().from(sincronizacion).where(eq(sincronizacion.id, resumen.id));
    expect(corrida).toMatchObject({ estado: "error", error: "SonarQube no respondió bien.", nuevas: 0 });
    expect(corrida.terminadaEn).not.toBeNull();
    expect(await db().select({ id: regla.id }).from(regla).where(eq(regla.origen, Origen.Sonar))).toEqual([]);
  });

  it("si falla al escribir, no queda nada a medias", async () => {
    // Una regla de un lenguaje que la base no conoce rompe la clave foránea a mitad de la
    // carga: la transacción entera se deshace.
    const resumen = await sincronizarSonar({
      db: db(),
      sonar: sonar((reglas) => (reglas[0]?.lenguaje === "ts" ? [...reglas, { ...reglas[0], clave: "x:S1", lenguaje: "java" }] : reglas)),
    });

    expect(resumen.estado).toBe("error");
    expect(await db().select({ id: regla.id }).from(regla).where(eq(regla.origen, Origen.Sonar))).toEqual([]);
  });

  it("dos corridas a la vez no duplican nada", async () => {
    const resumenes = await Promise.all([
      sincronizarSonar({ db: db(), sonar: sonar() }),
      sincronizarSonar({ db: db(), sonar: sonar() }),
    ]);

    expect(resumenes.map((r) => r.estado)).toEqual(["ok", "ok"]);
    expect(resumenes.map((r) => r.nuevas).sort((a, b) => a - b)).toEqual([0, total]);
    const [{ cantidad }] = await db().select({ cantidad: count() }).from(regla).where(eq(regla.origen, Origen.Sonar));
    expect(cantidad).toBe(total);
  });

  it("registra quién la disparó desde la app", async () => {
    const [decisor] = await db()
      .select({ id: usuario.id })
      .from(usuario)
      .where(eq(usuario.email, "federico.sanchez@laincosoftware.com"));

    const resumen = await sincronizarSonar({ db: db(), sonar: sonar(), disparadaPorId: decisor.id });

    const [corrida] = await db().select().from(sincronizacion).where(eq(sincronizacion.id, resumen.id));
    expect(corrida.disparadaPorId).toBe(decisor.id);
  });

  it("la huella guardada es la de la definición de la regla", async () => {
    await sincronizarSonar({ db: db(), sonar: sonar() });

    const [{ distintas }] = await db()
      .select({ distintas: sql<number>`count(distinct ${regla.hashDescripcion})::int` })
      .from(regla)
      .where(eq(regla.origen, Origen.Sonar));
    // Cada regla tiene su descripción: las huellas no se repiten (salvo alguna duplicada en Sonar).
    expect(distintas).toBeGreaterThan(total * 0.95);
  });
});
