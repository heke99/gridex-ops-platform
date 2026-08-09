-- GRIDEX-AUD-003 derived bootstrap: restore the historical Ediel environment enum.
-- Source: supabase/migrations/20260602143000_ediel_environment_business_action_locks.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact limited to the enum required by later canonical Ediel evidence/state migrations.

do $$
begin
  if to_regtype('public.ediel_environment_type') is null then
    create type public.ediel_environment_type as enum (
      'tgt_test',
      'agt_test',
      'bilateral_test',
      'production'
    );
  end if;
end $$;
