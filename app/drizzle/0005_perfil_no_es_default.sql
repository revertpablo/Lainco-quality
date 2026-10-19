-- Entrega 6.2, paso 2: la reconciliación también avisa si el perfil gestionado no es el
-- default del lenguaje (el 2026-10-19 no lo era: el default era "Sonar way comprehensive").
INSERT INTO "tipoDesvio" ("codigo", "descripcion", "orden") VALUES
  ('perfilNoEsDefault', 'El perfil no es el default', 7);
