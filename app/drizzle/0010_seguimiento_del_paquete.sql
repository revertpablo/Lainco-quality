CREATE TABLE "estadoPr" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "estadoPrPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "prConfiguracion" (
	"numero" integer NOT NULL,
	"url" text NOT NULL,
	"version" text,
	"estado" text DEFAULT 'abierto' NOT NULL,
	"creadoEn" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizadoEn" timestamp with time zone DEFAULT now() NOT NULL,
	"revisadoEn" timestamp with time zone,
	"mergeadoEn" timestamp with time zone,
	"cerradoEn" timestamp with time zone,
	CONSTRAINT "prConfiguracionPk" PRIMARY KEY("numero"),
	CONSTRAINT "prConfiguracionMergeadoConFecha" CHECK (("prConfiguracion"."estado" = 'mergeado') = ("prConfiguracion"."mergeadoEn" is not null))
);
--> statement-breakpoint
CREATE TABLE "revisionPaquete" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"iniciadaEn" timestamp with time zone DEFAULT now() NOT NULL,
	"terminadaEn" timestamp with time zone,
	"estado" text DEFAULT 'enCurso' NOT NULL,
	"versionEnMain" text,
	"coincide" boolean,
	"error" text,
	"disparadaPorId" uuid,
	CONSTRAINT "revisionPaquetePk" PRIMARY KEY("id")
);
--> statement-breakpoint
INSERT INTO "estadoPr" ("codigo", "descripcion", "orden") VALUES
  ('abierto',  'Abierto',              1),
  ('mergeado', 'Mergeado',             2),
  ('cerrado',  'Cerrado sin mergear',  3);
--> statement-breakpoint
INSERT INTO "tipoDesvio" ("codigo", "descripcion", "orden") VALUES
  ('globalconfigDistinto', 'El .globalconfig de main no es el de la app', 8);
--> statement-breakpoint
-- Los PRs que la app abrió antes de este paso, por sus publicaciones. Quedan abiertos hasta
-- que la revisión del paquete traiga su estado de GitHub.
INSERT INTO "prConfiguracion" ("numero", "url", "creadoEn", "actualizadoEn")
SELECT "prNumero", min("prUrl"), min("publicadaEn"), max("publicadaEn")
FROM "publicacion" WHERE "prNumero" IS NOT NULL GROUP BY "prNumero";
--> statement-breakpoint
ALTER TABLE "prConfiguracion" ADD CONSTRAINT "prConfiguracionEstado" FOREIGN KEY ("estado") REFERENCES "public"."estadoPr"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisionPaquete" ADD CONSTRAINT "revisionPaqueteEstado" FOREIGN KEY ("estado") REFERENCES "public"."estadoSincronizacion"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisionPaquete" ADD CONSTRAINT "revisionPaqueteDisparadaPor" FOREIGN KEY ("disparadaPorId") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;