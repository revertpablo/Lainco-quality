import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Estado, Origen, Rol } from "@/dominio/valores";

/**
 * Detalle de una regla e historial, contra una base real (entrega 6.1, paso 10).
 *
 * Criterio del paso: "El historial muestra autor, fecha y justificación de cada decisión."
 *
 * Necesita DATABASE_URL_PRUEBAS. Usa reglas `PRUEBA-DET-` (origen eslint, que ningún test sincroniza) y usuarios
 * `prueba-det-`, y los borra al terminar.
 */

const url = process.env.DATABASE_URL_PRUEBAS;
const PREFIJO = "PRUEBA-DET-";

describe.skipIf(!url)("detalle e historial de una regla", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { aviso, decision, estadoRegla, regla, sincronizacion, usuario } = await import("@/db/esquema");
  const { aplicarTransicion } = await import("@/transiciones/aplicarTransicion");
  const { historialDeRegla, obtenerRegla } = await import("@/reglas/detalle");

  const db = () => obtenerDb();
  let analista: { id: string; rol: Rol };
  let decisor: { id: string; rol: Rol };
  let principal: string;
  let otra: string;
  let corrida: string;

  async function limpiar() {
    const mias = db().select({ id: regla.id }).from(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(decision).where(inArray(decision.reglaId, mias));
    await db().delete(regla).where(like(regla.clave, `${PREFIJO}%`));
    await db().delete(sincronizacion).where(eq(sincronizacion.error, "prueba-detalle"));
    await db().delete(usuario).where(like(usuario.email, "prueba-det-%"));
  }

  async function crearRegla(clave: string) {
    const [r] = await db()
      .insert(regla)
      .values({
        origen: Origen.Eslint,
        clave: `${PREFIJO}${clave}`,
        lenguaje: "cs",
        nombre: `Regla ${clave}`,
        descripcion: '<p>Por qué</p><script>alert(1)</script>',
        tipo: "CODE_SMELL",
        severidadDefault: "MAJOR",
        tags: ["pitfall"],
        atributoCleanCode: "CLEAR",
        impactos: [{ calidad: "MAINTAINABILITY", severidad: "HIGH" }],
        parametros: [{ clave: "max", descripcion: "Máximo", valorDefault: "3" }],
        hashDescripcion: "x",
        primeraSincronizacion: sql`now() - interval '1 day'`,
        altaEnSincronizacionId: corrida,
      })
      .returning({ id: regla.id });
    await db().insert(estadoRegla).values({ reglaId: r.id });
    return r.id;
  }

  beforeAll(async () => {
    await limpiar();
    const [a] = await db()
      .insert(usuario)
      .values({ nombre: "Ana Analista", email: "prueba-det-ana@laincosoftware.com" })
      .returning({ id: usuario.id, rol: usuario.rol });
    const [d] = await db()
      .insert(usuario)
      .values({ nombre: "Diego Decisor", email: "prueba-det-diego@laincosoftware.com", rol: Rol.Decisor })
      .returning({ id: usuario.id, rol: usuario.rol });
    analista = a;
    decisor = d;
    const [s] = await db()
      .insert(sincronizacion)
      .values({ origen: Origen.Eslint, error: "prueba-detalle" })
      .returning({ id: sincronizacion.id });
    corrida = s.id;

    principal = await crearRegla("PRINCIPAL");
    otra = await crearRegla("OTRA");

    // 1. La analista la pasa a A revisar, sin justificación.
    await aplicarTransicion(db(), analista, {
      reglas: [{ id: principal, desde: Estado.PendienteDeAnalizar }],
      hacia: Estado.ARevisar,
      masiva: false,
    });
    // 2. El decisor la incorpora, con justificación, severidad y parámetros.
    await aplicarTransicion(db(), decisor, {
      reglas: [{ id: principal, desde: Estado.ARevisar }],
      hacia: Estado.Incorporada,
      justificacion: "Encontró bugs reales en Dico",
      severidad: "CRITICAL",
      parametros: { max: "5" },
      masiva: false,
    });
    // 3. El decisor la pasa a En prueba junto con otra, en un lote.
    await aplicarTransicion(db(), decisor, {
      reglas: [{ id: otra, desde: Estado.PendienteDeAnalizar }],
      hacia: Estado.EnPrueba,
      masiva: false,
    });
    await aplicarTransicion(db(), decisor, {
      reglas: [
        { id: principal, desde: Estado.Incorporada },
        { id: otra, desde: Estado.EnPrueba },
      ],
      hacia: Estado.Descartada,
      justificacion: "Cambió en Sonar y ya no aplica",
      masiva: true,
    });
    // Un aviso de la sincronización.
    await db().insert(aviso).values({ reglaId: principal, motivo: "modificada", sincronizacionId: corrida });
  });
  afterAll(async () => {
    await limpiar();
    await db().$client.end();
  });

  it("el historial muestra autor, fecha y justificación de cada decisión, de la más nueva a la más vieja", async () => {
    const historial = await historialDeRegla(db(), principal);
    const decisiones = historial.filter((e) => e.tipo === "decision");

    expect(decisiones.map((d) => [d.autor, d.desde, d.hacia, d.justificacion])).toEqual([
      ["Diego Decisor", Estado.Incorporada, Estado.Descartada, "Cambió en Sonar y ya no aplica"],
      ["Diego Decisor", Estado.ARevisar, Estado.Incorporada, "Encontró bugs reales en Dico"],
      ["Ana Analista", Estado.PendienteDeAnalizar, Estado.ARevisar, null],
    ]);
    for (const d of decisiones) {
      expect(d.fecha).toBeInstanceOf(Date);
    }
    const fechas = decisiones.map((d) => d.fecha.getTime());
    expect([...fechas].sort((a, b) => b - a)).toEqual(fechas);
  });

  it("cada decisión trae los textos de los estados y lo que se eligió al incorporar", async () => {
    const historial = await historialDeRegla(db(), principal);
    const incorporacion = historial.find((e) => e.tipo === "decision" && e.hacia === Estado.Incorporada);

    expect(incorporacion).toMatchObject({
      desdeDescripcion: "A revisar",
      haciaDescripcion: "Incorporada",
      severidad: "CRITICAL",
      parametros: { max: "5" },
      lote: null,
    });
  });

  it("una decisión de una operación masiva dice de cuántas reglas fue el lote", async () => {
    const historial = await historialDeRegla(db(), principal);
    const masiva = historial.find((e) => e.tipo === "decision" && e.hacia === Estado.Descartada);

    expect(masiva).toMatchObject({ lote: { cantidad: 2 } });
  });

  it("incluye cuándo llegó de Sonar y los avisos", async () => {
    const historial = await historialDeRegla(db(), principal);

    expect(historial.at(-1)).toMatchObject({ tipo: "alta" });
    expect(historial.find((e) => e.tipo === "aviso")).toMatchObject({
      motivo: "modificada",
      motivoDescripcion: "Cambió en Sonar",
      resuelto: false,
    });
  });

  it("el detalle trae los datos de la regla, su estado actual y la descripción saneada", async () => {
    const detalle = await obtenerRegla(db(), principal);

    expect(detalle).toMatchObject({
      id: principal,
      clave: `${PREFIJO}PRINCIPAL`,
      nombre: "Regla PRINCIPAL",
      origenDescripcion: "ESLint (regla propia)",
      lenguajeDescripcion: "C#",
      tipo: "CODE_SMELL",
      severidadDefault: "MAJOR",
      tags: ["pitfall"],
      atributoCleanCode: "CLEAR",
      impactos: [{ calidad: "MAINTAINABILITY", severidad: "HIGH" }],
      parametros: [{ clave: "max", descripcion: "Máximo", valorDefault: "3" }],
      estado: Estado.Descartada,
      estadoDescripcion: "Descartada",
      severidadAsignada: null,
      parametrosAsignados: null,
      deprecadaEn: null,
      avisosPendientes: 1,
    });
    expect(detalle?.descripcion).toBe("<p>Por qué</p>");
  });

  it("una regla que no existe da null", async () => {
    expect(await obtenerRegla(db(), "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await historialDeRegla(db(), "00000000-0000-4000-8000-000000000000")).toEqual([]);
  });
});
