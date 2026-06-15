-- Batch O — Grid owner verification, actor registry, certificate coverage & resolver hardening
-- Production-safe, additive and idempotent.
-- Purpose: make network-owner masterdata usable only when actor identity, routes,
-- subaddresses, contact path, certificate coverage and duplicate status are known.

create extension if not exists pgcrypto with schema extensions;

-- 1) Extend OPS-facing grid owner masterdata with platform registry links and readiness fields.
alter table public.grid_owners add column if not exists platform_market_actor_id uuid;
alter table public.grid_owners add column if not exists platform_grid_owner_id uuid;
alter table public.grid_owners add column if not exists verification_status text not null default 'needs_ediel_id';
alter table public.grid_owners add column if not exists verification_reasons text[] not null default '{}'::text[];
alter table public.grid_owners add column if not exists certificate_status text not null default 'saknas';
alter table public.grid_owners add column if not exists certificate_environment text;
alter table public.grid_owners add column if not exists certificate_fingerprint_sha256 text;
alter table public.grid_owners add column if not exists route_status text not null default 'needs_route';
alter table public.grid_owners add column if not exists route_count integer not null default 0;
alter table public.grid_owners add column if not exists prodat_route_count integer not null default 0;
alter table public.grid_owners add column if not exists utilts_route_count integer not null default 0;
alter table public.grid_owners add column if not exists duplicate_group_key text;
alter table public.grid_owners add column if not exists duplicate_count integer not null default 0;
alter table public.grid_owners add column if not exists resolver_source_status text;
alter table public.grid_owners add column if not exists verified_for_customer_flow boolean not null default false;
alter table public.grid_owners add column if not exists actor_registry_status text not null default 'under_review';
alter table public.grid_owners add column if not exists verification_checked_at timestamptz;
alter table public.grid_owners add column if not exists verified_at timestamptz;
alter table public.grid_owners add column if not exists verification_metadata jsonb not null default '{}'::jsonb;
alter table public.grid_owners alter column country set default 'SE';

-- Keep FK creation guarded because older environments may not have all registry tables yet.
do $$
begin
  if to_regclass('public.platform_market_actors') is not null and not exists (
    select 1 from pg_constraint where conname = 'grid_owners_platform_market_actor_id_fkey'
  ) then
    alter table public.grid_owners
      add constraint grid_owners_platform_market_actor_id_fkey
      foreign key (platform_market_actor_id) references public.platform_market_actors(id) on delete set null;
  end if;

  if to_regclass('public.platform_grid_owners') is not null then
    alter table public.platform_grid_owners add column if not exists ops_grid_owner_id uuid;
    if not exists (
      select 1 from pg_constraint where conname = 'platform_grid_owners_ops_grid_owner_id_fkey'
    ) then
      alter table public.platform_grid_owners
        add constraint platform_grid_owners_ops_grid_owner_id_fkey
        foreign key (ops_grid_owner_id) references public.grid_owners(id) on delete set null;
    end if;
  end if;
end $$;

create index if not exists grid_owners_platform_market_actor_idx on public.grid_owners(platform_market_actor_id) where platform_market_actor_id is not null;
create index if not exists grid_owners_platform_grid_owner_idx on public.grid_owners(platform_grid_owner_id) where platform_grid_owner_id is not null;
create index if not exists grid_owners_verification_status_idx on public.grid_owners(verification_status, verified_for_customer_flow, is_active);
create index if not exists grid_owners_ediel_verification_idx on public.grid_owners(ediel_id, verification_status) where ediel_id is not null;
create index if not exists grid_owners_duplicate_key_idx on public.grid_owners(duplicate_group_key) where duplicate_group_key is not null;

-- 2) Review table for unresolved/duplicate/unsafe grid-owner cases.
create table if not exists public.grid_owner_verification_reviews (
  id uuid primary key default gen_random_uuid(),
  grid_owner_id uuid references public.grid_owners(id) on delete cascade,
  platform_market_actor_id uuid,
  issue_type text not null,
  severity text not null default 'warning' check (severity in ('info','warning','blocking')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved','ignored')),
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists grid_owner_verification_reviews_lookup_idx
  on public.grid_owner_verification_reviews(issue_type, status, severity, created_at desc);
create index if not exists grid_owner_verification_reviews_owner_idx
  on public.grid_owner_verification_reviews(grid_owner_id, status);

-- 3) Duplicate view. Duplicates are evaluated by Ediel ID first, then org number/name.
create or replace view public.gridex_grid_owner_duplicate_v
with (security_invoker = true)
as
with base as (
  select
    g.*,
    case
      when nullif(btrim(coalesce(g.ediel_id, '')), '') is not null then 'ediel:' || btrim(g.ediel_id)
      when nullif(btrim(coalesce(g.org_number, '')), '') is not null then 'org:' || regexp_replace(g.org_number, '\D', '', 'g')
      else 'name:' || lower(regexp_replace(coalesce(g.name, ''), '\s+', ' ', 'g'))
    end as duplicate_key
  from public.grid_owners g
), grouped as (
  select duplicate_key, count(*)::integer as duplicate_count, array_agg(id order by name) as duplicate_ids
  from base
  where duplicate_key is not null and duplicate_key <> 'name:'
  group by duplicate_key
)
select
  b.id as grid_owner_id,
  b.name,
  b.ediel_id,
  b.org_number,
  b.duplicate_key,
  coalesce(g.duplicate_count, 1) as duplicate_count,
  coalesce(g.duplicate_ids, array[b.id]) as duplicate_ids
from base b
left join grouped g on g.duplicate_key = b.duplicate_key;

-- 4) Canonical verification view used by UI, intake filters and backfill.
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
    bool_or(coalesce(r.status, '') = 'active' and nullif(btrim(coalesce(r.subaddress, '')), '') is not null) as has_subaddress,
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
    c.updated_at
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
    coalesce(rs.has_subaddress, false) or nullif(btrim(coalesce(g.default_prodat_subaddress, g.default_utilts_subaddress, '')), '') is not null as has_subaddress,
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
    coalesce(d.duplicate_count, 1) as duplicate_count
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
)
select
  m.*,
  case
    when coalesce(m.duplicate_count, 1) > 1 then 'unresolved_duplicate'
    when nullif(btrim(coalesce(m.ediel_id, '')), '') is null then 'needs_ediel_id'
    when coalesce(m.route_count, 0) = 0 or not m.has_verified_route then 'needs_route'
    when not m.has_subaddress then 'needs_subaddress'
    when not m.has_contact_path then 'needs_contact'
    when m.requires_certificate and (m.raw_certificate_status is null or m.raw_certificate_status in ('missing','unknown','invalid')) then 'needs_certificate'
    when m.requires_certificate and m.raw_certificate_status = 'expired' then 'needs_certificate'
    when m.requires_certificate and m.raw_certificate_status = 'mismatch' then 'needs_certificate'
    when m.requires_certificate and m.certificate_ediel_id is not null and nullif(btrim(coalesce(m.ediel_id, '')), '') is not null and m.certificate_ediel_id <> m.ediel_id then 'needs_certificate'
    else 'verified'
  end as verification_status,
  case
    when m.raw_certificate_status in ('valid','expires_soon') and (m.certificate_ediel_id is null or m.certificate_ediel_id = m.ediel_id) then 'finns'
    when m.raw_certificate_status = 'expired' then 'utgånget'
    when m.raw_certificate_status = 'mismatch' then 'fel_mottagare'
    when m.raw_certificate_status is not null and m.certificate_environment is not null and m.certificate_environment <> coalesce(m.environment, 'production') then 'fel_miljö'
    else 'saknas'
  end as certificate_status,
  array_remove(array[
    case when coalesce(m.duplicate_count, 1) > 1 then 'unresolved_duplicate' end,
    case when nullif(btrim(coalesce(m.ediel_id, '')), '') is null then 'needs_ediel_id' end,
    case when coalesce(m.route_count, 0) = 0 or not m.has_verified_route then 'needs_route' end,
    case when not m.has_subaddress then 'needs_subaddress' end,
    case when not m.has_contact_path then 'needs_contact' end,
    case when m.requires_certificate and (m.raw_certificate_status is null or m.raw_certificate_status in ('missing','unknown','invalid','expired','mismatch')) then 'needs_certificate' end,
    case when m.requires_certificate and m.certificate_ediel_id is not null and nullif(btrim(coalesce(m.ediel_id, '')), '') is not null and m.certificate_ediel_id <> m.ediel_id then 'certificate_ediel_mismatch' end
  ], null) as verification_reasons,
  case when coalesce(m.route_count, 0) > 0 and m.has_verified_route then 'verified' else 'needs_route' end as route_status,
  (case
    when coalesce(m.duplicate_count, 1) > 1 then false
    when nullif(btrim(coalesce(m.ediel_id, '')), '') is null then false
    when not m.has_verified_route then false
    when not m.has_subaddress then false
    when not m.has_contact_path then false
    when m.requires_certificate and not (m.raw_certificate_status in ('valid','expires_soon') and (m.certificate_ediel_id is null or m.certificate_ediel_id = m.ediel_id)) then false
    else true
  end) as verified_for_customer_flow,
  case
    when coalesce(m.duplicate_count, 1) > 1 then 'duplicate_review'
    when nullif(btrim(coalesce(m.ediel_id, '')), '') is null then 'missing_ediel_id'
    when m.actor_status = 'active' and (m.match_status = 'verified' or m.ediel_id_verified) then 'verified'
    else 'under_review'
  end as actor_registry_status,
  case
    when coalesce(m.duplicate_count, 1) > 1 then 'Granska dubbletter innan nätägaren används i kundflöde.'
    when nullif(btrim(coalesce(m.ediel_id, '')), '') is null then 'Komplettera Ediel-ID.'
    when not m.has_verified_route then 'Verifiera PRODAT/UTILTS-route.'
    when not m.has_subaddress then 'Komplettera subadress.'
    when not m.has_contact_path then 'Komplettera SMTP/kontaktväg.'
    when m.requires_certificate and (m.raw_certificate_status is null or m.raw_certificate_status not in ('valid','expires_soon')) then 'Lägg till eller verifiera mottagarcertifikat.'
    else 'Verifierad för kundflöde och Ediel-readiness.'
  end as next_action
from mapped m;

comment on view public.gridex_verified_grid_owners_v is
  'Canonical grid-owner verification view. Address/postal code may suggest a network owner; Ediel ID, route, subaddress, contact path, certificate and no duplicates verify it for customer flow.';

-- 5) Backfill/sync function. Keeps platform registry, platform grid owner resolver data,
-- OPS grid_owners and review items aligned.
create or replace function public.gridex_backfill_grid_owner_verification(p_source text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_grid_owners int := 0;
  v_inserted_platform_grid_owners int := 0;
  v_updated_grid_owners int := 0;
  v_review_items int := 0;
begin
  -- Ensure platform_grid_owners exists before trying to sync resolver-side rows.
  if to_regclass('public.platform_grid_owners') is not null then
    insert into public.platform_grid_owners(name, org_number, ediel_id, communication_email, source, metadata, market_actor_id, updated_at)
    select distinct
      a.name,
      a.org_number,
      ai.ediel_id,
      nullif(coalesce(r.communication_address, ''), ''),
      'actor_registry_backfill',
      jsonb_build_object('backfill_source', p_source, 'platform_actor_id', a.id),
      a.id,
      now()
    from public.platform_market_actors a
    join public.platform_actor_roles ar on ar.actor_id = a.id and coalesce(ar.is_active, true) = true
    left join lateral (
      select max(identifier_value) filter (where lower(identifier_type) in ('edielid','ediel_id')) as ediel_id
      from public.platform_actor_identifiers i where i.actor_id = a.id
    ) ai on true
    left join lateral (
      select communication_address
      from public.platform_actor_routes r
      where r.actor_id = a.id and nullif(btrim(coalesce(r.communication_address,'')), '') is not null
      order by case when r.environment = 'production' then 0 else 1 end, updated_at desc nulls last
      limit 1
    ) r on true
    where lower(ar.actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')
      and not exists (
        select 1 from public.platform_grid_owners pgo
        where (ai.ediel_id is not null and pgo.ediel_id = ai.ediel_id)
           or lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g')) = lower(regexp_replace(coalesce(a.name,''), '\s+', ' ', 'g'))
      );
    get diagnostics v_inserted_platform_grid_owners = row_count;
  end if;

  -- Insert OPS grid_owners from verified actor registry if not already present.
  insert into public.grid_owners(name, owner_code, ediel_id, org_number, communication_email, email, contact_name, country, environment, lifecycle_status, platform_market_actor_id, platform_grid_owner_id, is_active, notes, verification_metadata, created_at, updated_at)
  select distinct
    a.name,
    coalesce(ai.ediel_id, regexp_replace(lower(a.name), '[^a-z0-9]+', '_', 'g')),
    ai.ediel_id,
    coalesce(ai.registry_org_number, a.org_number),
    route.communication_address,
    route.communication_address,
    null,
    'SE',
    coalesce(route.environment, 'production'),
    'active',
    a.id,
    pgo.id,
    true,
    'Importerad/synkad från platform actor registry.',
    jsonb_build_object('backfill_source', p_source, 'platform_actor_id', a.id, 'platform_grid_owner_id', pgo.id),
    now(),
    now()
  from public.platform_market_actors a
  join public.platform_actor_roles ar on ar.actor_id = a.id and coalesce(ar.is_active, true) = true
  left join lateral (
    select
      max(identifier_value) filter (where lower(identifier_type) in ('edielid','ediel_id')) as ediel_id,
      max(identifier_value) filter (where lower(identifier_type) in ('orgno','org_number','orgnr')) as registry_org_number
    from public.platform_actor_identifiers i where i.actor_id = a.id
  ) ai on true
  left join lateral (
    select environment, communication_address
    from public.platform_actor_routes r
    where r.actor_id = a.id
    order by case when r.environment = 'production' then 0 else 1 end, updated_at desc nulls last
    limit 1
  ) route on true
  left join public.platform_grid_owners pgo
    on pgo.market_actor_id = a.id
    or (ai.ediel_id is not null and pgo.ediel_id = ai.ediel_id)
    or lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g')) = lower(regexp_replace(coalesce(a.name,''), '\s+', ' ', 'g'))
  where lower(ar.actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')
    and not exists (
      select 1 from public.grid_owners g
      where (ai.ediel_id is not null and g.ediel_id = ai.ediel_id)
         or (a.org_number is not null and g.org_number = a.org_number)
         or lower(regexp_replace(coalesce(g.name,''), '\s+', ' ', 'g')) = lower(regexp_replace(coalesce(a.name,''), '\s+', ' ', 'g'))
    );
  get diagnostics v_inserted_grid_owners = row_count;

  -- Link existing rows to registry/resolver records.
  update public.grid_owners g
  set platform_market_actor_id = coalesce(g.platform_market_actor_id, v.platform_market_actor_id),
      platform_grid_owner_id = coalesce(g.platform_grid_owner_id, v.platform_grid_owner_id),
      ediel_id = coalesce(nullif(g.ediel_id, ''), v.ediel_id),
      org_number = coalesce(nullif(g.org_number, ''), v.org_number),
      updated_at = now()
  from public.gridex_verified_grid_owners_v v
  where v.grid_owner_id = g.id;

  if to_regclass('public.platform_grid_owners') is not null then
    update public.platform_grid_owners pgo
    set ops_grid_owner_id = g.id,
        updated_at = now(),
        metadata = coalesce(pgo.metadata, '{}'::jsonb) || jsonb_build_object('ops_grid_owner_linked_at', now())
    from public.grid_owners g
    where (pgo.id = g.platform_grid_owner_id)
       or (g.ediel_id is not null and pgo.ediel_id = g.ediel_id)
       or lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g')) = lower(regexp_replace(coalesce(g.name,''), '\s+', ' ', 'g'));
  end if;

  -- Persist latest verification state back to grid_owners for fast UI/filtering.
  update public.grid_owners g
  set verification_status = v.verification_status,
      verification_reasons = v.verification_reasons,
      certificate_status = v.certificate_status,
      certificate_environment = v.certificate_environment,
      certificate_fingerprint_sha256 = v.certificate_fingerprint_sha256,
      route_status = v.route_status,
      route_count = v.route_count,
      prodat_route_count = v.prodat_route_count,
      utilts_route_count = v.utilts_route_count,
      duplicate_group_key = v.duplicate_key,
      duplicate_count = v.duplicate_count,
      verified_for_customer_flow = v.verified_for_customer_flow,
      actor_registry_status = v.actor_registry_status,
      verified_at = case when v.verified_for_customer_flow and g.verified_at is null then now() else g.verified_at end,
      verification_checked_at = now(),
      verification_metadata = coalesce(g.verification_metadata, '{}'::jsonb) || jsonb_build_object(
        'last_backfill_source', p_source,
        'last_backfill_at', now(),
        'next_action', v.next_action,
        'platform_market_actor_id', v.platform_market_actor_id,
        'actor_roles', v.actor_roles
      ),
      updated_at = now()
  from public.gridex_verified_grid_owners_v v
  where v.grid_owner_id = g.id;
  get diagnostics v_updated_grid_owners = row_count;

  -- Create review rows for non-green or duplicate owners without duplicating open issues.
  insert into public.grid_owner_verification_reviews(grid_owner_id, platform_market_actor_id, issue_type, severity, status, message, metadata)
  select v.grid_owner_id, v.platform_market_actor_id, v.verification_status,
         case when v.verification_status in ('unresolved_duplicate','needs_ediel_id','needs_route','needs_subaddress','needs_certificate') then 'blocking' else 'warning' end,
         'open',
         v.next_action,
         jsonb_build_object('verification_reasons', v.verification_reasons, 'certificate_status', v.certificate_status, 'route_count', v.route_count, 'duplicate_count', v.duplicate_count, 'backfill_source', p_source)
  from public.gridex_verified_grid_owners_v v
  where v.verification_status <> 'verified'
    and not exists (
      select 1 from public.grid_owner_verification_reviews r
      where r.grid_owner_id = v.grid_owner_id
        and r.issue_type = v.verification_status
        and r.status = 'open'
    );
  get diagnostics v_review_items = row_count;

  return jsonb_build_object(
    'ok', true,
    'inserted_platform_grid_owners', v_inserted_platform_grid_owners,
    'inserted_grid_owners', v_inserted_grid_owners,
    'updated_grid_owners', v_updated_grid_owners,
    'created_review_items', v_review_items
  );
end;
$$;

-- 6) Run once after migration so UI has a populated status immediately.
select public.gridex_backfill_grid_owner_verification('migration_20260615_batch_o');

-- 7) RLS. Platform/service can manage; tenant admins only consume filtered grid_owners through existing app queries.
alter table public.grid_owner_verification_reviews enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='grid_owner_verification_reviews' and policyname='grid_owner_verification_reviews_platform_read') then
    create policy grid_owner_verification_reviews_platform_read on public.grid_owner_verification_reviews
      for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='grid_owner_verification_reviews' and policyname='grid_owner_verification_reviews_platform_write') then
    create policy grid_owner_verification_reviews_platform_write on public.grid_owner_verification_reviews
      for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin())
      with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
end $$;

revoke all on public.grid_owner_verification_reviews from anon;
