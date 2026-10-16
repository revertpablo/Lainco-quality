import { eq, like, or } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { IdentidadGithub, IdentidadGoogle } from "@/dominio/acceso";
import { DOMINIO_DE_LAINCO } from "@/dominio/acceso";

/**
 * Ingreso contra una base real: búsqueda, alta de usuarios nuevos de Google y rechazos.
 *
 * Necesita una base **de pruebas** con las migraciones aplicadas, en DATABASE_URL_PRUEBAS
 * (no DATABASE_URL, para no escribir por error en la base de desarrollo). Sin esa
 * variable, se saltean. Los usuarios que crea usan emails y logins con el prefijo
 * `prueba-ingreso-` y se borran al empezar y al terminar.
 */

const url = process.env.DATABASE_URL_PRUEBAS;
const PREFIJO = "prueba-ingreso-";

const email = (nombre: string) => `${PREFIJO}${nombre}@${DOMINIO_DE_LAINCO}`;

function google(nombre: string): IdentidadGoogle {
  return { proveedor: "google", nombre, email: email(nombre), emailVerificado: true, dominio: DOMINIO_DE_LAINCO };
}

function github(login: string): IdentidadGithub {
  return { proveedor: "github", nombre: login, login };
}

describe.skipIf(!url)("ingreso contra la base", async () => {
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const { obtenerDb } = await import("@/db/cliente");
  const { usuario } = await import("@/db/esquema");
  const { resolverIngreso } = await import("@/auth/usuarios");

  const db = () => obtenerDb();

  async function borrarUsuariosDePrueba() {
    await db()
      .delete(usuario)
      .where(or(like(usuario.email, `${PREFIJO}%`), like(usuario.githubLogin, `${PREFIJO}%`)));
  }

  async function buscarPorEmail(valor: string) {
    return db().select().from(usuario).where(eq(usuario.email, valor));
  }

  beforeAll(borrarUsuariosDePrueba);
  beforeEach(borrarUsuariosDePrueba);
  afterAll(async () => {
    await borrarUsuariosDePrueba();
    await db().$client.end();
  });

  it("alguien del dominio que entra por primera vez queda dado de alta como analista", async () => {
    const resultado = await resolverIngreso(google("nueva"));

    const filas = await buscarPorEmail(email("nueva"));
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ nombre: "nueva", rol: "analista", activo: true, githubLogin: null });
    expect(resultado).toEqual({ permitido: true, usuarioId: filas[0].id });
  });

  it("la segunda vez entra con el mismo usuario, sin crear otro", async () => {
    const primera = await resolverIngreso(google("repetida"));
    const segunda = await resolverIngreso(google("repetida"));

    expect(segunda).toEqual(primera);
    expect(await buscarPorEmail(email("repetida"))).toHaveLength(1);
  });

  it("dos ingresos simultáneos del mismo usuario nuevo crean un solo usuario", async () => {
    const resultados = await Promise.all([resolverIngreso(google("simultanea")), resolverIngreso(google("simultanea"))]);

    expect(await buscarPorEmail(email("simultanea"))).toHaveLength(1);
    expect(resultados[0]).toEqual(resultados[1]);
  });

  it("un decisor cargado por seed entra con su rol, aunque Google mande el email con mayúsculas", async () => {
    const resultado = await resolverIngreso({
      ...google("x"),
      email: `Federico.Sanchez@${DOMINIO_DE_LAINCO}`,
    });

    const [decisor] = await buscarPorEmail(`federico.sanchez@${DOMINIO_DE_LAINCO}`);
    expect(decisor.rol).toBe("decisor");
    expect(resultado).toEqual({ permitido: true, usuarioId: decisor.id });
  });

  it("alguien de afuera del dominio no entra y no queda dado de alta", async () => {
    const resultado = await resolverIngreso({ ...google("afuera"), email: `${PREFIJO}afuera@gmail.com`, dominio: null });

    expect(resultado).toEqual({ permitido: false, motivo: "fueraDelDominio" });
    expect(await buscarPorEmail(`${PREFIJO}afuera@gmail.com`)).toHaveLength(0);
  });

  it("GitHub: un login no registrado no entra y no queda dado de alta", async () => {
    const resultado = await resolverIngreso(github(`${PREFIJO}desconocido`));

    expect(resultado).toEqual({ permitido: false, motivo: "noRegistrado" });
    const filas = await db().select().from(usuario).where(eq(usuario.githubLogin, `${PREFIJO}desconocido`));
    expect(filas).toHaveLength(0);
  });

  it("GitHub: un login dado de alta entra, aunque GitHub lo mande con mayúsculas", async () => {
    const [alta] = await db()
      .insert(usuario)
      .values({ nombre: "Con GitHub", githubLogin: `${PREFIJO}conlogin` })
      .returning();

    const resultado = await resolverIngreso(github(`${PREFIJO.toUpperCase()}ConLogin`));

    expect(resultado).toEqual({ permitido: true, usuarioId: alta.id });
  });

  it("un usuario dado de baja no entra, ni por Google ni por GitHub", async () => {
    await db()
      .insert(usuario)
      .values({ nombre: "De baja", email: email("baja"), githubLogin: `${PREFIJO}baja`, activo: false });

    expect(await resolverIngreso(google("baja"))).toEqual({ permitido: false, motivo: "usuarioInactivo" });
    expect(await resolverIngreso(github(`${PREFIJO}baja`))).toEqual({ permitido: false, motivo: "usuarioInactivo" });
  });
});
