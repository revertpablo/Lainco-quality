CREATE TABLE "corridaPrueba" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"iniciadaEn" timestamp with time zone DEFAULT now() NOT NULL,
	"terminadaEn" timestamp with time zone,
	"estado" text DEFAULT 'enCurso' NOT NULL,
	"error" text,
	"tokenId" uuid NOT NULL,
	"workflowUrl" text,
	"versionSonarAnalyzer" text,
	"versionLaincoAnalyzers" text,
	CONSTRAINT "corridaPruebaPk" PRIMARY KEY("id"),
	CONSTRAINT "corridaPruebaTerminadaConFecha" CHECK (("corridaPrueba"."estado" = 'enCurso') = ("corridaPrueba"."terminadaEn" is null)),
	CONSTRAINT "corridaPruebaFallidaConError" CHECK (("corridaPrueba"."estado" = 'fallida') = ("corridaPrueba"."error" is not null))
);
--> statement-breakpoint
CREATE TABLE "estadoCorrida" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "estadoCorridaPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "estadoRepositorioPrueba" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "estadoRepositorioPruebaPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "evaluacionMuestra" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "evaluacionMuestraPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "muestraPrueba" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reglaId" uuid NOT NULL,
	"repositorio" text NOT NULL,
	"archivo" text NOT NULL,
	"mensaje" text NOT NULL,
	"linea" integer NOT NULL,
	"columna" integer,
	"commit" text NOT NULL,
	"primeraCorridaId" uuid NOT NULL,
	"ultimaCorridaId" uuid NOT NULL,
	"evaluacion" text DEFAULT 'sinEvaluar' NOT NULL,
	"evaluadaPorId" uuid,
	"evaluadaEn" timestamp with time zone,
	CONSTRAINT "muestraPruebaPk" PRIMARY KEY("id"),
	CONSTRAINT "muestraPruebaIdentidad" UNIQUE("reglaId","repositorio","archivo","mensaje"),
	CONSTRAINT "muestraPruebaRepositorio" CHECK ("muestraPrueba"."repositorio" ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
	CONSTRAINT "muestraPruebaArchivoRelativo" CHECK ("muestraPrueba"."archivo" <> '' and left("muestraPrueba"."archivo", 1) <> '/' and strpos("muestraPrueba"."archivo", '\') = 0),
	CONSTRAINT "muestraPruebaMensajeSinEspaciosDeMas" CHECK ("muestraPrueba"."mensaje" <> '' and "muestraPrueba"."mensaje" = btrim("muestraPrueba"."mensaje")),
	CONSTRAINT "muestraPruebaPosicion" CHECK ("muestraPrueba"."linea" >= 1 and ("muestraPrueba"."columna" is null or "muestraPrueba"."columna" >= 1)),
	CONSTRAINT "muestraPruebaEvaluadaConAutor" CHECK (("muestraPrueba"."evaluacion" = 'sinEvaluar') = ("muestraPrueba"."evaluadaPorId" is null) and ("muestraPrueba"."evaluadaPorId" is null) = ("muestraPrueba"."evaluadaEn" is null))
);
--> statement-breakpoint
CREATE TABLE "reglaEnCorrida" (
	"corridaId" uuid NOT NULL,
	"reglaId" uuid NOT NULL,
	CONSTRAINT "reglaEnCorridaPk" PRIMARY KEY("corridaId","reglaId")
);
--> statement-breakpoint
CREATE TABLE "repositorioEnCorrida" (
	"corridaId" uuid NOT NULL,
	"repositorio" text NOT NULL,
	"estado" text,
	"commit" text,
	"error" text,
	"recibidoEn" timestamp with time zone,
	CONSTRAINT "repositorioEnCorridaPk" PRIMARY KEY("corridaId","repositorio"),
	CONSTRAINT "repositorioEnCorridaFormato" CHECK ("repositorioEnCorrida"."repositorio" ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
	CONSTRAINT "repositorioEnCorridaRecibidoConEstado" CHECK (("repositorioEnCorrida"."estado" is null) = ("repositorioEnCorrida"."recibidoEn" is null)),
	CONSTRAINT "repositorioEnCorridaErrorConMotivo" CHECK ("repositorioEnCorrida"."estado" is null or ("repositorioEnCorrida"."estado" = 'error') = ("repositorioEnCorrida"."error" is not null)),
	CONSTRAINT "repositorioEnCorridaOkConCommit" CHECK ("repositorioEnCorrida"."estado" is distinct from 'ok' or "repositorioEnCorrida"."commit" is not null)
);
--> statement-breakpoint
CREATE TABLE "resultadoPrueba" (
	"corridaId" uuid NOT NULL,
	"repositorio" text NOT NULL,
	"reglaId" uuid NOT NULL,
	"cantidad" integer NOT NULL,
	CONSTRAINT "resultadoPruebaPk" PRIMARY KEY("corridaId","repositorio","reglaId"),
	CONSTRAINT "resultadoPruebaCantidadNoNegativa" CHECK ("resultadoPrueba"."cantidad" >= 0)
);
--> statement-breakpoint
ALTER TABLE "corridaPrueba" ADD CONSTRAINT "corridaPruebaEstado" FOREIGN KEY ("estado") REFERENCES "public"."estadoCorrida"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corridaPrueba" ADD CONSTRAINT "corridaPruebaToken" FOREIGN KEY ("tokenId") REFERENCES "public"."tokenServicio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muestraPrueba" ADD CONSTRAINT "muestraPruebaRegla" FOREIGN KEY ("reglaId") REFERENCES "public"."regla"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muestraPrueba" ADD CONSTRAINT "muestraPruebaPrimeraCorrida" FOREIGN KEY ("primeraCorridaId") REFERENCES "public"."corridaPrueba"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muestraPrueba" ADD CONSTRAINT "muestraPruebaUltimaCorrida" FOREIGN KEY ("ultimaCorridaId") REFERENCES "public"."corridaPrueba"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muestraPrueba" ADD CONSTRAINT "muestraPruebaEvaluacion" FOREIGN KEY ("evaluacion") REFERENCES "public"."evaluacionMuestra"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muestraPrueba" ADD CONSTRAINT "muestraPruebaEvaluadaPor" FOREIGN KEY ("evaluadaPorId") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reglaEnCorrida" ADD CONSTRAINT "reglaEnCorridaCorrida" FOREIGN KEY ("corridaId") REFERENCES "public"."corridaPrueba"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reglaEnCorrida" ADD CONSTRAINT "reglaEnCorridaRegla" FOREIGN KEY ("reglaId") REFERENCES "public"."regla"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositorioEnCorrida" ADD CONSTRAINT "repositorioEnCorridaCorrida" FOREIGN KEY ("corridaId") REFERENCES "public"."corridaPrueba"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositorioEnCorrida" ADD CONSTRAINT "repositorioEnCorridaEstado" FOREIGN KEY ("estado") REFERENCES "public"."estadoRepositorioPrueba"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resultadoPrueba" ADD CONSTRAINT "resultadoPruebaRepositorio" FOREIGN KEY ("corridaId","repositorio") REFERENCES "public"."repositorioEnCorrida"("corridaId","repositorio") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resultadoPrueba" ADD CONSTRAINT "resultadoPruebaRegla" FOREIGN KEY ("corridaId","reglaId") REFERENCES "public"."reglaEnCorrida"("corridaId","reglaId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corridaPruebaIniciadaEn" ON "corridaPrueba" USING btree ("iniciadaEn");--> statement-breakpoint
CREATE INDEX "muestraPruebaReglaUltimaCorrida" ON "muestraPrueba" USING btree ("reglaId","ultimaCorridaId");--> statement-breakpoint
CREATE INDEX "reglaEnCorridaReglaId" ON "reglaEnCorrida" USING btree ("reglaId");--> statement-breakpoint
CREATE INDEX "resultadoPruebaReglaId" ON "resultadoPrueba" USING btree ("reglaId");--> statement-breakpoint
-- Valores de referencia (a mano: drizzle-kit no genera datos).
INSERT INTO "estadoCorrida" ("codigo", "descripcion", "orden") VALUES
	('enCurso',   'En curso',  1),
	('terminada', 'Terminada', 2),
	('fallida',   'Fallida',   3);
--> statement-breakpoint
INSERT INTO "estadoRepositorioPrueba" ("codigo", "descripcion", "orden") VALUES
	('ok',    'Analizado',          1),
	('error', 'No se pudo analizar', 2);
--> statement-breakpoint
INSERT INTO "evaluacionMuestra" ("codigo", "descripcion", "orden") VALUES
	('sinEvaluar',    'Sin evaluar',    1),
	('valida',        'Válida',         2),
	('falsoPositivo', 'Falso positivo', 3);
