import { and, eq, isNull, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Db } from "@/db/cliente";
import { EstadoPublicacion, Estado, Origen, Rol, TipoDesvio, type Estado as TipoEstado } from "@/dominio/valores";
import { ErrorDeSonar } from "@/sonar/http";
import type { PerfilDeSonar, ReglaActiva } from "@/sonar/perfiles";

/**
 * La reconciliación contra una base real y un Sonar falso (entrega 6.2, paso 5).
 *
 * Criterio del paso: "Activar una regla a mano en el Sonar simulado genera el desvío;
 * corregirlo lo cierra."
 *
 * Necesita DATABASE_URL_PRUEBAS. Usa reglas de Sonar `PRUEBA-REC-`, que los tests de
 * sincronización borran en paralelo: cada test corre en una transacción que se descarta.
 */

const url = process.env.DATABASE_URL_PRUEBAS;
const PREFIJO = "PRUEBA-REC-";
const PERFILES = { cs: "Lainco C#", ts: "Lainco Typescript" } as const;

class Descartada extends Error {}

/** Un Sonar en memoria: perfiles gestionados, reglas activas y proyectos. */
function sonarFalso() {
  const estado = {
    activas: { cs: new Map<string, ReglaActiva>(), ts: new Map<string, ReglaActiva>() },
    esDefault: true,
    heredaDe: null as PerfilDeSonar["heredaDe"],
    /** Lo que dice el perfil que tiene activo; por defecto, lo que hay. */
    cuenta: null as number | null,
    proyectos: [{ clave: "revertpablo_Lainco-quality", nombre: "Lainco-quality", perfilCs: "qp-cs" }],
    caido: false,
    escrituras: [] as string[],
  };
  const perfil = (lenguaje: "cs" | "ts"): PerfilDeSonar => ({
    clave: `qp-${lenguaje}`,
    nombre: PERFILES[lenguaje],
    lenguaje,
    esDefault: estado.esDefault,
    heredaDe: estado.heredaDe,
    esDeSonar: false,
    reglasActivas: estado.cuenta ?? estado.activas[lenguaje].size,
  });
  const lenguajeDe = (clave: string) => (clave === "qp-ts" ? "ts" : "cs");
  const sonar = {
    async buscarPerfil(lenguaje: string) {
      if (estado.caido) throw new ErrorDeSonar("servidor", "SonarQube no respondió bien. (HTTP 503)", 503);
      return perfil(lenguaje as "cs" | "ts");
    },
    reglasActivas: async (clave: string) => [...estado.activas[lenguajeDe(clave)].values()],
    proyectos: async () => estado.proyectos.map(({ clave, nombre }) => ({ clave, nombre })),
    async perfilesDelProyecto(proyecto: string) {
      const p = estado.proyectos.find((x) => x.clave === proyecto)!;
      return [
        { ...perfil("cs"), clave: p.perfilCs, nombre: p.perfilCs === "qp-cs" ? PERFILES.cs : "Sonar way comprehensive" },
        perfil("ts"),
        { ...perfil("ts"), clave: "sw-abap", nombre: "Sonar way core", lenguaje: "abap" },
      ];
    },
    async activarRegla(clave: string, regla: string, activacion: { impactos?: { calidad: string; severidad: string }[]; parametros?: Record<string, string> }) {
      estado.escrituras.push(`activar ${regla}`);
      estado.activas[lenguajeDe(clave)].set(regla, { clave: regla, severidad: null, impactos: activacion.impactos ?? [], parametros: activacion.parametros ?? {}, heredada: false });
    },
    async desactivarRegla(clave: string, regla: string) {
      estado.escrituras.push(`desactivar ${regla}`);
      estado.activas[lenguajeDe(clave)].delete(regla);
    },
  };
  /** Activa una regla "a mano", como en la interfaz de Sonar. */
  const activarAMano = (regla: string, impactos = [{ calidad: "MAINTAINABILITY", severidad: "MEDIUM" }], parametros: Record<string, string> = {}) =>
    estado.activas.cs.set(regla, { clave: regla, severidad: null, impactos, parametros, heredada: false });
  return { sonar, estado, activarAMano };
}

describe.skipIf(!url)("reconciliación con Sonar", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { desvio, estadoRegla, publicacion, reconciliacion, regla, usuario } = await import("@/db/esquema");
  const { reconciliar } = await import("@/reconciliacion/reconciliar");
  const { corregirDesvio, corregirTodos } = await import("@/reconciliacion/corregir");
  const { publicarPendientes } = await import("@/publicacion/publicar");

  interface Contexto {
    tx: Db;
    decisor: { id: string; rol: Rol };
    analista: { id: string; rol: Rol };
    falso: ReturnType<typeof sonarFalso>;
    /** Crea una regla de Sonar en ese estado; devuelve id y clave. */
    regla(estado: TipoEstado, extra?: { severidad?: string; parametros?: Record<string, string>; porDefecto?: Record<string, string> }): Promise<{ id: string; clave: string }>;
    reconciliar(): ReturnType<typeof reconciliar>;
    abiertos(): Promise<(typeof desvio.$inferSelect)[]>;
  }

  function enTransaccion(nombre: string, prueba: (c: Contexto) => Promise<void>) {
    it(nombre, async () => {
      let numero = 0;
      const resultado = obtenerDb().transaction(async (transaccion) => {
        const tx = transaccion as unknown as Db;
        const nuevoUsuario = async (rol: Rol) =>
          (
            await tx
              .insert(usuario)
              .values({ nombre: `Prueba ${rol}`, email: `prueba-rec-${rol}@laincosoftware.com`, rol })
              .returning({ id: usuario.id, rol: usuario.rol })
          )[0];
        const falso = sonarFalso();
        await prueba({
          tx,
          decisor: await nuevoUsuario(Rol.Decisor),
          analista: await nuevoUsuario(Rol.Analista),
          falso,
          async regla(estado, extra = {}) {
            const clave = `${PREFIJO}${++numero}`;
            const [creada] = await tx
              .insert(regla)
              .values({
                origen: Origen.Sonar,
                clave,
                lenguaje: "cs",
                nombre: clave,
                hashDescripcion: "x",
                impactos: [{ calidad: "MAINTAINABILITY", severidad: "LOW" }],
                parametros: Object.entries(extra.porDefecto ?? {}).map(([c, v]) => ({ clave: c, valorDefault: v })),
              })
              .returning({ id: regla.id });
            const incorporada = estado === Estado.Incorporada;
            await tx.insert(estadoRegla).values({
              reglaId: creada.id,
              estado,
              severidadAsignada: incorporada ? (extra.severidad ?? "MAJOR") : null,
              parametros: incorporada ? (extra.parametros ?? null) : null,
            });
            return { id: creada.id, clave };
          },
          reconciliar: () => reconciliar({ db: tx, sonar: falso.sonar, perfiles: PERFILES }),
          abiertos: () => tx.select().from(desvio).where(and(isNull(desvio.resueltoEn), like(desvio.clave, `${PREFIJO}%`))),
        });
        throw new Descartada();
      });
      await expect(resultado).rejects.toBeInstanceOf(Descartada);
    });
  }

  enTransaccion("si Sonar coincide con la app, no hay desvíos y la corrida queda registrada", async (c) => {
    const r = await c.regla(Estado.Incorporada);
    c.falso.activarAMano(r.clave);

    const resumen = await c.reconciliar();

    expect(resumen).toMatchObject({ estado: "ok", abiertos: 0, nuevos: 0, resueltos: 0, advertencias: [], error: null });
    const [corrida] = await c.tx.select().from(reconciliacion).where(eq(reconciliacion.id, resumen.id));
    expect(corrida).toMatchObject({ estado: "ok", abiertos: 0 });
    expect(corrida.terminadaEn).toBeInstanceOf(Date);
  });

  enTransaccion("activar una regla a mano en Sonar genera el desvío; corregirlo lo cierra", async (c) => {
    const r = await c.regla(Estado.PendienteDeAnalizar);
    c.falso.activarAMano(r.clave);

    // La reconciliación ve la regla activa sin estar Incorporada.
    expect(await c.reconciliar()).toMatchObject({ estado: "ok", abiertos: 1, nuevos: 1 });
    const [abierto] = await c.abiertos();
    expect(abierto).toMatchObject({ tipo: TipoDesvio.ActivaSinIncorporar, lenguaje: "cs", clave: r.clave, reglaId: r.id });

    // Un decisor lo corrige: se encola la publicación de lo que dice la app...
    const correccion = await corregirDesvio(c.tx, c.decisor, abierto.id);
    expect(correccion.ok).toBe(true);
    if (!correccion.ok) return;
    const [pub] = await c.tx.select().from(publicacion).where(eq(publicacion.id, correccion.publicacionId));
    expect(pub).toMatchObject({ desvioId: abierto.id, decisionId: null, pedidaPorId: c.decisor.id, estado: EstadoPublicacion.Pendiente });

    // ...que la desactiva en Sonar y cierra el desvío.
    await publicarPendientes({ db: c.tx, sonar: c.falso.sonar, perfiles: PERFILES, ids: [correccion.publicacionId] });
    expect(c.falso.estado.escrituras).toEqual([`desactivar ${r.clave}`]);
    expect(await c.abiertos()).toEqual([]);

    // La próxima reconciliación lo confirma.
    expect(await c.reconciliar()).toMatchObject({ abiertos: 0, nuevos: 0 });
  });

  enTransaccion("un desvío que sigue no se duplica: se actualiza cuándo se vio y qué se vio", async (c) => {
    const r = await c.regla(Estado.Incorporada, { parametros: { max: "5" } });
    c.falso.activarAMano(r.clave, undefined, { max: "9" });
    await c.reconciliar();
    const [antes] = await c.abiertos();

    c.falso.activarAMano(r.clave, undefined, { max: "8" });
    expect(await c.reconciliar()).toMatchObject({ abiertos: 1, nuevos: 0, resueltos: 0 });

    const despues = await c.abiertos();
    expect(despues).toHaveLength(1);
    expect(despues[0]).toMatchObject({ id: antes.id, tipo: TipoDesvio.ParametrosDistintos, detalle: { esperado: { max: "5" }, encontrado: { max: "8" } } });
    expect(despues[0].vistoEn.getTime()).toBeGreaterThanOrEqual(antes.vistoEn.getTime());
  });

  enTransaccion("un desvío que ya no aparece se cierra solo", async (c) => {
    const r = await c.regla(Estado.Incorporada);
    await c.reconciliar();
    expect((await c.abiertos()).map((d) => d.tipo)).toEqual([TipoDesvio.IncorporadaInactiva]);

    // Alguien la activó en Sonar como dice la app.
    c.falso.activarAMano(r.clave);

    expect(await c.reconciliar()).toMatchObject({ abiertos: 0, resueltos: 1 });
    expect(await c.abiertos()).toEqual([]);
  });

  enTransaccion("si Sonar falla, la corrida queda con error y los desvíos no se tocan", async (c) => {
    await c.regla(Estado.Incorporada);
    await c.reconciliar();
    const antes = await c.abiertos();
    c.falso.estado.caido = true;

    const resumen = await c.reconciliar();

    expect(resumen).toMatchObject({ estado: "error", error: expect.stringContaining("HTTP 503") });
    expect(await c.abiertos()).toEqual(antes);
  });

  enTransaccion("una regla con la publicación en camino no es desvío", async (c) => {
    const r = await c.regla(Estado.Incorporada);
    await c.tx.insert(publicacion).values({
      reglaId: r.id,
      desvioId: (
        await c.tx.insert(desvio).values({ tipo: TipoDesvio.IncorporadaInactiva, lenguaje: "cs", clave: `${PREFIJO}otro` }).returning({ id: desvio.id })
      )[0].id,
      pedidaPorId: c.decisor.id,
    });

    await c.reconciliar();

    expect((await c.abiertos()).filter((d) => d.clave === r.clave)).toEqual([]);
  });

  enTransaccion("una regla publicada mientras corría la reconciliación no es desvío", async (c) => {
    const r = await c.regla(Estado.ARevisar);
    const leerActivas = c.falso.sonar.reglasActivas;
    // Justo después de que la reconciliación lee Sonar (sin la regla), alguien la incorpora
    // y se publica: la app ya la tiene Incorporada, pero la foto de Sonar es de antes.
    c.falso.sonar.reglasActivas = async (clave: string) => {
      const activas = await leerActivas(clave);
      if (clave === "qp-cs") {
        await c.tx.update(estadoRegla).set({ estado: Estado.Incorporada, severidadAsignada: "MAJOR" }).where(eq(estadoRegla.reglaId, r.id));
        const [d] = await c.tx
          .insert(desvio)
          .values({ tipo: TipoDesvio.IncorporadaInactiva, lenguaje: "ts", clave: `${PREFIJO}auxiliar`, resueltoEn: new Date() })
          .returning({ id: desvio.id });
        await c.tx.insert(publicacion).values({
          reglaId: r.id,
          desvioId: d.id,
          pedidaPorId: c.decisor.id,
          estado: EstadoPublicacion.Publicada,
          accion: "activar",
          publicadaEn: new Date(),
        });
      }
      return activas;
    };

    await c.reconciliar();

    expect((await c.abiertos()).filter((d) => d.clave === r.clave)).toEqual([]);
  });

  enTransaccion("perfil y proyectos: no default, herencia y un proyecto con otro perfil, por lenguaje", async (c) => {
    c.falso.estado.esDefault = false;
    c.falso.estado.heredaDe = { clave: "sw", nombre: "Sonar way" };
    c.falso.estado.proyectos = [{ clave: "revertpablo_otro", nombre: "Otro", perfilCs: "sw-cs" }];

    await c.reconciliar();

    const abiertos = await c.tx
      .select({ tipo: desvio.tipo, lenguaje: desvio.lenguaje, clave: desvio.clave })
      .from(desvio)
      .where(isNull(desvio.resueltoEn));
    expect(abiertos).toEqual(
      expect.arrayContaining([
        { tipo: TipoDesvio.PerfilNoEsDefault, lenguaje: "cs", clave: "Lainco C#" },
        { tipo: TipoDesvio.PerfilNoEsDefault, lenguaje: "ts", clave: "Lainco Typescript" },
        { tipo: TipoDesvio.PerfilConHerencia, lenguaje: "cs", clave: "Lainco C#" },
        { tipo: TipoDesvio.ProyectoConOtroPerfil, lenguaje: "cs", clave: "revertpablo_otro" },
      ]),
    );
    // El proyecto usa el nuestro para TypeScript, y los demás lenguajes no cuentan.
    expect(abiertos.filter((d) => d.tipo === TipoDesvio.ProyectoConOtroPerfil)).toHaveLength(1);
  });

  enTransaccion("si el perfil dice tener otra cantidad de reglas activas, queda una advertencia", async (c) => {
    c.falso.estado.cuenta = 3;

    const resumen = await c.reconciliar();

    expect(resumen.advertencias).toEqual([
      "El perfil 'Lainco C#' dice tener 3 reglas activas y la búsqueda devolvió 0.",
      "El perfil 'Lainco Typescript' dice tener 3 reglas activas y la búsqueda devolvió 0.",
    ]);
  });

  describe("corregir", () => {
    enTransaccion("solo un decisor", async (c) => {
      const r = await c.regla(Estado.PendienteDeAnalizar);
      c.falso.activarAMano(r.clave);
      await c.reconciliar();
      const [abierto] = await c.abiertos();

      expect(await corregirDesvio(c.tx, c.analista, abierto.id)).toEqual({ ok: false, motivo: "sinPermiso" });
    });

    enTransaccion("los del perfil se corrigen en Sonar, no desde la app", async (c) => {
      c.falso.estado.esDefault = false;
      await c.reconciliar();
      const [delPerfil] = await c.tx
        .select({ id: desvio.id })
        .from(desvio)
        .where(and(eq(desvio.tipo, TipoDesvio.PerfilNoEsDefault), isNull(desvio.resueltoEn)));

      expect(await corregirDesvio(c.tx, c.decisor, delPerfil.id)).toEqual({ ok: false, motivo: "seCorrigeEnSonar" });
    });

    enTransaccion("uno resuelto o que no existe no se corrige", async (c) => {
      const [resuelto] = await c.tx
        .insert(desvio)
        .values({ tipo: TipoDesvio.ActivaSinIncorporar, lenguaje: "cs", clave: `${PREFIJO}viejo`, resueltoEn: new Date() })
        .returning({ id: desvio.id });

      expect(await corregirDesvio(c.tx, c.decisor, resuelto.id)).toEqual({ ok: false, motivo: "yaResuelto" });
      expect(await corregirDesvio(c.tx, c.decisor, "00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, motivo: "noEncontrado" });
    });

    enTransaccion("una regla activa que no está en el inventario no se puede corregir desde la app", async (c) => {
      c.falso.activarAMano(`${PREFIJO}FUERA`);
      await c.reconciliar();
      const [fuera] = await c.abiertos();

      expect(fuera).toMatchObject({ clave: `${PREFIJO}FUERA`, reglaId: null });
      expect(await corregirDesvio(c.tx, c.decisor, fuera.id)).toEqual({ ok: false, motivo: "fueraDelInventario" });
    });

    enTransaccion("corregir todos: una publicación por regla, y nada de lo que se corrige en Sonar", async (c) => {
      const conDos = await c.regla(Estado.Incorporada, { severidad: "CRITICAL", parametros: { max: "5" } });
      const inactiva = await c.regla(Estado.Incorporada);
      c.falso.activarAMano(conDos.clave, [{ calidad: "MAINTAINABILITY", severidad: "LOW" }], { max: "9" });
      c.falso.estado.esDefault = false;
      await c.reconciliar();
      expect((await c.abiertos()).map((d) => d.tipo).sort()).toEqual(
        [TipoDesvio.IncorporadaInactiva, TipoDesvio.ParametrosDistintos, TipoDesvio.SeveridadDistinta].sort(),
      );

      expect(await corregirTodos(c.tx, c.analista)).toEqual({ ok: false, motivo: "sinPermiso" });
      const resultado = await corregirTodos(c.tx, c.decisor);

      expect(resultado.ok && resultado.publicaciones).toHaveLength(2);
      const pendientes = await c.tx
        .select({ reglaId: publicacion.reglaId })
        .from(publicacion)
        .where(eq(publicacion.estado, EstadoPublicacion.Pendiente));
      expect(pendientes.map((p) => p.reglaId).filter((id) => id === conDos.id || id === inactiva.id).sort()).toEqual([conDos.id, inactiva.id].sort());

      await publicarPendientes({ db: c.tx, sonar: c.falso.sonar, perfiles: PERFILES, ids: resultado.ok ? resultado.publicaciones : [] });
      expect(await c.abiertos()).toEqual([]);
      // El del perfil sigue: se corrige en Sonar.
      const [delPerfil] = await c.tx.select({ tipo: desvio.tipo }).from(desvio).where(and(eq(desvio.tipo, TipoDesvio.PerfilNoEsDefault), isNull(desvio.resueltoEn)));
      expect(delPerfil).toBeDefined();
    });

    enTransaccion("una publicación exitosa por una decisión también cierra los desvíos de la regla", async (c) => {
      const r = await c.regla(Estado.Incorporada, { severidad: "CRITICAL" });
      c.falso.activarAMano(r.clave, [{ calidad: "MAINTAINABILITY", severidad: "LOW" }]);
      await c.reconciliar();
      expect((await c.abiertos()).map((d) => d.tipo)).toEqual([TipoDesvio.SeveridadDistinta]);
      const [d] = await c.tx.select({ id: desvio.id }).from(desvio).where(eq(desvio.clave, r.clave));
      const correccion = await corregirDesvio(c.tx, c.decisor, d.id);

      await publicarPendientes({ db: c.tx, sonar: c.falso.sonar, perfiles: PERFILES, ids: correccion.ok ? [correccion.publicacionId] : [] });

      expect(c.falso.estado.activas.cs.get(r.clave)?.impactos).toEqual([{ calidad: "MAINTAINABILITY", severidad: "HIGH" }]);
      expect(await c.abiertos()).toEqual([]);
      expect(await c.reconciliar()).toMatchObject({ abiertos: 0 });
    });
  });
});
