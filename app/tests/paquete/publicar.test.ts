import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";
import { DestinoPublicacion, Estado, EstadoPublicacion, Origen, Rol, type Estado as TipoEstado } from "@/dominio/valores";
import { ErrorDeGitHub } from "@/github/cliente";
import { RUTAS } from "@/paquete/pr";

import { githubEnMemoria } from "./githubEnMemoria";

/**
 * El PR de configuración contra una base real y un GitHub en memoria (entrega 6.4,
 * paso 6; decisiones R4 y R5). `main` arranca con los archivos del paquete de
 * tests/fixtures/paquete/ (versión 0.1.0).
 *
 * Criterio de la 6.4: "Incorporar una regla propia abre un PR con el cambio en el
 * `.globalconfig`."
 *
 * Necesita DATABASE_URL_PRUEBAS. El job lee **todas** las reglas Roslyn, así que cada test
 * corre en una transacción que se descarta (como tests/sincronizacion/sincronizarRoslyn):
 * no ve las de otros tests, ni ellos las de este. Usa claves LAIN9##, que no chocan con
 * las del catálogo real.
 */

const url = process.env.DATABASE_URL_PRUEBAS;

class Descartada extends Error {}

describe.skipIf(!url)("publicar en el paquete: el PR de configuración", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { estadoRegla, publicacion, regla, usuario } = await import("@/db/esquema");
  const { aplicarTransicion } = await import("@/transiciones/aplicarTransicion");
  const { publicarPaquete, RAMA_DEL_PR } = await import("@/paquete/publicar");

  interface Contexto {
    tx: Db;
    decisor: { id: string; rol: Rol };
    /** Crea una regla Roslyn en ese estado y devuelve su id. */
    reglaPropia(clave: string, estado: TipoEstado, titulo?: string): Promise<string>;
    /** Pasa una regla de un estado a otro, como lo haría el decisor desde la app. */
    decidir(id: string, desde: TipoEstado, hacia: TipoEstado, justificacion?: string): Promise<void>;
    publicacionesDe(...reglaIds: string[]): Promise<(typeof publicacion.$inferSelect)[]>;
  }

  function enTransaccion(nombre: string, prueba: (c: Contexto) => Promise<void>) {
    it(nombre, async () => {
      const resultado = obtenerDb().transaction(async (transaccion) => {
        const tx = transaccion as unknown as Db;
        const [decisor] = await tx
          .insert(usuario)
          .values({ nombre: "Federico Sánchez", email: "prueba-paq-decisor@laincosoftware.com", rol: Rol.Decisor })
          .returning({ id: usuario.id, rol: usuario.rol });

        await prueba({
          tx,
          decisor,
          async reglaPropia(clave, estado, titulo = `Título de ${clave}`) {
            const [creada] = await tx
              .insert(regla)
              .values({ origen: Origen.Roslyn, clave, lenguaje: "cs", nombre: titulo, hashDescripcion: "x", severidadDefault: "warning" })
              .returning({ id: regla.id });
            await tx.insert(estadoRegla).values({ reglaId: creada.id, estado, severidadAsignada: estado === Estado.Incorporada ? "warning" : null });
            return creada.id;
          },
          async decidir(id, desde, hacia, justificacion = "Decisión de prueba.") {
            const resultado = await aplicarTransicion(tx, decisor, { reglas: [{ id, desde }], hacia, justificacion, masiva: false });
            if (!resultado.ok) throw new Error(`No se aplicó: ${JSON.stringify(resultado)}`);
          },
          publicacionesDe: (...reglaIds) => tx.select().from(publicacion).where(inArray(publicacion.reglaId, reglaIds)),
        });
        throw new Descartada();
      });
      // Un error del test se muestra tal cual; la transacción se descarta igual.
      await resultado.then(
        () => expect.unreachable("La transacción tenía que descartarse."),
        (e: unknown) => {
          if (!(e instanceof Descartada)) throw e;
        },
      );
    });
  }

  enTransaccion("incorporar una regla propia abre el PR con el .globalconfig, la versión y AnalyzerReleases", async (c) => {
    const id = await c.reglaPropia("LAIN901", Estado.ARevisar, "No se permite ToList() sobre queries");
    await c.decidir(id, Estado.ARevisar, Estado.Incorporada, "Regla dura acordada en la Fase 3.");
    const repo = githubEnMemoria();

    const resumen = await publicarPaquete({ db: c.tx, github: repo.github });

    expect(resumen).toMatchObject({ publicadas: 1, fallidas: 0, reprogramadas: 0, version: "0.1.1", error: null });
    expect(repo.prs).toHaveLength(1);
    const [pr] = repo.prs;
    expect(pr).toMatchObject({ numero: 1, rama: RAMA_DEL_PR, base: "main", abierto: true, titulo: "Lainco.Analyzers 0.1.1: severidades decididas en el catálogo de reglas" });
    expect(pr.cuerpo).toContain("| LAIN901 — No se permite ToList() sobre queries | (no está) | `warning` | Incorporada por Federico Sánchez el ");
    expect(pr.cuerpo).toContain(": Regla dura acordada en la Fase 3. |");

    // Un solo commit sobre main, con los cambios.
    expect(repo.padreDe(RAMA_DEL_PR)).toBe(repo.commitDe("main"));
    expect(repo.archivo(RAMA_DEL_PR, RUTAS.globalconfig)).toContain("dotnet_diagnostic.LAIN901.severity = warning");
    expect(repo.archivo(RAMA_DEL_PR, RUTAS.csproj)).toContain("<Version>0.1.1</Version>");
    expect(repo.archivo(RAMA_DEL_PR, RUTAS.shipped)).toContain("## Release 0.1.1");

    const [pub] = await c.publicacionesDe(id);
    expect(pub).toMatchObject({
      estado: EstadoPublicacion.Publicada,
      accion: "activar",
      severidad: "warning",
      prNumero: 1,
      prUrl: "https://github.com/revertpablo/Lainco-quality/pull/1",
      intentos: 1,
      ultimoError: null,
    });
  });

  enTransaccion("otra decisión antes del merge actualiza el mismo PR, que sigue siendo un commit sobre main", async (c) => {
    const repo = githubEnMemoria();
    const primera = await c.reglaPropia("LAIN901", Estado.ARevisar);
    await c.decidir(primera, Estado.ARevisar, Estado.Incorporada);
    await publicarPaquete({ db: c.tx, github: repo.github });

    const segunda = await c.reglaPropia("LAIN902", Estado.ARevisar);
    await c.decidir(segunda, Estado.ARevisar, Estado.Incorporada);
    const resumen = await publicarPaquete({ db: c.tx, github: repo.github });

    expect(resumen).toMatchObject({ publicadas: 1, pr: { numero: 1 } });
    expect(repo.prs).toHaveLength(1);
    expect(repo.prs[0].cuerpo).toContain("| LAIN901 —");
    expect(repo.prs[0].cuerpo).toContain("| LAIN902 —");
    expect(repo.padreDe(RAMA_DEL_PR)).toBe(repo.commitDe("main"));
    expect(repo.archivo(RAMA_DEL_PR, RUTAS.globalconfig)).toContain("dotnet_diagnostic.LAIN902.severity = warning");
    // Sigue proponiendo una sola versión más que main.
    expect(repo.archivo(RAMA_DEL_PR, RUTAS.csproj)).toContain("<Version>0.1.1</Version>");
  });

  enTransaccion("después del merge, la siguiente decisión abre un PR nuevo con la versión siguiente", async (c) => {
    const repo = githubEnMemoria();
    const id = await c.reglaPropia("LAIN901", Estado.ARevisar);
    await c.decidir(id, Estado.ARevisar, Estado.Incorporada);
    await publicarPaquete({ db: c.tx, github: repo.github });
    repo.mergear(RAMA_DEL_PR);

    await c.decidir(id, Estado.Incorporada, Estado.Descartada, "Da demasiados falsos positivos.");
    const resumen = await publicarPaquete({ db: c.tx, github: repo.github });

    expect(resumen).toMatchObject({ publicadas: 1, version: "0.1.2", pr: { numero: 2 } });
    expect(repo.prs[1].cuerpo).toContain("| `warning` | `none` | Descartada por Federico Sánchez");
    // AnalyzerReleases ya se movió en la 0.1.1: esta vez no se toca.
    expect(repo.archivo(RAMA_DEL_PR, RUTAS.shipped)).not.toContain("## Release 0.1.2");
    // Las dos son de la misma transacción, con la misma fecha: la del retiro es la del PR #2.
    const retiro = (await c.publicacionesDe(id)).find((p) => p.decisionId !== null && p.prNumero === 2);
    expect(retiro).toMatchObject({ estado: EstadoPublicacion.Publicada, accion: "desactivar", severidad: null, prNumero: 2 });
  });

  enTransaccion("si main ya tiene lo que dice la app, no hay PR: se publica sin PR y el abierto se cierra", async (c) => {
    const repo = githubEnMemoria();
    const id = await c.reglaPropia("LAIN901", Estado.ARevisar);
    await c.decidir(id, Estado.ARevisar, Estado.Incorporada);
    await publicarPaquete({ db: c.tx, github: repo.github });

    // Se arrepiente antes del merge: vuelve a como está en main.
    await c.decidir(id, Estado.Incorporada, Estado.Descartada);
    // Y alguien ya dejó main así (por ejemplo, a mano).
    const { generarGlobalconfig } = await import("@/paquete/globalconfig");
    repo.cambiarEnMain(RUTAS.globalconfig, generarGlobalconfig([{ clave: "LAIN901", titulo: "Título de LAIN901", estado: Estado.Descartada, severidadPorDefecto: "warning", eliminada: false }]));
    const resumen = await publicarPaquete({ db: c.tx, github: repo.github });

    expect(resumen).toMatchObject({ publicadas: 1, pr: null, version: null });
    expect(repo.prs[0].abierto).toBe(false);
    expect(repo.prs[0].cuerpo).toContain("Se cerró solo");
    const ultima = (await c.publicacionesDe(id)).find((p) => p.accion === "desactivar");
    expect(ultima).toMatchObject({ estado: EstadoPublicacion.Publicada, prNumero: null });
  });

  enTransaccion("si GitHub falla, quedan pendientes con el error; el reintento arma el PR", async (c) => {
    let caido = true;
    const repo = githubEnMemoria((op) => (caido && op === "crearCommit" ? new ErrorDeGitHub("servidor", "GitHub no respondió bien. (HTTP 502)", 502) : undefined));
    const id = await c.reglaPropia("LAIN901", Estado.ARevisar);
    await c.decidir(id, Estado.ARevisar, Estado.Incorporada);

    const fallo = await publicarPaquete({ db: c.tx, github: repo.github });

    expect(fallo).toMatchObject({ publicadas: 0, reprogramadas: 1, error: "GitHub no respondió bien. (HTTP 502)" });
    expect(repo.prs).toEqual([]);
    const [pendiente] = await c.publicacionesDe(id);
    expect(pendiente).toMatchObject({ estado: EstadoPublicacion.Pendiente, intentos: 1, ultimoError: "GitHub no respondió bien. (HTTP 502)" });
    expect(pendiente.proximoIntentoEn.getTime()).toBeGreaterThan(Date.now());

    // Sin esperar, como el botón: todavía no le toca.
    expect(await publicarPaquete({ db: c.tx, github: repo.github })).toMatchObject({ publicadas: 0, reprogramadas: 0 });
    caido = false;
    expect(await publicarPaquete({ db: c.tx, github: repo.github, sinEsperar: true })).toMatchObject({ publicadas: 1, pr: { numero: 1 } });
  });

  enTransaccion("si main no permite armar el PR (versión previa), queda fallida enseguida: lo mira una persona", async (c) => {
    const repo = githubEnMemoria();
    repo.cambiarEnMain(RUTAS.csproj, repo.archivo("main", RUTAS.csproj)!.replace(/<Version>[^<]*<\/Version>/, "<Version>0.2.0-beta.1</Version>"));
    const id = await c.reglaPropia("LAIN901", Estado.ARevisar);
    await c.decidir(id, Estado.ARevisar, Estado.Incorporada);

    const resumen = await publicarPaquete({ db: c.tx, github: repo.github });

    expect(resumen).toMatchObject({ fallidas: 1, publicadas: 0 });
    expect(resumen.error).toContain("0.2.0-beta.1");
    expect((await c.publicacionesDe(id))[0].estado).toBe(EstadoPublicacion.Fallida);
  });

  enTransaccion("sin nada pendiente no habla con GitHub, y nunca toma las publicaciones de Sonar", async (c) => {
    const repo = githubEnMemoria();
    const [deSonar] = await c.tx
      .insert(regla)
      .values({ origen: Origen.Sonar, clave: "PRUEBA-PAQ-S1", lenguaje: "cs", nombre: "x", hashDescripcion: "x" })
      .returning({ id: regla.id });
    await c.tx.insert(estadoRegla).values({ reglaId: deSonar.id, estado: Estado.ARevisar });
    await aplicarTransicion(c.tx, c.decisor, {
      reglas: [{ id: deSonar.id, desde: Estado.ARevisar }],
      hacia: Estado.Incorporada,
      severidad: "MAJOR",
      justificacion: "x",
      masiva: false,
    });

    const resumen = await publicarPaquete({ db: c.tx, github: repo.github, sinEsperar: true });

    expect(resumen).toMatchObject({ publicadas: 0, pr: null });
    expect(repo.llamadas).toEqual([]);
    const [sonar] = await c.publicacionesDe(deSonar.id);
    expect(sonar).toMatchObject({ destino: DestinoPublicacion.PerfilSonar, estado: EstadoPublicacion.Pendiente });
  });

  enTransaccion("las publicaciones de reglas que ya estaban publicadas no se vuelven a tomar", async (c) => {
    const repo = githubEnMemoria();
    const id = await c.reglaPropia("LAIN901", Estado.ARevisar);
    await c.decidir(id, Estado.ARevisar, Estado.Incorporada);
    await publicarPaquete({ db: c.tx, github: repo.github });
    const llamadas = repo.llamadas.length;

    expect(await publicarPaquete({ db: c.tx, github: repo.github, sinEsperar: true })).toMatchObject({ publicadas: 0 });
    expect(repo.llamadas).toHaveLength(llamadas);
    expect(await c.tx.select({ estado: publicacion.estado }).from(publicacion).where(eq(publicacion.reglaId, id))).toEqual([{ estado: "publicada" }]);
  });
});
