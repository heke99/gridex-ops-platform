-- Batch O2 — Grid owner subaddress completion, certificate import and readiness review
-- Production-safe, additive and idempotent.
-- Purpose: complete network-owner readiness without guessing subaddresses or certificates.
-- Rules:
--  * Only auto-fill subaddress when the actor registry has exactly one non-empty value for the same actor/family/environment.
--  * Empty subaddress can only be accepted through explicit platform-admin confirmation.
--  * Certificate readiness is matched by actor, Ediel ID, environment and encryption/recipient purpose.
--  * Missing/ambiguous data remains a blocking review item.

create extension if not exists pgcrypto with schema extensions;

-- 1) Add explicit subaddress provenance and readiness fields to OPS grid owner masterdata.
alter table public.grid_owners add column if not exists prodat_subaddress_status text not null default 'missing';
alter table public.grid_owners add column if not exists utilts_subaddress_status text not null default 'missing';
alter table public.grid_owners add column if not exists prodat_subaddress_source text not null default 'missing';
alter table public.grid_owners add column if not exists utilts_subaddress_source text not null default 'missing';
alter table public.grid_owners add column if not exists subaddress_verified_at timestamptz;
alter table public.grid_owners add column if not exists subaddress_verified_by uuid;
alter table public.grid_owners add column if not exists subaddress_verification_note text;
alter table public.grid_owners add column if not exists prodat_ready_for_customer_flow boolean not null default false;
alter table public.grid_owners add column if not exists utilts_ready_for_metering_flow boolean not null default false;
alter table public.grid_owners add column if not exists supplier_switch_ready boolean not null default false;
alter table public.grid_owners add column if not exists certificate_last_import_at timestamptz;
alter table public.grid_owners add column if not exists certificate_import_source text;

-- Keep values constrained through update guards without breaking older manually-entered rows.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'grid_owners_prodat_subaddress_status_check') then
    alter table public.grid_owners add constraint grid_owners_prodat_subaddress_status_check
      check (prodat_subaddress_status in ('verified','not_required_confirmed','missing','ambiguous'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'grid_owners_utilts_subaddress_status_check') then
    alter table public.grid_owners add constraint grid_owners_utilts_subaddress_status_check
      check (utilts_subaddress_status in ('verified','not_required_confirmed','missing','ambiguous'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'grid_owners_prodat_subaddress_source_check') then
    alter table public.grid_owners add constraint grid_owners_prodat_subaddress_source_check
      check (prodat_subaddress_source in ('route','manual_verified','not_required_confirmed','missing','ambiguous'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'grid_owners_utilts_subaddress_source_check') then
    alter table public.grid_owners add constraint grid_owners_utilts_subaddress_source_check
      check (utilts_subaddress_source in ('route','manual_verified','not_required_confirmed','missing','ambiguous'));
  end if;
end $$;

create index if not exists grid_owners_subaddress_status_idx
  on public.grid_owners(prodat_subaddress_status, utilts_subaddress_status, supplier_switch_ready, is_active);

create index if not exists grid_owner_verification_reviews_grid_owner_issue_status_idx
  on public.grid_owner_verification_reviews(grid_owner_id, issue_type, status);

-- 2) Replace the canonical view with the same existing column order plus O2 readiness columns appended at the end.
create or replace view public.gridex_verified_grid_owners_v
with (security_invoker = true)
as
with actor_ids as (
  select
    i.actor_id,
    max(i.identifier_value) filter (where lower(i.identifier_type) in ('edielid','ediel_id')) as ediel_id,
    bool_or(coalesce(i.is_verified, false)) filter (where lower(i.identifier_type) in ('edielid','ediel_id')) as ediel_id_verified,
    max(i.identifier_value) filter (where lower(i.identifier_type) in ('orgno','org_number','orgnr')) as registry_org_number
  from public.platform_actor_identifiers i
  group by i.actor_id
), actor_roles as (
  select
    r.actor_id,
    array_agg(distinct lower(r.actor_role) order by lower(r.actor_role)) as roles,
    bool_or(lower(r.actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')) as is_grid_owner
  from public.platform_actor_roles r
  where coalesce(r.is_active, true) = true
  group by r.actor_id
), route_summary as (
  select
    r.actor_id,
    count(*)::integer as route_count,
    count(*) filter (where upper(r.message_family) = 'PRODAT')::integer as prodat_route_count,
    count(*) filter (where upper(r.message_family) = 'UTILTS')::integer as utilts_route_count,
    bool_or(coalesce(r.status, '') = 'active' and coalesce(r.is_verified, false)) as has_verified_route,
    bool_or(upper(r.message_family) = 'PRODAT' and coalesce(r.status, '') = 'active' and coalesce(r.is_verified, false)) as has_verified_prodat_route,
    bool_or(upper(r.message_family) = 'UTILTS' and coalesce(r.status, '') = 'active' and coalesce(r.is_verified, false)) as has_verified_utilts_route,
    bool_or(coalesce(r.status, '') = 'active' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as has_subaddress,
    count(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'PRODAT' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null)::integer as prodat_subaddress_value_count,
    count(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'UTILTS' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null)::integer as utilts_subaddress_value_count,
    min(nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'PRODAT' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as suggested_prodat_subaddress,
    min(nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'UTILTS' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as suggested_utilts_subaddress,
    array_agg(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'PRODAT' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as possible_prodat_subaddresses,
    array_agg(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) filter (where upper(r.message_family) = 'UTILTS' and r.environment = 'production' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as possible_utilts_subaddresses,
    bool_or(nullif(btrim(coalesce(r.communication_address, '')), '') is not null) as has_route_contact,
    bool_or(r.environment = 'production') as has_production_route,
    bool_or(r.environment = 'test') as has_test_route,
    bool_or(upper(r.message_family) = 'PRODAT' and r.environment = 'production') as requires_certificate
  from public.platform_actor_routes r
  group by r.actor_id
), latest_cert as (
  select distinct on (c.actor_id, c.environment, c.purpose)
    c.actor_id,
    c.environment,
    c.purpose,
    c.status,
    c.fingerprint_sha256,
    c.ediel_id,
    c.valid_from,
    c.valid_to,
    c.updated_at,
    c.source
  from public.platform_actor_certificates c
  where c.purpose in ('encryption','signing')
  order by c.actor_id, c.environment, c.purpose,
    case c.status when 'valid' then 0 when 'expires_soon' then 1 when 'unknown' then 2 when 'missing' then 3 else 4 end,
    c.updated_at desc nulls last
), mapped as (
  select
    g.id as grid_owner_id,
    g.company_id,
    g.name,
    g.owner_code,
    coalesce(nullif(btrim(g.ediel_id), ''), ai.ediel_id) as ediel_id,
    coalesce(nullif(btrim(g.org_number), ''), ai.registry_org_number, a.org_number) as org_number,
    g.environment,
    g.lifecycle_status,
    g.default_prodat_subaddress,
    g.default_utilts_subaddress,
    g.communication_email,
    g.email,
    g.contact_name,
    g.phone,
    g.is_active,
    coalesce(g.platform_market_actor_id, a.id) as platform_market_actor_id,
    g.platform_grid_owner_id,
    a.name as actor_name,
    a.status as actor_status,
    a.match_status,
    coalesce(ar.roles, '{}'::text[]) as actor_roles,
    coalesce(ar.is_grid_owner, false) as actor_is_grid_owner,
    coalesce(ai.ediel_id_verified, false) as ediel_id_verified,
    coalesce(rs.route_count, 0) as route_count,
    coalesce(rs.prodat_route_count, 0) as prodat_route_count,
    coalesce(rs.utilts_route_count, 0) as utilts_route_count,
    coalesce(rs.has_verified_route, false) as has_verified_route,
    coalesce(rs.has_subaddress, false)
      or nullif(btrim(coalesce(g.default_prodat_subaddress, g.default_utilts_subaddress, '')), '') is not null
      or coalesce(g.prodat_subaddress_status, '') = 'not_required_confirmed'
      or coalesce(g.utilts_subaddress_status, '') = 'not_required_confirmed' as has_subaddress,
    coalesce(rs.has_route_contact, false) or nullif(btrim(coalesce(g.communication_email, g.email, '')), '') is not null as has_contact_path,
    coalesce(rs.has_production_route, false) as has_production_route,
    coalesce(rs.has_test_route, false) as has_test_route,
    coalesce(rs.requires_certificate, false) as requires_certificate,
    lc.status as raw_certificate_status,
    lc.environment as certificate_environment,
    lc.fingerprint_sha256 as certificate_fingerprint_sha256,
    lc.ediel_id as certificate_ediel_id,
    lc.valid_to as certificate_valid_to,
    d.duplicate_key,
    coalesce(d.duplicate_count, 1) as duplicate_count,
    coalesce(rs.has_verified_prodat_route, false) as has_verified_prodat_route,
    coalesce(rs.has_verified_utilts_route, false) as has_verified_utilts_route,
    coalesce(rs.prodat_subaddress_value_count, 0) as prodat_subaddress_value_count,
    coalesce(rs.utilts_subaddress_value_count, 0) as utilts_subaddress_value_count,
    rs.suggested_prodat_subaddress,
    rs.suggested_utilts_subaddress,
    coalesce(rs.possible_prodat_subaddresses, '{}'::text[]) as possible_prodat_subaddresses,
    coalesce(rs.possible_utilts_subaddresses, '{}'::text[]) as possible_utilts_subaddresses,
    coalesce(g.prodat_subaddress_status, 'missing') as stored_prodat_subaddress_status,
    coalesce(g.utilts_subaddress_status, 'missing') as stored_utilts_subaddress_status,
    coalesce(g.prodat_subaddress_source, 'missing') as stored_prodat_subaddress_source,
    coalesce(g.utilts_subaddress_source, 'missing') as stored_utilts_subaddress_source,
    lc.source as certificate_source
  from public.grid_owners g
  left join public.platform_market_actors a
    on a.id = g.platform_market_actor_id
    or (nullif(btrim(g.ediel_id), '') is not null and exists (
      select 1 from public.platform_actor_identifiers i
      where i.actor_id = a.id and lower(i.identifier_type) in ('edielid','ediel_id') and i.identifier_value = g.ediel_id
    ))
    or (nullif(btrim(g.org_number), '') is not null and regexp_replace(coalesce(a.org_number,''), '\D', '', 'g') = regexp_replace(g.org_number, '\D', '', 'g'))
    or lower(regexp_replace(coalesce(a.name, ''), '\s+', ' ', 'g')) = lower(regexp_replace(coalesce(g.name, ''), '\s+', ' ', 'g'))
  left join actor_ids ai on ai.actor_id = coalesce(g.platform_market_actor_id, a.id)
  left join actor_roles ar on ar.actor_id = coalesce(g.platform_market_actor_id, a.id)
  left join route_summary rs on rs.actor_id = coalesce(g.platform_market_actor_id, a.id)
  left join latest_cert lc on lc.actor_id = coalesce(g.platform_market_actor_id, a.id) and lc.environment = coalesce(g.environment, 'production') and lc.purpose = 'encryption'
  left join public.gridex_grid_owner_duplicate_v d on d.grid_owner_id = g.id
), evaluated as (
  select
    m.*,
    case
      when m.prodat_route_count = 0 then 'missing'
      when coalesce(m.default_prodat_subaddress, '') <> '' then 'verified'
      when m.stored_prodat_subaddress_status = 'not_required_confirmed' then 'not_required_confirmed'
      when m.prodat_subaddress_value_count = 1 then 'route_available'
      when m.prodat_subaddress_value_count > 1 then 'ambiguous'
      else 'missing'
    end as prodat_subaddress_status_evaluated,
    case
      when m.utilts_route_count = 0 then 'missing'
      when coalesce(m.default_utilts_subaddress, '') <> '' then 'verified'
      when m.stored_utilts_subaddress_status = 'not_required_confirmed' then 'not_required_confirmed'
      when m.utilts_subaddress_value_count = 1 then 'route_available'
      when m.utilts_subaddress_value_count > 1 then 'ambiguous'
      else 'missing'
    end as utilts_subaddress_status_evaluated,
    case
      when m.raw_certificate_status in ('valid','expires_soon') and (m.certificate_ediel_id is null or m.certificate_ediel_id = m.ediel_id) then true
      else false
    end as certificate_is_usable
  from mapped m
)
select
  e.grid_owner_id,
  e.company_id,
  e.name,
  e.owner_code,
  e.ediel_id,
  e.org_number,
  e.environment,
  e.lifecycle_status,
  e.default_prodat_subaddress,
  e.default_utilts_subaddress,
  e.communication_email,
  e.email,
  e.contact_name,
  e.phone,
  e.is_active,
  e.platform_market_actor_id,
  e.platform_grid_owner_id,
  e.actor_name,
  e.actor_status,
  e.match_status,
  e.actor_roles,
  e.actor_is_grid_owner,
  e.ediel_id_verified,
  e.route_count,
  e.prodat_route_count,
  e.utilts_route_count,
  e.has_verified_route,
  ((e.prodat_route_count = 0 or e.prodat_subaddress_status_evaluated in ('verified','not_required_confirmed','route_available'))
    and (e.utilts_route_count = 0 or e.utilts_subaddress_status_evaluated in ('verified','not_required_confirmed','route_available'))) as has_subaddress,
  e.has_contact_path,
  e.has_production_route,
  e.has_test_route,
  e.requires_certificate,
  e.raw_certificate_status,
  e.certificate_environment,
  e.certificate_fingerprint_sha256,
  e.certificate_ediel_id,
  e.certificate_valid_to,
  e.duplicate_key,
  e.duplicate_count,
  case
    when coalesce(e.duplicate_count, 1) > 1 then 'unresolved_duplicate'
    when nullif(btrim(coalesce(e.ediel_id, '')), '') is null then 'needs_ediel_id'
    when coalesce(e.route_count, 0) = 0 or not e.has_verified_route then 'needs_route'
    when e.prodat_subaddress_status_evaluated = 'ambiguous' or e.utilts_subaddress_status_evaluated = 'ambiguous' then 'ambiguous_subaddress'
    when (e.prodat_route_count > 0 and e.prodat_subaddress_status_evaluated = 'missing') or (e.utilts_route_count > 0 and e.utilts_subaddress_status_evaluated = 'missing') then 'needs_subaddress'
    when not e.has_contact_path then 'needs_contact'
    when e.requires_certificate and (e.raw_certificate_status is null or e.raw_certificate_status in ('missing','unknown','invalid')) then 'needs_certificate'
    when e.requires_certificate and e.raw_certificate_status = 'expired' then 'needs_certificate'
    when e.requires_certificate and e.raw_certificate_status = 'mismatch' then 'needs_certificate'
    when e.requires_certificate and e.certificate_ediel_id is not null and nullif(btrim(coalesce(e.ediel_id, '')), '') is not null and e.certificate_ediel_id <> e.ediel_id then 'needs_certificate'
    else 'verified'
  end as verification_status,
  case
    when e.raw_certificate_status in ('valid','expires_soon') and (e.certificate_ediel_id is null or e.certificate_ediel_id = e.ediel_id) then 'finns'
    when e.raw_certificate_status = 'expired' then 'utgånget'
    when e.raw_certificate_status = 'mismatch' then 'fel_mottagare'
    when e.raw_certificate_status is not null and e.certificate_environment is not null and e.certificate_environment <> coalesce(e.environment, 'production') then 'fel_miljö'
    else 'saknas'
  end as certificate_status,
  array_remove(array[
    case when coalesce(e.duplicate_count, 1) > 1 then 'unresolved_duplicate' end,
    case when nullif(btrim(coalesce(e.ediel_id, '')), '') is null then 'needs_ediel_id' end,
    case when coalesce(e.route_count, 0) = 0 or not e.has_verified_route then 'needs_route' end,
    case when e.prodat_subaddress_status_evaluated = 'ambiguous' or e.utilts_subaddress_status_evaluated = 'ambiguous' then 'ambiguous_subaddress' end,
    case when (e.prodat_route_count > 0 and e.prodat_subaddress_status_evaluated = 'missing') or (e.utilts_route_count > 0 and e.utilts_subaddress_status_evaluated = 'missing') then 'needs_subaddress' end,
    case when not e.has_contact_path then 'needs_contact' end,
    case when e.requires_certificate and (e.raw_certificate_status is null or e.raw_certificate_status in ('missing','unknown','invalid','expired','mismatch')) then 'needs_certificate' end,
    case when e.requires_certificate and e.certificate_ediel_id is not null and nullif(btrim(coalesce(e.ediel_id, '')), '') is not null and e.certificate_ediel_id <> e.ediel_id then 'certificate_ediel_mismatch' end
  ], null) as verification_reasons,
  case when coalesce(e.route_count, 0) > 0 and e.has_verified_route then 'verified' else 'needs_route' end as route_status,
  (case
    when coalesce(e.duplicate_count, 1) > 1 then false
    when nullif(btrim(coalesce(e.ediel_id, '')), '') is null then false
    when not e.has_verified_prodat_route then false
    when e.prodat_route_count > 0 and e.prodat_subaddress_status_evaluated not in ('verified','not_required_confirmed','route_available') then false
    when not e.has_contact_path then false
    when e.requires_certificate and not e.certificate_is_usable then false
    else true
  end) as verified_for_customer_flow,
  case
    when coalesce(e.duplicate_count, 1) > 1 then 'duplicate_review'
    when nullif(btrim(coalesce(e.ediel_id, '')), '') is null then 'missing_ediel_id'
    when e.actor_status = 'active' and (e.match_status = 'verified' or e.ediel_id_verified) then 'verified'
    else 'under_review'
  end as actor_registry_status,
  case
    when coalesce(e.duplicate_count, 1) > 1 then 'Granska dubbletter innan nätägaren används i kundflöde.'
    when nullif(btrim(coalesce(e.ediel_id, '')), '') is null then 'Komplettera Ediel-ID.'
    when not e.has_verified_route then 'Verifiera PRODAT/UTILTS-route.'
    when e.prodat_subaddress_status_evaluated = 'ambiguous' or e.utilts_subaddress_status_evaluated = 'ambiguous' then 'Välj rätt subadress för PRODAT/UTILTS.'
    when (e.prodat_route_count > 0 and e.prodat_subaddress_status_evaluated = 'missing') or (e.utilts_route_count > 0 and e.utilts_subaddress_status_evaluated = 'missing') then 'Komplettera subadress eller bekräfta att tom subadress är korrekt.'
    when not e.has_contact_path then 'Komplettera SMTP/kontaktväg.'
    when e.requires_certificate and not e.certificate_is_usable then 'Lägg till eller verifiera mottagarcertifikat.'
    else 'Verifierad för kundflöde och Ediel-readiness.'
  end as next_action,
  -- O2 appended columns. Safe for existing consumers.
  e.has_verified_prodat_route,
  e.has_verified_utilts_route,
  e.prodat_subaddress_value_count,
  e.utilts_subaddress_value_count,
  e.suggested_prodat_subaddress,
  e.suggested_utilts_subaddress,
  e.possible_prodat_subaddresses,
  e.possible_utilts_subaddresses,
  case
    when e.prodat_route_count = 0 then 'missing'
    when e.prodat_subaddress_status_evaluated = 'route_available' then 'verified'
    else e.prodat_subaddress_status_evaluated
  end as prodat_subaddress_status,
  case
    when e.utilts_route_count = 0 then 'missing'
    when e.utilts_subaddress_status_evaluated = 'route_available' then 'verified'
    else e.utilts_subaddress_status_evaluated
  end as utilts_subaddress_status,
  case
    when nullif(btrim(coalesce(e.default_prodat_subaddress, '')), '') is not null then coalesce(nullif(e.stored_prodat_subaddress_source, 'missing'), 'manual_verified')
    when e.stored_prodat_subaddress_status = 'not_required_confirmed' then 'not_required_confirmed'
    when e.prodat_subaddress_value_count = 1 then 'route'
    when e.prodat_subaddress_value_count > 1 then 'ambiguous'
    else 'missing'
  end as prodat_subaddress_source,
  case
    when nullif(btrim(coalesce(e.default_utilts_subaddress, '')), '') is not null then coalesce(nullif(e.stored_utilts_subaddress_source, 'missing'), 'manual_verified')
    when e.stored_utilts_subaddress_status = 'not_required_confirmed' then 'not_required_confirmed'
    when e.utilts_subaddress_value_count = 1 then 'route'
    when e.utilts_subaddress_value_count > 1 then 'ambiguous'
    else 'missing'
  end as utilts_subaddress_source,
  (e.has_verified_prodat_route and e.prodat_route_count > 0 and e.prodat_subaddress_status_evaluated in ('verified','not_required_confirmed','route_available') and e.has_contact_path and (not e.requires_certificate or e.certificate_is_usable)) as can_use_for_prodat,
  (e.has_verified_utilts_route and e.utilts_route_count > 0 and e.utilts_subaddress_status_evaluated in ('verified','not_required_confirmed','route_available') and e.has_contact_path) as can_use_for_utilts,
  (e.has_verified_prodat_route and e.prodat_route_count > 0 and e.prodat_subaddress_status_evaluated in ('verified','not_required_confirmed','route_available') and e.has_contact_path and (not e.requires_certificate or e.certificate_is_usable)) as can_start_supplier_switch,
  e.certificate_source
from evaluated e;

comment on view public.gridex_verified_grid_owners_v is
  'Canonical grid-owner verification view. Batch O2 adds subaddress provenance, certificate readiness and per-flow readiness without guessing missing subaddresses.';

-- 3) Completion RPC: conservative route-derived subaddress completion + certificate/status sync.
create or replace function public.gridex_complete_grid_owner_readiness(p_source text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prodat_route_filled int := 0;
  v_utilts_route_filled int := 0;
  v_status_updated int := 0;
  v_reviews_created int := 0;
  v_reviews_resolved int := 0;
  v_backfill jsonb;
begin
  -- Auto-fill PRODAT only when exactly one non-empty production PRODAT subaddress exists for the actor.
  with candidates as (
    select
      r.actor_id,
      min(nullif(btrim(coalesce(r.subaddress, '')), '')) as only_subaddress
    from public.platform_actor_routes r
    where upper(r.message_family) = 'PRODAT'
      and r.environment = 'production'
      and coalesce(r.status, '') = 'active'
      and nullif(btrim(coalesce(r.subaddress, '')), '') is not null
    group by r.actor_id
    having count(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) = 1
  )
  update public.grid_owners g
  set default_prodat_subaddress = c.only_subaddress,
      prodat_subaddress_status = 'verified',
      prodat_subaddress_source = 'route',
      subaddress_verified_at = coalesce(g.subaddress_verified_at, now()),
      subaddress_verification_note = coalesce(g.subaddress_verification_note, 'Autoifylld från verifierad actor route.'),
      updated_at = now()
  from candidates c
  where g.platform_market_actor_id = c.actor_id
    and nullif(btrim(coalesce(g.default_prodat_subaddress, '')), '') is null
    and coalesce(g.prodat_subaddress_status, 'missing') <> 'not_required_confirmed';
  get diagnostics v_prodat_route_filled = row_count;

  -- Auto-fill UTILTS only when exactly one non-empty production UTILTS subaddress exists for the actor.
  with candidates as (
    select
      r.actor_id,
      min(nullif(btrim(coalesce(r.subaddress, '')), '')) as only_subaddress
    from public.platform_actor_routes r
    where upper(r.message_family) = 'UTILTS'
      and r.environment = 'production'
      and coalesce(r.status, '') = 'active'
      and nullif(btrim(coalesce(r.subaddress, '')), '') is not null
    group by r.actor_id
    having count(distinct nullif(btrim(coalesce(r.subaddress, '')), '')) = 1
  )
  update public.grid_owners g
  set default_utilts_subaddress = c.only_subaddress,
      utilts_subaddress_status = 'verified',
      utilts_subaddress_source = 'route',
      subaddress_verified_at = coalesce(g.subaddress_verified_at, now()),
      subaddress_verification_note = coalesce(g.subaddress_verification_note, 'Autoifylld från verifierad actor route.'),
      updated_at = now()
  from candidates c
  where g.platform_market_actor_id = c.actor_id
    and nullif(btrim(coalesce(g.default_utilts_subaddress, '')), '') is null
    and coalesce(g.utilts_subaddress_status, 'missing') <> 'not_required_confirmed';
  get diagnostics v_utilts_route_filled = row_count;

  -- Persist evaluated subaddress status and per-flow readiness from the canonical view.
  update public.grid_owners g
  set prodat_subaddress_status = case
        when v.prodat_route_count = 0 then g.prodat_subaddress_status
        when v.prodat_subaddress_status in ('verified','not_required_confirmed','ambiguous','missing') then v.prodat_subaddress_status
        else g.prodat_subaddress_status
      end,
      utilts_subaddress_status = case
        when v.utilts_route_count = 0 then g.utilts_subaddress_status
        when v.utilts_subaddress_status in ('verified','not_required_confirmed','ambiguous','missing') then v.utilts_subaddress_status
        else g.utilts_subaddress_status
      end,
      prodat_subaddress_source = case
        when v.prodat_route_count = 0 then g.prodat_subaddress_source
        when v.prodat_subaddress_source in ('route','manual_verified','not_required_confirmed','ambiguous','missing') then v.prodat_subaddress_source
        else g.prodat_subaddress_source
      end,
      utilts_subaddress_source = case
        when v.utilts_route_count = 0 then g.utilts_subaddress_source
        when v.utilts_subaddress_source in ('route','manual_verified','not_required_confirmed','ambiguous','missing') then v.utilts_subaddress_source
        else g.utilts_subaddress_source
      end,
      prodat_ready_for_customer_flow = coalesce(v.can_use_for_prodat, false),
      utilts_ready_for_metering_flow = coalesce(v.can_use_for_utilts, false),
      supplier_switch_ready = coalesce(v.can_start_supplier_switch, false),
      certificate_last_import_at = case when v.certificate_status = 'finns' then now() else g.certificate_last_import_at end,
      certificate_import_source = case when v.certificate_status = 'finns' then coalesce(v.certificate_source, g.certificate_import_source) else g.certificate_import_source end,
      updated_at = now()
  from public.gridex_verified_grid_owners_v v
  where v.grid_owner_id = g.id;
  get diagnostics v_status_updated = row_count;

  -- Add explicit ambiguous-subaddress review rows when registry has multiple candidates.
  insert into public.grid_owner_verification_reviews(grid_owner_id, platform_market_actor_id, issue_type, severity, status, message, metadata)
  select v.grid_owner_id, v.platform_market_actor_id, 'ambiguous_subaddress', 'blocking', 'open',
         'Flera möjliga subadresser finns. Välj rätt PRODAT/UTILTS-subadress innan nätägaren används.',
         jsonb_build_object(
           'possible_prodat_subaddresses', v.possible_prodat_subaddresses,
           'possible_utilts_subaddresses', v.possible_utilts_subaddresses,
           'backfill_source', p_source
         )
  from public.gridex_verified_grid_owners_v v
  where v.verification_status = 'ambiguous_subaddress'
    and not exists (
      select 1 from public.grid_owner_verification_reviews r
      where r.grid_owner_id = v.grid_owner_id and r.issue_type = 'ambiguous_subaddress' and r.status = 'open'
    );
  get diagnostics v_reviews_created = row_count;

  -- Let the Batch O function persist overall verification state and ordinary review issues.
  v_backfill := public.gridex_backfill_grid_owner_verification(coalesce(p_source, 'manual') || '_o2');

  -- Close stale open review items once the current canonical view no longer carries that issue.
  update public.grid_owner_verification_reviews r
  set status = 'resolved',
      resolved_at = now(),
      metadata = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object('resolved_by_batch_o2', now(), 'source', p_source)
  from public.gridex_verified_grid_owners_v v
  where r.grid_owner_id = v.grid_owner_id
    and r.status = 'open'
    and r.issue_type in ('needs_subaddress','ambiguous_subaddress','needs_certificate','needs_route','needs_contact','needs_ediel_id','unresolved_duplicate')
    and r.issue_type <> v.verification_status
    and not (r.issue_type = any(v.verification_reasons));
  get diagnostics v_reviews_resolved = row_count;

  return jsonb_build_object(
    'ok', true,
    'prodat_subaddresses_filled_from_route', v_prodat_route_filled,
    'utilts_subaddresses_filled_from_route', v_utilts_route_filled,
    'grid_owners_status_updated', v_status_updated,
    'ambiguous_review_items_created', v_reviews_created,
    'stale_review_items_resolved', v_reviews_resolved,
    'batch_o_backfill', v_backfill
  );
end;
$$;

-- 4) Platform-admin helper for explicitly confirming that a route's empty subaddress is correct.
create or replace function public.gridex_confirm_grid_owner_empty_subaddress(
  p_grid_owner_id uuid,
  p_message_family text,
  p_actor_user_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family text := upper(coalesce(p_message_family, ''));
  v_owner public.grid_owners%rowtype;
  v_backfill jsonb;
begin
  if p_grid_owner_id is null then
    raise exception 'grid_owner_id is required';
  end if;
  if v_family not in ('PRODAT','UTILTS') then
    raise exception 'message_family must be PRODAT or UTILTS';
  end if;

  select * into v_owner from public.grid_owners where id = p_grid_owner_id for update;
  if not found then
    raise exception 'grid owner not found';
  end if;

  if v_family = 'PRODAT' then
    update public.grid_owners
    set default_prodat_subaddress = null,
        prodat_subaddress_status = 'not_required_confirmed',
        prodat_subaddress_source = 'not_required_confirmed',
        subaddress_verified_at = now(),
        subaddress_verified_by = p_actor_user_id,
        subaddress_verification_note = coalesce(nullif(btrim(p_note), ''), 'Tom PRODAT-subadress bekräftad som korrekt av platform admin.'),
        verification_metadata = coalesce(verification_metadata, '{}'::jsonb) || jsonb_build_object('prodat_empty_subaddress_confirmed_at', now(), 'prodat_empty_subaddress_confirmed_by', p_actor_user_id),
        updated_at = now()
    where id = p_grid_owner_id;
  else
    update public.grid_owners
    set default_utilts_subaddress = null,
        utilts_subaddress_status = 'not_required_confirmed',
        utilts_subaddress_source = 'not_required_confirmed',
        subaddress_verified_at = now(),
        subaddress_verified_by = p_actor_user_id,
        subaddress_verification_note = coalesce(nullif(btrim(p_note), ''), 'Tom UTILTS-subadress bekräftad som korrekt av platform admin.'),
        verification_metadata = coalesce(verification_metadata, '{}'::jsonb) || jsonb_build_object('utilts_empty_subaddress_confirmed_at', now(), 'utilts_empty_subaddress_confirmed_by', p_actor_user_id),
        updated_at = now()
    where id = p_grid_owner_id;
  end if;

  update public.grid_owner_verification_reviews
  set status = 'resolved',
      resolved_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('resolved_by', p_actor_user_id, 'resolution', 'empty_subaddress_confirmed', 'message_family', v_family)
  where grid_owner_id = p_grid_owner_id
    and issue_type in ('needs_subaddress','ambiguous_subaddress')
    and status = 'open';

  v_backfill := public.gridex_complete_grid_owner_readiness('confirm_empty_subaddress_' || lower(v_family));
  return jsonb_build_object('ok', true, 'grid_owner_id', p_grid_owner_id, 'message_family', v_family, 'backfill', v_backfill);
end;
$$;

-- 5) Initial conservative completion pass. It never guesses when registry subaddress is missing.
select public.gridex_complete_grid_owner_readiness('migration_20260615_batch_o2');

revoke all on function public.gridex_complete_grid_owner_readiness(text) from anon;
revoke all on function public.gridex_confirm_grid_owner_empty_subaddress(uuid, text, uuid, text) from anon;
