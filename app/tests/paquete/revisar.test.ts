import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";
import { Estado, EstadoPr, Origen, Rol, TipoDesvio, type Estado as TipoEstado } from "@/dominio/valores";
import { ErrorDeGitHub } from "@/github/cliente";
import { RUTAS } from "@/paquete/pr";

import { githubEnMemoria } from "./githubEnMemoria";

/**
 * Seguimiento del paquete (entrega 6.4, paso 7): el estado de los PRs de configuración y
 * el desvío cuando el `.globalconfig` de main no es el de la app y no hay un PR que lo
 * corrija. Contra una base real y un GitHub en memoria, como tests/paquete/publicar.test.ts:
 * cada test en una transacción que se descarta, con reglas LAIN9##.
 */

const url = process.env.DATABASE_URL_PRUEBAS;

class Descartada extends Error {}

describe.skipIf(!url)("revisión del paquete", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { desvio, estadoRegla, prConfiguracion, regla, revisionPaquete, usuario } = await import("@/db/esquema");
  const { aplicarTransicion } = await import("@/transiciones/aplicarTransicion");
  const { publicarPaquete } = await import("@/paquete/publicar");
  const { revisarPaquete, DESVIO_DEL_PAQUETE } = await import("@/paquete/revisar");

  interface Contexto {
    tx: Db;
    decisor: { id: string; rol: Rol };
    reglaPropia(clave: string, estado: TipoEstado): Promise<string>;
    incorporar(id: string): Promise<void>;
    desvioAbierto(): Promise<(typeof desvio.$inferSelect) | undefined>;
    pr(numero: number): Promise<(typeof prConfiguracion.$inferSelect) | undefined>;
  }

  function enTransaccion(nombre: string, prueba: (c: Contexto) => Promise<void>) {
    it(nombre, async () => {
      const resultado = obtenerDb().transaction(async (transaccion) => {
        const tx = transaccion as unknown as Db;
        // Puede haber un desvío del paquete abierto de otra base de datos de pruebas vieja: no cuenta.
        await tx.delete(desvio).where(eq(desvio.tipo, TipoDesvio.GlobalconfigDistinto));
        await tx.delete(prConfiguracion);
        const [decisor] = await tx
          .insert(usuario)
          .values({ nombre: "Federico Sánchez", email: "prueba-rev-decisor@laincosoftware.com", rol: Rol.Decisor })
          .returning({ id: usuario.id, rol: usuario.rol });

        await prueba({
          tx,
          decisor,
          async reglaPropia(clave, estado) {
            const [creada] = await tx
              .insert(regla)
              .values({ origen: Origen.Roslyn, clave, lenguaje: "cs", nombre: `Título de ${clave}`, hashDescripcion: "x", severidadDefault: "warning" })
              .returning({ id: regla.id });
            await tx.insert(estadoRegla).values({ reglaId: creada.id, estado });
            return creada.id;
          },
          async incorporar(id) {
            const r = await aplicarTransicion(tx, decisor, { reglas: [{ id, desde: Estado.EnAnalisis }], hacia: Estado.Incorporada, justificacion: "x", masiva: false });
            if (!r.ok) throw new Error(JSON.stringify(r));
          },
          desvioAbierto: async () =>
            (await tx.select().from(desvio).where(and(eq(desvio.tipo, DESVIO_DEL_PAQUETE.tipo), isNull(desvio.resueltoEn))))[0],
          pr: async (numero) => (await tx.select().from(prConfiguracion).where(eq(prConfiguracion.numero, numero)))[0],
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

  enTransaccion("el PR que abre la publicación queda registrado, abierto, con la versión que propone", async (c) => {
    const repo = githubEnMemoria();
    await c.incorporar(await c.reglaPropia("LAIN901", Estado.EnAnalisis));

    await publicarPaquete({ db: c.tx, github: repo.github });

    expect(await c.pr(1)).toMatchObject({ numero: 1, version: "0.1.1", estado: EstadoPr.Abierto, url: "https://github.com/revertpablo/Lainco-quality/pull/1" });
  });

  enTransaccion("con el PR abierto no hay desvío; mergeado, la revisión lo registra y main coincide", async (c) => {
    const repo = githubEnMemoria();
    await c.incorporar(await c.reglaPropia("LAIN901", Estado.EnAnalisis));
    await publicarPaquete({ db: c.tx, github: repo.github });

    const conPr = await revisarPaquete({ db: c.tx, github: repo.github });
    expect(conPr).toMatchObject({ estado: "ok", versionEnMain: "0.1.0", coincide: false, desvio: null, prsCambiados: [] });

    repo.mergear("catalogo/globalconfig");
    const mergeado = await revisarPaquete({ db: c.tx, github: repo.github, disparadaPorId: c.decisor.id });

    expect(mergeado).toMatchObject({ estado: "ok", versionEnMain: "0.1.1", coincide: true, desvio: null, prsCambiados: [{ numero: 1, estado: "mergeado" }] });
    expect(await c.pr(1)).toMatchObject({ estado: EstadoPr.Mergeado });
    expect((await c.pr(1))!.mergeadoEn).not.toBeNull();
    const [registro] = await c.tx.select().from(revisionPaquete).where(eq(revisionPaquete.id, mergeado.id));
    expect(registro).toMatchObject({ estado: "ok", versionEnMain: "0.1.1", coincide: true, disparadaPorId: c.decisor.id });
  });

  enTransaccion("un PR cerrado sin mergear deja a main distinto de la app: desvío", async (c) => {
    const repo = githubEnMemoria();
    await c.incorporar(await c.reglaPropia("LAIN901", Estado.EnAnalisis));
    await publicarPaquete({ db: c.tx, github: repo.github });
    repo.cerrarSinMergear(1);

    const resumen = await revisarPaquete({ db: c.tx, github: repo.github });

    expect(resumen).toMatchObject({ coincide: false, desvio: "nuevo", prsCambiados: [{ numero: 1, estado: "cerrado" }] });
    expect(await c.pr(1)).toMatchObject({ estado: EstadoPr.Cerrado });
    const abierto = await c.desvioAbierto();
    expect(abierto).toMatchObject({ lenguaje: "cs", clave: "Lainco.Analyzers", reglaId: null });
    // LAIN901 está incorporada en la app y no está en main; LAIN004 y LAIN005 están en main y la app no las conoce.
    expect(abierto!.detalle).toEqual({
      esperado: { LAIN004: null, LAIN005: null, LAIN901: "warning" },
      encontrado: { LAIN004: "warning", LAIN005: "warning", LAIN901: null },
    });

    // La revisión siguiente no lo duplica.
    expect(await revisarPaquete({ db: c.tx, github: repo.github })).toMatchObject({ desvio: "sigue" });
  });

  enTransaccion("un decisor lo corrige abriendo el PR: el desvío se cierra en la revisión siguiente", async (c) => {
    const repo = githubEnMemoria();
    await c.incorporar(await c.reglaPropia("LAIN901", Estado.EnAnalisis));
    await publicarPaquete({ db: c.tx, github: repo.github });
    repo.cerrarSinMergear(1);
    await revisarPaquete({ db: c.tx, github: repo.github });

    // Sin nada pendiente: hay que forzar.
    expect(await publicarPaquete({ db: c.tx, github: repo.github, sinEsperar: true })).toMatchObject({ pr: null });
    const corregido = await publicarPaquete({ db: c.tx, github: repo.github, forzar: true });

    expect(corregido).toMatchObject({ publicadas: 0, pr: { numero: 2 }, version: "0.1.1" });
    expect(await revisarPaquete({ db: c.tx, github: repo.github })).toMatchObject({ desvio: "resuelto" });
    expect(await c.desvioAbierto()).toBeUndefined();
  });

  enTransaccion("un cambio a mano en main es un desvío; volver main a lo de la app lo cierra", async (c) => {
    const repo = githubEnMemoria();
    await c.reglaPropia("LAIN004", Estado.Incorporada);
    await c.reglaPropia("LAIN005", Estado.Incorporada);
    const { generarGlobalconfig } = await import("@/paquete/globalconfig");
    const { reglasDelPaquete } = await import("@/paquete/publicar");
    const deLaApp = generarGlobalconfig(await reglasDelPaquete(c.tx));
    repo.cambiarEnMain(RUTAS.globalconfig, deLaApp);
    expect(await revisarPaquete({ db: c.tx, github: repo.github })).toMatchObject({ coincide: true, desvio: null });

    repo.cambiarEnMain(RUTAS.globalconfig, deLaApp.replace("LAIN005.severity = warning", "LAIN005.severity = suggestion"));
    expect(await revisarPaquete({ db: c.tx, github: repo.github })).toMatchObject({ coincide: false, desvio: "nuevo" });
    expect((await c.desvioAbierto())!.detalle).toEqual({ esperado: { LAIN005: "warning" }, encontrado: { LAIN005: "suggestion" } });

    repo.cambiarEnMain(RUTAS.globalconfig, deLaApp);
    expect(await revisarPaquete({ db: c.tx, github: repo.github })).toMatchObject({ coincide: true, desvio: "resuelto" });
  });

  enTransaccion("con algo pendiente de pasar al paquete, la diferencia está en camino: no es desvío", async (c) => {
    const repo = githubEnMemoria();
    await c.incorporar(await c.reglaPropia("LAIN901", Estado.EnAnalisis));

    expect(await revisarPaquete({ db: c.tx, github: repo.github })).toMatchObject({ coincide: false, desvio: null });
  });

  enTransaccion("si GitHub falla, la revisión queda con error y el desvío no se toca", async (c) => {
    let caido = false;
    const repo = githubEnMemoria((op) => (caido && op === "commitDeRama" ? new ErrorDeGitHub("red", "No se pudo conectar con GitHub.") : undefined));
    await c.incorporar(await c.reglaPropia("LAIN901", Estado.EnAnalisis));
    await publicarPaquete({ db: c.tx, github: repo.github });
    repo.cerrarSinMergear(1);
    await revisarPaquete({ db: c.tx, github: repo.github });

    caido = true;
    const resumen = await revisarPaquete({ db: c.tx, github: repo.github });

    expect(resumen).toMatchObject({ estado: "error", error: "No se pudo conectar con GitHub.", desvio: null });
    expect(await c.desvioAbierto()).toBeDefined();
    const [registro] = await c.tx.select().from(revisionPaquete).where(eq(revisionPaquete.id, resumen.id));
    expect(registro).toMatchObject({ estado: "error", error: "No se pudo conectar con GitHub." });
  });

  enTransaccion("la reconciliación con Sonar no cierra el desvío del paquete", async (c) => {
    await c.tx.insert(desvio).values({ ...DESVIO_DEL_PAQUETE, detalle: { esperado: {}, encontrado: {} } });
    const { reconciliar } = await import("@/reconciliacion/reconciliar");
    const vacio = { cs: "Lainco C#", ts: "Lainco Typescript" } as const;
    const sonar = {
      buscarPerfil: async (lenguaje: string, nombre: string) => ({ clave: `p-${lenguaje}`, nombre, lenguaje, esDefault: true, heredaDe: null, esDeSonar: false, reglasActivas: 0 }),
      reglasActivas: async () => [],
      proyectos: async () => [],
      perfilesDelProyecto: async () => [],
    };

    const resumen = await reconciliar({ db: c.tx, sonar: sonar as never, perfiles: vacio });

    expect(resumen.estado).toBe("ok");
    expect(await c.desvioAbierto()).toBeDefined();
  });

  enTransaccion("lo que muestra la pantalla: versión publicada, revisión, PRs, lo que falta pasar y el desvío", async (c) => {
    const { estadoDelPaquete, atencionDelPaquete } = await import("@/paquete/consultas");
    const repo = githubEnMemoria();
    await c.incorporar(await c.reglaPropia("LAIN901", Estado.EnAnalisis));
    await publicarPaquete({ db: c.tx, github: repo.github });
    repo.cerrarSinMergear(1);
    await revisarPaquete({ db: c.tx, github: repo.github, disparadaPorId: c.decisor.id });
    await c.incorporar(await c.reglaPropia("LAIN902", Estado.EnAnalisis));

    const estado = await estadoDelPaquete(c.tx);

    expect(estado.ultimaRevision).toMatchObject({ estado: "ok", versionEnMain: "0.1.0", coincide: false, disparadaPor: "Federico Sánchez" });
    expect(estado.prs.map((p) => [p.numero, p.estado, p.estadoDescripcion, p.version])).toEqual([[1, "cerrado", "Cerrado sin mergear", "0.1.1"]]);
    expect(estado.sinPasar.map((p) => [p.clave, p.estado])).toEqual([["LAIN902", "pendiente"]]);
    expect(estado.desvio?.detalle?.esperado).toMatchObject({ LAIN901: "warning" });
    expect(await atencionDelPaquete(c.tx)).toEqual({ desvio: true, fallidas: 0 });
  });
});
