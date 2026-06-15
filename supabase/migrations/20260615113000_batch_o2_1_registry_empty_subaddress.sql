-- Batch O2.1 — Registry empty subaddress confirmation
-- Purpose: distinguish between "missing subaddress" and "verified empty subaddress".
--
-- Background:
-- Many production platform_actor_routes are active/verified, have a communication address,
-- and have subaddress = null. In the Ediel registry this can mean that no UNB subaddress
-- is registered/required for that counterparty route. Batch O2 correctly refused to guess a
-- synthetic value such as PRODAT/SCH/GAS, but it was too strict by keeping those active,
-- single-route registry rows blocked forever as needs_subaddress.
--
-- This hotfix does NOT invent a subaddress. It marks an empty subaddress as verified only when:
--   * the grid owner is mapped to a platform actor,
--   * there is exactly one active production route for the actor/message family,
--   * the route has no non-empty subaddress candidates,
--   * the route has a communication address,
--   * and the route is already verified when the column is present.
-- Conflicting or ambiguous routes remain in review.

create extension if not exists pgcrypto with schema extensions;

-- Preserve existing check constraints while allowing a clearer provenance value going forward.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'grid_owners_prodat_subaddress_source_check') then
    alter table public.grid_owners drop constraint grid_owners_prodat_subaddress_source_check;
  end if;
  if exists (select 1 from pg_constraint where conname = 'grid_owners_utilts_subaddress_source_check') then
    alter table public.grid_owners drop constraint grid_owners_utilts_subaddress_source_check;
  end if;

  alter table public.grid_owners add constraint grid_owners_prodat_subaddress_source_check
    check (prodat_subaddress_source in ('route','manual_verified','not_required_confirmed','registry_empty_route','missing','ambiguous'));
  alter table public.grid_owners add constraint grid_owners_utilts_subaddress_source_check
    check (utilts_subaddress_source in ('route','manual_verified','not_required_confirmed','registry_empty_route','missing','ambiguous'));
end $$;

create or replace function public.gridex_confirm_registry_empty_subaddresses(p_source text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prodat_confirmed int := 0;
  v_utilts_confirmed int := 0;
  v_reviews_resolved int := 0;
  v_recheck jsonb := '{}'::jsonb;
begin
  -- PRODAT: mark empty route-subaddress as verified empty only when the registry route is unique and safe.
  with route_candidates as (
    select
      r.actor_id,
      count(*) filter (where upper(r.message_family) = 'PRODAT' and r.environment = 'production' and coalesce(r.status, '') = 'active') as active_route_count,
      count(*) filter (where upper(r.message_family) = 'PRODAT' and r.environment = 'production' and coalesce(r.status, '') = 'active' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as non_empty_subaddress_count,
      count(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'PRODAT' and r.environment = 'production' and coalesce(r.status, '') = 'active' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as distinct_subaddress_count,
      bool_or(upper(r.message_family) = 'PRODAT' and r.environment = 'production' and coalesce(r.status, '') = 'active' and nullif(btrim(coalesce(r.communication_address, '')), '') is not null) as has_communication_address,
      bool_and(coalesce(r.is_verified, true)) filter (where upper(r.message_family) = 'PRODAT' and r.environment = 'production' and coalesce(r.status, '') = 'active') as active_routes_verified
    from public.platform_actor_routes r
    group by r.actor_id
  )
  update public.grid_owners g
  set prodat_subaddress_status = 'not_required_confirmed',
      prodat_subaddress_source = 'registry_empty_route',
      default_prodat_subaddress = null,
      subaddress_verified_at = coalesce(g.subaddress_verified_at, now()),
      subaddress_verification_note = coalesce(
        nullif(btrim(g.subaddress_verification_note), ''),
        'Tom PRODAT-subadress verifierad från aktiv platform actor route utan registrerad subadress.'
      ),
      verification_metadata = coalesce(g.verification_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'prodat_empty_subaddress_confirmed_at', now(),
          'prodat_empty_subaddress_confirmed_source', p_source,
          'prodat_empty_subaddress_confirmation_rule', 'unique_active_production_route_with_empty_registry_subaddress'
        ),
      updated_at = now()
  from route_candidates c
  where g.platform_market_actor_id = c.actor_id
    and c.active_route_count = 1
    and c.non_empty_subaddress_count = 0
    and c.distinct_subaddress_count = 0
    and c.has_communication_address = true
    and coalesce(c.active_routes_verified, true) = true
    and coalesce(g.prodat_subaddress_status, 'missing') in ('missing','ambiguous')
    and nullif(btrim(coalesce(g.default_prodat_subaddress, '')), '') is null;
  get diagnostics v_prodat_confirmed = row_count;

  -- UTILTS: same safe rule for metering route readiness.
  with route_candidates as (
    select
      r.actor_id,
      count(*) filter (where upper(r.message_family) = 'UTILTS' and r.environment = 'production' and coalesce(r.status, '') = 'active') as active_route_count,
      count(*) filter (where upper(r.message_family) = 'UTILTS' and r.environment = 'production' and coalesce(r.status, '') = 'active' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as non_empty_subaddress_count,
      count(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'UTILTS' and r.environment = 'production' and coalesce(r.status, '') = 'active' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as distinct_subaddress_count,
      bool_or(upper(r.message_family) = 'UTILTS' and r.environment = 'production' and coalesce(r.status, '') = 'active' and nullif(btrim(coalesce(r.communication_address, '')), '') is not null) as has_communication_address,
      bool_and(coalesce(r.is_verified, true)) filter (where upper(r.message_family) = 'UTILTS' and r.environment = 'production' and coalesce(r.status, '') = 'active') as active_routes_verified
    from public.platform_actor_routes r
    group by r.actor_id
  )
  update public.grid_owners g
  set utilts_subaddress_status = 'not_required_confirmed',
      utilts_subaddress_source = 'registry_empty_route',
      default_utilts_subaddress = null,
      subaddress_verified_at = coalesce(g.subaddress_verified_at, now()),
      subaddress_verification_note = coalesce(
        nullif(btrim(g.subaddress_verification_note), ''),
        'Tom UTILTS-subadress verifierad från aktiv platform actor route utan registrerad subadress.'
      ),
      verification_metadata = coalesce(g.verification_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'utilts_empty_subaddress_confirmed_at', now(),
          'utilts_empty_subaddress_confirmed_source', p_source,
          'utilts_empty_subaddress_confirmation_rule', 'unique_active_production_route_with_empty_registry_subaddress'
        ),
      updated_at = now()
  from route_candidates c
  where g.platform_market_actor_id = c.actor_id
    and c.active_route_count = 1
    and c.non_empty_subaddress_count = 0
    and c.distinct_subaddress_count = 0
    and c.has_communication_address = true
    and coalesce(c.active_routes_verified, true) = true
    and coalesce(g.utilts_subaddress_status, 'missing') in ('missing','ambiguous')
    and nullif(btrim(coalesce(g.default_utilts_subaddress, '')), '') is null;
  get diagnostics v_utilts_confirmed = row_count;

  -- Re-run O2 completion if it exists, then Batch O verification if available through that function.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'gridex_complete_grid_owner_readiness'
  ) then
    v_recheck := public.gridex_complete_grid_owner_readiness(coalesce(p_source, 'manual') || '_registry_empty_subaddress');
  end if;

  -- Close needs_subaddress review items when no current canonical view reason remains.
  update public.grid_owner_verification_reviews r
  set status = 'resolved',
      resolved_at = now(),
      metadata = coalesce(r.metadata, '{}'::jsonb)
        || jsonb_build_object('resolved_by_batch_o2_1', now(), 'source', p_source)
  from public.gridex_verified_grid_owners_v v
  where r.grid_owner_id = v.grid_owner_id
    and r.status = 'open'
    and r.issue_type = 'needs_subaddress'
    and not ('needs_subaddress' = any(v.verification_reasons));
  get diagnostics v_reviews_resolved = row_count;

  return jsonb_build_object(
    'ok', true,
    'prodat_empty_subaddresses_confirmed_from_registry', v_prodat_confirmed,
    'utilts_empty_subaddresses_confirmed_from_registry', v_utilts_confirmed,
    'needs_subaddress_review_items_resolved', v_reviews_resolved,
    'readiness_recheck', v_recheck
  );
end;
$$;

comment on function public.gridex_confirm_registry_empty_subaddresses(text) is
  'Batch O2.1: marks null route subaddress as verified-empty only for unique active verified production routes with communication address. Does not invent a subaddress value.';

revoke all on function public.gridex_confirm_registry_empty_subaddresses(text) from anon;

-- Do not auto-run on migration; run manually after reviewing the result set:
-- select public.gridex_confirm_registry_empty_subaddresses('manual_after_o2_1');
