-- Ciclo de vida (2026-10-30, FASE-6.md sección 4): "A revisar" pasa a llamarse "En análisis",
-- también en el código (aRevisar → enAnalisis), y se agrega "En duda": no hay acuerdo, o los
-- resultados de la prueba no convencen todavía.
--
-- El código es la clave de la tabla de referencia y las claves foráneas no actualizan en
-- cascada: se agrega el código nuevo, se pasan a él el estado actual de las reglas, el
-- historial y los filtros de las vistas guardadas, y recién entonces se borra el viejo.

INSERT INTO "estado" ("codigo", "descripcion", "orden") VALUES
  ('enAnalisis', 'En análisis', 2),
  ('enDuda',     'En duda',     4);
--> statement-breakpoint
UPDATE "estadoRegla" SET "estado" = 'enAnalisis' WHERE "estado" = 'aRevisar';
--> statement-breakpoint
UPDATE "decision" SET "estadoAnterior" = 'enAnalisis' WHERE "estadoAnterior" = 'aRevisar';
--> statement-breakpoint
UPDATE "decision" SET "estadoNuevo" = 'enAnalisis' WHERE "estadoNuevo" = 'aRevisar';
--> statement-breakpoint
UPDATE "vistaGuardada"
SET "filtros" = jsonb_set(
  "filtros",
  '{estado}',
  (SELECT jsonb_agg(CASE WHEN e = 'aRevisar' THEN 'enAnalisis' ELSE e END) FROM jsonb_array_elements_text("filtros" -> 'estado') AS e)
)
WHERE "filtros" -> 'estado' ? 'aRevisar';
--> statement-breakpoint
DELETE FROM "estado" WHERE "codigo" = 'aRevisar';
--> statement-breakpoint
UPDATE "estado" SET "orden" = 5 WHERE "codigo" = 'incorporada';
--> statement-breakpoint
UPDATE "estado" SET "orden" = 6 WHERE "codigo" = 'descartada';
