ALTER TABLE "prConfiguracion" ADD COLUMN "paquete" text DEFAULT 'roslyn' NOT NULL;--> statement-breakpoint
ALTER TABLE "revisionPaquete" ADD COLUMN "paquete" text DEFAULT 'roslyn' NOT NULL;--> statement-breakpoint
ALTER TABLE "prConfiguracion" ADD CONSTRAINT "prConfiguracionPaquete" CHECK ("prConfiguracion"."paquete" in ('roslyn', 'eslint'));--> statement-breakpoint
ALTER TABLE "revisionPaquete" ADD CONSTRAINT "revisionPaquetePaquete" CHECK ("revisionPaquete"."paquete" in ('roslyn', 'eslint'));--> statement-breakpoint
-- Entrega 6.4, parte ESLint (decisión L4): el desvío del paquete de ESLint.
INSERT INTO "tipoDesvio" ("codigo", "descripcion", "orden") VALUES
  ('reglasEslintDistintas', 'El reglas.json de main no es el de la app', 9);
