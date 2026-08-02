-- Idempotent tenant website integration receipts and duplicate-primary guards.
-- Existing duplicate clients are not silently revoked. An explicit repair RPC
-- requires the operator to choose the credential that remains active.

create table if not exists public.tenant_website_installation_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  api_client_id uuid references public.integration_api_clients(id) on delete set null,
  environment text not null default 'production'
    check (environment in ('development','staging','production')),
  profile_key text not null default 'tenant_website'
    check (profile_key = 'tenant_website'),
  idempotency_key text not null,
  state text not null
    check (state in (
      'requested','company_ready','client_ready','credential_created',
      'preflight_passed','feed_verified','completed','failed'
    )),
  tenant_reference text,
  contract_schema_version text,
  allowed_origins text[] not null default '{}'::text[],
  scopes text[] not null default '{}'::text[],
  readiness_blockers jsonb not null default '[]'::jsonb,
  receipt_sha256 text,
  failure_code text,
  failure_message text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(company_id, environment, profile_key, idempotency_key)
);

alter table public.tenant_website_installation_receipts enable row level security;
revoke all on public.tenant_website_installation_receipts from public;
revoke all on public.tenant_website_installation_receipts from anon;
revoke all on public.tenant_website_installation_receipts from authenticated;
grant select, insert, update on public.tenant_website_installation_receipts to service_role;

create index if not exists tenant_website_installation_receipts_company_state_idx
  on public.tenant_website_installation_receipts(company_id, environment, state, updated_at desc);

create or replace function public.gridex_guard_primary_tenant_website_client_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_environment text;
  v_primary boolean;
begin
  v_environment := coalesce(nullif(new.metadata->>'environment',''), 'production');
  perform pg_advisory_xact_lock(
    hashtextextended(
      new.company_id::text || ':tenant_website:' || v_environment,
      0
    )
  );

  v_primary := coalesce(
    case
      when lower(coalesce(new.metadata->>'primary','true')) in ('true','1','yes') then true
      when lower(coalesce(new.metadata->>'primary','true')) in ('false','0','no') then false
      else true
    end,
    true
  );

  if new.profile_key = 'tenant_website'
     and new.status = 'active'
     and new.deleted_at is null
     and v_primary
     and exists (
       select 1
       from public.integration_api_clients existing
       where existing.company_id = new.company_id
         and existing.id is distinct from new.id
         and existing.profile_key = 'tenant_website'
         and existing.status = 'active'
         and existing.deleted_at is null
         and coalesce(nullif(existing.metadata->>'environment',''), 'production') = v_environment
         and lower(coalesce(existing.metadata->>'primary','true')) not in ('false','0','no')
     )
  then
    raise exception using
      errcode = '23505',
      message = 'DUPLICATE_PRIMARY_TENANT_WEBSITE_CLIENT',
      detail = format('company_id=%s environment=%s', new.company_id, v_environment);
  end if;

  return new;
end;
$$;

revoke execute on function public.gridex_guard_primary_tenant_website_client_v1()
  from public, anon, authenticated;
grant execute on function public.gridex_guard_primary_tenant_website_client_v1()
  to service_role;

drop trigger if exists integration_api_clients_primary_tenant_website_guard
  on public.integration_api_clients;
create trigger integration_api_clients_primary_tenant_website_guard
before insert or update of company_id, profile_key, status, deleted_at, metadata
on public.integration_api_clients
for each row execute function public.gridex_guard_primary_tenant_website_client_v1();

create or replace function public.gridex_repair_duplicate_primary_website_client_v1(
  p_company_id uuid,
  p_environment text,
  p_keep_client_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_environment text := coalesce(nullif(trim(p_environment),''), 'production');
  v_paused_ids uuid[];
begin
  if p_company_id is null or p_keep_client_id is null or p_actor_user_id is null then
    raise exception using errcode='22023', message='DUPLICATE_CLIENT_REPAIR_INPUT_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception using errcode='22023', message='DUPLICATE_CLIENT_REPAIR_REASON_REQUIRED';
  end if;

  perform 1
  from public.integration_api_clients keep_client
  where keep_client.id = p_keep_client_id
    and keep_client.company_id = p_company_id
    and keep_client.profile_key = 'tenant_website'
    and keep_client.status = 'active'
    and keep_client.deleted_at is null
    and coalesce(nullif(keep_client.metadata->>'environment',''), 'production') = v_environment
  for update;
  if not found then
    raise exception using errcode='P0002', message='PRIMARY_TENANT_WEBSITE_CLIENT_NOT_FOUND';
  end if;

  with paused as (
    update public.integration_api_clients duplicate_client
       set status = 'paused',
           launch_ready = false,
           launch_blockers = coalesce(duplicate_client.launch_blockers, '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object(
                  'code','duplicate_primary_client_repaired',
                  'kept_client_id',p_keep_client_id,
                  'reason',trim(p_reason)
                )),
           metadata = coalesce(duplicate_client.metadata, '{}'::jsonb)
             || jsonb_build_object(
                  'primary',false,
                  'duplicate_repair_kept_client_id',p_keep_client_id,
                  'duplicate_repair_actor_user_id',p_actor_user_id,
                  'duplicate_repair_reason',trim(p_reason),
                  'duplicate_repaired_at',now()
                ),
           updated_at = now()
     where duplicate_client.company_id = p_company_id
       and duplicate_client.id <> p_keep_client_id
       and duplicate_client.profile_key = 'tenant_website'
       and duplicate_client.status = 'active'
       and duplicate_client.deleted_at is null
       and coalesce(nullif(duplicate_client.metadata->>'environment',''), 'production') = v_environment
     returning duplicate_client.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_paused_ids from paused;

  update public.integration_api_clients
     set metadata = coalesce(metadata, '{}'::jsonb)
       || jsonb_build_object(
            'primary',true,
            'environment',v_environment,
            'duplicate_repair_actor_user_id',p_actor_user_id,
            'duplicate_repair_reason',trim(p_reason),
            'duplicate_repaired_at',now()
          ),
         updated_at = now()
   where id = p_keep_client_id;

  insert into public.audit_logs(
    company_id, actor_user_id, entity_type, entity_id, action,
    old_values, new_values, metadata
  ) values (
    p_company_id, p_actor_user_id, 'integration_api_client', p_keep_client_id,
    'api_client.duplicate_primary_repaired', null, null,
    jsonb_build_object(
      'environment',v_environment,
      'kept_client_id',p_keep_client_id,
      'paused_client_ids',to_jsonb(v_paused_ids),
      'reason',trim(p_reason)
    )
  );

  return jsonb_build_object(
    'company_id',p_company_id,
    'environment',v_environment,
    'kept_client_id',p_keep_client_id,
    'paused_client_ids',to_jsonb(v_paused_ids)
  );
end;
$$;

revoke execute on function public.gridex_repair_duplicate_primary_website_client_v1(uuid,text,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.gridex_repair_duplicate_primary_website_client_v1(uuid,text,uuid,uuid,text)
  to service_role;

create or replace function public.gridex_provision_tenant_website_client_v1(
  p_company_id uuid,
  p_environment text,
  p_client_name text,
  p_key_prefix text,
  p_secret_hash text,
  p_scopes text[],
  p_allowed_origins text[],
  p_rate_limit_per_minute integer,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns table(
  api_client_id uuid,
  client_created boolean,
  tenant_reference text,
  receipt_id uuid,
  installation_state text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_environment text := coalesce(nullif(trim(p_environment),''), 'production');
  v_company public.companies%rowtype;
  v_client public.integration_api_clients%rowtype;
  v_existing_count integer;
  v_created boolean := false;
  v_receipt_id uuid;
begin
  if p_company_id is null or p_actor_user_id is null then
    raise exception using errcode='22023', message='TENANT_WEBSITE_PROVISIONING_CONTEXT_REQUIRED';
  end if;
  if v_environment not in ('development','staging','production') then
    raise exception using errcode='22023', message='TENANT_WEBSITE_ENVIRONMENT_INVALID';
  end if;
  if nullif(trim(coalesce(p_idempotency_key,'')),'') is null then
    raise exception using errcode='22023', message='TENANT_WEBSITE_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if coalesce(cardinality(p_scopes),0) = 0 then
    raise exception using errcode='22023', message='TENANT_WEBSITE_SCOPES_REQUIRED';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_allowed_origins,'{}'::text[])) origin
    where origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'
  ) then
    raise exception using errcode='22023', message='TENANT_WEBSITE_ORIGIN_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_company_id::text || ':tenant_website:' || v_environment,
      0
    )
  );

  select * into v_company
  from public.companies
  where id = p_company_id
  for update;
  if not found then
    raise exception using errcode='P0002', message='TENANT_NOT_FOUND';
  end if;
  if v_company.status not in ('active','onboarding') then
    raise exception using errcode='23514', message='TENANT_NOT_OPERATIONALLY_READY';
  end if;

  if nullif(trim(coalesce(v_company.external_tenant_reference,'')),'') is null then
    update public.companies
       set external_tenant_reference = 'tenant_' || substr(
             encode(extensions.digest(p_company_id::text,'sha256'),'hex'),
             1,
             36
           ),
           updated_at = now()
     where id = p_company_id
     returning * into v_company;
  end if;

  insert into public.tenant_website_installation_receipts(
    company_id, environment, profile_key, idempotency_key, state,
    tenant_reference, allowed_origins, scopes, created_by
  ) values (
    p_company_id, v_environment, 'tenant_website', trim(p_idempotency_key),
    'company_ready', v_company.external_tenant_reference,
    coalesce(p_allowed_origins,'{}'::text[]), coalesce(p_scopes,'{}'::text[]),
    p_actor_user_id
  )
  on conflict (company_id, environment, profile_key, idempotency_key)
  do update set
    tenant_reference = excluded.tenant_reference,
    allowed_origins = excluded.allowed_origins,
    scopes = excluded.scopes,
    updated_at = now()
  returning id into v_receipt_id;

  select count(*)::integer into v_existing_count
  from public.integration_api_clients existing
  where existing.company_id = p_company_id
    and existing.profile_key = 'tenant_website'
    and existing.status = 'active'
    and existing.deleted_at is null
    and coalesce(nullif(existing.metadata->>'environment',''), 'production') = v_environment
    and lower(coalesce(existing.metadata->>'primary','true')) not in ('false','0','no');

  if v_existing_count > 1 then
    update public.tenant_website_installation_receipts
       set state='failed',
           failure_code='DUPLICATE_PRIMARY_TENANT_WEBSITE_CLIENT',
           failure_message='Explicit duplicate-client repair is required.',
           readiness_blockers=jsonb_build_array(jsonb_build_object(
             'code','duplicate_primary_tenant_website_client',
             'environment',v_environment
           )),
           updated_at=now()
     where id=v_receipt_id;
    raise exception using errcode='23505', message='DUPLICATE_PRIMARY_TENANT_WEBSITE_CLIENT';
  end if;

  if v_existing_count = 1 then
    select * into v_client
    from public.integration_api_clients existing
    where existing.company_id = p_company_id
      and existing.profile_key = 'tenant_website'
      and existing.status = 'active'
      and existing.deleted_at is null
      and coalesce(nullif(existing.metadata->>'environment',''), 'production') = v_environment
      and lower(coalesce(existing.metadata->>'primary','true')) not in ('false','0','no')
    for update;

    update public.integration_api_clients
       set scopes = (
             select array_agg(distinct scope order by scope)
             from unnest(coalesce(v_client.scopes,'{}'::text[]) || coalesce(p_scopes,'{}'::text[])) as expanded(scope)
           ),
           allowed_origins = coalesce(p_allowed_origins,'{}'::text[]),
           profile_key = 'tenant_website',
           launch_ready = false,
           launch_blockers = jsonb_build_array(jsonb_build_object(
             'code','provisioning_preflight_pending'
           )),
           metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
             'primary',true,
             'environment',v_environment,
             'provisioning_idempotency_key',trim(p_idempotency_key),
             'provisioning_receipt_id',v_receipt_id,
             'tenant_identity_source','api_key'
           ),
           updated_at = now()
     where id = v_client.id
     returning * into v_client;
  else
    if nullif(trim(coalesce(p_key_prefix,'')),'') is null
       or nullif(trim(coalesce(p_secret_hash,'')),'') is null then
      raise exception using errcode='22023', message='TENANT_WEBSITE_CREDENTIAL_MATERIAL_REQUIRED';
    end if;

    insert into public.integration_api_clients(
      company_id, name, status, key_prefix, secret_hash, scopes,
      allowed_origins, allowed_ips, rate_limit_per_minute, created_by,
      permission_groups, purpose_label, profile_key, launch_ready,
      launch_blockers, metadata
    ) values (
      p_company_id,
      coalesce(nullif(trim(p_client_name),''),'Tenant website integration'),
      'active', trim(p_key_prefix), trim(p_secret_hash),
      coalesce(p_scopes,'{}'::text[]), coalesce(p_allowed_origins,'{}'::text[]),
      '{}'::text[], greatest(1,least(coalesce(p_rate_limit_per_minute,120),5000)),
      p_actor_user_id, '{}'::text[], 'Tenant website', 'tenant_website', false,
      jsonb_build_array(jsonb_build_object('code','provisioning_preflight_pending')),
      jsonb_build_object(
        'primary',true,
        'environment',v_environment,
        'provisioning_idempotency_key',trim(p_idempotency_key),
        'provisioning_receipt_id',v_receipt_id,
        'tenant_identity_source','api_key',
        'token_display','shown_once_on_create'
      )
    )
    returning * into v_client;
    v_created := true;
  end if;

  update public.tenant_website_installation_receipts
     set api_client_id=v_client.id,
         state=case when v_created then 'credential_created' else 'client_ready' end,
         updated_at=now()
   where id=v_receipt_id;

  return query select
    v_client.id,
    v_created,
    v_company.external_tenant_reference,
    v_receipt_id,
    case when v_created then 'credential_created' else 'client_ready' end;
end;
$$;

revoke execute on function public.gridex_provision_tenant_website_client_v1(uuid,text,text,text,text,text[],text[],integer,uuid,text)
  from public, anon, authenticated;
grant execute on function public.gridex_provision_tenant_website_client_v1(uuid,text,text,text,text,text[],text[],integer,uuid,text)
  to service_role;
