-- OPS completion hardening: immutable operation snapshots, site-safe readiness support,
-- queue observability, address-conflict dedupe and deployment health checks.
-- Forward-only and additive. No customer, contract, Ediel or financial data is deleted.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) Immutable snapshots: never apply late replies to a materially changed site.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.customer_operation_jobs') is not null then
    alter table public.customer_operation_jobs add column if not exists heartbeat_at timestamptz;
    alter table public.customer_operation_jobs add column if not exists request_snapshot jsonb not null default '{}'::jsonb;
    alter table public.customer_operation_jobs add column if not exists stale_reason text;
    alter table public.customer_operation_jobs add column if not exists trace_id uuid;
    create index if not exists customer_operation_jobs_site_status_idx
      on public.customer_operation_jobs(company_id, customer_site_id, status, created_at desc)
      where customer_site_id is not null;

    drop index if exists public.customer_operation_jobs_active_idempotency_uidx;
    if not exists (
      select 1
      from public.customer_operation_jobs
      where status in ('queued', 'running', 'waiting_response')
        and idempotency_key is not null
      group by company_id, job_type, idempotency_key
      having count(*) > 1
    ) then
      create unique index customer_operation_jobs_active_idempotency_uidx
        on public.customer_operation_jobs(company_id, job_type, idempotency_key)
        where status in ('queued', 'running', 'waiting_response');
    end if;
  end if;
end $$;

create table if not exists public.customer_operation_request_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_site_id uuid not null references public.customer_sites(id) on delete cascade,
  metering_point_id uuid null references public.metering_points(id) on delete set null,
  customer_operation_job_id uuid null references public.customer_operation_jobs(id) on delete set null,
  operation_id uuid not null,
  request_kind text not null,
  site_address_hash text not null,
  grid_owner_id uuid null,
  grid_area_code text null,
  route_profile_id uuid null,
  request_reference text null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  superseded_at timestamptz null,
  constraint customer_operation_request_snapshots_kind_check check (
    request_kind in ('customer_data_request', 'supplier_switch', 'inbound_grid_owner_response')
  )
);

drop index if exists public.customer_operation_request_snapshots_active_uidx;
create unique index if not exists customer_operation_request_snapshots_company_operation_kind_uidx
  on public.customer_operation_request_snapshots(company_id, operation_id, request_kind);
create index if not exists customer_operation_request_snapshots_site_idx
  on public.customer_operation_request_snapshots(company_id, customer_site_id, created_at desc);

alter table public.customer_operation_request_snapshots enable row level security;

do $$
begin
  if to_regprocedure('public.gridex_can_read_company(uuid)') is not null and not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_operation_request_snapshots'
      and policyname = 'customer_operation_request_snapshots_tenant_read'
  ) then
    create policy customer_operation_request_snapshots_tenant_read
      on public.customer_operation_request_snapshots
      for select to authenticated
      using (public.gridex_can_read_company(company_id));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_operation_request_snapshots'
      and policyname = 'customer_operation_request_snapshots_service_role_all'
  ) then
    create policy customer_operation_request_snapshots_service_role_all
      on public.customer_operation_request_snapshots
      for all to service_role
      using (true) with check (true);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2) Address conflict and document dedupe are enforced by the database.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.customer_site_address_conflicts') is not null then
    alter table public.customer_site_address_conflicts add column if not exists dedupe_key text;
    update public.customer_site_address_conflicts
       set dedupe_key = coalesce(
         nullif(dedupe_key, ''),
         encode(digest(
           coalesce(company_id::text, '') || '|' ||
           coalesce(customer_site_id::text, '') || '|' ||
           coalesce(candidate_source, '') || '|' ||
           coalesce(candidate_address::text, ''),
           'sha256'
         ), 'hex')
       )
     where dedupe_key is null or dedupe_key = '';
    if not exists (
      select 1
      from public.customer_site_address_conflicts
      where status = 'open' and dedupe_key is not null
      group by company_id, customer_site_id, dedupe_key
      having count(*) > 1
    ) then
      create unique index if not exists customer_site_address_conflicts_open_dedupe_uidx
        on public.customer_site_address_conflicts(company_id, customer_site_id, dedupe_key)
        where status = 'open' and dedupe_key is not null;
    end if;
  end if;

  if to_regclass('public.customer_documents') is not null
     and not exists (
       select 1
       from public.customer_documents
       where document_type = 'power_of_attorney'
         and coalesce((metadata->>'power_of_attorney_id'), '') <> ''
       group by company_id, customer_id, document_type, coalesce((metadata->>'power_of_attorney_id'), '')
       having count(*) > 1
     ) then
    create unique index if not exists customer_documents_poa_snapshot_uidx
      on public.customer_documents(company_id, customer_id, document_type, coalesce((metadata->>'power_of_attorney_id'), ''))
      where document_type = 'power_of_attorney'
        and coalesce((metadata->>'power_of_attorney_id'), '') <> '';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3) E-mail transport reconciliation needs a durable provider key and timestamp.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.tenant_email_outbox') is not null then
    alter table public.tenant_email_outbox add column if not exists provider_idempotency_key text;
    alter table public.tenant_email_outbox add column if not exists delivery_uncertain_at timestamptz;
    create unique index if not exists tenant_email_outbox_provider_idempotency_uidx
      on public.tenant_email_outbox(company_id, provider_idempotency_key)
      where provider_idempotency_key is not null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4) Deployment and master-data health. It is dynamic by design: a missing
-- object is reported as a blocking deployment issue rather than faked as empty
-- business data.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_ops_health_checks()
returns table (
  check_key text,
  status text,
  issue_count bigint,
  details jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text[] := array[
    'customer_operation_jobs',
    'customer_operation_request_snapshots',
    'customer_application_workflows',
    'customer_sites',
    'customer_site_resolution',
    'customer_site_address_conflicts',
    'platform_grid_areas',
    'platform_grid_owners',
    'grid_owners',
    'gridex_verified_grid_owners_v',
    'tenant_email_outbox',
    'webhook_deliveries',
    'ediel_outbox'
  ];
  item text;
  missing_count bigint := 0;
  count_value bigint;
begin
  foreach item in array expected loop
    if to_regclass('public.' || item) is null then
      missing_count := missing_count + 1;
      return query select
        'schema:' || item,
        'blocking'::text,
        1::bigint,
        jsonb_build_object('missing_relation', item);
    end if;
  end loop;

  if missing_count > 0 then
    return;
  end if;

  select count(*) into count_value
  from (
    select company_id, job_type, idempotency_key
    from public.customer_operation_jobs
    where status in ('queued', 'running', 'waiting_response')
      and idempotency_key is not null
    group by company_id, job_type, idempotency_key
    having count(*) > 1
  ) active_duplicates;
  return query select 'queue:customer_operation_active_idempotency_duplicate',
    case when count_value = 0 then 'ok' else 'blocking' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.customer_operation_jobs
  where status = 'running'
    and locked_at < now() - interval '15 minutes';
  return query select 'queue:customer_operation_stale',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.tenant_email_outbox
  where status = 'delivery_uncertain';
  return query select 'queue:email_delivery_uncertain',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.webhook_deliveries
  where status = 'processing'
    and locked_at < now() - interval '15 minutes';
  return query select 'queue:webhook_stale_processing',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.ediel_outbox
  where status = 'delivery_uncertain';
  return query select 'queue:ediel_delivery_uncertain',
    case when count_value = 0 then 'ok' else 'blocking' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.platform_grid_areas a
  left join public.platform_grid_owners pgo on pgo.id = a.grid_owner_id
  where a.is_active
    and (a.grid_owner_id is null or pgo.ops_grid_owner_id is null);
  return query select 'masterdata:grid_area_ops_owner_mapping_missing',
    case when count_value = 0 then 'ok' else 'blocking' end,
    count_value,
    '{}'::jsonb;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'gridex_verified_grid_owners_v'
      and column_name = 'can_use_for_prodat'
  ) then
    execute 'select count(*) from public.gridex_verified_grid_owners_v where coalesce(can_use_for_prodat, false) = false'
      into count_value;
    return query select 'masterdata:grid_owner_prodat_readiness_missing',
      case when count_value = 0 then 'ok' else 'warning' end,
      count_value,
      jsonb_build_object('source', 'gridex_verified_grid_owners_v');
  else
    return query select 'schema:gridex_verified_grid_owners_v.can_use_for_prodat',
      'blocking'::text,
      1::bigint,
      jsonb_build_object('missing_column', 'can_use_for_prodat');
  end if;

  select count(*) into count_value
  from (
    select company_id, customer_site_id, dedupe_key
    from public.customer_site_address_conflicts
    where status = 'open' and dedupe_key is not null
    group by company_id, customer_site_id, dedupe_key
    having count(*) > 1
  ) duplicates;
  return query select 'address_conflict:duplicate_open',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    '{}'::jsonb;

  select count(*) into count_value
  from public.customer_sites
  where status = 'active'
    and resolution_status in ('needs_review', 'failed')
    and coalesce(trim(street), '') <> '';
  return query select 'customer_site:unresolved_grid_context',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    '{}'::jsonb;
end;
$$;

revoke all on function public.gridex_ops_health_checks() from public;
revoke all on function public.gridex_ops_health_checks() from anon;
revoke all on function public.gridex_ops_health_checks() from authenticated;
grant execute on function public.gridex_ops_health_checks() to service_role;

-- -----------------------------------------------------------------------------
-- 5) Any material site address change invalidates active external operations.
-- Late Z02/APERAK responses are retained for audit but must be manually reviewed.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_invalidate_site_operations_on_address_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_fingerprint text;
  new_fingerprint text;
begin
  old_fingerprint := coalesce(
    nullif(old.address_hash, ''),
    lower(concat_ws('|', nullif(trim(old.street), ''), regexp_replace(coalesce(old.postal_code, ''), '\\D', '', 'g'), nullif(trim(old.city), '')))
  );
  new_fingerprint := coalesce(
    nullif(new.address_hash, ''),
    lower(concat_ws('|', nullif(trim(new.street), ''), regexp_replace(coalesce(new.postal_code, ''), '\\D', '', 'g'), nullif(trim(new.city), '')))
  );

  if old_fingerprint is distinct from new_fingerprint then
    update public.customer_operation_jobs
       set status = 'needs_review',
           stale_reason = 'site_address_changed_after_operation_started',
           locked_at = null,
           locked_by = null,
           lock_token = null,
           completed_at = now(),
           updated_at = now()
     where company_id = new.company_id
       and customer_site_id = new.id
       and status in ('queued', 'running', 'waiting_response');

    update public.customer_operation_request_snapshots
       set superseded_at = now()
     where company_id = new.company_id
       and customer_site_id = new.id
       and superseded_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_sites_invalidate_operations_on_address_change on public.customer_sites;
create trigger customer_sites_invalidate_operations_on_address_change
before update of street, postal_code, city, country, address_hash on public.customer_sites
for each row execute function public.gridex_invalidate_site_operations_on_address_change();

-- -----------------------------------------------------------------------------
-- 6) Durable website-application workflow. External automation is only started
-- after the internal customer, contract and legal state has been persisted.
-- -----------------------------------------------------------------------------
create table if not exists public.customer_application_workflows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_application_id uuid not null references public.website_customer_applications(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_site_id uuid null references public.customer_sites(id) on delete set null,
  metering_point_id uuid null references public.metering_points(id) on delete set null,
  contract_id uuid null references public.customer_contracts(id) on delete set null,
  operation_id uuid not null default gen_random_uuid(),
  state text not null default 'received',
  snapshot jsonb not null default '{}'::jsonb,
  failure_code text null,
  failure_detail_internal text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_application_workflows_state_check check (state in (
    'received','provisioning','provisioned','pending_customer_data','ready_for_switch','pending_review','failed','cancelled'
  ))
);
create unique index if not exists customer_application_workflows_application_uidx
  on public.customer_application_workflows(company_id, customer_application_id);
create index if not exists customer_application_workflows_company_state_idx
  on public.customer_application_workflows(company_id, state, updated_at desc);
alter table public.customer_application_workflows enable row level security;

do $$
begin
  if to_regprocedure('public.gridex_can_read_company(uuid)') is not null and not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='customer_application_workflows'
      and policyname='customer_application_workflows_tenant_read'
  ) then
    create policy customer_application_workflows_tenant_read on public.customer_application_workflows
      for select to authenticated using (public.gridex_can_read_company(company_id));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='customer_application_workflows'
      and policyname='customer_application_workflows_service_role_all'
  ) then
    create policy customer_application_workflows_service_role_all on public.customer_application_workflows
      for all to service_role using (true) with check (true);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 7) Atomic address commit. The core site, meter, request and address-history
-- writes happen in one database transaction; events are emitted afterwards.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_commit_customer_site_address(
  p_company_id uuid,
  p_customer_id uuid,
  p_site_id uuid,
  p_street text,
  p_postal_code text,
  p_city text,
  p_country text,
  p_care_of text,
  p_apartment_number text,
  p_address_normalized text,
  p_address_hash text,
  p_source text,
  p_source_reference text,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_hash text;
  v_address_id uuid;
  v_now timestamptz := now();
begin
  select address_hash
    into v_previous_hash
    from public.customer_sites
   where id = p_site_id
     and company_id = p_company_id
     and customer_id = p_customer_id
   for update;

  if not found then
    raise exception 'customer_site_not_found' using errcode = 'P0002';
  end if;

  if p_address_hash is null or btrim(p_address_hash) = '' then
    raise exception 'address_hash_required' using errcode = '22023';
  end if;

  if v_previous_hash is distinct from p_address_hash then
    update public.customer_operation_jobs
       set status = 'needs_review',
           stale_reason = 'site_address_changed_after_operation_started',
           last_error = 'Anläggningsadressen ändrades efter att automationen startades. Begäran måste granskas och startas om.',
           completed_at = v_now,
           locked_at = null,
           locked_by = null,
           lock_token = null,
           updated_at = v_now
     where company_id = p_company_id
       and customer_site_id = p_site_id
       and status in ('queued', 'running', 'waiting_response');

    update public.customer_info_requests
       set status = 'manual_review_required',
           blocker_reason = 'Anläggningsadressen har ändrats efter att begäran skapades. Kontrollera adress och starta om automatiken.',
           updated_at = v_now
     where company_id = p_company_id
       and customer_id = p_customer_id
       and site_id = p_site_id
       and status in ('draft', 'ready_to_send', 'z01_prepared', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl');
  end if;

  update public.customer_sites
     set street = p_street,
         postal_code = p_postal_code,
         city = p_city,
         country = p_country,
         care_of = p_care_of,
         apartment_number = p_apartment_number,
         address_normalized = p_address_normalized,
         address_hash = p_address_hash,
         address_source = p_source,
         address_source_reference = p_source_reference,
         address_received_at = v_now,
         address_verified_at = case when p_source = 'grid_owner_response' then v_now else null end,
         address_verification_method = case when p_source = 'grid_owner_response' then 'grid_owner_response' else null end,
         address_confidence = case when p_source = 'grid_owner_response' then 1 else null end,
         address_status = case when p_source = 'grid_owner_response' then 'verified' else 'candidate' end,
         address_quality_status = 'complete',
         address_quality_warnings = '[]'::jsonb,
         grid_owner_id = null,
         grid_area_code = null,
         price_area_code = null,
         resolution_id = null,
         resolution_status = 'needs_review',
         resolution_confidence = null,
         facility_data_status = case when p_source = 'grid_owner_response' then 'verified' else 'unverified' end,
         metadata = coalesce(p_metadata, '{}'::jsonb),
         updated_at = v_now
   where id = p_site_id
     and company_id = p_company_id
     and customer_id = p_customer_id;

  update public.metering_points
     set grid_owner_id = null,
         grid_area_code = null,
         price_area_code = null,
         verification_status = 'pending_verification',
         updated_at = v_now
   where company_id = p_company_id
     and site_id = p_site_id
     and status <> 'closed';

  select id into v_address_id
    from public.customer_addresses
   where company_id = p_company_id
     and customer_id = p_customer_id
     and type = 'facility'
     and metadata @> jsonb_build_object('customer_site_id', p_site_id)
   order by updated_at desc nulls last
   limit 1
   for update;

  if v_address_id is null then
    insert into public.customer_addresses (
      company_id, customer_id, type, street_1, street_2, postal_code, city,
      country, is_active, metadata, created_at, updated_at
    ) values (
      p_company_id, p_customer_id, 'facility', p_street, p_care_of, p_postal_code,
      p_city, p_country, true,
      jsonb_build_object('customer_site_id', p_site_id, 'address_hash', p_address_hash, 'source', p_source),
      v_now, v_now
    );
  else
    update public.customer_addresses
       set street_1 = p_street,
           street_2 = p_care_of,
           postal_code = p_postal_code,
           city = p_city,
           country = p_country,
           is_active = true,
           metadata = jsonb_build_object('customer_site_id', p_site_id, 'address_hash', p_address_hash, 'source', p_source),
           updated_at = v_now
     where id = v_address_id;
  end if;

  insert into public.customer_site_address_history (
    company_id, customer_id, customer_site_id, address_hash, source,
    source_reference, actor_user_id, snapshot
  ) values (
    p_company_id, p_customer_id, p_site_id, p_address_hash, p_source,
    p_source_reference, p_actor_user_id,
    jsonb_build_object(
      'street', p_street,
      'postal_code', p_postal_code,
      'city', p_city,
      'country', p_country,
      'care_of', p_care_of,
      'apartment_number', p_apartment_number,
      'address_hash', p_address_hash,
      'source', p_source,
      'source_reference', p_source_reference
    )
  );
end;
$$;

revoke all on function public.gridex_commit_customer_site_address(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) from public;
revoke all on function public.gridex_commit_customer_site_address(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) from anon;
revoke all on function public.gridex_commit_customer_site_address(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) from authenticated;
grant execute on function public.gridex_commit_customer_site_address(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) to service_role;
