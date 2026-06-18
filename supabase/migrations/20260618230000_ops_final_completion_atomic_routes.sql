-- Final OPS completion: durable customer-application saga, exact Ediel route/certificate
-- health, and deployment-safe schema diagnostics. Forward-only; no destructive changes.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) Durable provisioning saga. The workflow commit is atomic and must happen
-- before any external grid-owner or Ediel automation is queued.
-- -----------------------------------------------------------------------------
create table if not exists public.customer_application_provisioning_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_application_id uuid not null references public.website_customer_applications(id) on delete cascade,
  operation_id uuid not null,
  step text not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_application_provisioning_steps_step_check check (step in (
    'application_persisted','legal_persisted','workflow_committed','external_automation_queued','compensated','failed'
  )),
  constraint customer_application_provisioning_steps_status_check check (status in ('started','completed','failed'))
);

create unique index if not exists customer_application_provisioning_steps_idempotency_uidx
  on public.customer_application_provisioning_steps(company_id, customer_application_id, operation_id, step);
create index if not exists customer_application_provisioning_steps_lookup_idx
  on public.customer_application_provisioning_steps(company_id, customer_application_id, created_at desc);

alter table public.customer_application_provisioning_steps enable row level security;

do $$
begin
  if to_regprocedure('public.gridex_can_read_company(uuid)') is not null and not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='customer_application_provisioning_steps'
      and policyname='customer_application_provisioning_steps_tenant_read'
  ) then
    create policy customer_application_provisioning_steps_tenant_read
      on public.customer_application_provisioning_steps
      for select to authenticated using (public.gridex_can_read_company(company_id));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='customer_application_provisioning_steps'
      and policyname='customer_application_provisioning_steps_service_role_all'
  ) then
    create policy customer_application_provisioning_steps_service_role_all
      on public.customer_application_provisioning_steps
      for all to service_role using (true) with check (true);
  end if;
end $$;

create or replace function public.gridex_record_application_provisioning_step(
  p_company_id uuid,
  p_customer_application_id uuid,
  p_operation_id uuid,
  p_step text,
  p_status text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.customer_application_provisioning_steps (
    company_id, customer_application_id, operation_id, step, status, payload
  ) values (
    p_company_id, p_customer_application_id, p_operation_id, p_step, p_status, coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (company_id, customer_application_id, operation_id, step)
  do update set
    status = excluded.status,
    payload = public.customer_application_provisioning_steps.payload || excluded.payload,
    updated_at = now();
end;
$$;

create or replace function public.gridex_commit_customer_application_provisioning(
  p_company_id uuid,
  p_customer_application_id uuid,
  p_customer_id uuid,
  p_customer_site_id uuid,
  p_metering_point_id uuid,
  p_contract_id uuid,
  p_power_of_attorney_id uuid,
  p_operation_id uuid,
  p_state text,
  p_snapshot jsonb default '{}'::jsonb
)
returns table(operation_id uuid, state text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application record;
  v_workflow_id uuid;
  v_existing_operation_id uuid;
  v_final_state text := coalesce(nullif(btrim(p_state), ''), 'pending_review');
  v_snapshot jsonb := coalesce(p_snapshot, '{}'::jsonb);
begin
  if v_final_state not in ('pending_customer_data','ready_for_switch','pending_review') then
    raise exception 'invalid_workflow_state' using errcode = '22023';
  end if;

  select id, customer_id, customer_site_id, metering_point_id, contract_id
    into v_application
    from public.website_customer_applications
   where id = p_customer_application_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'customer_application_not_found' using errcode = 'P0002';
  end if;
  if v_application.customer_id is not null and v_application.customer_id <> p_customer_id then
    raise exception 'customer_application_customer_mismatch' using errcode = '23514';
  end if;

  if p_customer_site_id is not null and not exists (
    select 1 from public.customer_sites
     where id = p_customer_site_id and company_id = p_company_id and customer_id = p_customer_id
  ) then
    raise exception 'customer_site_scope_mismatch' using errcode = '23514';
  end if;
  if p_metering_point_id is not null and not exists (
    select 1 from public.metering_points
     where id = p_metering_point_id and company_id = p_company_id
       and customer_id = p_customer_id
       and (p_customer_site_id is null or site_id = p_customer_site_id)
  ) then
    raise exception 'metering_point_scope_mismatch' using errcode = '23514';
  end if;
  if p_contract_id is not null and not exists (
    select 1 from public.customer_contracts
     where id = p_contract_id and company_id = p_company_id and customer_id = p_customer_id
  ) then
    raise exception 'contract_scope_mismatch' using errcode = '23514';
  end if;
  if p_power_of_attorney_id is not null and not exists (
    select 1 from public.powers_of_attorney
     where id = p_power_of_attorney_id and company_id = p_company_id and customer_id = p_customer_id
       and coalesce(revoked_at, 'infinity'::timestamptz) > now()
       and (valid_from is null or valid_from <= now())
       and (valid_until is null or valid_until > now())
       and status in ('signed','accepted','active')
  ) then
    raise exception 'power_of_attorney_not_active' using errcode = '23514';
  end if;

  -- The response row and all references are now internally durable. Upsert the
  -- workflow in the same transaction and keep a stable operation id on retries.
  select id, operation_id into v_workflow_id, v_existing_operation_id
    from public.customer_application_workflows
   where company_id = p_company_id and customer_application_id = p_customer_application_id
   for update;

  if v_workflow_id is null then
    insert into public.customer_application_workflows (
      company_id, customer_application_id, customer_id, customer_site_id,
      metering_point_id, contract_id, operation_id, state, snapshot, updated_at
    ) values (
      p_company_id, p_customer_application_id, p_customer_id, p_customer_site_id,
      p_metering_point_id, p_contract_id, p_operation_id, v_final_state,
      v_snapshot || jsonb_build_object('commit_version', 'ops_final_completion_v1'), now()
    ) returning id, operation_id into v_workflow_id, v_existing_operation_id;
  else
    update public.customer_application_workflows
       set customer_id = p_customer_id,
           customer_site_id = p_customer_site_id,
           metering_point_id = p_metering_point_id,
           contract_id = p_contract_id,
           state = v_final_state,
           snapshot = coalesce(snapshot, '{}'::jsonb) || v_snapshot || jsonb_build_object('commit_version', 'ops_final_completion_v1'),
           failure_code = null,
           failure_detail_internal = null,
           completed_at = case when v_final_state = 'ready_for_switch' then now() else null end,
           updated_at = now()
     where id = v_workflow_id;
  end if;

  perform public.gridex_record_application_provisioning_step(
    p_company_id, p_customer_application_id, v_existing_operation_id,
    'workflow_committed', 'completed',
    jsonb_build_object(
      'workflow_id', v_workflow_id,
      'customer_id', p_customer_id,
      'customer_site_id', p_customer_site_id,
      'metering_point_id', p_metering_point_id,
      'contract_id', p_contract_id,
      'power_of_attorney_id', p_power_of_attorney_id,
      'state', v_final_state
    )
  );

  return query select v_existing_operation_id, v_final_state;
end;
$$;

revoke all on function public.gridex_record_application_provisioning_step(uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.gridex_record_application_provisioning_step(uuid,uuid,uuid,text,text,jsonb) to service_role;
revoke all on function public.gridex_commit_customer_application_provisioning(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.gridex_commit_customer_application_provisioning(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 2) Exact outbound route/certificate health. Runtime code performs the final
-- message-level check; these health rows surface configuration gaps before send.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_ops_health_checks_v2()
returns table(check_key text, status text, issue_count bigint, details jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  count_value bigint;
begin
  return query select * from public.gridex_ops_health_checks();

  if to_regclass('public.ediel_route_runtime_v') is null then
    return query select 'schema:ediel_route_runtime_v', 'blocking'::text, 1::bigint, jsonb_build_object('missing_relation','ediel_route_runtime_v');
    return;
  end if;

  execute $q$
    select count(*) from public.ediel_route_runtime_v
    where coalesce(is_enabled,false) = true
      and coalesce(communication_route_active,false) = true
      and (coalesce(receiver_ediel_id,'') = '' or coalesce(target_email,'') = '')
  $q$ into count_value;
  return query select 'route:receiver_or_mailbox_missing', case when count_value=0 then 'ok' else 'blocking' end, count_value, '{}'::jsonb;

  execute $q$
    select count(*) from public.ediel_route_runtime_v
    where coalesce(is_enabled,false) = true
      and coalesce(communication_route_active,false) = true
      and coalesce(subaddress_required,false) = true
      and coalesce(nullif(receiver_message_subaddress,''),nullif(receiver_subaddress,''),nullif(receiver_sub_address,'')) is null
  $q$ into count_value;
  return query select 'route:required_receiver_subaddress_missing', case when count_value=0 then 'ok' else 'blocking' end, count_value, '{}'::jsonb;

  if to_regclass('public.ediel_certificates') is not null then
    execute $q$
      select count(*) from public.ediel_route_runtime_v r
      left join public.ediel_certificates c on c.id = coalesce(r.receiver_certificate_id,r.certificate_id)
      where coalesce(r.is_enabled,false) = true
        and coalesce(r.communication_route_active,false) = true
        and (coalesce(r.certificate_required,false) = true or coalesce(r.encryption_mode,'') = 'smime')
        and (
          coalesce(r.receiver_certificate_id,r.certificate_id) is null
          or c.id is null
          or coalesce(c.status,'') not in ('valid','active')
          or (c.valid_from is not null and c.valid_from > now())
          or (c.valid_to is not null and c.valid_to <= now())
          or (c.environment is not null and c.environment <> r.environment)
          or (c.owner_ediel_id is not null and c.owner_ediel_id <> r.receiver_ediel_id)
        )
    $q$ into count_value;
    return query select 'route:receiver_certificate_invalid_or_missing', case when count_value=0 then 'ok' else 'blocking' end, count_value, '{}'::jsonb;
  end if;

  if to_regclass('public.customer_application_provisioning_steps') is not null then
    select count(*) into count_value
      from public.customer_application_workflows w
      left join public.customer_application_provisioning_steps s
        on s.company_id = w.company_id
       and s.customer_application_id = w.customer_application_id
       and s.operation_id = w.operation_id
       and s.step = 'workflow_committed'
       and s.status = 'completed'
     where w.state in ('pending_customer_data','ready_for_switch') and s.id is null;
    return query select 'workflow:missing_atomic_commit_marker', case when count_value=0 then 'ok' else 'blocking' end, count_value, '{}'::jsonb;
  end if;
end;
$$;

revoke all on function public.gridex_ops_health_checks_v2() from public, anon, authenticated;
grant execute on function public.gridex_ops_health_checks_v2() to service_role;

-- Persist the exact route contract used by an outbound send for audit and stale
-- reconciliation. The columns are additive and nullable for historical rows.
do $$
begin
  if to_regclass('public.ediel_outbox') is not null then
    alter table public.ediel_outbox add column if not exists route_contract_fingerprint text;
    alter table public.ediel_outbox add column if not exists route_contract_snapshot jsonb not null default '{}'::jsonb;
    create index if not exists ediel_outbox_route_contract_fingerprint_idx
      on public.ediel_outbox(company_id, route_contract_fingerprint)
      where route_contract_fingerprint is not null;
  end if;
end $$;

-- Atomic creation for a new delivery point and its first address. This prevents
-- a draft site from surviving when address persistence fails half-way through.
create or replace function public.gridex_create_customer_site_with_address(
  p_company_id uuid,
  p_customer_id uuid,
  p_site_name text,
  p_facility_id text,
  p_street text,
  p_postal_code text,
  p_city text,
  p_country text,
  p_address_normalized text,
  p_address_hash text,
  p_source text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id uuid;
  v_now timestamptz := now();
begin
  if p_address_hash is null or btrim(p_address_hash) = '' then
    raise exception 'address_hash_required' using errcode = '22023';
  end if;

  select id into v_site_id
    from public.customer_sites
   where company_id = p_company_id
     and customer_id = p_customer_id
     and address_hash = p_address_hash
     and coalesce(is_active, true) = true
   order by created_at asc
   limit 1
   for update;

  if v_site_id is not null then
    return v_site_id;
  end if;

  insert into public.customer_sites (
    company_id, customer_id, site_name, facility_id, site_type, status, is_active,
    street, postal_code, city, country, address_normalized, address_hash,
    address_source, address_received_at, address_status, address_quality_status,
    facility_data_status, resolution_status, metadata, created_at, updated_at
  ) values (
    p_company_id, p_customer_id, coalesce(nullif(btrim(p_site_name), ''), 'Anläggning'),
    nullif(btrim(p_facility_id), ''), 'consumption', 'draft', true,
    p_street, p_postal_code, p_city, coalesce(nullif(btrim(p_country), ''), 'SE'),
    p_address_normalized, p_address_hash, p_source, v_now, 'candidate', 'complete',
    'unverified', 'needs_review', coalesce(p_metadata, '{}'::jsonb), v_now, v_now
  ) returning id into v_site_id;

  insert into public.customer_addresses (
    company_id, customer_id, type, street_1, postal_code, city, country,
    is_active, metadata, created_at, updated_at
  ) values (
    p_company_id, p_customer_id, 'facility', p_street, p_postal_code, p_city,
    coalesce(nullif(btrim(p_country), ''), 'SE'), true,
    jsonb_build_object('customer_site_id', v_site_id, 'address_hash', p_address_hash, 'source', p_source),
    v_now, v_now
  );

  insert into public.customer_site_address_history (
    company_id, customer_id, customer_site_id, address_hash, source, snapshot
  ) values (
    p_company_id, p_customer_id, v_site_id, p_address_hash, p_source,
    jsonb_build_object('street', p_street, 'postal_code', p_postal_code, 'city', p_city, 'country', p_country, 'address_hash', p_address_hash)
  );

  return v_site_id;
end;
$$;
revoke all on function public.gridex_create_customer_site_with_address(uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.gridex_create_customer_site_with_address(uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb) to service_role;
