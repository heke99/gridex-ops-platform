-- Clean-replay prerequisite derived from the checksum-pinned canonical
-- 20260708210000 website application canonical dispatch alignment migration.
-- Batch M (20260613090000) reads this canonical identifier in its readiness
-- view before the later additive migration creates it in historical order.
-- Keep this narrow and idempotent; the complete source migration still replays
-- at its natural timestamp via preserveSourceReplay metadata.

alter table if exists public.metering_points
  add column if not exists ediel_metering_point_id text;
