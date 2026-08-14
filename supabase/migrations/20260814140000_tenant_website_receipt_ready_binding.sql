-- Bind normal-traffic receipt_ready to the client's current
-- metadata.provisioning_receipt_id when present. A historical completed receipt
-- left behind after revalidation with a new idempotency key must not authorize
-- API traffic once the client points at a newer receipt.
--
-- Legacy clients that became launch-ready before provisioning_receipt_id was
-- written keep the previous any-completed-receipt behavior only while that
-- metadata key is absent.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local search_path = public, pg_catalog;

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
          and receipt.profile_key='tenant_website'
          and receipt.state='completed'
          and receipt.completed_at is not null
          and nullif(receipt.receipt_sha256,'') is not null
          and (
            receipt.id::text = nullif(auth.metadata->>'provisioning_receipt_id','')
            or (
              nullif(auth.metadata->>'provisioning_receipt_id','') is null
            )
          )
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

comment on function public.authenticate_integration_request_v1(
  text,text,text,text[],text[],text,text,integer,integer
) is 'Atomic integration auth. Normal traffic requires launch readiness, the metadata-linked completed receipt when present (else a legacy completed receipt) and api_sales; bounded provisioning-smoke routes require the exact in-progress receipt.';

commit;
