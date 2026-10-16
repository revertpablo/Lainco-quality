-- Decisores iniciales (decisión D6.1, resuelta el 2026-10-15).
--
-- Entran con Google, con la cuenta del dominio de Lainco. Sus usuarios de GitHub, si los
-- quieren usar, se agregan después desde la app. El resto del equipo entra como
-- analista y los cambios de rol se hacen desde la app.
--
-- ON CONFLICT: si alguien ya existe (por ejemplo, porque se cargó a mano antes de
-- correr la migración), no se toca.

INSERT INTO "usuario" ("nombre", "email", "rol") VALUES
  ('Federico Sánchez', 'federico.sanchez@laincosoftware.com', 'decisor'),
  ('Pablo A. Revert', 'pablo.revert@laincosoftware.com', 'decisor')
ON CONFLICT ("email") DO NOTHING;
