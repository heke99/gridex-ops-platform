-- Batch O6.3 — Safe blank subaddress backfill + future enforcement
-- Purpose:
--   * If the Ediel actor registry has exactly one active verified production route for PRODAT/UTILTS
--     and that route has no subaddress, the blank subaddress is a valid "not required" state.
--   * Do not invent a subaddress value. Keep platform_actor_routes.subaddress as NULL.
--   * Persist the safe decision in route metadata so actor_readiness_status and auto-send guards can trust it.
--   * Backfill existing safe routes and make the same function reusable by XML import, cron and admin actions.

create extension if not exists pgcrypto with schema extensions;

create or replace view public.gridex_o6_3_safe_blank_subaddress_candidates_v
with (security_invoker = true)
as
with actor_ediel_ids as (
  select
    actor_id,
    array_agg(distinct identifier_value order by identifier_value) filter (
      where lower(identifier_type) in ('edielid', 'ediel_id', 'ediel')
        and nullif(btrim(identifier_value), '') is not null
    ) as ediel_ids,
    array_agg(distinct identifier_value order by identifier_value) filter (
      where lower(identifier_type) in ('edielid', 'ediel_id', 'ediel')
        and coalesce(is_verified, false) = true
        and nullif(btrim(identifier_value), '') is not null
    ) as verified_ediel_ids
  from public.platform_actor_identifiers
  group by actor_id
), actor_roles as (
  select
    actor_id,
    array_agg(distinct lower(actor_role) order by lower(actor_role)) filter (where nullif(btrim(actor_role), '') is not null) as actor_roles,
    bool_or(lower(actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')) as has_grid_owner_role
  from public.platform_actor_roles
  where coalesce(is_active, true) = true
  group by actor_id
), active_routes as (
  select
    r.*,
    upper(coalesce(r.message_family, '')) as family,
    lower(coalesce(r.environment, '')) as env,
    nullif(btrim(coalesce(r.subaddress, '')), '') as clean_subaddress,
    nullif(btrim(coalesce(r.communication_address, '')), '') as clean_communication_address,
    nullif(btrim(coalesce(r.party_id, '')), '') as clean_party_id,
    nullif(btrim(coalesce(r.interchange_party_id, '')), '') as clean_interchange_party_id
  from public.platform_actor_routes r
  where upper(coalesce(r.message_family, '')) in ('PRODAT', 'UTILTS')
    and lower(coalesce(r.environment, '')) = 'production'
    and lower(coalesce(r.status, '')) = 'active'
), grouped as (
  select
    actor_id,
    family,
    env,
    count(*)::integer as active_route_count,
    count(*) filter (where clean_subaddress is null)::integer as blank_subaddress_count,
    count(*) filter (where clean_subaddress is not null)::integer as explicit_subaddress_count,
    count(distinct clean_communication_address) filter (where clean_communication_address is not null)::integer as distinct_communication_address_count,
    array_agg(id order by created_at, id) as route_ids,
    array_agg(distinct clean_communication_address) filter (where clean_communication_address is not null) as communication_addresses,
    array_agg(distinct clean_party_id) filter (where clean_party_id is not null) as party_ids,
    array_agg(distinct clean_interchange_party_id) filter (where clean_interchange_party_id is not null) as interchange_party_ids,
    bool_and(coalesce(is_verified, false)) as all_active_routes_verified
  from active_routes
  group by actor_id, family, env
), route_rows as (
  select
    r.id as route_id,
    r.actor_id,
    r.family as message_family,
    r.env as environment,
    r.clean_subaddress,
    r.clean_communication_address,
    r.clean_party_id,
    r.clean_interchange_party_id,
    r.metadata,
    g.active_route_count,
    g.blank_subaddress_count,
    g.explicit_subaddress_count,
    g.distinct_communication_address_count,
    g.route_ids,
    g.communication_addresses,
    g.party_ids,
    g.interchange_party_ids,
    g.all_active_routes_verified
  from active_routes r
  join grouped g
    on g.actor_id = r.actor_id
   and g.family = r.family
   and g.env = r.env
)
select
  a.name as actor_name,
  rr.actor_id,
  rr.route_id,
  coalesce(rr.clean_party_id, (ai.verified_ediel_ids)[1], (ai.ediel_ids)[1]) as ediel_id,
  ai.ediel_ids,
  ai.verified_ediel_ids,
  coalesce(ar.actor_roles, '{}'::text[]) as actor_roles,
  coalesce(ar.has_grid_owner_role, false) as has_grid_owner_role,
  rr.message_family,
  rr.environment,
  rr.active_route_count,
  rr.blank_subaddress_count,
  rr.explicit_subaddress_count,
  rr.distinct_communication_address_count,
  rr.communication_addresses,
  rr.party_ids,
  rr.interchange_party_ids,
  coalesce(rr.metadata->>'subaddress_status', 'missing') as current_subaddress_status,
  case
    when coalesce(ar.has_grid_owner_role, false) is not true then false
    when rr.active_route_count <> 1 then false
    when rr.blank_subaddress_count <> 1 then false
    when rr.explicit_subaddress_count <> 0 then false
    when rr.clean_subaddress is not null then false
    when rr.clean_communication_address is null then false
    when rr.all_active_routes_verified is not true then false
    when rr.clean_party_id is null then false
    when rr.clean_interchange_party_id is null then false
    when rr.clean_party_id <> rr.clean_interchange_party_id then false
    when coalesce(array_length(ai.verified_ediel_ids, 1), 0) > 0 and not (rr.clean_party_id = any(ai.verified_ediel_ids)) then false
    when coalesce(rr.metadata->>'subaddress_status', '') in ('verified', 'not_required_confirmed') then true
    else true
  end as can_auto_confirm,
  array_remove(array[
    case when coalesce(ar.has_grid_owner_role, false) is not true then 'actor_not_grid_owner' end,
    case when rr.active_route_count <> 1 then 'not_unique_active_route' end,
    case when rr.blank_subaddress_count <> 1 then 'blank_route_count_not_one' end,
    case when rr.explicit_subaddress_count <> 0 then 'explicit_subaddress_exists' end,
    case when rr.clean_subaddress is not null then 'subaddress_already_explicit' end,
    case when rr.clean_communication_address is null then 'missing_communication_address' end,
    case when rr.all_active_routes_verified is not true then 'route_not_verified' end,
    case when rr.clean_party_id is null then 'missing_party_id' end,
    case when rr.clean_interchange_party_id is null then 'missing_interchange_party_id' end,
    case when rr.clean_party_id is not null and rr.clean_interchange_party_id is not null and rr.clean_party_id <> rr.clean_interchange_party_id then 'party_id_interchange_mismatch' end,
    case when coalesce(array_length(ai.verified_ediel_ids, 1), 0) > 0 and rr.clean_party_id is not null and not (rr.clean_party_id = any(ai.verified_ediel_ids)) then 'party_id_not_verified_ediel_id' end
  ], null) as skip_reasons
from route_rows rr
join public.platform_market_actors a on a.id = rr.actor_id
left join actor_ediel_ids ai on ai.actor_id = rr.actor_id
left join actor_roles ar on ar.actor_id = rr.actor_id;

comment on view public.gridex_o6_3_safe_blank_subaddress_candidates_v is
  'O6.3 diagnostic view for safe blank PRODAT/UTILTS subaddress confirmation. can_auto_confirm=true means blank subaddress is treated as not required, never as a synthetic value.';

create or replace function public.gridex_confirm_safe_blank_route_subaddresses(
  p_source text default 'manual',
  p_actor_id uuid default null,
  p_apply_auto_send boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_routes_confirmed int := 0;
  v_prodat_routes_confirmed int := 0;
  v_utilts_routes_confirmed int := 0;
  v_grid_prodat_updated int := 0;
  v_grid_utilts_updated int := 0;
  v_readiness jsonb := '{}'::jsonb;
  v_auto_send jsonb := '{}'::jsonb;
begin
  -- Confirm only safe blank routes. Keep subaddress NULL; write provenance to metadata.
  with candidates as (
    select *
    from public.gridex_o6_3_safe_blank_subaddress_candidates_v
    where can_auto_confirm = true
      and (p_actor_id is null or actor_id = p_actor_id)
  ), updated as (
    update public.platform_actor_routes r
    set metadata = coalesce(r.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'subaddress_status', 'not_required_confirmed',
            'subaddress_confirmation_source', 'unique_active_verified_production_route_without_subaddress',
            'subaddress_confirmation_policy', 'blank_allowed_only_for_unique_active_route',
            'subaddress_confirmed_by', 'system',
            'subaddress_confirmed_at', now(),
            'subaddress_confirmation_batch', 'O6.3',
            'subaddress_confirmation_trigger', coalesce(p_source, 'manual'),
            'blank_subaddress_requires_review', false
          ),
        updated_at = now()
    from candidates c
    where r.id = c.route_id
      and coalesce(r.metadata->>'subaddress_status', '') <> 'not_required_confirmed'
    returning r.id, r.actor_id, upper(r.message_family) as message_family
  )
  select
    count(*)::integer,
    count(*) filter (where message_family = 'PRODAT')::integer,
    count(*) filter (where message_family = 'UTILTS')::integer
  into v_routes_confirmed, v_prodat_routes_confirmed, v_utilts_routes_confirmed
  from updated;

  -- Keep legacy/grid-owner readiness fields in sync for grid owners mapped to confirmed actor routes.
  with confirmed as (
    select distinct actor_id, message_family
    from public.gridex_o6_3_safe_blank_subaddress_candidates_v
    where can_auto_confirm = true
      and message_family = 'PRODAT'
      and (p_actor_id is null or actor_id = p_actor_id)
  )
  update public.grid_owners g
  set prodat_subaddress_status = 'not_required_confirmed',
      prodat_subaddress_source = 'registry_empty_route',
      default_prodat_subaddress = null,
      subaddress_verified_at = coalesce(g.subaddress_verified_at, now()),
      subaddress_verification_note = coalesce(nullif(btrim(g.subaddress_verification_note), ''), 'Tom PRODAT-subadress bekräftad från unik aktiv verifierad registerroute utan subadress.'),
      verification_metadata = coalesce(g.verification_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'o6_3_prodat_blank_subaddress_confirmed_at', now(),
          'o6_3_prodat_blank_subaddress_source', coalesce(p_source, 'manual'),
          'o6_3_prodat_blank_subaddress_policy', 'unique_active_verified_production_route_without_subaddress'
        ),
      updated_at = now()
  from confirmed c
  where g.platform_market_actor_id = c.actor_id
    and coalesce(g.prodat_subaddress_status, 'missing') in ('missing', 'ambiguous')
    and nullif(btrim(coalesce(g.default_prodat_subaddress, '')), '') is null;
  get diagnostics v_grid_prodat_updated = row_count;

  with confirmed as (
    select distinct actor_id, message_family
    from public.gridex_o6_3_safe_blank_subaddress_candidates_v
    where can_auto_confirm = true
      and message_family = 'UTILTS'
      and (p_actor_id is null or actor_id = p_actor_id)
  )
  update public.grid_owners g
  set utilts_subaddress_status = 'not_required_confirmed',
      utilts_subaddress_source = 'registry_empty_route',
      default_utilts_subaddress = null,
      subaddress_verified_at = coalesce(g.subaddress_verified_at, now()),
      subaddress_verification_note = coalesce(nullif(btrim(g.subaddress_verification_note), ''), 'Tom UTILTS-subadress bekräftad från unik aktiv verifierad registerroute utan subadress.'),
      verification_metadata = coalesce(g.verification_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'o6_3_utilts_blank_subaddress_confirmed_at', now(),
          'o6_3_utilts_blank_subaddress_source', coalesce(p_source, 'manual'),
          'o6_3_utilts_blank_subaddress_policy', 'unique_active_verified_production_route_without_subaddress'
        ),
      updated_at = now()
  from confirmed c
  where g.platform_market_actor_id = c.actor_id
    and coalesce(g.utilts_subaddress_status, 'missing') in ('missing', 'ambiguous')
    and nullif(btrim(coalesce(g.default_utilts_subaddress, '')), '') is null;
  get diagnostics v_grid_utilts_updated = row_count;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'gridex_recalculate_actor_readiness'
  ) then
    v_readiness := public.gridex_recalculate_actor_readiness(p_actor_id);
  end if;

  if coalesce(p_apply_auto_send, true) and exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'gridex_apply_actor_auto_send_readiness'
  ) then
    v_auto_send := public.gridex_apply_actor_auto_send_readiness(null::uuid);
  end if;

  return jsonb_build_object(
    'ok', true,
    'source', coalesce(p_source, 'manual'),
    'actor_id', p_actor_id,
    'routes_confirmed', v_routes_confirmed,
    'prodat_routes_confirmed', v_prodat_routes_confirmed,
    'utilts_routes_confirmed', v_utilts_routes_confirmed,
    'grid_owner_prodat_rows_updated', v_grid_prodat_updated,
    'grid_owner_utilts_rows_updated', v_grid_utilts_updated,
    'readiness_recalculation', v_readiness,
    'auto_send', v_auto_send
  );
end;
$$;

comment on function public.gridex_confirm_safe_blank_route_subaddresses(text, uuid, boolean) is
  'Backfills and enforces safe blank subaddress handling. Blank subaddress is accepted only for unique active verified production PRODAT/UTILTS routes with matching party IDs and a communication address. Does not invent a subaddress.';

-- Recreate auto-send readiness view with a guard: blank subaddress is allowed only after O6.3 confirmation.
create or replace view public.platform_actor_send_readiness_v
with (security_invoker = true)
as
with actor_roles as (
  select actor_id, array_agg(distinct actor_role order by actor_role) as roles
  from public.platform_actor_roles
  where coalesce(is_active, true) = true
  group by actor_id
), actor_ids as (
  select actor_id, max(identifier_value) filter (where lower(identifier_type) in ('edielid','ediel_id','ediel')) as ediel_id,
         bool_or(coalesce(is_verified, false)) filter (where lower(identifier_type) in ('edielid','ediel_id','ediel')) as ediel_id_verified
  from public.platform_actor_identifiers
  group by actor_id
), latest_cert as (
  select distinct on (c.actor_id, c.environment, c.purpose)
    c.id,
    c.actor_id,
    c.ediel_id,
    c.environment,
    c.purpose,
    c.status,
    c.fingerprint_sha256,
    c.subject,
    c.issuer,
    c.serial_number,
    c.valid_from,
    c.valid_to,
    c.last_checked_at,
    c.next_check_at,
    c.metadata
  from public.platform_actor_certificates c
  where c.purpose in ('encryption','signing')
  order by c.actor_id, c.environment, c.purpose,
           case c.status when 'valid' then 0 when 'expires_soon' then 1 when 'unknown' then 2 else 3 end,
           c.last_checked_at desc nulls last,
           c.updated_at desc
), route_base as (
  select
    r.id as route_id,
    r.actor_id,
    a.name as actor_name,
    a.legal_name,
    a.org_number,
    a.status as actor_status,
    a.match_status,
    a.visible_to_tenants,
    coalesce(ar.roles, '{}'::text[]) as actor_roles,
    ai.ediel_id,
    coalesce(ai.ediel_id_verified, false) as ediel_id_verified,
    r.message_family,
    r.application_reference,
    r.environment,
    r.subaddress,
    r.communication_type,
    r.communication_address,
    r.party_id,
    r.interchange_party_id,
    r.status as route_status,
    r.is_verified as route_verified,
    r.auto_send_allowed,
    r.source as route_source,
    r.valid_to as route_valid_to,
    r.metadata as route_metadata,
    case
      when upper(r.message_family) = 'PRODAT' and r.environment = 'production' then true
      when coalesce(r.metadata->>'requires_certificate', '') in ('true','1','yes') then true
      when coalesce(r.metadata->>'transport_security_mode', '') in ('encrypted','smime','s_mime','cms') then true
      else false
    end as requires_certificate,
    (
      nullif(trim(coalesce(r.subaddress, '')), '') is not null
      or coalesce(r.metadata->>'subaddress_status', '') = 'not_required_confirmed'
    ) as has_safe_subaddress
  from public.platform_actor_routes r
  join public.platform_market_actors a on a.id = r.actor_id
  left join actor_roles ar on ar.actor_id = r.actor_id
  left join actor_ids ai on ai.actor_id = r.actor_id
)
select
  rb.actor_id,
  rb.actor_name,
  rb.legal_name,
  rb.org_number,
  rb.actor_status,
  rb.match_status,
  rb.visible_to_tenants,
  rb.actor_roles,
  rb.ediel_id,
  rb.ediel_id_verified,
  rb.route_id,
  rb.message_family,
  rb.application_reference,
  rb.environment,
  rb.subaddress,
  rb.communication_type,
  rb.communication_address,
  rb.party_id,
  rb.interchange_party_id,
  rb.route_status,
  rb.route_verified,
  rb.auto_send_allowed,
  rb.route_source,
  rb.route_valid_to,
  rb.requires_certificate,
  lc.id as certificate_id,
  lc.status as certificate_status,
  lc.fingerprint_sha256 as certificate_fingerprint_sha256,
  lc.subject as certificate_subject,
  lc.issuer as certificate_issuer,
  lc.serial_number as certificate_serial_number,
  lc.valid_from as certificate_valid_from,
  lc.valid_to as certificate_valid_to,
  lc.last_checked_at as certificate_last_checked_at,
  lc.next_check_at as certificate_next_check_at,
  array_remove(array[
    case when rb.actor_status <> 'active' then 'actor_not_active' end,
    case when rb.ediel_id is null then 'missing_ediel_id' end,
    case when rb.ediel_id is not null and rb.ediel_id_verified = false then 'ediel_id_not_verified' end,
    case when rb.route_status <> 'active' then 'route_not_active' end,
    case when rb.route_verified = false then 'route_not_verified' end,
    case when rb.has_safe_subaddress = false then 'unsafe_or_missing_subaddress' end,
    case when nullif(trim(coalesce(rb.communication_address, '')), '') is null then 'missing_smtp_address' end,
    case when nullif(trim(coalesce(rb.party_id, '')), '') is null then 'missing_party_id' end,
    case when nullif(trim(coalesce(rb.interchange_party_id, '')), '') is null then 'missing_interchange_party_id' end,
    case when rb.ediel_id is not null and rb.party_id is not null and rb.party_id <> rb.ediel_id then 'party_id_mismatch' end,
    case when rb.ediel_id is not null and rb.interchange_party_id is not null and rb.interchange_party_id <> rb.ediel_id then 'interchange_party_id_mismatch' end,
    case when rb.route_valid_to is not null and rb.route_valid_to < current_date then 'route_expired' end,
    case when rb.requires_certificate and lc.id is null then 'missing_certificate' end,
    case when rb.requires_certificate and lc.status = 'missing' then 'missing_certificate' end,
    case when rb.requires_certificate and lc.status = 'expired' then 'expired_certificate' end,
    case when rb.requires_certificate and lc.status = 'invalid' then 'invalid_certificate' end,
    case when rb.requires_certificate and lc.status = 'mismatch' then 'certificate_mismatch' end,
    case when rb.requires_certificate and lc.status = 'unknown' then 'certificate_unknown' end,
    case when rb.requires_certificate and lc.ediel_id is not null and rb.ediel_id is not null and lc.ediel_id <> rb.ediel_id then 'certificate_ediel_mismatch' end,
    case when rb.environment not in ('test','production') then 'wrong_environment' end
  ], null) as blocking_reasons,
  array_remove(array[
    case when rb.requires_certificate and lc.status = 'expires_soon' then 'certificate_expires_soon' end,
    case when rb.requires_certificate and lc.next_check_at is not null and lc.next_check_at <= now() then 'certificate_check_due' end,
    case when rb.auto_send_allowed = true and (lc.status in ('expires_soon','unknown') or lc.id is null) then 'auto_send_should_be_rechecked' end
  ], null) as warnings,
  case
    when cardinality(array_remove(array[
      case when rb.actor_status <> 'active' then 'actor_not_active' end,
      case when rb.ediel_id is null then 'missing_ediel_id' end,
      case when rb.ediel_id is not null and rb.ediel_id_verified = false then 'ediel_id_not_verified' end,
      case when rb.route_status <> 'active' then 'route_not_active' end,
      case when rb.route_verified = false then 'route_not_verified' end,
      case when rb.has_safe_subaddress = false then 'unsafe_or_missing_subaddress' end,
      case when nullif(trim(coalesce(rb.communication_address, '')), '') is null then 'missing_smtp_address' end,
      case when nullif(trim(coalesce(rb.party_id, '')), '') is null then 'missing_party_id' end,
      case when nullif(trim(coalesce(rb.interchange_party_id, '')), '') is null then 'missing_interchange_party_id' end,
      case when rb.ediel_id is not null and rb.party_id is not null and rb.party_id <> rb.ediel_id then 'party_id_mismatch' end,
      case when rb.ediel_id is not null and rb.interchange_party_id is not null and rb.interchange_party_id <> rb.ediel_id then 'interchange_party_id_mismatch' end,
      case when rb.route_valid_to is not null and rb.route_valid_to < current_date then 'route_expired' end,
      case when rb.requires_certificate and lc.id is null then 'missing_certificate' end,
      case when rb.requires_certificate and lc.status in ('missing','expired','invalid','mismatch','unknown') then lc.status || '_certificate' end,
      case when rb.requires_certificate and lc.ediel_id is not null and rb.ediel_id is not null and lc.ediel_id <> rb.ediel_id then 'certificate_ediel_mismatch' end
    ], null)) = 0 then 'ready_for_auto_send'
    when rb.has_safe_subaddress = false then 'unsafe_or_missing_subaddress'
    when rb.requires_certificate and (lc.id is null or lc.status = 'missing') then 'missing_certificate'
    when rb.requires_certificate and lc.status = 'expired' then 'expired_certificate'
    when rb.requires_certificate and lc.status = 'expires_soon' then 'certificate_expires_soon'
    when rb.route_verified = false or rb.route_status <> 'active' then 'route_not_verified'
    when nullif(trim(coalesce(rb.communication_address, '')), '') is null then 'missing_smtp_address'
    when rb.ediel_id is not null and (rb.party_id <> rb.ediel_id or rb.interchange_party_id <> rb.ediel_id) then 'party_id_mismatch'
    else 'needs_manual_review'
  end as readiness_status,
  greatest(
    coalesce(lc.last_checked_at, '-infinity'::timestamptz),
    coalesce((rb.route_metadata->>'auto_readiness_checked_at')::timestamptz, '-infinity'::timestamptz)
  ) as last_checked_at,
  coalesce(lc.next_check_at, now()) as next_check_at
from route_base rb
left join latest_cert lc
  on lc.actor_id = rb.actor_id
 and lc.environment = rb.environment
 and lc.purpose = 'encryption';

-- Backfill now and apply auto-send only through the guarded readiness function.
select public.gridex_confirm_safe_blank_route_subaddresses('batch_o6_3_migration_backfill', null::uuid, true);
