-- Valores de las tablas de referencia.
--
-- `codigo` es fijo: lo usa el programa (src/dominio/valores.ts) y no se cambia.
-- `descripcion` es el texto que ve el usuario: se puede corregir con una migración
-- nueva sin tocar el código. `orden` es el orden en los listados y filtros.
--
-- Un código nuevo se agrega en las dos partes: en src/dominio/valores.ts y con una
-- migración nueva que lo inserte acá.

INSERT INTO "estado" ("codigo", "descripcion", "orden") VALUES
  ('pendienteDeAnalizar', 'Pendiente de analizar', 1),
  ('aRevisar',            'A revisar',             2),
  ('enPrueba',            'En prueba',             3),
  ('incorporada',         'Incorporada',           4),
  ('descartada',          'Descartada',            5);
--> statement-breakpoint
INSERT INTO "origen" ("codigo", "descripcion", "orden") VALUES
  ('sonar',   'SonarQube',              1),
  ('roslyn',  'Roslyn (regla propia)',  2),
  ('eslint',  'ESLint (regla propia)',  3),
  ('normaIa', 'Norma de IA',            4);
--> statement-breakpoint
INSERT INTO "lenguaje" ("codigo", "descripcion", "orden") VALUES
  ('cs', 'C#',         1),
  ('ts', 'TypeScript', 2);
--> statement-breakpoint
INSERT INTO "rol" ("codigo", "descripcion", "orden") VALUES
  ('analista', 'Analista', 1),
  ('decisor',  'Decisor',  2);
--> statement-breakpoint
INSERT INTO "estadoSincronizacion" ("codigo", "descripcion", "orden") VALUES
  ('enCurso', 'En curso',   1),
  ('ok',      'Completada', 2),
  ('error',   'Con error',  3);
