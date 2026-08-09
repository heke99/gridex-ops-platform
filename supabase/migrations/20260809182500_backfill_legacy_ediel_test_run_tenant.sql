-- Backfill the pre-tenant Ediel AGT test-run history to its verified tenant.
--
-- Historical evidence in the current schema:
-- * all company-less runs are AGT test-environment runs with production disabled;
-- * legacy case codes include the configured test Ediel id 92825;
-- * exactly one company owns test_ediel_id=92825.
--
-- The migration deliberately aborts if that fingerprint is not true. It never
-- chooses an arbitrary company and it never touches production-mode runs.

begin;
set local search_path = public, pg_catalog;

do $$
declare
  v_company_id uuid;
  v_company_count integer;
  v_candidate_count integer;
  v_unexpected_count integer;
begin
  select count(*)::integer, (array_agg(id order by id))[1]
    into v_company_count, v_company_id
  from public.companies
  where test_ediel_id = '92825';

  if v_company_count <> 1 or v_company_id is null then
    raise exception 'legacy_ediel_test_tenant_not_unique:%', v_company_count;
  end if;

  select count(*)::integer
    into v_candidate_count
  from public.ediel_test_runs
  where company_id is null;

  select count(*)::integer
    into v_unexpected_count
  from public.ediel_test_runs
  where company_id is null
    and (
      environment is distinct from 'test'
      or environment_type::text is distinct from 'agt_test'
      or production_mode is distinct from 'disabled'
      or production_like is distinct from false
    );

  if v_unexpected_count <> 0 then
    raise exception 'legacy_ediel_test_run_fingerprint_mismatch:%', v_unexpected_count;
  end if;

  update public.ediel_test_runs
  set
    company_id = v_company_id,
    updated_at = greatest(updated_at, now())
  where company_id is null
    and environment = 'test'
    and environment_type::text = 'agt_test'
    and production_mode = 'disabled'
    and production_like = false;

  if exists (select 1 from public.ediel_test_runs where company_id is null) then
    raise exception 'legacy_ediel_test_run_company_backfill_incomplete';
  end if;

  raise notice 'backfilled % legacy AGT test runs to verified test tenant', v_candidate_count;
end;
$$;

commit;
