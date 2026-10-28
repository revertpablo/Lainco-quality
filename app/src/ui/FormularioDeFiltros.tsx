import Link from "next/link";

import type { Filtros } from "@/dominio/filtros";
import type { OpcionesDeFiltro } from "@/inventario/consulta";

import { textoDeSeveridad, textoDeTipo } from "./etiquetas";

/**
 * Filtros del inventario. Es un formulario GET común: los filtros quedan en la URL y
 * funciona sin JavaScript. El orden de la tabla viaja en campos ocultos.
 */
export function FormularioDeFiltros({ filtros, opciones }: { filtros: Filtros; opciones: OpcionesDeFiltro }) {
  const tagsElegidos = new Set(filtros.tags);
  const tagsParaAgregar = opciones.tags.filter((t) => !tagsElegidos.has(t.tag));

  return (
    <form method="get" action="/reglas" className="flex flex-col gap-5 text-sm">
      <input type="hidden" name="orden" value={filtros.orden} />
      <input type="hidden" name="sentido" value={filtros.sentido} />

      <label className="flex flex-col gap-1">
        <span className="font-medium">Buscar</span>
        <input
          type="search"
          name="q"
          defaultValue={filtros.q}
          placeholder="Clave o nombre"
          className="rounded border border-linea bg-superficie px-2 py-1"
        />
      </label>

      <Grupo titulo="Estado">
        {opciones.estados.map((e) => (
          <Casilla key={e.codigo} nombre="estado" valor={e.codigo} marcada={filtros.estados.includes(e.codigo)}>
            {e.descripcion}
          </Casilla>
        ))}
      </Grupo>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium">Tags</legend>
        {filtros.tags.map((tag) => (
          <Casilla key={tag} nombre="tag" valor={tag} marcada>
            {tag}
          </Casilla>
        ))}
        <select
          name="tag"
          defaultValue=""
          aria-label="Agregar un tag"
          className="mt-1 rounded border border-linea bg-superficie px-1 py-1"
        >
          <option value="">{filtros.tags.length > 0 ? "Agregar otro tag" : "Elegir un tag"}</option>
          {tagsParaAgregar.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.cantidad})
            </option>
          ))}
        </select>
        {filtros.tags.length > 1 && <p className="text-xs text-tenue">Reglas con cualquiera de estos tags.</p>}
      </fieldset>

      <Grupo titulo="Lenguaje">
        {opciones.lenguajes.map((l) => (
          <Casilla key={l.codigo} nombre="lenguaje" valor={l.codigo} marcada={filtros.lenguajes.includes(l.codigo)}>
            {l.descripcion}
          </Casilla>
        ))}
      </Grupo>

      <Grupo titulo="Tipo">
        {opciones.tipos.map((t) => (
          <Casilla key={t} nombre="tipo" valor={t} marcada={filtros.tipos.includes(t)}>
            {textoDeTipo(t)}
          </Casilla>
        ))}
      </Grupo>

      <Grupo titulo="Severidad por defecto">
        {opciones.severidades.map((s) => (
          <Casilla key={s} nombre="severidad" valor={s} marcada={filtros.severidades.includes(s)}>
            {textoDeSeveridad(s)}
          </Casilla>
        ))}
      </Grupo>

      <Grupo titulo="Atributo de clean code">
        {opciones.atributos.map((a) => (
          <Casilla key={a} nombre="atributo" valor={a} marcada={filtros.atributos.includes(a)}>
            {a.charAt(0) + a.slice(1).toLowerCase()}
          </Casilla>
        ))}
      </Grupo>

      <Grupo titulo="Origen">
        {opciones.origenes.map((o) => (
          <Casilla key={o.codigo} nombre="origen" valor={o.codigo} marcada={filtros.origenes.includes(o.codigo)}>
            {o.descripcion}
          </Casilla>
        ))}
      </Grupo>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium">Última sincronización</legend>
        <Opcion nombre="novedad" valor="" marcada={!filtros.novedad}>
          Todas
        </Opcion>
        <Opcion nombre="novedad" valor="nuevas" marcada={filtros.novedad === "nuevas"}>
          Solo las nuevas
        </Opcion>
        <Opcion nombre="novedad" valor="modificadas" marcada={filtros.novedad === "modificadas"}>
          Solo las modificadas
        </Opcion>
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium">Deprecadas o eliminadas</legend>
        <Opcion nombre="deprecadas" valor="incluir" marcada={filtros.deprecadas === "incluir"}>
          Incluirlas
        </Opcion>
        <Opcion nombre="deprecadas" valor="excluir" marcada={filtros.deprecadas === "excluir"}>
          Ocultarlas
        </Opcion>
        <Opcion nombre="deprecadas" valor="solo" marcada={filtros.deprecadas === "solo"}>
          Solo las deprecadas
        </Opcion>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" className="rounded bg-pino px-3 py-1.5 font-medium text-sobre-pino">
          Filtrar
        </button>
        <Link href="/reglas" className="text-tenue underline underline-offset-2 hover:text-tinta">
          Limpiar
        </Link>
      </div>
    </form>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 font-medium">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function Casilla({
  nombre,
  valor,
  marcada,
  children,
}: {
  nombre: string;
  valor: string;
  marcada: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" name={nombre} value={valor} defaultChecked={marcada} className="accent-pino" />
      <span>{children}</span>
    </label>
  );
}

function Opcion({
  nombre,
  valor,
  marcada,
  children,
}: {
  nombre: string;
  valor: string;
  marcada: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="radio" name={nombre} value={valor} defaultChecked={marcada} className="accent-pino" />
      <span>{children}</span>
    </label>
  );
}
