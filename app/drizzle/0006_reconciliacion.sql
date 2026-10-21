CREATE TABLE "reconciliacion" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"iniciadaEn" timestamp with time zone DEFAULT now() NOT NULL,
	"terminadaEn" timestamp with time zone,
	"estado" text DEFAULT 'enCurso' NOT NULL,
	"abiertos" integer DEFAULT 0 NOT NULL,
	"nuevos" integer DEFAULT 0 NOT NULL,
	"resueltos" integer DEFAULT 0 NOT NULL,
	"advertencias" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"disparadaPorId" uuid,
	CONSTRAINT "reconciliacionPk" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "reconciliacion" ADD CONSTRAINT "reconciliacionEstado" FOREIGN KEY ("estado") REFERENCES "public"."estadoSincronizacion"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliacion" ADD CONSTRAINT "reconciliacionDisparadaPor" FOREIGN KEY ("disparadaPorId") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;