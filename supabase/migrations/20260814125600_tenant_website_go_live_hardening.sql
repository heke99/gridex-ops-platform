-- Production-safe tenant website go-live/revalidation.
--
-- Goals:
--   * keep normal external API authentication fail-closed;
--   * make provisioning smoke possible before launch_ready/receipt/capability are complete;
--   * safely adopt exactly one legacy primary client that was paused only by the
--     canonical-readiness migration, without rotating its credential;
--   * never auto-reactivate manually paused, revoked, deleted or ambiguous clients;
--   * reset the installation receipt on an explicit revalidation run so a stale
--     completed receipt can never authorize a new launch without a fresh smoke.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local search_path = public, pg_catalog;

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
as $function$
declare
  v_environment text := coalesce(nullif(trim(p_environment),''), 'production');
  v_company public.companies%rowtype;
  v_client public.integration_api_clients%rowtype;
  v_active_count integer := 0;
  v_paused_count integer := 0;
  v_created boolean := false;
  v_adopted boolean := false;
  v_receipt_id uuid;
  v_previous_status text;
  v_previous_blockers jsonb;
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
  if coalesce(cardinality(p_allowed_origins),0) = 0 then
    raise exception using errcode='22023', message='TENANT_WEBSITE_ORIGINS_REQUIRED';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_allowed_origins,'{}'::text[])) origin
    where origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'
  ) then
    raise exception using errcode='22023', message='TENANT_WEBSITE_ORIGIN_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_company_id::text || ':tenant_website:' || v_environment, 0)
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

  -- One idempotency key identifies the canonical production installation. A
  -- new explicit provisioning/revalidation run resets proof fields before any
  -- credential is made executable. This prevents a historical completed receipt
  -- from authorizing a changed configuration.
  insert into public.tenant_website_installation_receipts(
    company_id, environment, profile_key, idempotency_key, state,
    tenant_reference, allowed_origins, scopes, readiness_blockers,
    receipt_sha256, failure_code, failure_message, created_by, completed_at
  ) values (
    p_company_id, v_environment, 'tenant_website', trim(p_idempotency_key),
    'company_ready', v_company.external_tenant_reference,
    coalesce(p_allowed_origins,'{}'::text[]), coalesce(p_scopes,'{}'::text[]),
    '[]'::jsonb, null, null, null, p_actor_user_id, null
  )
  on conflict (company_id, environment, profile_key, idempotency_key)
  do update set
    state = 'company_ready',
    tenant_reference = excluded.tenant_reference,
    allowed_origins = excluded.allowed_origins,
    scopes = excluded.scopes,
    readiness_blockers = '[]'::jsonb,
    receipt_sha256 = null,
    failure_code = null,
    failure_message = null,
    completed_at = null,
    updated_at = now()
  returning id into v_receipt_id;

  select count(*)::integer into v_active_count
  from public.integration_api_clients existing
  where existing.company_id = p_company_id
    and existing.profile_key = 'tenant_website'
    and existing.status = 'active'
    and existing.deleted_at is null
    and coalesce(nullif(existing.metadata->>'environment',''), 'production') = v_environment
    and lower(coalesce(existing.metadata->>'primary','true')) not in ('false','0','no');

  if v_active_count > 1 then
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

  if v_active_count = 1 then
    select * into v_client
    from public.integration_api_clients existing
    where existing.company_id = p_company_id
      and existing.profile_key = 'tenant_website'
      and existing.status = 'active'
      and existing.deleted_at is null
      and coalesce(nullif(existing.metadata->>'environment',''), 'production') = v_environment
      and lower(coalesce(existing.metadata->>'primary','true')) not in ('false','0','no')
    for update;

    if v_client.revoked_at is not null then
      update public.tenant_website_installation_receipts
         set state='failed',
             failure_code='TENANT_WEBSITE_ACTIVE_CLIENT_REVOKED',
             failure_message='The selected primary client has revocation evidence and cannot be reused.',
             readiness_blockers=jsonb_build_array(jsonb_build_object('code','api_client_revoked')),
             updated_at=now()
       where id=v_receipt_id;
      raise exception using errcode='23514', message='TENANT_WEBSITE_ACTIVE_CLIENT_REVOKED';
    end if;

    update public.integration_api_clients
       set scopes = (
             select array_agg(distinct scope order by scope)
             from unnest(coalesce(v_client.scopes,'{}'::text[]) || coalesce(p_scopes,'{}'::text[])) expanded(scope)
           ),
           allowed_origins = coalesce(p_allowed_origins,'{}'::text[]),
           rate_limit_per_minute = greatest(1,least(coalesce(p_rate_limit_per_minute,120),5000)),
           profile_key = 'tenant_website',
           launch_ready = false,
           launch_blockers = jsonb_build_array(jsonb_build_object('code','provisioning_preflight_pending')),
           metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
             'primary',true,
             'environment',v_environment,
             'provisioning_idempotency_key',trim(p_idempotency_key),
             'provisioning_receipt_id',v_receipt_id,
             'tenant_identity_source','api_key',
             'go_live_flow','canonical_tenant_website_v2'
           ),
           updated_at = now()
     where id = v_client.id
     returning * into v_client;

  else
    select count(*)::integer into v_paused_count
    from public.integration_api_clients existing
    where existing.company_id = p_company_id
      and existing.profile_key = 'tenant_website'
      and existing.status = 'paused'
      and existing.deleted_at is null
      and coalesce(nullif(existing.metadata->>'environment',''), 'production') = v_environment
      and lower(coalesce(existing.metadata->>'primary','true')) not in ('false','0','no');

    if v_paused_count > 1 then
      update public.tenant_website_installation_receipts
         set state='failed',
             failure_code='AMBIGUOUS_PAUSED_PRIMARY_TENANT_WEBSITE_CLIENT',
             failure_message='Multiple paused primary clients require explicit operator repair.',
             readiness_blockers=jsonb_build_array(jsonb_build_object(
               'code','ambiguous_paused_primary_tenant_website_client',
               'environment',v_environment
             )),
             updated_at=now()
       where id=v_receipt_id;
      raise exception using errcode='23505', message='AMBIGUOUS_PAUSED_PRIMARY_TENANT_WEBSITE_CLIENT';
    end if;

    if v_paused_count = 1 then
      select * into v_client
      from public.integration_api_clients existing
      where existing.company_id = p_company_id
        and existing.profile_key = 'tenant_website'
        and existing.status = 'paused'
        and existing.deleted_at is null
        and coalesce(nullif(existing.metadata->>'environment',''), 'production') = v_environment
        and lower(coalesce(existing.metadata->>'primary','true')) not in ('false','0','no')
      for update;

      v_previous_status := v_client.status;
      v_previous_blockers := coalesce(v_client.launch_blockers,'[]'::jsonb);

      -- Auto-adoption is deliberately narrow. A paused credential may be reused
      -- only when every blocker is one of the canonical-readiness migration/
      -- revalidation blockers and at least one such blocker exists. Manual pause,
      -- revocation, deletion, unknown blocker shapes, or mixed blocker reasons
      -- require explicit operator review.
      if v_client.revoked_at is not null
         or jsonb_typeof(v_previous_blockers) <> 'array'
         or jsonb_array_length(v_previous_blockers) = 0
         or not exists (
           select 1
           from jsonb_array_elements(v_previous_blockers) blocker
           where coalesce(blocker->>'code','') in (
             'canonical_readiness_required',
             'canonical_readiness_revalidation_required',
             'canonical_readiness_revalidation_pending'
           )
         )
         or exists (
           select 1
           from jsonb_array_elements(v_previous_blockers) blocker
           where coalesce(blocker->>'code','') not in (
             'canonical_readiness_required',
             'canonical_readiness_revalidation_required',
             'canonical_readiness_revalidation_pending'
           )
         )
      then
        update public.tenant_website_installation_receipts
           set state='failed',
               failure_code='TENANT_WEBSITE_PAUSED_CLIENT_REQUIRES_OPERATOR_REVIEW',
               failure_message='Paused primary client was not paused solely by canonical readiness migration/revalidation.',
               readiness_blockers=jsonb_build_array(jsonb_build_object(
                 'code','paused_client_requires_operator_review',
                 'api_client_id',v_client.id
               )),
               updated_at=now()
         where id=v_receipt_id;
        raise exception using errcode='23514', message='TENANT_WEBSITE_PAUSED_CLIENT_REQUIRES_OPERATOR_REVIEW';
      end if;

      update public.integration_api_clients
         set status = 'active',
             scopes = (
               select array_agg(distinct scope order by scope)
               from unnest(coalesce(v_client.scopes,'{}'::text[]) || coalesce(p_scopes,'{}'::text[])) expanded(scope)
             ),
             allowed_origins = coalesce(p_allowed_origins,'{}'::text[]),
             rate_limit_per_minute = greatest(1,least(coalesce(p_rate_limit_per_minute,120),5000)),
             profile_key = 'tenant_website',
             launch_ready = false,
             launch_blockers = jsonb_build_array(jsonb_build_object('code','provisioning_preflight_pending')),
             metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
               'primary',true,
               'environment',v_environment,
               'provisioning_idempotency_key',trim(p_idempotency_key),
               'provisioning_receipt_id',v_receipt_id,
               'tenant_identity_source','api_key',
               'go_live_flow','canonical_tenant_website_v2',
               'canonical_readiness_adopted_at',now(),
               'canonical_readiness_adopted_by',p_actor_user_id
             ),
             updated_at = now()
       where id = v_client.id
       returning * into v_client;

      v_adopted := true;
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
          'go_live_flow','canonical_tenant_website_v2',
          'token_display','shown_once_on_create'
        )
      )
      returning * into v_client;
      v_created := true;
    end if;
  end if;

  update public.tenant_website_installation_receipts
     set api_client_id=v_client.id,
         state=case when v_created then 'credential_created' else 'client_ready' end,
         updated_at=now()
   where id=v_receipt_id;

  if v_adopted then
    insert into public.audit_logs(
      company_id, actor_user_id, entity_type, entity_id, action,
      old_values, new_values, metadata
    ) values (
      p_company_id,
      p_actor_user_id,
      'integration_api_client',
      v_client.id,
      'api_client.canonical_readiness_adopted',
      jsonb_build_object(
        'status',v_previous_status,
        'launch_blockers',v_previous_blockers
      ),
      jsonb_build_object(
        'status','active',
        'launch_ready',false,
        'launch_blockers',jsonb_build_array(jsonb_build_object('code','provisioning_preflight_pending'))
      ),
      jsonb_build_object(
        'environment',v_environment,
        'receipt_id',v_receipt_id,
        'credential_rotated',false,
        'reason','canonical_readiness_revalidation'
      )
    );
  end if;

  return query select
    v_client.id,
    v_created,
    v_company.external_tenant_reference,
    v_receipt_id,
    case when v_created then 'credential_created' else 'client_ready' end;
end
$function$;

revoke all on function public.gridex_provision_tenant_website_client_v1(
  uuid,text,text,text,text,text[],text[],integer,uuid,text
) from public, anon, authenticated;
grant execute on function public.gridex_provision_tenant_website_client_v1(
  uuid,text,text,text,text,text[],text[],integer,uuid,text
) to service_role;

-- Compatibility bridge for the current application-level provisioning smoke
-- caller. Normal API requests still require launch_ready + completed receipt +
-- api_sales readiness. Only the internal synthetic route prefix may bypass those
-- final launch gates, and only while the exact receipt linked in the API-client
-- metadata belongs to that same client/company and is in a provisioning state.
create or replace function public.authenticate_integration_request_v1(
  p_key_prefix text,
  p_secret_hash text,
  p_route text,
  p_required_all text[] default array[]::text[],
  p_required_any text[] default array[]::text[],
  p_client_ip text default null,
  p_origin text default null,
  p_rate_limit_cost integer default 1,
  p_window_seconds integer default 60
)
returns table(
  auth_outcome text,
  error_code text,
  tenant_status text,
  client_id uuid,
  company_id uuid,
  client_name text,
  client_status text,
  key_prefix text,
  scopes text[],
  allowed_ips text[],
  allowed_origins text[],
  metadata jsonb,
  rate_limit_per_minute integer,
  expires_at timestamptz,
  request_count integer,
  route_limit integer,
  reset_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $function$
  with auth as (
    select *
    from public.authenticate_integration_request_v1_credential_core(
      p_key_prefix,p_secret_hash,p_route,p_required_all,p_required_any,
      p_client_ip,p_origin,p_rate_limit_cost,p_window_seconds
    )
  ), readiness as (
    select
      auth.*,
      exists (
        select 1
        from public.integration_api_clients client
        where client.id=auth.client_id
          and client.company_id=auth.company_id
          and client.launch_ready is true
          and jsonb_typeof(coalesce(client.launch_blockers,'[]'::jsonb))='array'
          and jsonb_array_length(coalesce(client.launch_blockers,'[]'::jsonb))=0
      ) as client_ready,
      exists (
        select 1
        from public.tenant_website_installation_receipts receipt
        where receipt.api_client_id=auth.client_id
          and receipt.company_id=auth.company_id
          and receipt.state='completed'
          and receipt.completed_at is not null
          and nullif(receipt.receipt_sha256,'') is not null
      ) as receipt_ready,
      exists (
        select 1
        from public.company_capabilities capability
        where capability.company_id=auth.company_id
          and capability.capability_code='api_sales'
          and capability.enabled is true
          and capability.readiness_status='ready'
      ) as capability_ready,
      exists (
        select 1
        from public.tenant_website_installation_receipts receipt
        where p_route like 'provisioning-smoke:%'
          and receipt.id::text = nullif(auth.metadata->>'provisioning_receipt_id','')
          and receipt.api_client_id=auth.client_id
          and receipt.company_id=auth.company_id
          and receipt.profile_key='tenant_website'
          and receipt.state in (
            'client_ready','credential_created','preflight_passed','feed_verified','failed'
          )
      ) as provisioning_smoke_ready
    from auth
  )
  select
    case
      when readiness.auth_outcome<>'allowed' then readiness.auth_outcome
      when p_route like 'provisioning-smoke:%' and readiness.provisioning_smoke_ready then 'allowed'
      when p_route like 'provisioning-smoke:%' then 'denied'
      when readiness.client_ready and readiness.receipt_ready and readiness.capability_ready then 'allowed'
      else 'denied'
    end,
    case
      when readiness.auth_outcome<>'allowed' then readiness.error_code
      when p_route like 'provisioning-smoke:%' and not readiness.provisioning_smoke_ready then 'provisioning_smoke_receipt_invalid'
      when p_route like 'provisioning-smoke:%' then null
      when not readiness.client_ready then 'api_client_not_launch_ready'
      when not readiness.receipt_ready then 'integration_receipt_not_verified'
      when not readiness.capability_ready then 'integration_capability_not_ready'
      else null
    end,
    readiness.tenant_status,
    readiness.client_id,
    readiness.company_id,
    readiness.client_name,
    readiness.client_status,
    readiness.key_prefix,
    readiness.scopes,
    readiness.allowed_ips,
    readiness.allowed_origins,
    readiness.metadata,
    readiness.rate_limit_per_minute,
    readiness.expires_at,
    readiness.request_count,
    readiness.route_limit,
    readiness.reset_at
  from readiness
$function$;

revoke all on function public.authenticate_integration_request_v1(
  text,text,text,text[],text[],text,text,integer,integer
) from public, anon, authenticated;
grant execute on function public.authenticate_integration_request_v1(
  text,text,text,text[],text[],text,text,integer,integer
) to service_role;

comment on function public.gridex_provision_tenant_website_client_v1(
  uuid,text,text,text,text,text[],text[],integer,uuid,text
) is 'Canonical tenant website go-live/revalidation v2. Safely adopts only canonical-readiness-paused primary clients; manual pause/revocation remains fail-closed.';

comment on function public.authenticate_integration_request_v1(
  text,text,text,text[],text[],text,text,integer,integer
) is 'Atomic integration auth. Normal traffic requires launch readiness, verified receipt and api_sales; bounded provisioning-smoke routes require an exact in-progress receipt.';

commit;
