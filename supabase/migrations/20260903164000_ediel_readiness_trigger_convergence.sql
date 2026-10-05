begin;

-- PR #295 installed an earlier global policy fan-out trigger that only captured
-- a new tenant snapshot. The v3 readiness lifecycle now owns rule-version
-- fan-out and also queues exactly one readiness revalidation job per immutable
-- snapshot. Keep only the v3 trigger to avoid duplicate statement-level work.
drop trigger if exists canonical_snapshot_ediel_rule_versions
  on public.ediel_rule_versions;

commit;
