-- Canonical customer onboarding transaction.
--
-- All production intake channels call gridex_onboard_customer_graph(jsonb).
-- The function owns the tenant-scoped customer graph, exact signed POA scope,
-- legal/pricing snapshots, workflow/task/outbox and audit rows in one database
-- transaction. External transports (mail, storage and Ediel) are represented as
-- durable outbox work and happen only after commit.

create extension if not exists pgcrypto;

create table if not exists public.customer_onboarding_operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text not null,
  idempotency_key text not null,
  correlation_id uuid not null,
  status text not null default 'started',
  command_snapshot jsonb not null default '{}'::jsonb,
  result_snapshot jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint customer_onboarding_operations_status_check
    check (status in ('started','completed','ambiguous_customer_match','failed')),
  constraint customer_onboarding_operations_channel_check
    check (channel in ('admin','website','external_contract','ediel_inbound','api','import','repair'))
);

create unique index if not exists customer_onboarding_operations_idempotency_uidx
  on public.customer_onboarding_operations(company_id, channel, idempotency_key);
create index if not exists customer_onboarding_operations_correlation_idx
  on public.customer_onboarding_operations(correlation_id);

create table if not exists public.customer_match_review_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  onboarding_operation_id uuid not null references public.customer_onboarding_operations(id) on delete cascade,
  status text not null default 'open',
  candidate_customer_ids uuid[] not null default '{}'::uuid[],
  match_evidence jsonb not null default '{}'::jsonb,
  resolved_customer_id uuid references public.customers(id) on delete restrict,
  resolution_type text,
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_match_review_cases_status_check check (status in ('open','resolved','rejected')),
  constraint customer_match_review_cases_resolution_type_check check (resolution_type is null or resolution_type in ('link_customer','create_separate'))
);
create unique index if not exists customer_match_review_cases_operation_uidx
  on public.customer_match_review_cases(onboarding_operation_id);

alter table public.customer_match_review_cases
  add column if not exists resolution_type text,
  add column if not exists resolution_note text;

create or replace function public.gridex_validate_customer_match_review_case()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
      from unnest(coalesce(new.candidate_customer_ids, '{}'::uuid[])) candidate_id
      left join public.customers c
        on c.id = candidate_id and c.company_id = new.company_id
     where c.id is null
  ) then
    raise exception 'candidate_customer_outside_review_tenant' using errcode = '22023';
  end if;

  if new.status = 'resolved' then
    if new.resolved_by is null or new.resolution_type not in ('link_customer','create_separate') then
      raise exception 'complete_match_resolution_evidence_required' using errcode = '22023';
    end if;
    if new.resolution_type = 'link_customer' and (
      new.resolved_customer_id is null
      or not (new.resolved_customer_id = any(new.candidate_customer_ids))
      or not exists (
        select 1 from public.customers c
         where c.id = new.resolved_customer_id and c.company_id = new.company_id
      )
    ) then
      raise exception 'resolved_customer_not_in_tenant_candidate_set' using errcode = '22023';
    end if;
    if new.resolution_type = 'create_separate' and new.resolved_customer_id is not null then
      raise exception 'create_separate_resolution_cannot_link_customer' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_match_review_cases_validate_tg on public.customer_match_review_cases;
create trigger customer_match_review_cases_validate_tg
before insert or update on public.customer_match_review_cases
for each row execute function public.gridex_validate_customer_match_review_case();

create table if not exists public.customer_onboarding_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  onboarding_operation_id uuid not null references public.customer_onboarding_operations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  customer_site_id uuid references public.customer_sites(id) on delete restrict,
  metering_point_id uuid references public.metering_points(id) on delete restrict,
  contract_id uuid references public.customer_contracts(id) on delete restrict,
  channel text not null,
  source_record_type text,
  source_record_id text,
  status text not null default 'committed',
  payload_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customer_onboarding_applications_operation_uidx
  on public.customer_onboarding_applications(onboarding_operation_id);

create table if not exists public.customer_onboarding_legal_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  onboarding_operation_id uuid not null references public.customer_onboarding_operations(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  contract_id uuid references public.customer_contracts(id) on delete restrict,
  power_of_attorney_id uuid references public.powers_of_attorney(id) on delete restrict,
  legal_bundle_version_id uuid,
  terms_version text,
  privacy_version text,
  cooling_off_version text,
  signed_scope_snapshot jsonb not null default '[]'::jsonb,
  acceptance_snapshot jsonb not null default '{}'::jsonb,
  accepted_at timestamptz,
  content_hash text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists customer_onboarding_legal_snapshots_operation_uidx
  on public.customer_onboarding_legal_snapshots(onboarding_operation_id);

alter table if exists public.powers_of_attorney
  add column if not exists signed_scope_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists legal_snapshot_id uuid references public.customer_onboarding_legal_snapshots(id) on delete restrict;

alter table if exists public.authorization_scopes
  add column if not exists signed_scope_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists legal_snapshot_id uuid references public.customer_onboarding_legal_snapshots(id) on delete restrict;

-- Immutable legal evidence and signed POA scope. Relations may be repaired, but
-- the customer's signed legal content and scope can never be widened or edited.
create or replace function public.gridex_protect_onboarding_legal_snapshot()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Published onboarding legal snapshots are immutable.' using errcode = '55000';
end;
$$;

drop trigger if exists customer_onboarding_legal_snapshots_immutable_tg on public.customer_onboarding_legal_snapshots;
create trigger customer_onboarding_legal_snapshots_immutable_tg
before update or delete on public.customer_onboarding_legal_snapshots
for each row execute function public.gridex_protect_onboarding_legal_snapshot();

create or replace function public.gridex_protect_signed_poa_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.signed_scope_snapshot is distinct from new.signed_scope_snapshot then
    raise exception 'Signed power-of-attorney scope snapshot is immutable.' using errcode = '55000';
  end if;
  if old.legal_snapshot_id is not null and old.legal_snapshot_id is distinct from new.legal_snapshot_id then
    raise exception 'Power-of-attorney legal snapshot link is immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists powers_of_attorney_signed_scope_immutable_tg on public.powers_of_attorney;
create trigger powers_of_attorney_signed_scope_immutable_tg
before update of signed_scope_snapshot, legal_snapshot_id on public.powers_of_attorney
for each row execute function public.gridex_protect_signed_poa_scope();

create or replace function public.gridex_protect_authorization_scope_coverage()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Legacy rows may receive their first immutable snapshot once. The boolean
  -- coverage must then equal that snapshot exactly. After the snapshot exists,
  -- neither the snapshot nor any false->true coverage transition is allowed.
  if coalesce(jsonb_array_length(old.signed_scope_snapshot), 0) = 0
     and coalesce(jsonb_array_length(new.signed_scope_snapshot), 0) > 0 then
    if coalesce(new.covers_grid_owner_data, false) is distinct from (new.signed_scope_snapshot ?| array['grid_owner_data','facility_information_lookup','supplier_switch'])
       or coalesce(new.covers_current_supplier_contract, false) is distinct from (new.signed_scope_snapshot ?| array['current_supplier_contract','supplier_switch'])
       or coalesce(new.covers_metering_data, false) is distinct from (new.signed_scope_snapshot ?| array['metering_data','facility_information_lookup']) then
      raise exception 'Authorization coverage must match signed scope snapshot.' using errcode = '55000';
    end if;
    return new;
  end if;
  if old.signed_scope_snapshot is distinct from new.signed_scope_snapshot then
    raise exception 'Authorization signed scope snapshot is immutable.' using errcode = '55000';
  end if;
  if coalesce(new.covers_grid_owner_data, false) and not coalesce(old.covers_grid_owner_data, false) then
    raise exception 'Authorization coverage cannot be widened after signing.' using errcode = '55000';
  end if;
  if coalesce(new.covers_current_supplier_contract, false) and not coalesce(old.covers_current_supplier_contract, false) then
    raise exception 'Authorization coverage cannot be widened after signing.' using errcode = '55000';
  end if;
  if coalesce(new.covers_metering_data, false) and not coalesce(old.covers_metering_data, false) then
    raise exception 'Authorization coverage cannot be widened after signing.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists authorization_scopes_no_widen_tg on public.authorization_scopes;
create trigger authorization_scopes_no_widen_tg
before update of covers_grid_owner_data, covers_current_supplier_contract, covers_metering_data, signed_scope_snapshot
on public.authorization_scopes
for each row execute function public.gridex_protect_authorization_scope_coverage();

-- Inserts a JSON object into a known canonical table while tolerating additive
-- schema differences between older and newer live databases. Generated and
-- identity columns are excluded. Only keys present in the JSON payload are
-- inserted, so table defaults remain authoritative.
create or replace function public.gridex_insert_jsonb_row(p_table regclass, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_columns text;
  v_select text;
  v_sql text;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'row payload must be a JSON object' using errcode = '22023';
  end if;

  select string_agg(format('%I', a.attname), ', ' order by a.attnum),
         string_agg(format('x.%I', a.attname), ', ' order by a.attnum)
    into v_columns, v_select
    from pg_attribute a
   where a.attrelid = p_table
     and a.attnum > 0
     and not a.attisdropped
     and a.attgenerated = ''
     and a.attidentity = ''
     and p_payload ? a.attname;

  if v_columns is null then
    raise exception 'payload has no writable columns for %', p_table using errcode = '22023';
  end if;

  v_sql := format(
    'insert into %s as target (%s) select %s from jsonb_populate_record(null::%s, $1) x returning to_jsonb(target)',
    p_table, v_columns, v_select, p_table
  );
  execute v_sql into v_result using p_payload;
  return v_result;
end;
$$;

create or replace function public.gridex_update_jsonb_row(
  p_table regclass,
  p_id uuid,
  p_company_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignments text;
  v_sql text;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'row payload must be a JSON object' using errcode = '22023';
  end if;

  select string_agg(format('%1$I = x.%1$I', a.attname), ', ' order by a.attnum)
    into v_assignments
    from pg_attribute a
   where a.attrelid = p_table
     and a.attnum > 0
     and not a.attisdropped
     and a.attgenerated = ''
     and a.attidentity = ''
     and a.attname not in ('id','company_id','created_at','customer_number')
     and p_payload ? a.attname;

  if v_assignments is null then
    execute format('select to_jsonb(t) from %s t where t.id = $1 and t.company_id = $2', p_table)
      into v_result using p_id, p_company_id;
    return v_result;
  end if;

  v_sql := format(
    'update %s t set %s from jsonb_populate_record(null::%s, $1) x where t.id = $2 and t.company_id = $3 returning to_jsonb(t)',
    p_table, v_assignments, p_table
  );
  execute v_sql into v_result using p_payload, p_id, p_company_id;
  return v_result;
end;
$$;

create or replace function public.gridex_onboard_customer_graph(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_channel text;
  v_idempotency_key text;
  v_correlation_id uuid;
  v_operation public.customer_onboarding_operations%rowtype;
  v_customer_payload jsonb;
  v_site_payload jsonb;
  v_meter_payload jsonb;
  v_contract_payload jsonb;
  v_price_payload jsonb;
  v_legal_payload jsonb;
  v_poa_payload jsonb;
  v_contact_payload jsonb;
  v_address_payload jsonb;
  v_application_payload jsonb;
  v_task_payload jsonb;
  v_info_request_payload jsonb;
  v_existing_customer_id uuid;
  v_existing_site_id uuid;
  v_existing_metering_point_id uuid;
  v_customer_id uuid;
  v_contact_id uuid;
  v_address_id uuid;
  v_site_id uuid;
  v_metering_point_id uuid;
  v_contract_id uuid;
  v_price_snapshot_id uuid;
  v_power_of_attorney_id uuid;
  v_authorization_document_id uuid;
  v_authorization_scope_id uuid;
  v_legal_snapshot_id uuid;
  v_application_id uuid;
  v_task_id uuid;
  v_info_request_id uuid;
  v_domain_event_id uuid;
  v_candidate_ids uuid[] := '{}'::uuid[];
  v_candidate_count integer := 0;
  v_customer_number text;
  v_contract_number text;
  v_matching_policy text;
  v_update_existing boolean;
  v_signed_scopes jsonb := '[]'::jsonb;
  v_scope_values text[] := '{}'::text[];
  v_result jsonb;
  v_row jsonb;
  v_source_record_id text;
  v_source_record_type text;
  v_fail_after text;
  v_cross_tenant_facility_seen boolean := false;
  v_review_resolution_type text;
  v_review_customer_id uuid;
begin
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    raise exception 'canonical onboarding command must be a JSON object' using errcode = '22023';
  end if;

  v_company_id := nullif(btrim(p_command->>'company_id'), '')::uuid;
  v_channel := lower(nullif(btrim(p_command->>'channel'), ''));
  v_idempotency_key := nullif(btrim(p_command->>'idempotency_key'), '');
  v_correlation_id := coalesce(nullif(btrim(p_command->>'correlation_id'), '')::uuid, gen_random_uuid());
  v_matching_policy := coalesce(nullif(lower(btrim(p_command->>'matching_policy')), ''), 'link_unique');
  v_update_existing := coalesce((p_command->>'update_existing')::boolean, false);
  v_fail_after := nullif(btrim(p_command->>'test_fail_after'), '');

  if v_company_id is null or not exists (select 1 from public.companies where id = v_company_id) then
    raise exception 'company_not_found' using errcode = 'P0002';
  end if;
  if v_channel not in ('admin','website','external_contract','ediel_inbound','api','import','repair') then
    raise exception 'unsupported_onboarding_channel' using errcode = '22023';
  end if;
  if v_idempotency_key is null then
    raise exception 'idempotency_key_required' using errcode = '22023';
  end if;
  if v_matching_policy not in ('link_unique','create_only','create_separate','link_selected') then
    raise exception 'unsupported_matching_policy' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':' || v_channel || ':' || v_idempotency_key, 0));

  select * into v_operation
    from public.customer_onboarding_operations
   where company_id = v_company_id and channel = v_channel and idempotency_key = v_idempotency_key
   for update;

  if v_operation.id is not null and v_operation.status = 'completed' then
    return v_operation.result_snapshot;
  end if;
  if v_operation.id is not null and v_operation.status = 'ambiguous_customer_match' then
    select resolution_type, resolved_customer_id
      into v_review_resolution_type, v_review_customer_id
      from public.customer_match_review_cases
     where onboarding_operation_id = v_operation.id
       and status = 'resolved';

    if v_review_resolution_type = 'link_customer' and v_review_customer_id is not null then
      p_command := p_command || jsonb_build_object(
        'existing_customer_id', v_review_customer_id,
        'matching_policy', 'link_selected'
      );
      v_matching_policy := 'link_selected';
    elsif v_review_resolution_type = 'create_separate' then
      p_command := (p_command - 'existing_customer_id') || jsonb_build_object('matching_policy', 'create_separate');
      v_matching_policy := 'create_separate';
    else
      return v_operation.result_snapshot;
    end if;
  end if;

  if v_operation.id is null then
    insert into public.customer_onboarding_operations(
      company_id, channel, idempotency_key, correlation_id, status, command_snapshot
    ) values (
      v_company_id, v_channel, v_idempotency_key, v_correlation_id, 'started', p_command - 'test_fail_after'
    ) returning * into v_operation;
  else
    update public.customer_onboarding_operations
       set correlation_id = v_correlation_id,
           status = 'started',
           command_snapshot = p_command - 'test_fail_after',
           error_code = null,
           updated_at = now()
     where id = v_operation.id
     returning * into v_operation;
  end if;

  v_customer_payload := coalesce(p_command->'customer', '{}'::jsonb) || jsonb_build_object('company_id', v_company_id);
  v_contact_payload := coalesce(p_command->'contact', '{}'::jsonb);
  v_address_payload := coalesce(p_command->'address', '{}'::jsonb);
  v_site_payload := coalesce(p_command->'site', '{}'::jsonb);
  v_meter_payload := coalesce(p_command->'metering_point', '{}'::jsonb);
  v_contract_payload := coalesce(p_command->'contract', '{}'::jsonb);
  v_price_payload := coalesce(p_command->'price_snapshot', '{}'::jsonb);
  v_legal_payload := coalesce(p_command->'legal', '{}'::jsonb);
  v_poa_payload := coalesce(p_command->'power_of_attorney', '{}'::jsonb);
  v_application_payload := coalesce(p_command->'application', '{}'::jsonb);
  v_task_payload := coalesce(p_command->'task', '{}'::jsonb);
  v_info_request_payload := coalesce(p_command->'info_request', '{}'::jsonb);

  -- Cross-tenant matches are a platform-only integrity signal. They never
  -- disclose another tenant's customer or block legitimate onboarding here.
  if nullif(btrim(v_site_payload->>'facility_id'), '') is not null then
    select exists (
      select 1
        from public.customer_sites s
       where s.company_id <> v_company_id
         and s.normalized_facility_id = public.gridex_normalize_facility_id(v_site_payload->>'facility_id')
    ) into v_cross_tenant_facility_seen;
  end if;

  v_existing_customer_id := nullif(btrim(p_command->>'existing_customer_id'), '')::uuid;
  v_existing_site_id := nullif(btrim(p_command->>'existing_site_id'), '')::uuid;
  v_existing_metering_point_id := nullif(btrim(p_command->>'existing_metering_point_id'), '')::uuid;
  if v_existing_customer_id is not null then
    if not exists (
      select 1 from public.customers where id = v_existing_customer_id and company_id = v_company_id
    ) then
      raise exception 'selected_customer_not_found_for_tenant' using errcode = 'P0002';
    end if;
    v_candidate_ids := array[v_existing_customer_id];
  else
    select coalesce(array_agg(distinct candidate_id), '{}'::uuid[])
      into v_candidate_ids
      from (
        select c.id candidate_id
          from public.customers c
         where c.company_id = v_company_id
           and nullif(btrim(v_customer_payload->>'personal_number'), '') is not null
           and c.normalized_personal_number = public.gridex_normalize_personal_number(v_customer_payload->>'personal_number')
        union all
        select c.id
          from public.customers c
         where c.company_id = v_company_id
           and nullif(btrim(v_customer_payload->>'org_number'), '') is not null
           and c.normalized_org_number = public.gridex_normalize_org_number(v_customer_payload->>'org_number')
        union all
        select s.customer_id
          from public.customer_sites s
         where s.company_id = v_company_id
           and nullif(btrim(v_site_payload->>'facility_id'), '') is not null
           and s.normalized_facility_id = public.gridex_normalize_facility_id(v_site_payload->>'facility_id')
        union all
        select m.customer_id
          from public.metering_points m
         where m.company_id = v_company_id
           and nullif(btrim(coalesce(v_meter_payload->>'meter_point_id', v_meter_payload->>'metering_point_id')), '') is not null
           and m.normalized_metering_point_id = public.gridex_normalize_metering_point_id(coalesce(v_meter_payload->>'meter_point_id', v_meter_payload->>'metering_point_id'))
      ) matches
     where candidate_id is not null;
  end if;

  v_candidate_count := coalesce(array_length(v_candidate_ids, 1), 0);
  if v_candidate_count > 1 or (v_candidate_count > 0 and v_matching_policy = 'create_only') then
    v_result := jsonb_build_object(
      'ok', false,
      'code', 'ambiguous_customer_match',
      'correlation_id', v_correlation_id,
      'operation_id', v_operation.id,
      'candidate_customer_ids', to_jsonb(v_candidate_ids)
    );
    insert into public.customer_match_review_cases(
      company_id, onboarding_operation_id, candidate_customer_ids, match_evidence
    ) values (
      v_company_id,
      v_operation.id,
      v_candidate_ids,
      jsonb_build_object(
        'customer_identity', jsonb_build_object(
          'personal_number_present', nullif(btrim(v_customer_payload->>'personal_number'), '') is not null,
          'org_number_present', nullif(btrim(v_customer_payload->>'org_number'), '') is not null,
          'email', nullif(btrim(v_customer_payload->>'email'), '')
        ),
        'facility_id', nullif(btrim(v_site_payload->>'facility_id'), ''),
        'metering_point_id', nullif(btrim(coalesce(v_meter_payload->>'meter_point_id', v_meter_payload->>'metering_point_id')), '')
      )
    ) on conflict (onboarding_operation_id) do update set
      candidate_customer_ids = excluded.candidate_customer_ids,
      match_evidence = excluded.match_evidence,
      status = 'open',
      updated_at = now();

    update public.customer_onboarding_operations
       set status = 'ambiguous_customer_match', result_snapshot = v_result,
           error_code = 'ambiguous_customer_match', completed_at = now(), updated_at = now()
     where id = v_operation.id;
    return v_result;
  end if;

  if v_candidate_count = 1 and v_matching_policy in ('link_unique','link_selected') then
    v_customer_id := v_candidate_ids[1];
    if v_update_existing then
      v_row := public.gridex_update_jsonb_row('public.customers'::regclass, v_customer_id, v_company_id, v_customer_payload);
    else
      select to_jsonb(c) into v_row from public.customers c where c.id = v_customer_id and c.company_id = v_company_id;
    end if;
  else
    v_row := public.gridex_insert_jsonb_row('public.customers'::regclass, v_customer_payload);
    v_customer_id := (v_row->>'id')::uuid;
  end if;

  select customer_number into v_customer_number
    from public.customers where id = v_customer_id and company_id = v_company_id for update;
  if nullif(btrim(v_customer_number), '') is null then
    raise exception 'customer_number_assignment_failed' using errcode = '23502';
  end if;

  if v_fail_after = 'customer' and current_setting('gridex.allow_test_failpoints', true) = 'on' then
    raise exception 'test_fail_after_customer' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_contact_payload) = 'object' and v_contact_payload <> '{}'::jsonb then
    v_row := public.gridex_insert_jsonb_row(
      'public.customer_contacts'::regclass,
      v_contact_payload || jsonb_build_object('company_id', v_company_id, 'customer_id', v_customer_id)
    );
    v_contact_id := (v_row->>'id')::uuid;
  end if;

  if jsonb_typeof(v_address_payload) = 'object' and v_address_payload <> '{}'::jsonb then
    v_row := public.gridex_insert_jsonb_row(
      'public.customer_addresses'::regclass,
      v_address_payload || jsonb_build_object('company_id', v_company_id, 'customer_id', v_customer_id)
    );
    v_address_id := (v_row->>'id')::uuid;
  end if;

  if jsonb_typeof(v_site_payload) = 'object' and v_site_payload <> '{}'::jsonb then
    if v_existing_site_id is not null then
      select id into v_site_id
        from public.customer_sites
       where id = v_existing_site_id and company_id = v_company_id and customer_id = v_customer_id;
      if v_site_id is null then
        raise exception 'selected_site_not_found_for_customer_tenant' using errcode = 'P0002';
      end if;
    end if;
    if v_site_id is null and nullif(btrim(v_site_payload->>'facility_id'), '') is not null then
      select id into v_site_id
        from public.customer_sites
       where company_id = v_company_id
         and normalized_facility_id = public.gridex_normalize_facility_id(v_site_payload->>'facility_id')
         and customer_id = v_customer_id
       order by created_at desc limit 1;
      if v_site_id is null and exists (
        select 1 from public.customer_sites
         where company_id = v_company_id
           and normalized_facility_id = public.gridex_normalize_facility_id(v_site_payload->>'facility_id')
           and customer_id <> v_customer_id
      ) then
        raise exception 'facility_id_owned_by_another_customer' using errcode = '23505';
      end if;
    end if;
    if v_site_id is null then
      v_row := public.gridex_insert_jsonb_row(
        'public.customer_sites'::regclass,
        v_site_payload || jsonb_build_object('company_id', v_company_id, 'customer_id', v_customer_id)
      );
      v_site_id := (v_row->>'id')::uuid;
    elsif v_update_existing or v_existing_site_id is not null then
      perform public.gridex_update_jsonb_row('public.customer_sites'::regclass, v_site_id, v_company_id, v_site_payload);
    end if;
  end if;

  if v_fail_after = 'site' and current_setting('gridex.allow_test_failpoints', true) = 'on' then
    raise exception 'test_fail_after_site' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_meter_payload) = 'object' and v_meter_payload <> '{}'::jsonb then
    if v_existing_metering_point_id is not null then
      select id into v_metering_point_id
        from public.metering_points
       where id = v_existing_metering_point_id and company_id = v_company_id and customer_id = v_customer_id;
      if v_metering_point_id is null then
        raise exception 'selected_metering_point_not_found_for_customer_tenant' using errcode = 'P0002';
      end if;
    end if;
    if v_metering_point_id is null and nullif(btrim(coalesce(v_meter_payload->>'meter_point_id', v_meter_payload->>'metering_point_id')), '') is not null then
      select id into v_metering_point_id
        from public.metering_points
       where company_id = v_company_id
         and normalized_metering_point_id = public.gridex_normalize_metering_point_id(coalesce(v_meter_payload->>'meter_point_id', v_meter_payload->>'metering_point_id'))
         and customer_id = v_customer_id
       order by created_at desc limit 1;
      if v_metering_point_id is null and exists (
        select 1 from public.metering_points
         where company_id = v_company_id
           and normalized_metering_point_id = public.gridex_normalize_metering_point_id(coalesce(v_meter_payload->>'meter_point_id', v_meter_payload->>'metering_point_id'))
           and customer_id <> v_customer_id
      ) then
        raise exception 'metering_point_owned_by_another_customer' using errcode = '23505';
      end if;
    end if;
    if v_metering_point_id is null then
      v_row := public.gridex_insert_jsonb_row(
        'public.metering_points'::regclass,
        v_meter_payload || jsonb_build_object(
          'company_id', v_company_id,
          'customer_id', v_customer_id,
          'site_id', v_site_id,
          'customer_site_id', v_site_id
        )
      );
      v_metering_point_id := (v_row->>'id')::uuid;
    elsif v_update_existing or v_existing_metering_point_id is not null then
      perform public.gridex_update_jsonb_row(
        'public.metering_points'::regclass,
        v_metering_point_id,
        v_company_id,
        v_meter_payload || jsonb_build_object('site_id', v_site_id, 'customer_site_id', v_site_id)
      );
    end if;
  end if;

  if jsonb_typeof(v_contract_payload) = 'object' and v_contract_payload <> '{}'::jsonb then
    -- Contract/customer numbers are allocated inside this transaction. Intake
    -- callers may never reserve a customer number before the customer commit.
    v_contract_number := coalesce(
      nullif(btrim(v_contract_payload->>'contract_number'), ''),
      public.gridex_next_contract_number(v_company_id, v_customer_number)
    );
    v_contract_payload := v_contract_payload || jsonb_build_object(
      'contract_number', v_contract_number,
      'customer_number', v_customer_number
    );
    v_row := public.gridex_insert_jsonb_row(
      'public.customer_contracts'::regclass,
      v_contract_payload || jsonb_build_object(
        'company_id', v_company_id,
        'customer_id', v_customer_id,
        'site_id', v_site_id,
        'customer_site_id', v_site_id,
        'metering_point_id', v_metering_point_id
      )
    );
    v_contract_id := (v_row->>'id')::uuid;
  end if;

  if v_contract_id is not null and jsonb_typeof(v_price_payload) = 'object' and v_price_payload <> '{}'::jsonb then
    v_price_payload := v_price_payload || jsonb_build_object(
      'customer_number', v_customer_number,
      'contract_number', v_contract_number,
      'snapshot_json', coalesce(v_price_payload->'snapshot_json', '{}'::jsonb) || jsonb_build_object(
        'customer_number', v_customer_number,
        'contract_number', v_contract_number
      )
    );
    v_row := public.gridex_insert_jsonb_row(
      'public.contract_price_snapshots'::regclass,
      v_price_payload || jsonb_build_object(
        'company_id', v_company_id,
        'contract_id', v_contract_id,
        'customer_id', v_customer_id
      )
    );
    v_price_snapshot_id := (v_row->>'id')::uuid;
    perform public.gridex_update_jsonb_row(
      'public.customer_contracts'::regclass,
      v_contract_id,
      v_company_id,
      jsonb_build_object(
        'contract_price_snapshot_id', v_price_snapshot_id,
        'pricing_snapshot_id', v_price_snapshot_id,
        'price_snapshot', coalesce(v_price_payload->'snapshot_json', v_price_payload)
      )
    );
  end if;

  if jsonb_typeof(v_legal_payload->'signed_scopes') = 'array' then
    v_signed_scopes := v_legal_payload->'signed_scopes';
  elsif jsonb_typeof(v_poa_payload->'signed_scopes') = 'array' then
    v_signed_scopes := v_poa_payload->'signed_scopes';
  else
    v_signed_scopes := '[]'::jsonb;
  end if;
  select coalesce(array_agg(value), '{}'::text[]) into v_scope_values
    from jsonb_array_elements_text(v_signed_scopes) value;

  if jsonb_typeof(v_poa_payload) = 'object' and v_poa_payload <> '{}'::jsonb then
    if coalesce(jsonb_array_length(v_signed_scopes), 0) = 0 then
      raise exception 'signed_power_of_attorney_scope_required' using errcode = '22023';
    end if;
    v_row := public.gridex_insert_jsonb_row(
      'public.powers_of_attorney'::regclass,
      (v_poa_payload - 'signed_scopes') || jsonb_build_object(
        'company_id', v_company_id,
        'customer_id', v_customer_id,
        'site_id', v_site_id,
        'customer_site_id', v_site_id,
        'metering_point_id', v_metering_point_id,
        'contract_id', v_contract_id,
        'customer_contract_id', v_contract_id,
        'signed_scope_snapshot', v_signed_scopes,
        'scope_summary', jsonb_build_object('scopes', v_signed_scopes, 'source', v_channel)
      )
    );
    v_power_of_attorney_id := (v_row->>'id')::uuid;

    v_row := public.gridex_insert_jsonb_row(
      'public.customer_authorization_documents'::regclass,
      coalesce(p_command->'authorization_document', '{}'::jsonb) || jsonb_build_object(
        'company_id', v_company_id,
        'customer_id', v_customer_id,
        'site_id', v_site_id,
        'metering_point_id', v_metering_point_id,
        'customer_contract_id', v_contract_id,
        'power_of_attorney_id', v_power_of_attorney_id,
        'document_type', 'power_of_attorney',
        'status', coalesce(nullif(p_command#>>'{authorization_document,status}', ''), 'active'),
        'title', coalesce(nullif(p_command#>>'{authorization_document,title}', ''), 'Signerad fullmakt'),
        'metadata', coalesce(p_command#>'{authorization_document,metadata}', '{}'::jsonb) || jsonb_build_object('signed_scopes', v_signed_scopes)
      )
    );
    v_authorization_document_id := (v_row->>'id')::uuid;

    v_row := public.gridex_insert_jsonb_row(
      'public.authorization_scopes'::regclass,
      jsonb_build_object(
        'company_id', v_company_id,
        'customer_id', v_customer_id,
        'authorization_document_id', v_authorization_document_id,
        'scope_type', 'signed_customer_authorization',
        'status', 'active',
        'covers_grid_owner_data', ('grid_owner_data' = any(v_scope_values) or 'facility_information_lookup' = any(v_scope_values) or 'supplier_switch' = any(v_scope_values)),
        'covers_current_supplier_contract', ('current_supplier_contract' = any(v_scope_values) or 'supplier_switch' = any(v_scope_values)),
        'covers_metering_data', ('metering_data' = any(v_scope_values) or 'facility_information_lookup' = any(v_scope_values)),
        'valid_from', nullif(v_poa_payload->>'valid_from', ''),
        'valid_to', nullif(v_poa_payload->>'valid_to', ''),
        'evidence_note', 'Coverage derived exactly from immutable signed scope snapshot.',
        'signed_scope_snapshot', v_signed_scopes,
        'metadata', jsonb_build_object('power_of_attorney_id', v_power_of_attorney_id, 'source', v_channel),
        'created_by', nullif(p_command->>'actor_user_id', '')
      )
    );
    v_authorization_scope_id := (v_row->>'id')::uuid;
  end if;

  if jsonb_typeof(v_legal_payload) = 'object' and v_legal_payload <> '{}'::jsonb then
    insert into public.customer_onboarding_legal_snapshots(
      company_id, onboarding_operation_id, customer_id, contract_id, power_of_attorney_id,
      legal_bundle_version_id, terms_version, privacy_version, cooling_off_version,
      signed_scope_snapshot, acceptance_snapshot, accepted_at, content_hash
    ) values (
      v_company_id, v_operation.id, v_customer_id, v_contract_id, v_power_of_attorney_id,
      nullif(v_legal_payload->>'legal_bundle_version_id', '')::uuid,
      nullif(v_legal_payload->>'terms_version', ''),
      nullif(v_legal_payload->>'privacy_version', ''),
      nullif(v_legal_payload->>'cooling_off_version', ''),
      v_signed_scopes,
      coalesce(v_legal_payload->'acceptance_snapshot', v_legal_payload - 'signed_scopes'),
      nullif(v_legal_payload->>'accepted_at', '')::timestamptz,
      encode(digest(convert_to((v_legal_payload || jsonb_build_object('signed_scopes', v_signed_scopes))::text, 'utf8'), 'sha256'), 'hex')
    ) returning id into v_legal_snapshot_id;

    if v_power_of_attorney_id is not null then
      update public.powers_of_attorney
         set legal_snapshot_id = v_legal_snapshot_id,
             updated_at = now()
       where id = v_power_of_attorney_id and company_id = v_company_id;
      update public.authorization_scopes
         set legal_snapshot_id = v_legal_snapshot_id,
             updated_at = now()
       where id = v_authorization_scope_id and company_id = v_company_id;
    end if;
  end if;

  insert into public.customer_onboarding_applications(
    company_id, onboarding_operation_id, customer_id, customer_site_id,
    metering_point_id, contract_id, channel, source_record_type, source_record_id,
    status, payload_snapshot
  ) values (
    v_company_id, v_operation.id, v_customer_id, v_site_id, v_metering_point_id,
    v_contract_id, v_channel,
    nullif(v_application_payload->>'source_record_type', ''),
    nullif(v_application_payload->>'source_record_id', ''),
    coalesce(nullif(v_application_payload->>'status', ''), 'committed'),
    coalesce(v_application_payload->'payload_snapshot', v_application_payload)
  ) returning id into v_application_id;

  v_source_record_type := nullif(v_application_payload->>'source_record_type', '');
  v_source_record_id := nullif(v_application_payload->>'source_record_id', '');

  if jsonb_typeof(v_info_request_payload) = 'object' and v_info_request_payload <> '{}'::jsonb then
    v_row := public.gridex_insert_jsonb_row(
      'public.customer_info_requests'::regclass,
      v_info_request_payload || jsonb_build_object(
        'company_id', v_company_id,
        'customer_id', v_customer_id,
        'site_id', v_site_id,
        'metering_point_id', v_metering_point_id,
        'authorization_document_id', v_authorization_document_id
      )
    );
    v_info_request_id := (v_row->>'id')::uuid;
  end if;

  if jsonb_typeof(v_task_payload) = 'object' and v_task_payload <> '{}'::jsonb then
    v_row := public.gridex_insert_jsonb_row(
      'public.customer_operation_tasks'::regclass,
      v_task_payload || jsonb_build_object(
        'company_id', v_company_id,
        'customer_id', v_customer_id,
        'site_id', v_site_id,
        'metering_point_id', v_metering_point_id,
        'metadata', coalesce(v_task_payload->'metadata', '{}'::jsonb) || jsonb_build_object(
          'onboarding_operation_id', v_operation.id,
          'correlation_id', v_correlation_id,
          'contract_id', v_contract_id,
          'application_id', v_application_id
        )
      )
    );
    v_task_id := (v_row->>'id')::uuid;
  end if;

  insert into public.domain_events(
    company_id, event_type, aggregate_type, aggregate_id, subject_customer_id,
    actor_user_id, source, idempotency_key, payload
  ) values (
    v_company_id,
    'customer.onboarding_committed',
    'customer_onboarding_operation',
    v_operation.id::text,
    v_customer_id,
    nullif(p_command->>'actor_user_id', '')::uuid,
    v_channel,
    'customer-onboarding:' || v_operation.id::text,
    jsonb_build_object(
      'correlation_id', v_correlation_id,
      'customer_id', v_customer_id,
      'customer_number', v_customer_number,
      'site_id', v_site_id,
      'metering_point_id', v_metering_point_id,
      'contract_id', v_contract_id,
      'power_of_attorney_id', v_power_of_attorney_id,
      'source_record_type', v_source_record_type,
      'source_record_id', v_source_record_id,
      'cross_tenant_facility_seen', v_cross_tenant_facility_seen,
      'cross_tenant_signal_visibility', 'platform_only'
    )
  ) returning id into v_domain_event_id;

  insert into public.event_outbox(
    company_id, domain_event_id, destination_type, destination_key, status, payload
  ) values (
    v_company_id,
    v_domain_event_id,
    'internal',
    'customer-onboarding-orchestrator',
    'queued',
    jsonb_build_object(
      'operation_id', v_operation.id,
      'correlation_id', v_correlation_id,
      'customer_id', v_customer_id,
      'application_id', v_application_id,
      'info_request_id', v_info_request_id,
      'task_id', v_task_id
    )
  ) on conflict (domain_event_id, destination_type, destination_key) where destination_key is not null do nothing;

  insert into public.audit_logs(
    company_id, actor_user_id, entity_type, entity_id, action, new_values, metadata
  ) values (
    v_company_id,
    nullif(p_command->>'actor_user_id', '')::uuid,
    'customer_onboarding_operation',
    v_operation.id::text,
    'customer_onboarding.committed',
    jsonb_build_object(
      'customer_id', v_customer_id,
      'customer_number', v_customer_number,
      'site_id', v_site_id,
      'metering_point_id', v_metering_point_id,
      'contract_id', v_contract_id
    ),
    jsonb_build_object(
      'channel', v_channel,
      'correlation_id', v_correlation_id,
      'cross_tenant_facility_seen', v_cross_tenant_facility_seen,
      'cross_tenant_signal_visibility', 'platform_only'
    )
  );

  if v_fail_after = 'complete' and current_setting('gridex.allow_test_failpoints', true) = 'on' then
    raise exception 'test_fail_before_commit' using errcode = 'P0001';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'code', 'customer_onboarding_committed',
    'operation_id', v_operation.id,
    'correlation_id', v_correlation_id,
    'customer_id', v_customer_id,
    'customer_number', v_customer_number,
    'created_new_customer', v_candidate_count = 0 or v_matching_policy = 'create_separate',
    'contact_id', v_contact_id,
    'address_id', v_address_id,
    'site_id', v_site_id,
    'metering_point_id', v_metering_point_id,
    'contract_id', v_contract_id,
    'contract_number', v_contract_number,
    'price_snapshot_id', v_price_snapshot_id,
    'power_of_attorney_id', v_power_of_attorney_id,
    'authorization_document_id', v_authorization_document_id,
    'authorization_scope_id', v_authorization_scope_id,
    'legal_snapshot_id', v_legal_snapshot_id,
    'application_id', v_application_id,
    'task_id', v_task_id,
    'info_request_id', v_info_request_id,
    'outbox_event_id', v_domain_event_id
  );

  update public.customer_onboarding_operations
     set status = 'completed', result_snapshot = v_result, completed_at = now(), updated_at = now()
   where id = v_operation.id;

  return v_result;
exception
  when others then
    -- PL/pgSQL exception handling creates an internal subtransaction. Every row
    -- written above is rolled back before this block runs. Re-raise so callers
    -- cannot receive a false success. Failed attempts are observable through
    -- application logs using the correlation id included in the error detail.
    raise exception '%', SQLERRM
      using errcode = SQLSTATE,
            detail = jsonb_build_object(
              'correlation_id', v_correlation_id,
              'channel', v_channel,
              'idempotency_key', v_idempotency_key,
              'sqlstate', SQLSTATE
            )::text;
end;
$$;

create or replace function public.gridex_resolve_customer_match_review_case(
  p_case_id uuid,
  p_resolution_type text,
  p_selected_customer_id uuid,
  p_actor_user_id uuid,
  p_resolution_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.customer_match_review_cases%rowtype;
  v_resolution_type text := lower(nullif(btrim(p_resolution_type), ''));
begin
  if p_actor_user_id is null then
    raise exception 'actor_user_id_required' using errcode = '22023';
  end if;
  if v_resolution_type not in ('link_customer','create_separate') then
    raise exception 'unsupported_match_resolution' using errcode = '22023';
  end if;

  select * into v_case
    from public.customer_match_review_cases
   where id = p_case_id
   for update;
  if v_case.id is null then
    raise exception 'customer_match_review_case_not_found' using errcode = 'P0002';
  end if;
  if v_case.status <> 'open' then
    raise exception 'customer_match_review_case_already_resolved' using errcode = '55000';
  end if;

  if v_resolution_type = 'link_customer' then
    if p_selected_customer_id is null
       or not (p_selected_customer_id = any(v_case.candidate_customer_ids))
       or not exists (
         select 1 from public.customers c
          where c.id = p_selected_customer_id and c.company_id = v_case.company_id
       ) then
      raise exception 'selected_customer_not_in_tenant_candidate_set' using errcode = '22023';
    end if;
  elsif p_selected_customer_id is not null then
    raise exception 'selected_customer_must_be_null_for_create_separate' using errcode = '22023';
  end if;

  update public.customer_match_review_cases
     set status = 'resolved',
         resolution_type = v_resolution_type,
         resolution_note = nullif(btrim(p_resolution_note), ''),
         resolved_customer_id = case when v_resolution_type = 'link_customer' then p_selected_customer_id else null end,
         resolved_by = p_actor_user_id,
         resolved_at = now(),
         updated_at = now()
   where id = v_case.id;

  insert into public.audit_logs(
    company_id, actor_user_id, entity_type, entity_id, action, old_values, new_values, metadata
  ) values (
    v_case.company_id,
    p_actor_user_id,
    'customer_match_review_case',
    v_case.id::text,
    'customer_match_review_case.resolved',
    jsonb_build_object('status', v_case.status, 'candidate_customer_ids', v_case.candidate_customer_ids),
    jsonb_build_object(
      'status', 'resolved',
      'resolution_type', v_resolution_type,
      'resolved_customer_id', case when v_resolution_type = 'link_customer' then p_selected_customer_id else null end
    ),
    jsonb_build_object('resolution_note', nullif(btrim(p_resolution_note), ''))
  );

  return jsonb_build_object(
    'ok', true,
    'case_id', v_case.id,
    'operation_id', v_case.onboarding_operation_id,
    'company_id', v_case.company_id,
    'resolution_type', v_resolution_type,
    'resolved_customer_id', case when v_resolution_type = 'link_customer' then p_selected_customer_id else null end
  );
end;
$$;

alter table public.customer_onboarding_operations enable row level security;
alter table public.customer_match_review_cases enable row level security;
alter table public.customer_onboarding_applications enable row level security;
alter table public.customer_onboarding_legal_snapshots enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'customer_onboarding_operations',
    'customer_match_review_cases',
    'customer_onboarding_applications',
    'customer_onboarding_legal_snapshots'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_tenant_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.gridex_can_read_company(company_id))',
      t || '_tenant_read', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_service_all', t);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      t || '_service_all', t
    );
  end loop;
end $$;

revoke all on function public.gridex_insert_jsonb_row(regclass,jsonb) from public, anon, authenticated;
revoke all on function public.gridex_update_jsonb_row(regclass,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.gridex_onboard_customer_graph(jsonb) from public, anon, authenticated;
revoke all on function public.gridex_resolve_customer_match_review_case(uuid,text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.gridex_onboard_customer_graph(jsonb) to service_role;
grant execute on function public.gridex_resolve_customer_match_review_case(uuid,text,uuid,uuid,text) to service_role;

comment on function public.gridex_onboard_customer_graph(jsonb) is
  'Canonical fail-closed, tenant-scoped and idempotent customer onboarding transaction for all intake channels.';
