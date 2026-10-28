ALTER TABLE "publicacion" ADD COLUMN "prNumero" integer;--> statement-breakpoint
ALTER TABLE "publicacion" ADD COLUMN "prUrl" text;--> statement-breakpoint
ALTER TABLE "publicacion" ADD CONSTRAINT "publicacionPrSoloDelPaquete" CHECK ("publicacion"."destino" = 'prConfiguracion' or "publicacion"."prNumero" is null);