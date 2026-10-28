CREATE TABLE "destinoPublicacion" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "destinoPublicacionPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
INSERT INTO "destinoPublicacion" ("codigo", "descripcion", "orden") VALUES
  ('perfilSonar',     'Perfil de Sonar',         1),
  ('prConfiguracion', 'PR de configuración',     2);
--> statement-breakpoint
ALTER TABLE "publicacion" ADD COLUMN "destino" text DEFAULT 'perfilSonar' NOT NULL;--> statement-breakpoint
ALTER TABLE "publicacion" ADD CONSTRAINT "publicacionDestino" FOREIGN KEY ("destino") REFERENCES "public"."destinoPublicacion"("codigo") ON DELETE no action ON UPDATE no action;