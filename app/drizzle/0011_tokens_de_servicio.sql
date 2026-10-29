CREATE TABLE "alcanceToken" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "alcanceTokenPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "tokenServicio" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"alcance" text NOT NULL,
	"hash" text NOT NULL,
	"prefijo" text NOT NULL,
	"creadoEn" timestamp with time zone DEFAULT now() NOT NULL,
	"expiraEn" timestamp with time zone NOT NULL,
	"ultimoUsoEn" timestamp with time zone,
	"revocadoEn" timestamp with time zone,
	CONSTRAINT "tokenServicioPk" PRIMARY KEY("id"),
	CONSTRAINT "tokenServicioNombre" UNIQUE("nombre"),
	CONSTRAINT "tokenServicioHash" UNIQUE("hash"),
	CONSTRAINT "tokenServicioHashSha256" CHECK ("tokenServicio"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "tokenServicioVenceDespuesDeCrearse" CHECK ("tokenServicio"."expiraEn" > "tokenServicio"."creadoEn")
);
--> statement-breakpoint
ALTER TABLE "tokenServicio" ADD CONSTRAINT "tokenServicioAlcance" FOREIGN KEY ("alcance") REFERENCES "public"."alcanceToken"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Valores de referencia (a mano: drizzle-kit no genera datos).
INSERT INTO "alcanceToken" ("codigo", "descripcion", "orden") VALUES
	('prueba', 'Job de prueba de reglas', 1);
