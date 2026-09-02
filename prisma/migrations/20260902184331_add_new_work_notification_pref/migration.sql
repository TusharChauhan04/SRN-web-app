-- Opt-out for the "new work matching your skills" notification.
--
-- Additive and backwards compatible on purpose: the column has a default, so
-- rows that already exist gain it without a backfill, and a deployment running
-- the PREVIOUS code keeps working because it simply never selects it. That is
-- what makes it safe to apply this BEFORE shipping the code that uses it, which
-- is the required order — the reverse would leave the new code querying a
-- column that does not exist yet.
--
-- Default true: a provider who never opens settings should still hear about
-- work, which is the point of being listed. Seekers never match the fan-out, so
-- the default costs them nothing.
ALTER TABLE "NotificationPref"
  ADD COLUMN "newWork" BOOLEAN NOT NULL DEFAULT true;
