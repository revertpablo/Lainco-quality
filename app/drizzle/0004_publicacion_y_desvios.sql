CREATE TABLE "accionPublicacion" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "accionPublicacionPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "desvio" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"lenguaje" text NOT NULL,
	"clave" text NOT NULL,
	"reglaId" uuid,
	"detalle" jsonb,
	"detectadoEn" timestamp with time zone DEFAULT now() NOT NULL,
	"vistoEn" timestamp with time zone DEFAULT now() NOT NULL,
	"resueltoEn" timestamp with time zone,
	CONSTRAINT "desvioPk" PRIMARY KEY("id"),
	CONSTRAINT "desvioVistoDespuesDeDetectado" CHECK ("desvio"."vistoEn" >= "desvio"."detectadoEn")
);
--> statement-breakpoint
CREATE TABLE "estadoPublicacion" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "estadoPublicacionPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "publicacion" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reglaId" uuid NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"decisionId" uuid,
	"desvioId" uuid,
	"pedidaPorId" uuid NOT NULL,
	"creadaEn" timestamp with time zone DEFAULT now() NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"proximoIntentoEn" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimoError" text,
	"accion" text,
	"severidad" text,
	"parametros" jsonb,
	"publicadaEn" timestamp with time zone,
	CONSTRAINT "publicacionPk" PRIMARY KEY("id"),
	CONSTRAINT "publicacionPorDecisionODesvio" CHECK (("publicacion"."decisionId" is null) <> ("publicacion"."desvioId" is null)),
	CONSTRAINT "publicacionPublicadaConFecha" CHECK (("publicacion"."estado" = 'publicada') = ("publicacion"."publicadaEn" is not null)),
	CONSTRAINT "publicacionPublicadaConAccion" CHECK ("publicacion"."estado" <> 'publicada' or "publicacion"."accion" is not null),
	CONSTRAINT "publicacionIntentosNoNegativos" CHECK ("publicacion"."intentos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tipoDesvio" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "tipoDesvioPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
ALTER TABLE "desvio" ADD CONSTRAINT "desvioTipo" FOREIGN KEY ("tipo") REFERENCES "public"."tipoDesvio"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desvio" ADD CONSTRAINT "desvioLenguaje" FOREIGN KEY ("lenguaje") REFERENCES "public"."lenguaje"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desvio" ADD CONSTRAINT "desvioRegla" FOREIGN KEY ("reglaId") REFERENCES "public"."regla"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publicacion" ADD CONSTRAINT "publicacionRegla" FOREIGN KEY ("reglaId") REFERENCES "public"."regla"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publicacion" ADD CONSTRAINT "publicacionEstado" FOREIGN KEY ("estado") REFERENCES "public"."estadoPublicacion"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publicacion" ADD CONSTRAINT "publicacionDecision" FOREIGN KEY ("decisionId") REFERENCES "public"."decision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publicacion" ADD CONSTRAINT "publicacionDesvio" FOREIGN KEY ("desvioId") REFERENCES "public"."desvio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publicacion" ADD CONSTRAINT "publicacionPedidaPor" FOREIGN KEY ("pedidaPorId") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publicacion" ADD CONSTRAINT "publicacionAccion" FOREIGN KEY ("accion") REFERENCES "public"."accionPublicacion"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "desvioAbiertoUnico" ON "desvio" USING btree ("tipo","lenguaje","clave") WHERE "desvio"."resueltoEn" is null;--> statement-breakpoint
CREATE INDEX "desvioPorRegla" ON "desvio" USING btree ("reglaId");--> statement-breakpoint
CREATE UNIQUE INDEX "publicacionPendienteUnica" ON "publicacion" USING btree ("reglaId") WHERE "publicacion"."estado" = 'pendiente';--> statement-breakpoint
CREATE INDEX "publicacionPorEstado" ON "publicacion" USING btree ("estado","proximoIntentoEn");--> statement-breakpoint
-- Valores de las tablas de referencia (ver 0001_valores_de_referencia.sql). Escritos a mano.
INSERT INTO "estadoPublicacion" ("codigo", "descripcion", "orden") VALUES
  ('pendiente', 'Pendiente', 1),
  ('publicada', 'Publicada', 2),
  ('fallida',   'Falló',     3);
--> statement-breakpoint
INSERT INTO "accionPublicacion" ("codigo", "descripcion", "orden") VALUES
  ('activar',    'Activar',    1),
  ('desactivar', 'Desactivar', 2);
--> statement-breakpoint
INSERT INTO "tipoDesvio" ("codigo", "descripcion", "orden") VALUES
  ('activaSinIncorporar',   'Activa en Sonar sin estar Incorporada', 1),
  ('incorporadaInactiva',   'Incorporada e inactiva en Sonar',       2),
  ('severidadDistinta',     'Otra severidad en Sonar',               3),
  ('parametrosDistintos',   'Otros parámetros en Sonar',             4),
  ('perfilConHerencia',     'El perfil hereda de otro',              5),
  ('proyectoConOtroPerfil', 'Un proyecto usa otro perfil',           6);
