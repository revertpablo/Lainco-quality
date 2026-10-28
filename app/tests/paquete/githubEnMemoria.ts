import { readFileSync } from "node:fs";

import type { ClienteGitHub, PrDeGitHub } from "@/github/cliente";
import { RUTAS } from "@/paquete/pr";

/**
 * Un repositorio de GitHub en memoria, con lo que usa el PR de configuración: ramas,
 * commits con sus archivos y PRs. `main` arranca con los archivos del paquete de
 * tests/fixtures/paquete/.
 * `fallar` decide, por operación, si GitHub falla.
 */

interface Commit {
  padre: string | null;
  mensaje: string;
  archivos: Map<string, string>;
}

export interface PrEnMemoria extends PrDeGitHub {
  rama: string;
  base: string;
  titulo: string;
  cuerpo: string;
  abierto: boolean;
  mergeadoEn: Date | null;
  cerradoEn: Date | null;
}

type Operacion = keyof Pick<
  ClienteGitHub,
  "commitDeRama" | "leerArchivo" | "crearCommit" | "crearRama" | "moverRama" | "prAbierto" | "crearPr" | "actualizarPr" | "estadoDePr"
>;

// Los archivos de main antes del primer PR de la app (tests/fixtures/paquete/LEEME.md).
const delRepositorio = (ruta: string) => readFileSync(new URL(`../fixtures/paquete/${ruta.split("/").at(-1)}`, import.meta.url), "utf8");

export function githubEnMemoria(fallar: (operacion: Operacion) => Error | undefined = () => undefined) {
  const commits = new Map<string, Commit>();
  const ramas = new Map<string, string>();
  const prs: PrEnMemoria[] = [];
  const llamadas: Operacion[] = [];
  let siguiente = 0;

  const nuevoCommit = (commit: Commit) => {
    const sha = `c${++siguiente}`;
    commits.set(sha, commit);
    return sha;
  };
  ramas.set(
    "main",
    nuevoCommit({ padre: null, mensaje: "inicial", archivos: new Map(Object.values(RUTAS).map((r) => [r, delRepositorio(r)])) }),
  );

  const registrar = (operacion: Operacion) => {
    llamadas.push(operacion);
    const error = fallar(operacion);
    if (error) throw error;
  };

  const github: Pick<ClienteGitHub, Operacion> = {
    async commitDeRama(rama) {
      registrar("commitDeRama");
      return ramas.get(rama) ?? null;
    },
    async leerArchivo(ruta, ref) {
      registrar("leerArchivo");
      return commits.get(ramas.get(ref) ?? ref)?.archivos.get(ruta) ?? null;
    },
    async crearCommit({ base, mensaje, archivos }) {
      registrar("crearCommit");
      const padre = commits.get(base)!;
      return nuevoCommit({ padre: base, mensaje, archivos: new Map([...padre.archivos, ...archivos.map((a) => [a.ruta, a.contenido] as const)]) });
    },
    async crearRama(rama, commit) {
      registrar("crearRama");
      if (ramas.has(rama)) throw new Error(`La rama ${rama} ya existe.`);
      ramas.set(rama, commit);
    },
    async moverRama(rama, commit) {
      registrar("moverRama");
      ramas.set(rama, commit);
    },
    async prAbierto(rama) {
      registrar("prAbierto");
      const pr = prs.find((p) => p.rama === rama && p.abierto);
      return pr ? { numero: pr.numero, url: pr.url } : null;
    },
    async crearPr({ titulo, cuerpo, rama, base }) {
      registrar("crearPr");
      const numero = prs.length + 1;
      const pr = { numero, url: `https://github.com/revertpablo/Lainco-quality/pull/${numero}`, rama, base, titulo, cuerpo, abierto: true, mergeadoEn: null, cerradoEn: null };
      prs.push(pr);
      return { numero, url: pr.url };
    },
    async actualizarPr(numero, { titulo, cuerpo, cerrar }) {
      registrar("actualizarPr");
      const pr = prs.find((p) => p.numero === numero)!;
      if (titulo !== undefined) pr.titulo = titulo;
      if (cuerpo !== undefined) pr.cuerpo = cuerpo;
      if (cerrar) Object.assign(pr, { abierto: false, cerradoEn: new Date() });
    },
    async estadoDePr(numero) {
      registrar("estadoDePr");
      const pr = prs.find((p) => p.numero === numero);
      if (!pr) return null;
      return { estado: pr.abierto ? "abierto" : pr.mergeadoEn ? "mergeado" : "cerrado", mergeadoEn: pr.mergeadoEn, cerradoEn: pr.cerradoEn };
    },
  };

  return {
    github,
    prs,
    llamadas,
    /** Un archivo en la punta de una rama. */
    archivo: (rama: string, ruta: string) => commits.get(ramas.get(rama)!)?.archivos.get(ruta) ?? null,
    /** El commit padre de la punta de una rama. */
    padreDe: (rama: string) => commits.get(ramas.get(rama)!)?.padre ?? null,
    commitDe: (rama: string) => ramas.get(rama) ?? null,
    /** Simula un merge: main pasa a tener los archivos de la rama. */
    mergear(rama: string) {
      const sha = nuevoCommit({ padre: ramas.get("main")!, mensaje: `merge ${rama}`, archivos: new Map(commits.get(ramas.get(rama)!)!.archivos) });
      ramas.set("main", sha);
      for (const pr of prs.filter((p) => p.rama === rama && p.abierto)) Object.assign(pr, { abierto: false, mergeadoEn: new Date(), cerradoEn: new Date() });
    },
    /** Cierra un PR sin mergearlo, como alguien desde GitHub. */
    cerrarSinMergear(numero: number) {
      Object.assign(prs.find((p) => p.numero === numero)!, { abierto: false, cerradoEn: new Date() });
    },
    /** Cambia un archivo en main, como un commit de otra persona. */
    cambiarEnMain(ruta: string, contenido: string) {
      const actual = commits.get(ramas.get("main")!)!;
      ramas.set("main", nuevoCommit({ padre: ramas.get("main")!, mensaje: "cambio a mano", archivos: new Map([...actual.archivos, [ruta, contenido]]) }));
    },
  };
}
