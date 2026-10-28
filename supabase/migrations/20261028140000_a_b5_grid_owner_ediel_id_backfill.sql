-- FINDINGS A-B5, owner decision 42 (2026-10-28): a bounded one-time backfill of metering_points.grid_owner_ediel_id.
-- Migration 20261027110000 fills the column for new and changed points; existing points bound to a grid owner still
-- lack it (world: 499 of 937), so no requested metering method and no Z03 can be prepared for them.
--
-- Rule (the owner's, verbatim in OWNER-DECISIONS 42):
-- * Only a missing value is filled, and only from the grid owner the point is already bound to (grid_owner_id).
-- * That owner must be usable by the point's tenant (its own row or a platform-shared row), active, in the electricity
--   scope, not under manual review, not an unresolved duplicate, with a well-formed Ediel id whose identity the actor
--   registry has verified (actor_registry_status = 'verified'). Route, subaddress, contact and certificate readiness
--   concern sending, not identity, and are not required.
-- * A point whose active grid-area mapping names another Ediel id, a historical (archived or ended) point, and every
--   point that fails a check above is not filled: it gets an open data-quality issue for review, with the reason.
-- * An existing explicit value is never overwritten (such points are not selected at all).
-- * Every fill gets an audit row with before and after image, the grid owner's identity evidence as its source, and
--   the e035 correction fact the update produced (gridex_correction_process.facts). Received originals
--   (ediel_messages, gridex_received_sources) are not read for attribution and are not written.
-- * One-time: (run_key, metering_point_id) is unique, so a repeated run does nothing for a point already handled.
begin;

create schema if not exists gridex_backfill;
revoke all on schema gridex_backfill from public, anon, authenticated, service_role;

create table gridex_backfill.grid_owner_ediel_id_v1 (
  id bigint generated always as identity primary key,
  run_key text not null,
  metering_point_id uuid not null references public.metering_points(id) on delete restrict,
  company_id uuid not null,
  grid_owner_id uuid not null,
  outcome text not null check (outcome in ('filled', 'review')),
  reason text not null,
  before_value text,
  after_value text,
  source jsonb not null,
  e035_fact_id bigint references gridex_correction_process.facts(id),
  data_quality_issue_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (run_key, metering_point_id),
  check ((outcome = 'filled') = (after_value is not null and e035_fact_id is not null and before_value is null)),
  check (outcome = 'filled' or (after_value is null and data_quality_issue_id is not null))
);
revoke all on table gridex_backfill.grid_owner_ediel_id_v1 from public, anon, authenticated, service_role;

create function gridex_backfill.a_b5_grid_owner_ediel_id_v1(p_run_key text, p_metering_point_ids uuid[] default null)
returns table (filled integer, review integer)
language plpgsql security definer set search_path = pg_catalog as $$
declare
  r record;
  why text;
  area_ediel text[];
  fact bigint;
  issue uuid;
  n_filled integer := 0;
  n_review integer := 0;
begin
  if nullif(btrim(p_run_key), '') is null then
    raise exception 'grid_owner_ediel_backfill_run_key_required' using errcode = '22023';
  end if;
  for r in
    select m.id, m.company_id, m.grid_owner_id, m.grid_area_code, m.archived_at, m.end_date, m.closed_at,
           g.company_id as owner_company_id, g.ediel_id, g.is_active, g.lifecycle_status, g.actor_registry_status,
           g.verification_status, g.manual_review_required, g.excluded_from_electricity_scope, g.duplicate_count,
           g.source as owner_source, g.verified_at, g.platform_market_actor_id
    from public.metering_points m
    join public.grid_owners g on g.id = m.grid_owner_id
    where nullif(btrim(m.grid_owner_ediel_id), '') is null
      and (p_metering_point_ids is null or m.id = any(p_metering_point_ids))
      and not exists (select from gridex_backfill.grid_owner_ediel_id_v1 b where b.run_key = p_run_key and b.metering_point_id = m.id)
    order by m.id
    for update of m
  loop
    select array_agg(distinct pg.ediel_id) filter (where nullif(btrim(pg.ediel_id), '') is not null) into area_ediel
    from public.platform_grid_areas pa join public.grid_owners pg on pg.id = pa.grid_owner_id
    where r.grid_area_code is not null and pa.grid_area_code = r.grid_area_code and pa.is_active
      and (pa.valid_from is null or pa.valid_from <= current_date) and (pa.valid_to is null or pa.valid_to > current_date);

    why := case
      when r.owner_company_id is not null and r.owner_company_id <> r.company_id then 'grid_owner_other_tenant'
      when r.archived_at is not null or r.closed_at is not null or (r.end_date is not null and r.end_date < current_date)
        then 'historical_metering_point'
      when not r.is_active or coalesce(r.lifecycle_status, 'active') <> 'active' then 'grid_owner_not_active'
      when coalesce(r.excluded_from_electricity_scope, false) then 'grid_owner_excluded_from_electricity_scope'
      when coalesce(r.duplicate_count, 1) > 1 then 'grid_owner_unresolved_duplicate'
      when coalesce(r.manual_review_required, false) then 'grid_owner_under_manual_review'
      when coalesce(r.ediel_id, '') !~ '^[0-9]{5}$' then 'grid_owner_ediel_id_missing_or_malformed'
      when r.actor_registry_status is distinct from 'verified' then 'grid_owner_identity_unverified'
      when cardinality(coalesce(area_ediel, '{}')) > 1 or (cardinality(coalesce(area_ediel, '{}')) = 1 and area_ediel[1] <> r.ediel_id)
        then 'grid_area_owner_conflict'
      else null
    end;

    if why is null then
      update public.metering_points set grid_owner_ediel_id = r.ediel_id
      where id = r.id and nullif(btrim(grid_owner_ediel_id), '') is null and grid_owner_id = r.grid_owner_id;
      select max(f.id) into fact from gridex_correction_process.facts f
      where f.table_name = 'metering_points' and f.row_id = r.id and f.operation = 'UPDATE'
        and f.created_xid = pg_current_xact_id() and f.new_fact->>'grid_owner_ediel_id' = r.ediel_id;
      if fact is null then
        raise exception 'grid_owner_ediel_backfill_e035_fact_missing' using errcode = 'P0001';
      end if;
      insert into gridex_backfill.grid_owner_ediel_id_v1(run_key, metering_point_id, company_id, grid_owner_id, outcome,
        reason, before_value, after_value, source, e035_fact_id)
      values (p_run_key, r.id, r.company_id, r.grid_owner_id, 'filled', 'bound_verified_grid_owner', null, r.ediel_id,
        jsonb_build_object('table', 'grid_owners', 'grid_owner_id', r.grid_owner_id, 'ediel_id', r.ediel_id,
          'actor_registry_status', r.actor_registry_status, 'verification_status', r.verification_status,
          'verified_at', r.verified_at, 'owner_source', r.owner_source, 'platform_market_actor_id', r.platform_market_actor_id,
          'grid_area_code', r.grid_area_code, 'grid_area_ediel_ids', area_ediel, 'decision', 'owner decision 42'),
        fact);
      n_filled := n_filled + 1;
    else
      select q.id into issue from public.data_quality_issues q
      where q.company_id = r.company_id and q.source = 'a_b5_grid_owner_ediel_backfill' and q.entity_type = 'metering_point'
        and q.entity_id = r.id and q.issue_type = 'grid_owner_ediel_id_backfill_review' and q.status = 'open'
      limit 1;
      if issue is null then
        insert into public.data_quality_issues(company_id, entity_type, entity_id, issue_type, severity, message, status, source)
        values (r.company_id, 'metering_point', r.id, 'grid_owner_ediel_id_backfill_review', 'warning',
          'Nätägarens Ediel-id fylldes inte i automatiskt (' || why || '). Kontrollera mätpunktens nätägarkoppling.',
          'open', 'a_b5_grid_owner_ediel_backfill')
        returning id into issue;
      end if;
      insert into gridex_backfill.grid_owner_ediel_id_v1(run_key, metering_point_id, company_id, grid_owner_id, outcome,
        reason, before_value, after_value, source, data_quality_issue_id)
      values (p_run_key, r.id, r.company_id, r.grid_owner_id, 'review', why, null, null,
        jsonb_build_object('table', 'grid_owners', 'grid_owner_id', r.grid_owner_id, 'ediel_id', r.ediel_id,
          'actor_registry_status', r.actor_registry_status, 'grid_area_code', r.grid_area_code,
          'grid_area_ediel_ids', area_ediel, 'decision', 'owner decision 42'),
        issue);
      n_review := n_review + 1;
    end if;
  end loop;
  return query select n_filled, n_review;
end
$$;
revoke all on function gridex_backfill.a_b5_grid_owner_ediel_id_v1(text, uuid[]) from public, anon, authenticated, service_role;

-- The one run.
select * from gridex_backfill.a_b5_grid_owner_ediel_id_v1('a_b5_20261028');

commit;
