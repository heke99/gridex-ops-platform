BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';

-- Additive service-only boundary. Legacy canonical invitation semantics stay
-- unchanged; the independent portal must supply its verified configuration
-- snapshot, which is rechecked under locks before any access materialization.
CREATE FUNCTION public.gridex_accept_staff_invitation_v1(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $staff_onboarding$
DECLARE
  v_company_id uuid := nullif(p_command->>'company_id','')::uuid;
  v_user_id uuid := nullif(p_command->>'user_id','')::uuid;
  v_actor_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_invitation_id uuid := nullif(p_command->>'invitation_id','')::uuid;
  v_client_id uuid := nullif(p_command->>'api_client_id','')::uuid;
  v_provider_id uuid := nullif(p_command->>'provider_id','')::uuid;
  v_key text := nullif(btrim(p_command->>'idempotency_key'),'');
  v_client public.integration_api_clients%rowtype;
  v_provider public.tenant_customer_identity_providers%rowtype;
  v_invitation public.company_invitations%rowtype;
  v_binding jsonb;
  v_origin text;
  v_email text;
  v_auth_confirmed timestamptz;
  v_deleted timestamptz;
  v_banned timestamptz;
  v_company_status text;
  v_company_active boolean;
BEGIN
  IF v_company_id IS NULL OR v_user_id IS NULL OR v_actor_id IS DISTINCT FROM v_user_id
    OR v_invitation_id IS NULL OR v_client_id IS NULL OR v_provider_id IS NULL OR v_key IS NULL
    OR p_command->>'channel' IS DISTINCT FROM 'staff_onboarding'
    OR jsonb_typeof(p_command->'verified_client') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_command->'verified_provider') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff_onboarding_identity_invalid'; END IF;

  -- Shared staff commands lock company first. Client/provider/Auth updates
  -- cannot invalidate a checked snapshot during the canonical transaction.
  SELECT status,is_active INTO v_company_status,v_company_active FROM public.companies WHERE id=v_company_id FOR NO KEY UPDATE;
  IF NOT FOUND OR v_company_status IS DISTINCT FROM 'active' OR v_company_active IS DISTINCT FROM true
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff_onboarding_company_inactive'; END IF;
  SELECT * INTO v_client FROM public.integration_api_clients
    WHERE id=v_client_id AND company_id=v_company_id FOR SHARE;
  IF NOT FOUND OR v_client.status IS DISTINCT FROM 'active' OR v_client.deleted_at IS NOT NULL OR v_client.revoked_at IS NOT NULL
    OR (v_client.expires_at IS NOT NULL AND v_client.expires_at<=now())
    OR NOT ('staff_users.write'=ANY(coalesce(v_client.scopes,ARRAY[]::text[])))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff_onboarding_client_invalid'; END IF;
  v_origin := v_client.metadata->>'staff_onboarding_origin';
  IF v_origin IS NULL OR v_origin !~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
    OR v_origin ~ '\.(localhost|local|internal|test|invalid)$'
    OR NOT (v_origin=ANY(coalesce(v_client.allowed_origins,ARRAY[]::text[])))
    OR p_command->'verified_client' IS DISTINCT FROM jsonb_build_object(
      'secret_hash',v_client.secret_hash,'scopes',to_jsonb(v_client.scopes),
      'allowed_origins',to_jsonb(v_client.allowed_origins),'staff_onboarding_origin',v_origin)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff_onboarding_client_changed'; END IF;

  SELECT * INTO v_provider FROM public.tenant_customer_identity_providers
    WHERE id=v_provider_id AND company_id=v_company_id FOR SHARE;
  IF NOT FOUND OR v_provider.purpose IS DISTINCT FROM 'staff' OR NOT coalesce(v_provider.is_active,false)
    OR v_provider.subject_claim IS DISTINCT FROM 'sub' OR v_provider.enforcement IS DISTINCT FROM 'enforce'
    OR p_command->'verified_provider' IS DISTINCT FROM jsonb_build_object(
      'kind',v_provider.kind,'issuer',v_provider.issuer,'audience',v_provider.audience,
      'jwks_uri',v_provider.jwks_uri,'public_jwk',v_provider.public_jwk,
      'subject_claim',v_provider.subject_claim,'enforcement',v_provider.enforcement)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff_onboarding_provider_changed'; END IF;

  SELECT lower(u.email),u.email_confirmed_at,u.deleted_at,u.banned_until
    INTO v_email,v_auth_confirmed,v_deleted,v_banned FROM auth.users u WHERE u.id=v_user_id FOR SHARE;
  IF NOT FOUND OR v_email IS NULL OR v_auth_confirmed IS NULL OR v_deleted IS NOT NULL
    OR (v_banned IS NOT NULL AND v_banned>now())
    OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=v_user_id AND user_status='active')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff_onboarding_auth_invalid'; END IF;
  SELECT * INTO v_invitation FROM public.company_invitations
    WHERE id=v_invitation_id AND company_id=v_company_id FOR UPDATE;
  IF NOT FOUND OR v_invitation.invited_user_id IS DISTINCT FROM v_user_id
    OR lower(btrim(v_invitation.email)) IS DISTINCT FROM v_email
    OR v_invitation.status NOT IN ('pending','accepted')
    OR (v_invitation.status='pending' AND (v_invitation.expires_at IS NULL OR v_invitation.expires_at<=now()))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff_onboarding_invitation_invalid'; END IF;
  SELECT request_payload INTO v_binding FROM public.canonical_command_results
    WHERE company_id=v_company_id AND command_type='tenant.invitation.create'
      AND result_payload->>'invitation_id'=v_invitation_id::text FOR SHARE;
  IF NOT FOUND OR v_binding->>'company_id' IS DISTINCT FROM v_company_id::text
    OR v_binding->>'channel' IS DISTINCT FROM 'staff_api'
    OR v_binding->>'staff_operation' IS DISTINCT FROM 'invite'
    OR v_binding->>'api_client_id' IS DISTINCT FROM v_client_id::text
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staff_onboarding_invitation_client_mismatch'; END IF;

  -- Only stable canonical authority fields enter the durable request/hash.
  -- Verification snapshots and secrets are never copied into receipts/audits.
  RETURN public.canonical_accept_tenant_invitation(jsonb_build_object(
    'company_id',v_company_id,'invitation_id',v_invitation_id,'user_id',v_user_id,
    'actor_user_id',v_user_id,'idempotency_key',v_key,
    'channel','staff_onboarding','api_client_id',v_client_id));
END;
$staff_onboarding$;
REVOKE ALL ON FUNCTION public.gridex_accept_staff_invitation_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_accept_staff_invitation_v1(jsonb) TO service_role;
COMMENT ON FUNCTION public.gridex_accept_staff_invitation_v1(jsonb) IS
  'Independent staff onboarding: verified Prod Auth and signed provider proof are checked by the API; locked native client/provider/invitation authority is checked before unchanged canonical acceptance. Service-only.';
-- Exact onboarding route opt-in reuses the unchanged credential/network/limiter core.
DO $auth_provenance$
DECLARE v_body text;
BEGIN
  SELECT prosrc INTO v_body FROM pg_catalog.pg_proc
    WHERE oid='public.authenticate_integration_request_v1(text,text,text,text[],text[],text,text,integer,integer)'::regprocedure;
  IF v_body IS NULL OR md5(v_body)<>'377d73119aba7d046045b1b38805e5d8' THEN
    RAISE EXCEPTION 'staff_onboarding_auth_source_mismatch';
  END IF;
END;
$auth_provenance$;
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
set search_path = pg_catalog, public, pg_temp
as $function$
  -- Existing callers pass the requested route's exact scopes. Staff opt-in is
  -- explicit: neither legacy wildcard nor website/customer permission groups
  -- may grant this new family. Unknown staff paths fail closed.
  with staff_policy as (
    select
      p_route ~ '^/api/v1/(staff|staff-onboarding)(/|$)' as is_staff_route,
      case
        when p_route='/api/v1/staff-onboarding/invitations/accept' then array['staff_users.write']::text[]
        when p_route='/api/v1/staff/users' then array['staff_users.read','staff_users.write']::text[]
        when p_route='/api/v1/staff/roles' then array['staff_users.read']::text[]
        when p_route ~ '^/api/v1/staff/users/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(/(disable|enable))?$' then array['staff_users.write']::text[]
        when p_route='/api/v1/staff/customers' or p_route ~ '^/api/v1/staff/customers/customer_[A-Za-z0-9_-]{32}$' then array['staff_customers.read']::text[]
        when p_route ~ '^/api/v1/staff/customers/customer_[A-Za-z0-9_-]{32}/(contact|identity-change)$' then array['staff_customers.write']::text[]
        when p_route='/api/v1/staff/cases' then array['staff_cases.read','staff_cases.write']::text[]
        when p_route ~ '^/api/v1/staff/cases/support_case_[A-Za-z0-9_-]{32}$' then array['staff_cases.read']::text[]
        when p_route ~ '^/api/v1/staff/cases/support_case_[A-Za-z0-9_-]{32}/events$' then array['staff_cases.read']::text[]
        when p_route ~ '^/api/v1/staff/cases/support_case_[A-Za-z0-9_-]{32}/(messages|notes|phone-interactions|status|assignee)$' then array['staff_cases.write']::text[]
        when p_route ~ '^/api/v1/staff/cases/support_case_[A-Za-z0-9_-]{32}/attachments$' then array['staff_cases.read','staff_cases.write']::text[]
        when p_route ~ '^/api/v1/staff/cases/support_case_[A-Za-z0-9_-]{32}/attachments/support_attachment_[A-Za-z0-9_-]{24}/file$' then array['staff_cases.read']::text[]
        else array[]::text[]
      end as allowed_scopes
  ), auth as (
    select *
    from public.authenticate_integration_request_v1_credential_core(
      p_key_prefix,p_secret_hash,p_route,p_required_all,p_required_any,
      p_client_ip,p_origin,p_rate_limit_cost,p_window_seconds
    )
  ), readiness as (
    select
      auth.*,
      staff_policy.is_staff_route,
      coalesce(
        cardinality(p_required_all)>0
        and cardinality(coalesce(p_required_any,array[]::text[]))=0
        and p_required_all <@ staff_policy.allowed_scopes
        and p_required_all <@ coalesce(auth.scopes,array[]::text[])
        and array_position(p_required_all,null) is null,
        false
      ) as staff_scopes_ready,
      exists (
        select 1 from public.companies company
        where company.id=auth.company_id and company.status='active'
          and company.is_active is true
      ) as staff_company_ready,
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
    from auth cross join staff_policy
  )
  select
    case
      when readiness.auth_outcome<>'allowed' then readiness.auth_outcome
      when readiness.is_staff_route and readiness.staff_scopes_ready and readiness.staff_company_ready then 'allowed'
      when readiness.is_staff_route then 'denied'
      when p_route like 'provisioning-smoke:%' and readiness.provisioning_smoke_ready then 'allowed'
      when p_route like 'provisioning-smoke:%' then 'denied'
      when readiness.client_ready and readiness.receipt_ready and readiness.capability_ready then 'allowed'
      else 'denied'
    end,
    case
      when readiness.auth_outcome<>'allowed' then readiness.error_code
      when readiness.is_staff_route and not readiness.staff_scopes_ready then 'api_scope_missing'
      when readiness.is_staff_route and not readiness.staff_company_ready then 'tenant_inactive'
      when readiness.is_staff_route then null
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
REVOKE ALL ON FUNCTION public.authenticate_integration_request_v1(text,text,text,text[],text[],text,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_integration_request_v1(text,text,text,text[],text[],text,text,integer,integer) TO service_role;
COMMIT;
