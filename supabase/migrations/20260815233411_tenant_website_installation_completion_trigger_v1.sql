begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local search_path = public, private, pg_catalog, extensions;

-- The first completion helper was intentionally service-role-only, but keeping a
-- public RPC would unnecessarily expand the generated Data API contract. The
-- durable mechanism is an internal trigger that completes evidence exactly when
-- the canonical provisioning flow marks a website client launch-ready.
drop function if exists public.gridex_complete_tenant_website_installation_v1(uuid,text,uuid);

create or replace function private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_receipt public.tenant_website_installation_receipts%rowtype;
  v_company public.companies%rowtype;
  v_auth record;
  v_feed record;
  v_offer_count integer := 0;
  v_completed_at timestamptz := now();
  v_evidence jsonb;
  v_sha text;
  v_origin text;
  v_contract_version text;
begin
  if new.profile_key is distinct from 'tenant_website'
     or new.status is distinct from 'active'
     or new.deleted_at is not null
     or new.revoked_at is not null
     or new.launch_ready is not true
     or jsonb_typeof(coalesce(new.launch_blockers,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(new.launch_blockers,'[]'::jsonb)) <> 0
     or coalesce(new.metadata->>'go_live_flow','') <> 'canonical_tenant_website_v2'
     or nullif(coalesce(new.metadata->>'provisioning_receipt_id',''),'') is null
  then
    return new;
  end if;

  select * into v_receipt
  from public.tenant_website_installation_receipts r
  where r.id::text = new.metadata->>'provisioning_receipt_id'
    and r.company_id = new.company_id
    and r.api_client_id = new.id
    and r.profile_key = 'tenant_website'
    and r.environment = coalesce(nullif(new.metadata->>'environment',''),'production')
  for update;

  if not found then
    raise exception using errcode='23514', message='TENANT_WEBSITE_RECEIPT_BINDING_INVALID';
  end if;

  if v_receipt.state='completed'
     and v_receipt.completed_at is not null
     and nullif(v_receipt.receipt_sha256,'') is not null
  then
    return new;
  end if;

  if v_receipt.state not in ('client_ready','credential_created','preflight_passed','feed_verified') then
    raise exception using errcode='23514', message='TENANT_WEBSITE_RECEIPT_NOT_COMPLETABLE';
  end if;

  select * into v_company from public.companies where id=new.company_id;
  if not found or v_company.status <> 'active' then
    raise exception using errcode='23514', message='TENANT_NOT_OPERATIONALLY_READY';
  end if;

  if not exists (
    select 1 from public.company_capabilities c
    where c.company_id=new.company_id
      and c.capability_code='api_sales'
      and c.enabled is true
      and c.readiness_status='ready'
  ) then
    raise exception using errcode='23514', message='TENANT_WEBSITE_API_SALES_NOT_READY';
  end if;

  if exists (
    select 1 from unnest(coalesce(v_receipt.scopes,'{}'::text[])) s
    where not (s=any(coalesce(new.scopes,'{}'::text[])))
  ) then
    raise exception using errcode='23514', message='TENANT_WEBSITE_SCOPE_DRIFT';
  end if;

  if exists (
    select 1 from unnest(coalesce(v_receipt.allowed_origins,'{}'::text[])) o
    where not (o=any(coalesce(new.allowed_origins,'{}'::text[])))
  ) or exists (
    select 1 from unnest(coalesce(new.allowed_origins,'{}'::text[])) o
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
    new.key_prefix,
    new.secret_hash,
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
  from public.public_contract_feed_fingerprint_v1(new.company_id,null,'website')
  limit 1;

  select count(*)::integer into v_offer_count
  from public.public_contract_offers o
  where o.company_id=new.company_id
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

  -- The currently served API release is persisted by the application into
  -- client metadata during provisioning when available. Fall back to the
  -- receipt version on revalidation, and finally to the minimum contract that
  -- introduced the canonical v2 go-live flow.
  v_contract_version := coalesce(
    nullif(new.metadata->>'contract_schema_version',''),
    nullif(v_receipt.contract_schema_version,''),
    '2026-08-14.1'
  );

  v_evidence := jsonb_build_object(
    'receipt_id',v_receipt.id,
    'company_id',new.company_id,
    'api_client_id',new.id,
    'tenant_reference',v_receipt.tenant_reference,
    'environment',v_receipt.environment,
    'profile_key',v_receipt.profile_key,
    'contract_schema_version',v_contract_version,
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
         contract_schema_version=v_contract_version,
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
    new.company_id,v_receipt.created_by,'tenant_website_installation_receipt',v_receipt.id,
    'tenant_website.installation_completed',
    jsonb_build_object('state',v_receipt.state,'contract_schema_version',v_receipt.contract_schema_version),
    jsonb_build_object('state','completed','contract_schema_version',v_contract_version,'receipt_sha256',v_sha),
    jsonb_build_object('feed_fingerprint',v_feed.fingerprint,'publication_revision',v_feed.publication_revision,'published_offer_count',v_offer_count,'auth_smoke','allowed','completion_source','launch_ready_trigger')
  );

  return new;
end
$function$;

revoke all on function private.gridex_complete_tenant_website_receipt_on_launch_ready_v1() from public, anon, authenticated;

drop trigger if exists integration_api_clients_tenant_website_receipt_completion on public.integration_api_clients;
create trigger integration_api_clients_tenant_website_receipt_completion
after update of launch_ready, launch_blockers, metadata, status on public.integration_api_clients
for each row
when (new.profile_key='tenant_website' and new.status='active' and new.launch_ready is true)
execute function private.gridex_complete_tenant_website_receipt_on_launch_ready_v1();

comment on function private.gridex_complete_tenant_website_receipt_on_launch_ready_v1() is
'Internal fail-closed completion of tenant website installation evidence after canonical launch readiness; verifies credential smoke, api_sales, scope/origin parity and published website feed before marking the receipt completed.';

commit;