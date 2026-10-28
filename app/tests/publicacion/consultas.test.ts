import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { FILTROS_POR_DEFECTO } from "@/dominio/filtros";
import { DestinoPublicacion, EstadoPublicacion, Estado, Origen, Rol, TipoDesvio } from "@/dominio/valores";

/**
 * Lo que muestra la pantalla de Sonar y el inventario sobre la publicación (entrega 6.2,
 * paso 6), contra una base real.
 *
 * Necesita DATABASE_URL_PRUEBAS. Usa reglas ESLint `PRUEBA-CON-` (ningún test sincroniza ESLint) y el usuario
 * `prueba-con-`; las consultas que cuentan todo se miran filtradas por esas reglas, porque
 * la base la comparten otros tests en paralelo.
 */

const url = process.env.DATABASE_URL_PRUEBAS;
const PREFIJO = "PRUEBA-CON-";

describe.skipIf(!url)("consultas de la publicación en Sonar", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { decision, desvio, estadoRegla, publicacion, regla, usuario } = await import("@/db/esquema");
  const { desviosAbiertos, publicacionesSinPublicar, ultimaPublicacionDeRegla } = await import("@/publicacion/consultas");
  const { buscarReglas } = await import("@/inventario/consulta");

  const db = () => obtenerDb();
  let autorId: string;
  let numero = 0;

  async function limpiar() {
    const mias = db().select({ id: regla.id }).from(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(publicacion).where(inArray(publicacion.reglaId, mias));
    await db().delete(desvio).where(like(desvio.clave, `${PREFIJO}%`));
    await db().delete(decision).where(inArray(decision.reglaId, mias));
    await db().delete(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(usuario).where(like(usuario.email, "prueba-con-%"));
  }

  beforeEach(async () => {
    await limpiar();
    const [autor] = await db()
      .insert(usuario)
      .values({ nombre: "Paula Consultas", email: "prueba-con-decisor@laincosoftware.com", rol: Rol.Decisor })
      .returning({ id: usuario.id });
    autorId = autor.id;
  });
  afterAll(async () => {
    await limpiar();
    await db().$client.end();
  });

  async function nuevaRegla() {
    const clave = `${PREFIJO}${++numero}`;
    const [r] = await db().insert(regla).values({ origen: Origen.Eslint, clave, lenguaje: "cs", nombre: `Regla ${clave}`, hashDescripcion: "x" }).returning({ id: regla.id });
    await db().insert(estadoRegla).values({ reglaId: r.id, estado: Estado.Incorporada, severidadAsignada: "MAJOR" });
    return { id: r.id, clave };
  }

  /** Una publicación de la regla, en ese estado, creada hace `minutos`. */
  async function publicada(reglaId: string, estado: EstadoPublicacion, minutos: number, extra: Partial<typeof publicacion.$inferInsert> = {}) {
    const [d] = await db()
      .insert(decision)
      .values({ reglaId, estadoAnterior: Estado.ARevisar, estadoNuevo: Estado.Incorporada, autorId })
      .returning({ id: decision.id });
    const creadaEn = new Date(Date.now() - minutos * 60_000);
    const [p] = await db()
      .insert(publicacion)
      .values({
        reglaId,
        decisionId: d.id,
        pedidaPorId: autorId,
        estado,
        creadaEn,
        accion: estado === EstadoPublicacion.Publicada ? "activar" : null,
        publicadaEn: estado === EstadoPublicacion.Publicada ? creadaEn : null,
        ...extra,
      })
      .returning({ id: publicacion.id });
    return p.id;
  }

  const mias = async () => (await publicacionesSinPublicar(db())).filter((p) => p.clave.startsWith(PREFIJO));

  it("sin publicar: las pendientes y las fallidas vigentes, las fallidas primero", async () => {
    const pendiente = await nuevaRegla();
    const fallida = await nuevaRegla();
    const reemplazada = await nuevaRegla();
    const ok = await nuevaRegla();
    await publicada(pendiente.id, EstadoPublicacion.Pendiente, 1);
    await publicada(fallida.id, EstadoPublicacion.Fallida, 5, { intentos: 5, ultimoError: "Sonar no responde" });
    // Falló, pero después se publicó otra vez: ya no importa.
    await publicada(reemplazada.id, EstadoPublicacion.Fallida, 10, { intentos: 5 });
    await publicada(reemplazada.id, EstadoPublicacion.Publicada, 2);
    await publicada(ok.id, EstadoPublicacion.Publicada, 3);

    const filas = await mias();

    expect(filas.map((f) => [f.clave, f.estado])).toEqual([
      [fallida.clave, "fallida"],
      [pendiente.clave, "pendiente"],
    ]);
    expect(filas[0]).toMatchObject({ estadoDescripcion: "Falló", intentos: 5, ultimoError: "Sonar no responde", pedidaPor: "Paula Consultas" });
  });

  it("las del PR de configuración (reglas propias) no son de la pantalla Sonar", async () => {
    const propia = await nuevaRegla();
    await publicada(propia.id, EstadoPublicacion.Pendiente, 1, { destino: DestinoPublicacion.PrConfiguracion });
    const otra = await nuevaRegla();
    await publicada(otra.id, EstadoPublicacion.Fallida, 2, { destino: DestinoPublicacion.PrConfiguracion, intentos: 5 });

    // El aviso del encabezado cuenta las mismas fallidas que esta lista (fallidaVigente).
    expect(await mias()).toEqual([]);
    // El detalle de la regla sí la muestra: es su última publicación.
    expect(await ultimaPublicacionDeRegla(db(), propia.id)).toMatchObject({ estado: "pendiente" });
  });

  it("la última publicación de una regla", async () => {
    const r = await nuevaRegla();
    expect(await ultimaPublicacionDeRegla(db(), r.id)).toBeNull();

    await publicada(r.id, EstadoPublicacion.Publicada, 10);
    await publicada(r.id, EstadoPublicacion.Pendiente, 1, { intentos: 2, ultimoError: "HTTP 503" });

    expect(await ultimaPublicacionDeRegla(db(), r.id)).toMatchObject({ estado: "pendiente", intentos: 2, ultimoError: "HTTP 503" });
  });

  it("los desvíos abiertos dicen si se corrigen desde la app y si ya hay una corrección en camino", async () => {
    const r = await nuevaRegla();
    const conPendiente = await nuevaRegla();
    await publicada(conPendiente.id, EstadoPublicacion.Pendiente, 1);
    await db()
      .insert(desvio)
      .values([
        { tipo: TipoDesvio.IncorporadaInactiva, lenguaje: "cs", clave: r.clave, reglaId: r.id, detalle: { esperado: { severidad: "MAJOR", parametros: {} }, encontrado: "inactiva" } },
        { tipo: TipoDesvio.SeveridadDistinta, lenguaje: "cs", clave: conPendiente.clave, reglaId: conPendiente.id },
        { tipo: TipoDesvio.ActivaSinIncorporar, lenguaje: "cs", clave: `${PREFIJO}FUERA` },
        { tipo: TipoDesvio.PerfilNoEsDefault, lenguaje: "ts", clave: `${PREFIJO}perfil` },
        { tipo: TipoDesvio.IncorporadaInactiva, lenguaje: "cs", clave: `${PREFIJO}resuelto`, reglaId: r.id, resueltoEn: new Date() },
      ]);

    const desvios = (await desviosAbiertos(db())).filter((d) => d.clave.startsWith(PREFIJO));

    // Por lenguaje y por tipo, en el orden de la tabla de referencia.
    expect(desvios.map((d) => [d.clave, d.tipoDescripcion, d.seCorrigeDesdeLaApp, d.correccionEnCamino])).toEqual([
      [`${PREFIJO}FUERA`, "Activa en Sonar sin estar Incorporada", false, false],
      [r.clave, "Incorporada e inactiva en Sonar", true, false],
      [conPendiente.clave, "Otra severidad en Sonar", true, true],
      [`${PREFIJO}perfil`, "El perfil no es el default", false, false],
    ]);
    expect(desvios[1].regla).toEqual({ id: r.id, nombre: `Regla ${r.clave}` });
    expect(desvios[1].detalle).toEqual({ esperado: { severidad: "MAJOR", parametros: {} }, encontrado: "inactiva" });

    // Los de una regla.
    expect((await desviosAbiertos(db(), r.id)).map((d) => d.clave)).toEqual([r.clave]);
  });

  it("el inventario marca las reglas sin publicar y con desvío", async () => {
    const sinPublicar = await nuevaRegla();
    const conDesvio = await nuevaRegla();
    const viejaFallida = await nuevaRegla();
    const enOrden = await nuevaRegla();
    await publicada(sinPublicar.id, EstadoPublicacion.Fallida, 1, { intentos: 1 });
    await publicada(viejaFallida.id, EstadoPublicacion.Fallida, 10, { intentos: 5 });
    await publicada(viejaFallida.id, EstadoPublicacion.Publicada, 1);
    await publicada(enOrden.id, EstadoPublicacion.Publicada, 1);
    await db().insert(desvio).values({ tipo: TipoDesvio.SeveridadDistinta, lenguaje: "cs", clave: conDesvio.clave, reglaId: conDesvio.id });

    const filas = await buscarReglas(db(), { ...FILTROS_POR_DEFECTO, q: PREFIJO }, []);

    expect(Object.fromEntries(filas.map((f) => [f.clave, [f.sinPublicar, f.conDesvio]]))).toEqual({
      [sinPublicar.clave]: [true, false],
      [conDesvio.clave]: [false, true],
      [viejaFallida.clave]: [false, false],
      [enOrden.clave]: [false, false],
    });
    await db().delete(desvio).where(eq(desvio.clave, conDesvio.clave));
  });
});
