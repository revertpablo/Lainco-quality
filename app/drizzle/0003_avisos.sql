CREATE TABLE "aviso" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reglaId" uuid NOT NULL,
	"motivo" text NOT NULL,
	"sincronizacionId" uuid NOT NULL,
	"creadoEn" timestamp with time zone DEFAULT now() NOT NULL,
	"resueltoEn" timestamp with time zone,
	"resueltoPorId" uuid,
	CONSTRAINT "avisoPk" PRIMARY KEY("id"),
	CONSTRAINT "avisoResueltoConAutor" CHECK (("aviso"."resueltoEn" is null) = ("aviso"."resueltoPorId" is null))
);
--> statement-breakpoint
CREATE TABLE "motivoAviso" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "motivoAvisoPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
ALTER TABLE "aviso" ADD CONSTRAINT "avisoRegla" FOREIGN KEY ("reglaId") REFERENCES "public"."regla"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aviso" ADD CONSTRAINT "avisoMotivo" FOREIGN KEY ("motivo") REFERENCES "public"."motivoAviso"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aviso" ADD CONSTRAINT "avisoSincronizacion" FOREIGN KEY ("sincronizacionId") REFERENCES "public"."sincronizacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aviso" ADD CONSTRAINT "avisoResueltoPor" FOREIGN KEY ("resueltoPorId") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avisoPorRegla" ON "aviso" USING btree ("reglaId");--> statement-breakpoint
-- Valores de la tabla de referencia (ver 0001_valores_de_referencia.sql). Escritos a mano.
INSERT INTO "motivoAviso" ("codigo", "descripcion", "orden") VALUES
  ('modificada', 'Cambió en Sonar',     1),
  ('deprecada',  'Deprecada en Sonar',  2),
  ('eliminada',  'Eliminada de Sonar',  3);
