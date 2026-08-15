begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local search_path = public, pg_catalog, extensions;

create or replace function public.gridex_complete_tenant_website_installation_v1(
  p_receipt_id uuid,
  p_contract_schema_version text,
  p_actor_user_id uuid
)
returns table(
  receipt_id uuid,
  installation_state text,
  receipt_sha256 text,
  publication_revision bigint,
  feed_fingerprint text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_receipt public.tenant_website_installation_receipts%rowtype;
  v_client public.integration_api_clients%rowtype;
  v_company public.companies%rowtype;
  v_auth record;
  v_feed record;
  v_offer_count integer := 0;
  v_completed_at timestamptz := now();
  v_evidence jsonb;
  v_sha text;
  v_origin text;
begin
  if p_receipt_id is null or p_actor_user_id is null then
    raise exception using errcode='22023', message='TENANT_WEBSITE_COMPLETION_CONTEXT_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_contract_schema_version,'')),'') is null then
    raise exception using errcode='22023', message='TENANT_WEBSITE_CONTRACT_SCHEMA_VERSION_REQUIRED';
  end if;

  select * into v_receipt
  from public.tenant_website_installation_receipts
  where id=p_receipt_id
  for update;

  if not found then
    raise exception using errcode='P0002', message='TENANT_WEBSITE_RECEIPT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_receipt.company_id::text || ':tenant_website:' || v_receipt.environment, 0)
  );

  if v_receipt.profile_key <> 'tenant_website'
     or v_receipt.state not in ('client_ready','credential_created','preflight_passed','feed_verified','completed')
  then
    raise exception using errcode='23514', message='TENANT_WEBSITE_RECEIPT_NOT_COMPLETABLE';
  end if;

  if v_receipt.state='completed'
     and v_receipt.completed_at is not null
     and nullif(v_receipt.receipt_sha256,'') is not null
     and v_receipt.contract_schema_version=trim(p_contract_schema_version)
  then
    return query select v_receipt.id, v_receipt.state, v_receipt.receipt_sha256,
      (select f.publication_revision from public.public_contract_feed_fingerprint_v1(v_receipt.company_id,null,'website') f limit 1),
      (select f.fingerprint from public.public_contract_feed_fingerprint_v1(v_receipt.company_id,null,'website') f limit 1);
    return;
  end if;

  select * into v_company
  from public.companies
  where id=v_receipt.company_id
  for update;

  if not found or v_company.status <> 'active' then
    raise exception using errcode='23514', message='TENANT_NOT_OPERATIONALLY_READY';
  end if;

  select * into v_client
  from public.integration_api_clients
  where id=v_receipt.api_client_id and company_id=v_receipt.company_id
  for update;

  if not found
     or v_client.profile_key <> 'tenant_website'
     or v_client.status <> 'active'
     or v_client.deleted_at is not null
     or v_client.revoked_at is not null
     or v_client.launch_ready is not true
     or jsonb_typeof(coalesce(v_client.launch_blockers,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(v_client.launch_blockers,'[]'::jsonb)) <> 0
     or coalesce(v_client.metadata->>'go_live_flow','') <> 'canonical_tenant_website_v2'
     or coalesce(v_client.metadata->>'provisioning_receipt_id','') <> v_receipt.id::text
  then
    raise exception using errcode='23514', message='TENANT_WEBSITE_CLIENT_NOT_LAUNCH_READY';
  end if;

  if not exists (
    select 1 from public.company_capabilities c
    where c.company_id=v_receipt.company_id
      and c.capability_code='api_sales'
      and c.enabled is true
      and c.readiness_status='ready'
  ) then
    raise exception using errcode='23514', message='TENANT_WEBSITE_API_SALES_NOT_READY';
  end if;

  if exists (
    select 1 from unnest(coalesce(v_receipt.scopes,'{}'::text[])) s
    where not (s=any(coalesce(v_client.scopes,'{}'::text[])))
  ) then
    raise exception using errcode='23514', message='TENANT_WEBSITE_SCOPE_DRIFT';
  end if;

  if exists (
    select 1 from unnest(coalesce(v_receipt.allowed_origins,'{}'::text[])) o
    where not (o=any(coalesce(v_client.allowed_origins,'{}'::text[])))
  ) or exists (
    select 1 from unnest(coalesce(v_client.allowed_origins,'{}'::text[])) o
    where not (o=any(coalesce(v_receipt.allowed_origins,'{}'::text[])))
  ) then
    raise exception using errcode='23514', message='TENANT_WEBSITE_ORIGIN_DRIFT';
  end if;

  v_origin := v_receipt.allowed_origins[1];
  if nullif(v_origin,'') is null then
    raise exception using errcode='23514', message='TENANT_WEBSITE_ORIGIN_REQUIRED';
  end if;

  select * into v_auth
  from public.authenticate_provisioning_smoke_request_v1(
    v_client.key_prefix,
    v_client.secret_hash,
    v_receipt.id,
    'provisioning-smoke:/api/v1/integration/context',
    array['integration_context.read']::text[],
    '{}'::text[],
    null,
    v_origin,
    0,
    60
  ) limit 1;

  if v_auth.auth_outcome is distinct from 'allowed' or v_auth.error_code is not null then
    raise exception using errcode='23514', message='TENANT_WEBSITE_PROVISIONING_SMOKE_FAILED', detail=coalesce(v_auth.error_code,'unknown');
  end if;

  update public.tenant_website_installation_receipts
     set state='preflight_passed', readiness_blockers='[]'::jsonb,
         failure_code=null, failure_message=null, updated_at=now()
   where id=v_receipt.id;

  select * into v_feed
  from public.public_contract_feed_fingerprint_v1(v_receipt.company_id,null,'website')
  limit 1;

  select count(*)::integer into v_offer_count
  from public.public_contract_offers o
  where o.company_id=v_receipt.company_id
    and o.publication_status='published'
    and o.is_public is true
    and o.website_enabled is true
    and o.website_cta_enabled is true
    and coalesce(o.is_archived,false) is false;

  if v_feed.fingerprint is null
     or coalesce(v_feed.publication_revision,0) <= 0
     or v_offer_count <= 0
  then
    raise exception using errcode='23514', message='TENANT_WEBSITE_PUBLIC_CONTRACT_FEED_NOT_READY';
  end if;

  update public.tenant_website_installation_receipts
     set state='feed_verified', updated_at=now()
   where id=v_receipt.id;

  v_evidence := jsonb_build_object(
    'receipt_id',v_receipt.id,
    'company_id',v_receipt.company_id,
    'api_client_id',v_client.id,
    'tenant_reference',v_receipt.tenant_reference,
    'environment',v_receipt.environment,
    'profile_key',v_receipt.profile_key,
    'contract_schema_version',trim(p_contract_schema_version),
    'auth_smoke','allowed',
    'auth_route','/api/v1/integration/context',
    'feed_fingerprint',v_feed.fingerprint,
    'publication_revision',v_feed.publication_revision,
    'published_offer_count',v_offer_count,
    'scopes',to_jsonb(v_receipt.scopes),
    'allowed_origins',to_jsonb(v_receipt.allowed_origins),
    'completed_at',v_completed_at
  );

  v_sha := encode(extensions.digest(convert_to(v_evidence::text,'UTF8'),'sha256'),'hex');

  update public.tenant_website_installation_receipts
     set state='completed',
         contract_schema_version=trim(p_contract_schema_version),
         readiness_blockers='[]'::jsonb,
         receipt_sha256=v_sha,
         failure_code=null,
         failure_message=null,
         completed_at=v_completed_at,
         updated_at=v_completed_at
   where id=v_receipt.id;

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values (
    v_receipt.company_id,p_actor_user_id,'tenant_website_installation_receipt',v_receipt.id,
    'tenant_website.installation_completed',
    jsonb_build_object('state',v_receipt.state,'contract_schema_version',v_receipt.contract_schema_version),
    jsonb_build_object('state','completed','contract_schema_version',trim(p_contract_schema_version),'receipt_sha256',v_sha),
    jsonb_build_object('feed_fingerprint',v_feed.fingerprint,'publication_revision',v_feed.publication_revision,'published_offer_count',v_offer_count,'auth_smoke','allowed')
  );

  return query select v_receipt.id,'completed'::text,v_sha,v_feed.publication_revision,v_feed.fingerprint;
end
$function$;

revoke all on function public.gridex_complete_tenant_website_installation_v1(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.gridex_complete_tenant_website_installation_v1(uuid,text,uuid) to service_role;
comment on function public.gridex_complete_tenant_website_installation_v1(uuid,text,uuid) is
'Atomically completes canonical tenant website installation after credential smoke, launch readiness, api_sales readiness, scope/origin parity, and non-empty published website feed verification.';

commit;