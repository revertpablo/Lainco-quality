import { and, eq, inArray, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";
import { Estado, EstadoPublicacion, Origen, Rol, TipoDesvio, type Estado as TipoEstado } from "@/dominio/valores";
import { RUTAS } from "@/paquete/pr";
import { RUTAS_ESLINT } from "@/paquete/prEslint";

import { githubEnMemoria } from "./githubEnMemoria";

/**
 * El PR de @lainco/eslint-config contra una base real y un GitHub en memoria (entrega
 * 6.4, parte ESLint, decisiones L3 y L4). `main` arranca con `reglas.json` y el
 * `package.json` de la config como estaban al cerrar la Fase 5 (versión 0.1.0).
 *
 * Criterio de la 6.4: "Incorporar una regla ESLint propia abre un PR con el cambio en
 * `reglas.json`."
 *
 * Necesita DATABASE_URL_PRUEBAS. Cada test corre en una transacción que se descarta. Usa
 * claves `lainco/prueba-*`.
 */

const url = process.env.DATABASE_URL_PRUEBAS;

class Descartada extends Error {}

describe.skipIf(!url)("publicar en el paquete: el PR de @lainco/eslint-config", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { desvio, estadoRegla, prConfiguracion, publicacion, regla, revisionPaquete, usuario } = await import("@/db/esquema");
  const { aplicarTransicion } = await import("@/transiciones/aplicarTransicion");
  const { publicarPaquete } = await import("@/paquete/publicar");
  const { revisarPaquete } = await import("@/paquete/revisar");
  const { PAQUETE_ESLINT, PAQUETE_ROSLYN } = await import("@/paquete/paquetes");

  interface Contexto {
    tx: Db;
    reglaPropia(origen: typeof Origen.Roslyn | typeof Origen.Eslint, clave: string, estado: TipoEstado): Promise<string>;
    decidir(id: string, desde: TipoEstado, hacia: TipoEstado): Promise<void>;
  }

  function enTransaccion(nombre: string, prueba: (c: Contexto) => Promise<void>) {
    it(nombre, async () => {
      const resultado = obtenerDb().transaction(async (transaccion) => {
        const tx = transaccion as unknown as Db;
        // Solo las reglas de este test: las ESLint inventadas de otros tests no tienen claves lainco/.
        const otras = tx.select({ id: regla.id }).from(regla).where(eq(regla.origen, Origen.Eslint));
        await tx.delete(publicacion).where(inArray(publicacion.reglaId, otras));
        await tx.update(regla).set({ deprecadaEn: new Date() }).where(eq(regla.origen, Origen.Eslint));
        const [decisor] = await tx
          .insert(usuario)
          .values({ nombre: "Pablo Revert", email: "prueba-esl-decisor@laincosoftware.com", rol: Rol.Decisor })
          .returning({ id: usuario.id, rol: usuario.rol });

        await prueba({
          tx,
          async reglaPropia(origen, clave, estado) {
            const [creada] = await tx
              .insert(regla)
              .values({ origen, clave, lenguaje: origen === Origen.Eslint ? "ts" : "cs", nombre: `Título de ${clave}`, hashDescripcion: "x", severidadDefault: "warning" })
              .returning({ id: regla.id });
            await tx.insert(estadoRegla).values({ reglaId: creada.id, estado, severidadAsignada: estado === Estado.Incorporada ? "warning" : null });
            return creada.id;
          },
          async decidir(id, desde, hacia) {
            const r = await aplicarTransicion(tx, decisor, { reglas: [{ id, desde }], hacia, justificacion: "Decisión de prueba.", masiva: false });
            if (!r.ok) throw new Error(`No se aplicó: ${JSON.stringify(r)}`);
          },
        });
        throw new Descartada();
      });
      await resultado.then(
        () => expect.unreachable("La transacción tenía que descartarse."),
        (e: unknown) => {
          if (!(e instanceof Descartada)) throw e;
        },
      );
    });
  }

  enTransaccion("incorporar una regla ESLint abre su PR con reglas.json y la versión de la config", async (c) => {
    const id = await c.reglaPropia(Origen.Eslint, "lainco/prueba-secretos", Estado.EnAnalisis);
    await c.decidir(id, Estado.EnAnalisis, Estado.Incorporada);
    const repo = githubEnMemoria();

    const resumen = await publicarPaquete({ db: c.tx, github: repo.github, paquete: PAQUETE_ESLINT });

    expect(resumen).toMatchObject({ publicadas: 1, fallidas: 0, version: "0.1.1", error: null });
    expect(repo.prs).toHaveLength(1);
    const [pr] = repo.prs;
    expect(pr).toMatchObject({ rama: "catalogo/eslint-config", base: "main", titulo: "@lainco/eslint-config 0.1.1: reglas decididas en el catálogo de reglas" });
    expect(pr.cuerpo).toContain("actualiza el `reglas.json` de `@lainco/eslint-config` y sube la versión de 0.1.0 a 0.1.1");
    expect(pr.cuerpo).toContain("| lainco/prueba-secretos — Título de lainco/prueba-secretos | (no está) | `warn` | Incorporada por Pablo Revert el ");

    expect(repo.padreDe("catalogo/eslint-config")).toBe(repo.commitDe("main"));
    expect(JSON.parse(repo.archivo("catalogo/eslint-config", RUTAS_ESLINT.reglas)!).reglas).toEqual({ "lainco/prueba-secretos": "warn" });
    expect(JSON.parse(repo.archivo("catalogo/eslint-config", RUTAS_ESLINT.paquete)!).version).toBe("0.1.1");
    // No toca Lainco.Analyzers.
    expect(repo.archivo("catalogo/eslint-config", RUTAS.csproj)).toBe(repo.archivo("main", RUTAS.csproj));

    const [pub] = await c.tx.select().from(publicacion).where(eq(publicacion.reglaId, id));
    expect(pub).toMatchObject({ estado: EstadoPublicacion.Publicada, accion: "activar", prNumero: pr.numero });
    const [seguimiento] = await c.tx.select().from(prConfiguracion).where(eq(prConfiguracion.numero, pr.numero));
    expect(seguimiento).toMatchObject({ paquete: "eslint", version: "0.1.1", estado: "abierto" });
  });

  enTransaccion("cada paquete toma solo las decisiones de sus reglas, en su propio PR", async (c) => {
    const roslyn = await c.reglaPropia(Origen.Roslyn, "LAIN951", Estado.EnAnalisis);
    const eslint = await c.reglaPropia(Origen.Eslint, "lainco/prueba-otra", Estado.EnAnalisis);
    await c.decidir(roslyn, Estado.EnAnalisis, Estado.Incorporada);
    await c.decidir(eslint, Estado.EnAnalisis, Estado.Incorporada);
    const repo = githubEnMemoria();

    const deRoslyn = await publicarPaquete({ db: c.tx, github: repo.github, paquete: PAQUETE_ROSLYN });

    expect(deRoslyn.publicadas).toBe(1);
    const [pubEslint] = await c.tx.select().from(publicacion).where(eq(publicacion.reglaId, eslint));
    expect(pubEslint.estado).toBe(EstadoPublicacion.Pendiente);

    const deEslint = await publicarPaquete({ db: c.tx, github: repo.github, paquete: PAQUETE_ESLINT });

    expect(deEslint.publicadas).toBe(1);
    expect(repo.prs.map((p) => p.rama).sort()).toEqual(["catalogo/eslint-config", "catalogo/globalconfig"]);
    expect(repo.archivo("catalogo/globalconfig", RUTAS.globalconfig)).not.toContain("lainco/");
    expect(repo.archivo("catalogo/eslint-config", RUTAS_ESLINT.reglas)).not.toContain("LAIN951");
  });

  enTransaccion("la revisión de ESLint detecta su desvío sin tocar el de Lainco.Analyzers", async (c) => {
    // La app no tiene ninguna regla ESLint incorporada; main enciende lainco/no-hardcoded-secrets a mano.
    await c.reglaPropia(Origen.Eslint, "lainco/no-hardcoded-secrets", Estado.EnAnalisis);
    const repo = githubEnMemoria();

    const resumen = await revisarPaquete({ db: c.tx, github: repo.github, paquete: PAQUETE_ESLINT });

    expect(resumen).toMatchObject({ estado: "ok", versionEnMain: "0.1.0", coincide: false, desvio: "nuevo" });
    const abiertos = await c.tx
      .select({ tipo: desvio.tipo, clave: desvio.clave, detalle: desvio.detalle })
      .from(desvio)
      .where(and(isNull(desvio.resueltoEn), inArray(desvio.tipo, [TipoDesvio.GlobalconfigDistinto, TipoDesvio.ReglasEslintDistintas])));
    expect(abiertos).toEqual([
      {
        tipo: TipoDesvio.ReglasEslintDistintas,
        clave: "@lainco/eslint-config",
        detalle: { esperado: { "lainco/no-hardcoded-secrets": "off" }, encontrado: { "lainco/no-hardcoded-secrets": "warn" } },
      },
    ]);
    const [revision] = await c.tx.select({ paquete: revisionPaquete.paquete }).from(revisionPaquete).where(eq(revisionPaquete.id, resumen.id));
    expect(revision.paquete).toBe("eslint");
  });
});
