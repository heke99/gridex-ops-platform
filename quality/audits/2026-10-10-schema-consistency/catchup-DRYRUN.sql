-- Gridex OPS: public catch-up, 16 migrationer från repot (main 420d212).
-- Ediel-motorns migrationer ingår INTE (separat release).
-- TORRKÖRNING: allt rullas tillbaka i slutet.
begin;
-- ===== 20261005101527_staff_independent_onboarding_authority =====

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

insert into supabase_migrations.schema_migrations(version,name) values ('20261005101527','staff_independent_onboarding_authority') on conflict (version) do nothing;

-- ===== 20261005124901_tenant_staff_external_identity_bindings =====
-- Independent tenant Auth identities are explicitly bound to central actors.
-- Compatibility actors have no OPS credential, identity or session. Existing
-- staff RBAC, membership materialization and canonical audit remain authoritative.
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';

CREATE UNIQUE INDEX IF NOT EXISTS staff_client_company_identity_key ON public.integration_api_clients(id,company_id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_provider_company_identity_key ON public.tenant_customer_identity_providers(id,company_id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitation_company_identity_key ON public.company_invitations(id,company_id);

CREATE TABLE public.tenant_staff_actor_anchors (
 actor_user_id uuid PRIMARY KEY REFERENCES auth.users(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 invitation_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_user_id,company_id),
 FOREIGN KEY(invitation_id,company_id) REFERENCES public.company_invitations(id,company_id)
);
CREATE TABLE public.tenant_staff_identity_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 api_client_id uuid NOT NULL,
 provider_id uuid NOT NULL,
 invitation_id uuid NOT NULL UNIQUE,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 local_auth_issuer text NOT NULL,
 recipient_email text NOT NULL,
 request_payload jsonb NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN('prepared','sent')),
 receipt_payload jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 UNIQUE(id,company_id),
 FOREIGN KEY(api_client_id,company_id) REFERENCES public.integration_api_clients(id,company_id),
 FOREIGN KEY(provider_id,company_id) REFERENCES public.tenant_customer_identity_providers(id,company_id),
 FOREIGN KEY(invitation_id,company_id) REFERENCES public.company_invitations(id,company_id),
 FOREIGN KEY(actor_user_id,company_id) REFERENCES public.tenant_staff_actor_anchors(actor_user_id,company_id),
 UNIQUE(id,company_id,actor_user_id,api_client_id,provider_id,invitation_id,local_auth_issuer),
 CHECK((status='prepared' AND receipt_payload IS NULL AND sent_at IS NULL) OR (status='sent' AND receipt_payload IS NOT NULL AND sent_at IS NOT NULL))
);
CREATE TABLE public.tenant_staff_identity_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 api_client_id uuid NOT NULL,
 provider_id uuid NOT NULL,
 local_auth_issuer text NOT NULL,
 local_user_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 provider_configuration jsonb NOT NULL,
 invitation_id uuid,
 delivery_id uuid,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','active','revoked')),
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 UNIQUE(company_id,provider_id,local_auth_issuer,local_user_id),
 UNIQUE(company_id,api_client_id,actor_user_id),
 UNIQUE(invitation_id),
 FOREIGN KEY(api_client_id,company_id) REFERENCES public.integration_api_clients(id,company_id),
 FOREIGN KEY(provider_id,company_id) REFERENCES public.tenant_customer_identity_providers(id,company_id),
 FOREIGN KEY(invitation_id,company_id) REFERENCES public.company_invitations(id,company_id),
 FOREIGN KEY(delivery_id,company_id) REFERENCES public.tenant_staff_identity_deliveries(id,company_id),
 FOREIGN KEY(delivery_id,company_id,actor_user_id,api_client_id,provider_id,invitation_id,local_auth_issuer)
  REFERENCES public.tenant_staff_identity_deliveries(id,company_id,actor_user_id,api_client_id,provider_id,invitation_id,local_auth_issuer),
 CHECK((invitation_id IS NULL)=(delivery_id IS NULL)),
 CHECK((status='revoked')=(revoked_at IS NOT NULL))
);
CREATE INDEX staff_identity_delivery_client ON public.tenant_staff_identity_deliveries(api_client_id,company_id);
CREATE INDEX staff_identity_delivery_provider ON public.tenant_staff_identity_deliveries(provider_id,company_id);
CREATE INDEX staff_identity_binding_actor ON public.tenant_staff_identity_bindings(actor_user_id);
CREATE INDEX staff_identity_binding_delivery ON public.tenant_staff_identity_bindings(delivery_id,company_id);
ALTER TABLE public.tenant_staff_actor_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_staff_identity_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_staff_identity_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_staff_actor_anchors,public.tenant_staff_identity_deliveries,public.tenant_staff_identity_bindings FROM PUBLIC,anon,authenticated,service_role;

-- The tuple/provenance cannot be reassigned, including by a service caller.
CREATE FUNCTION public.gridex_staff_identity_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP IN('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'staff_identity_immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='tenant_staff_actor_anchors' OR
   (TG_TABLE_NAME='tenant_staff_identity_bindings' AND
    (to_jsonb(NEW)-ARRAY['status','version','revoked_at','provider_configuration']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','revoked_at','provider_configuration'])) OR
   (TG_TABLE_NAME='tenant_staff_identity_deliveries' AND
    (to_jsonb(NEW)-ARRAY['status','receipt_payload','sent_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','receipt_payload','sent_at']))
 THEN RAISE EXCEPTION 'staff_identity_immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='tenant_staff_identity_bindings' THEN
  IF NOT ((OLD.status='pending' AND NEW.status='active' AND NEW.version=OLD.version AND NEW.revoked_at IS NULL AND NEW.provider_configuration=OLD.provider_configuration)
    OR (OLD.status IN('pending','active') AND NEW.status='revoked' AND NEW.version=OLD.version+1 AND NEW.revoked_at IS NOT NULL AND NEW.provider_configuration=OLD.provider_configuration)
    OR (OLD.status IN('pending','active') AND NEW.status=OLD.status AND NEW.version=OLD.version+1 AND NEW.revoked_at IS NULL AND NEW.provider_configuration IS DISTINCT FROM OLD.provider_configuration)
    OR NEW IS NOT DISTINCT FROM OLD)
  THEN RAISE EXCEPTION 'staff_identity_invalid_transition' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT ((OLD.status='prepared' AND NEW.status='sent') OR NEW IS NOT DISTINCT FROM OLD)
  THEN RAISE EXCEPTION 'staff_identity_delivery_immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_identity_anchor_immutable BEFORE UPDATE OR DELETE ON public.tenant_staff_actor_anchors FOR EACH ROW EXECUTE FUNCTION public.gridex_staff_identity_immutable_v1();
CREATE TRIGGER staff_identity_binding_immutable BEFORE UPDATE OR DELETE ON public.tenant_staff_identity_bindings FOR EACH ROW EXECUTE FUNCTION public.gridex_staff_identity_immutable_v1();
CREATE TRIGGER staff_identity_delivery_immutable BEFORE UPDATE OR DELETE ON public.tenant_staff_identity_deliveries FOR EACH ROW EXECUTE FUNCTION public.gridex_staff_identity_immutable_v1();
CREATE TRIGGER staff_identity_anchor_no_truncate BEFORE TRUNCATE ON public.tenant_staff_actor_anchors FOR EACH STATEMENT EXECUTE FUNCTION public.gridex_staff_identity_immutable_v1();
CREATE TRIGGER staff_identity_binding_no_truncate BEFORE TRUNCATE ON public.tenant_staff_identity_bindings FOR EACH STATEMENT EXECUTE FUNCTION public.gridex_staff_identity_immutable_v1();
CREATE TRIGGER staff_identity_delivery_no_truncate BEFORE TRUNCATE ON public.tenant_staff_identity_deliveries FOR EACH STATEMENT EXECUTE FUNCTION public.gridex_staff_identity_immutable_v1();

CREATE FUNCTION public.gridex_staff_anchor_no_login_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid;
BEGIN
 IF TG_TABLE_NAME='users' THEN
  v_actor:=NEW.id;
  IF EXISTS(SELECT FROM public.tenant_staff_actor_anchors WHERE actor_user_id=v_actor) AND
    (NEW.email IS NOT NULL OR NEW.phone IS NOT NULL OR nullif(NEW.encrypted_password,'') IS NOT NULL
     OR NEW.email_confirmed_at IS NOT NULL OR NEW.phone_confirmed_at IS NOT NULL OR NEW.last_sign_in_at IS NOT NULL
     OR nullif(NEW.confirmation_token,'') IS NOT NULL OR nullif(NEW.recovery_token,'') IS NOT NULL
     OR NEW.is_anonymous IS DISTINCT FROM false OR coalesce(NEW.is_super_admin,false))
  THEN RAISE EXCEPTION 'staff_anchor_has_no_login' USING ERRCODE='23514'; END IF;
 ELSE
  v_actor:=nullif(to_jsonb(NEW)->>'user_id','')::uuid;
  IF EXISTS(SELECT FROM public.tenant_staff_actor_anchors WHERE actor_user_id=v_actor)
  THEN RAISE EXCEPTION 'staff_anchor_has_no_login' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_anchor_no_login BEFORE INSERT OR UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.gridex_staff_anchor_no_login_v1();
CREATE TRIGGER staff_anchor_no_session BEFORE INSERT OR UPDATE ON auth.sessions FOR EACH ROW EXECUTE FUNCTION public.gridex_staff_anchor_no_login_v1();
CREATE TRIGGER staff_anchor_no_refresh BEFORE INSERT OR UPDATE ON auth.refresh_tokens FOR EACH ROW EXECUTE FUNCTION public.gridex_staff_anchor_no_login_v1();
DO $$ BEGIN
 -- The native bootstrap deliberately has no identities relation; a managed
 -- GoTrue installation does. Do not create/alter its relation or grants.
 IF to_regclass('auth.identities') IS NOT NULL THEN
  EXECUTE 'CREATE TRIGGER staff_anchor_no_identity BEFORE INSERT OR UPDATE ON auth.identities FOR EACH ROW EXECUTE FUNCTION public.gridex_staff_anchor_no_login_v1()';
 END IF;
END $$;

-- Shared current configuration guard. Snapshot material is not persisted.
CREATE FUNCTION public.gridex_staff_identity_registration_v1(p_command jsonb,p_delivery boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.integration_api_clients%rowtype; p public.tenant_customer_identity_providers%rowtype; origin text; auth_url text; delivery jsonb;
BEGIN
 PERFORM 1 FROM public.companies WHERE id=(p_command->>'company_id')::uuid AND status='active' AND is_active FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staff_identity_company_inactive' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.integration_api_clients WHERE id=(p_command->>'api_client_id')::uuid AND company_id=(p_command->>'company_id')::uuid FOR SHARE;
 IF NOT FOUND OR c.status<>'active' OR c.deleted_at IS NOT NULL OR c.revoked_at IS NOT NULL OR (c.expires_at IS NOT NULL AND c.expires_at<=clock_timestamp())
  OR NOT EXISTS(SELECT FROM unnest(c.scopes) scope WHERE scope IN('staff_users.read','staff_users.write','staff_customers.read','staff_customers.write','staff_cases.read','staff_cases.write'))
 THEN RAISE EXCEPTION 'staff_identity_client_inactive' USING ERRCODE='42501'; END IF;
 origin:=c.metadata->>'staff_onboarding_origin'; auth_url:=c.metadata->'staff_tenant_auth'->>'url'; delivery:=c.metadata->'staff_tenant_delivery';
 IF origin IS NULL OR origin !~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$' OR origin ~ '\.(localhost|local|internal|test|invalid)$'
  OR NOT origin=ANY(c.allowed_origins) OR auth_url IS NULL OR auth_url !~ '^https://[a-z0-9]{20}\.supabase\.co$'
  OR nullif(c.metadata->'staff_tenant_auth'->>'public_key','') IS NULL
  OR p_command->'verified_client' IS DISTINCT FROM jsonb_build_object('secret_hash',c.secret_hash,'scopes',to_jsonb(c.scopes),'allowed_origins',to_jsonb(c.allowed_origins),
    'staff_onboarding_origin',origin,'staff_tenant_auth',c.metadata->'staff_tenant_auth','staff_tenant_delivery',delivery)
 THEN RAISE EXCEPTION 'staff_identity_client_changed' USING ERRCODE='42501'; END IF;
 IF p_delivery AND (NOT 'staff_users.write'=ANY(c.scopes) OR jsonb_typeof(delivery) IS DISTINCT FROM 'object'
  OR delivery->>'url' IS DISTINCT FROM origin||'/api/internal/staff/invitations/deliver'
  OR delivery->>'audience' IS DISTINCT FROM delivery->>'url' OR nullif(delivery->>'issuer','') IS NULL
  OR nullif(delivery->>'key_id','') IS NULL OR jsonb_typeof(delivery->'request_public_jwk') IS DISTINCT FROM 'object'
  OR delivery->'request_public_jwk' ?| ARRAY['d','p','q','dp','dq','qi','oth','k']
  OR delivery->'request_public_jwk'->>'kty' IS DISTINCT FROM 'RSA'
  OR nullif(delivery->'request_public_jwk'->>'n','') IS NULL OR nullif(delivery->'request_public_jwk'->>'e','') IS NULL
  OR delivery->'request_public_jwk'->>'kid' IS DISTINCT FROM delivery->>'key_id')
 THEN RAISE EXCEPTION 'staff_identity_delivery_not_registered' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.tenant_customer_identity_providers WHERE id=(p_command->>'provider_id')::uuid AND company_id=c.company_id FOR SHARE;
 IF NOT FOUND OR NOT p.is_active OR p.purpose<>'staff' OR p.subject_claim<>'sub' OR p.enforcement<>'enforce'
  OR p_command->'verified_provider' IS DISTINCT FROM jsonb_build_object('kind',p.kind,'issuer',p.issuer,'audience',p.audience,'jwks_uri',p.jwks_uri,'public_jwk',p.public_jwk,'subject_claim',p.subject_claim,'enforcement',p.enforcement)
 THEN RAISE EXCEPTION 'staff_identity_provider_changed' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('auth_issuer',auth_url||'/auth/v1','origin',origin);
END $$;
CREATE FUNCTION public.gridex_staff_tenant_onboarding_ready_v1(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM public.gridex_staff_identity_registration_v1(p_command,true); RETURN 'true'::jsonb;
END $$;

CREATE FUNCTION public.gridex_staff_identity_invitation_v1(p_command jsonb,p_lease boolean DEFAULT false) RETURNS public.company_invitations
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.company_invitations%rowtype; intent jsonb;
BEGIN
 SELECT * INTO i FROM public.company_invitations WHERE id=(p_command->>'invitation_id')::uuid AND company_id=(p_command->>'company_id')::uuid FOR UPDATE;
 IF NOT FOUND OR i.status NOT IN('pending','accepted') OR (i.status='pending' AND (i.expires_at IS NULL OR i.expires_at<=clock_timestamp()))
 THEN RAISE EXCEPTION 'staff_identity_invitation_invalid' USING ERRCODE='42501'; END IF;
 SELECT request_payload INTO intent FROM public.canonical_command_results WHERE company_id=i.company_id AND command_type='tenant.invitation.create' AND result_payload->>'invitation_id'=i.id::text FOR SHARE;
 IF NOT FOUND OR intent->>'company_id' IS DISTINCT FROM i.company_id::text
  OR NOT (intent->>'channel'='staff_api' OR (intent->>'channel'='ops' AND intent->'external_staff_identity'='true'::jsonb))
  OR intent->>'staff_operation' IS DISTINCT FROM 'invite' OR intent->>'api_client_id' IS DISTINCT FROM p_command->>'api_client_id'
 THEN RAISE EXCEPTION 'staff_identity_invitation_client_mismatch' USING ERRCODE='42501'; END IF;
 IF p_lease THEN
  PERFORM 1 FROM public.company_provisioning_jobs WHERE id=(p_command->>'provisioning_job_id')::uuid AND company_id=i.company_id
   AND job_key='auth_invite' AND idempotency_key=i.idempotency_key AND status='processing' AND lease_token=(p_command->>'provisioning_lease_token')::uuid
   AND lease_token IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_identity_delivery_lease_invalid' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN i;
END $$;

CREATE FUNCTION public.gridex_prepare_staff_identity_delivery_v1(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registration jsonb; i public.company_invitations%rowtype; d public.tenant_staff_identity_deliveries%rowtype; actor uuid; payload jsonb; delivery_id uuid;
BEGIN
 registration:=public.gridex_staff_identity_registration_v1(p_command,true);
 i:=public.gridex_staff_identity_invitation_v1(p_command,true);
 SELECT * INTO d FROM public.tenant_staff_identity_deliveries WHERE invitation_id=i.id FOR UPDATE;
 IF FOUND THEN
  IF d.company_id<>i.company_id OR d.api_client_id<>(p_command->>'api_client_id')::uuid OR d.provider_id<>(p_command->>'provider_id')::uuid OR d.local_auth_issuer<>registration->>'auth_issuer'
  THEN RAISE EXCEPTION 'staff_identity_delivery_mismatch' USING ERRCODE='42501'; END IF;
  RETURN d.request_payload||jsonb_build_object('request_hash',d.request_hash);
 END IF;
 IF i.invited_user_id IS NOT NULL OR i.status<>'pending' OR i.token IS NULL
 THEN RAISE EXCEPTION 'staff_identity_existing_actor_requires_explicit_binding' USING ERRCODE='42501'; END IF;
 actor:=gen_random_uuid(); delivery_id:=gen_random_uuid();
 INSERT INTO auth.users(id,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous)
 VALUES(actor,'{}','{}',now(),now(),false);
 -- Contact/display data is explicit invitation data, never a GoTrue credential.
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(actor,lower(btrim(i.email)),i.full_name,'active');
 INSERT INTO public.tenant_staff_actor_anchors(actor_user_id,company_id,invitation_id) VALUES(actor,i.company_id,i.id);
 payload:=jsonb_build_object('delivery_id',delivery_id,'actor_user_id',actor,'company_id',i.company_id,'api_client_id',(p_command->>'api_client_id')::uuid,
  'provider_id',(p_command->>'provider_id')::uuid,'invitation_id',i.id,'recipient_email',lower(btrim(i.email)),'full_name',i.full_name,
  'auth_issuer',registration->>'auth_issuer','callback_url',(registration->>'origin')||'/auth/invitation?token='||i.token::text);
 INSERT INTO public.tenant_staff_identity_deliveries(id,company_id,api_client_id,provider_id,invitation_id,actor_user_id,local_auth_issuer,recipient_email,request_payload,request_hash)
 VALUES(delivery_id,i.company_id,(p_command->>'api_client_id')::uuid,(p_command->>'provider_id')::uuid,i.id,actor,registration->>'auth_issuer',lower(btrim(i.email)),payload,public.canonical_json_sha256(payload));
 RETURN payload||jsonb_build_object('request_hash',public.canonical_json_sha256(payload));
END $$;

CREATE FUNCTION public.gridex_record_staff_identity_delivery_v1(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registration jsonb; i public.company_invitations%rowtype; d public.tenant_staff_identity_deliveries%rowtype; b public.tenant_staff_identity_bindings%rowtype; r jsonb:=p_command->'verified_receipt'; subject uuid;
BEGIN
 registration:=public.gridex_staff_identity_registration_v1(p_command,true); i:=public.gridex_staff_identity_invitation_v1(p_command,true);
 SELECT * INTO d FROM public.tenant_staff_identity_deliveries WHERE id=(p_command->>'delivery_id')::uuid AND invitation_id=i.id AND company_id=i.company_id FOR UPDATE;
 subject:=nullif(r->>'local_auth_subject','')::uuid;
 IF NOT FOUND OR subject IS NULL OR subject=d.actor_user_id OR d.api_client_id<>(p_command->>'api_client_id')::uuid OR d.provider_id<>(p_command->>'provider_id')::uuid
  OR d.local_auth_issuer<>registration->>'auth_issuer' OR r IS DISTINCT FROM jsonb_build_object('request_hash',d.request_hash,'company_id',d.company_id,'api_client_id',d.api_client_id,
   'provider_id',d.provider_id,'invitation_id',d.invitation_id,'delivery_id',d.id,'local_auth_subject',subject,'auth_issuer',d.local_auth_issuer,'email',d.recipient_email,'status','sent')
 THEN RAISE EXCEPTION 'staff_identity_delivery_receipt_invalid' USING ERRCODE='42501'; END IF;
 IF d.status='sent' AND d.receipt_payload IS DISTINCT FROM r THEN RAISE EXCEPTION 'staff_identity_delivery_receipt_changed' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.tenant_staff_identity_bindings WHERE invitation_id=i.id FOR UPDATE;
 IF FOUND THEN
  IF b.status='revoked' OR b.api_client_id<>d.api_client_id OR b.provider_id<>d.provider_id OR b.local_auth_issuer<>d.local_auth_issuer OR b.local_user_id<>subject OR b.actor_user_id<>d.actor_user_id
  THEN RAISE EXCEPTION 'staff_identity_binding_mismatch' USING ERRCODE='42501'; END IF;
 ELSE
  -- No email or UUID lookup, no conflict-upsert/remap. Duplicate external pairs
  -- must be resolved explicitly by an operator rather than merged implicitly.
  INSERT INTO public.tenant_staff_identity_bindings(company_id,api_client_id,provider_id,local_auth_issuer,local_user_id,actor_user_id,provider_configuration,invitation_id,delivery_id)
  VALUES(d.company_id,d.api_client_id,d.provider_id,d.local_auth_issuer,subject,d.actor_user_id,p_command->'verified_provider',d.invitation_id,d.id) RETURNING * INTO b;
 END IF;
 IF d.status='prepared' THEN UPDATE public.tenant_staff_identity_deliveries SET status='sent',receipt_payload=r,sent_at=now() WHERE id=d.id; END IF;
 UPDATE public.company_invitations SET invited_user_id=d.actor_user_id,metadata=metadata||jsonb_build_object('provider_delivery_status','sent','tenant_staff_delivery_id',d.id),updated_at=now() WHERE id=i.id;
 RETURN jsonb_build_object('actor_user_id',b.actor_user_id,'binding_id',b.id,'binding_version',b.version);
END $$;

CREATE FUNCTION public.gridex_lookup_pending_staff_identity_binding_v1(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registration jsonb; b public.tenant_staff_identity_bindings%rowtype;
BEGIN
 registration:=public.gridex_staff_identity_registration_v1(p_command,true);
 PERFORM public.gridex_staff_identity_invitation_v1(p_command,false);
 SELECT * INTO b FROM public.tenant_staff_identity_bindings WHERE company_id=(p_command->>'company_id')::uuid AND api_client_id=(p_command->>'api_client_id')::uuid
  AND provider_id=(p_command->>'provider_id')::uuid AND invitation_id=(p_command->>'invitation_id')::uuid AND local_user_id=(p_command->>'local_user_id')::uuid
  AND local_auth_issuer=p_command->>'local_auth_issuer' AND local_auth_issuer=registration->>'auth_issuer' AND status IN('pending','active') FOR UPDATE;
 IF NOT FOUND OR b.provider_configuration IS DISTINCT FROM p_command->'verified_provider' THEN RAISE EXCEPTION 'staff_identity_binding_missing' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('actor_user_id',b.actor_user_id,'binding_id',b.id,'binding_version',b.version);
END $$;

CREATE FUNCTION public.gridex_staff_anchor_invitation_email_v1(p_invitation_id uuid,p_company_id uuid,p_actor uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT d.recipient_email FROM public.tenant_staff_actor_anchors a
 JOIN public.tenant_staff_identity_bindings b ON b.actor_user_id=a.actor_user_id AND b.company_id=a.company_id AND b.invitation_id=a.invitation_id AND b.status='active'
 JOIN public.tenant_staff_identity_deliveries d ON d.id=b.delivery_id AND d.company_id=b.company_id AND d.status='sent'
 WHERE a.actor_user_id=p_actor AND a.company_id=p_company_id AND a.invitation_id=p_invitation_id
$$;

CREATE FUNCTION public.gridex_accept_external_staff_invitation_v1(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; b public.tenant_staff_identity_bindings%rowtype; i public.company_invitations%rowtype;
BEGIN
 result:=public.gridex_lookup_pending_staff_identity_binding_v1(p_command);
 IF result->>'binding_id' IS DISTINCT FROM p_command->>'binding_id' OR result->>'binding_version' IS DISTINCT FROM p_command->>'binding_version'
  OR p_command->'email_confirmed' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'staff_identity_acceptance_invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.tenant_staff_identity_bindings WHERE id=(result->>'binding_id')::uuid FOR UPDATE;
 SELECT * INTO i FROM public.company_invitations WHERE id=b.invitation_id;
 IF lower(btrim(p_command->>'verified_email')) IS DISTINCT FROM lower(btrim(i.email)) OR i.invited_user_id IS DISTINCT FROM b.actor_user_id
  OR nullif(btrim(p_command->>'idempotency_key'),'') IS NULL
 THEN RAISE EXCEPTION 'staff_identity_acceptance_invalid' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM auth.users u JOIN public.user_profiles profile ON profile.id=u.id WHERE u.id=b.actor_user_id FOR SHARE OF u,profile;
 IF NOT FOUND OR NOT EXISTS(SELECT FROM auth.users u JOIN public.user_profiles profile ON profile.id=u.id WHERE u.id=b.actor_user_id AND u.deleted_at IS NULL
  AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()) AND profile.user_status='active')
 THEN RAISE EXCEPTION 'staff_identity_actor_inactive' USING ERRCODE='42501'; END IF;
 IF b.status='pending' THEN UPDATE public.tenant_staff_identity_bindings SET status='active' WHERE id=b.id; END IF;
 -- Stable authority only. No tenant access token, password or verification
 -- snapshot enters the unchanged command hash, audit or membership engine.
 RETURN public.canonical_accept_tenant_invitation(jsonb_build_object('company_id',b.company_id,'invitation_id',b.invitation_id,'user_id',b.actor_user_id,'actor_user_id',b.actor_user_id,
   'api_client_id',b.api_client_id,'channel','staff_external_onboarding','idempotency_key',p_command->>'idempotency_key'));
END $$;

CREATE FUNCTION public.gridex_resolve_staff_identity_v1(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registration jsonb; b public.tenant_staff_identity_bindings%rowtype;
BEGIN
 registration:=public.gridex_staff_identity_registration_v1(p_command,false);
 IF p_command->>'local_auth_issuer' IS DISTINCT FROM registration->>'auth_issuer'
  OR (p_command ? 'local_auth_url' AND p_command->>'local_auth_url' IS DISTINCT FROM p_command->'verified_client'->'staff_tenant_auth'->>'url')
 THEN RAISE EXCEPTION 'staff_identity_issuer_mismatch' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.tenant_staff_identity_bindings WHERE company_id=(p_command->>'company_id')::uuid AND api_client_id=(p_command->>'api_client_id')::uuid
  AND provider_id=(p_command->>'provider_id')::uuid AND local_auth_issuer=p_command->>'local_auth_issuer' AND local_user_id=(p_command->>'local_user_id')::uuid AND status='active' FOR SHARE;
 IF NOT FOUND OR b.provider_configuration IS DISTINCT FROM p_command->'verified_provider' THEN RAISE EXCEPTION 'staff_identity_binding_missing' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.company_memberships cm JOIN public.user_profiles profile ON profile.id=cm.user_id JOIN auth.users u ON u.id=cm.user_id
 WHERE cm.company_id=b.company_id AND cm.user_id=b.actor_user_id FOR SHARE OF cm,profile,u;
 IF NOT FOUND OR NOT EXISTS(SELECT FROM public.gridex_staff_active_membership_v1(b.company_id,b.actor_user_id))
 THEN RAISE EXCEPTION 'staff_identity_actor_inactive' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('actor_user_id',b.actor_user_id,'binding_id',b.id,'binding_version',b.version);
END $$;
CREATE FUNCTION public.gridex_validate_staff_identity_binding_v1(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE result jsonb; BEGIN
 result:=public.gridex_resolve_staff_identity_v1(p_command);
 IF result->>'binding_id' IS DISTINCT FROM p_command->>'binding_id' OR result->>'binding_version' IS DISTINCT FROM p_command->>'binding_version' OR result->>'actor_user_id' IS DISTINCT FROM p_command->>'actor_user_id'
 THEN RAISE EXCEPTION 'staff_identity_binding_mismatch' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

-- Called inside existing native write/cache guards. Company-first locking
-- prevents a binding/client/provider change between this check and commit.
CREATE FUNCTION public.gridex_staff_assert_external_actor_v1(p_company uuid,p_actor uuid,p_client uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.integration_api_clients%rowtype; b public.tenant_staff_identity_bindings%rowtype; p public.tenant_customer_identity_providers%rowtype;
BEGIN
 SELECT * INTO c FROM public.integration_api_clients WHERE id=p_client AND company_id=p_company FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staff_identity_client_inactive' USING ERRCODE='42501'; END IF;
 IF NOT c.metadata ? 'staff_tenant_auth' THEN
  IF EXISTS(SELECT FROM public.tenant_staff_actor_anchors WHERE actor_user_id=p_actor)
   OR EXISTS(SELECT FROM public.tenant_staff_identity_bindings WHERE company_id=p_company AND api_client_id=p_client AND actor_user_id=p_actor)
  THEN RAISE EXCEPTION 'staff_identity_registration_removed' USING ERRCODE='42501'; END IF;
  RETURN;
 END IF;
 SELECT * INTO b FROM public.tenant_staff_identity_bindings WHERE company_id=p_company AND api_client_id=p_client AND actor_user_id=p_actor FOR SHARE;
 IF NOT FOUND OR b.status<>'active' OR b.local_auth_issuer IS DISTINCT FROM (c.metadata->'staff_tenant_auth'->>'url')||'/auth/v1'
 THEN RAISE EXCEPTION 'staff_identity_binding_missing' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.tenant_customer_identity_providers WHERE id=b.provider_id AND company_id=p_company FOR SHARE;
 IF NOT FOUND OR NOT p.is_active OR p.purpose<>'staff' OR p.enforcement<>'enforce' OR p.subject_claim<>'sub'
  OR b.provider_configuration IS DISTINCT FROM jsonb_build_object('kind',p.kind,'issuer',p.issuer,'audience',p.audience,'jwks_uri',p.jwks_uri,'public_jwk',p.public_jwk,'subject_claim',p.subject_claim,'enforcement',p.enforcement)
 THEN RAISE EXCEPTION 'staff_identity_provider_changed' USING ERRCODE='42501'; END IF;
END $$;

-- Explicit administrative key rotation preserves the actor/identity tuple and
-- all memberships/roles. It invalidates old binding proofs by bumping version.
CREATE FUNCTION public.gridex_refresh_staff_identity_binding_v1(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.tenant_staff_identity_bindings%rowtype; operator_id uuid:=(p_command->>'operator_user_id')::uuid;
BEGIN
 PERFORM public.gridex_staff_identity_registration_v1(p_command,false);
 PERFORM 1 FROM auth.users u JOIN public.user_profiles profile ON profile.id=u.id WHERE u.id=operator_id FOR SHARE OF u,profile;
 IF NOT FOUND OR NOT coalesce('users.write'=ANY(public.gridex_staff_actor_permissions_v1((p_command->>'company_id')::uuid,operator_id,true)),false)
 THEN RAISE EXCEPTION 'staff_identity_rotation_not_authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.tenant_staff_identity_bindings WHERE id=(p_command->>'binding_id')::uuid AND company_id=(p_command->>'company_id')::uuid
  AND api_client_id=(p_command->>'api_client_id')::uuid AND provider_id=(p_command->>'provider_id')::uuid FOR UPDATE;
 IF NOT FOUND OR b.status NOT IN('pending','active') OR b.version IS DISTINCT FROM (p_command->>'binding_version')::integer
  OR b.local_auth_issuer IS DISTINCT FROM (p_command->'verified_client'->'staff_tenant_auth'->>'url')||'/auth/v1'
 THEN RAISE EXCEPTION 'staff_identity_binding_mismatch' USING ERRCODE='42501'; END IF;
 IF b.provider_configuration IS DISTINCT FROM p_command->'verified_provider' THEN
  UPDATE public.tenant_staff_identity_bindings SET provider_configuration=p_command->'verified_provider',version=version+1 WHERE id=b.id RETURNING * INTO b;
  INSERT INTO public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,idempotency_key,before_state,after_state)
  VALUES(b.company_id,'TENANT_STAFF_IDENTITY_KEY_ROTATED','tenant_staff_identity',b.id,operator_id,'Explicit staff provider key rotation without identity remap','staff-binding-rotation:'||b.id::text||':'||b.version::text,
   jsonb_build_object('binding_version',b.version-1),jsonb_build_object('binding_version',b.version,'actor_user_id',b.actor_user_id));
 END IF;
 RETURN jsonb_build_object('actor_user_id',b.actor_user_id,'binding_id',b.id,'binding_version',b.version);
END $$;

-- Initial tenant admin enrollment is a trusted OPS administrative command,
-- not an authority marker submitted by an external browser. It runs the same
-- current OPS admin / users.write / role-ceiling canonical invitation engine.
CREATE FUNCTION public.gridex_create_external_staff_invitation_v1(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE membership text;
BEGIN
 PERFORM public.gridex_staff_identity_registration_v1(p_command,true);
 SELECT membership_role INTO membership FROM public.canonical_tenant_access_role_mapping WHERE role_key=p_command->>'role_key' AND is_assignable;
 RETURN public.canonical_create_tenant_invitation(jsonb_build_object('company_id',(p_command->>'company_id')::uuid,'actor_user_id',(p_command->>'actor_user_id')::uuid,
  'api_client_id',(p_command->>'api_client_id')::uuid,'channel','ops','staff_operation','invite','external_staff_identity',true,
  'email',p_command->>'email','full_name',p_command->>'full_name','role_key',p_command->>'role_key','membership_role',membership,
  'idempotency_key',p_command->>'idempotency_key','source','ops_external_staff_bootstrap'));
END $$;

-- Only the exact qualified body is eligible for the compatibility extension.
-- The complete legacy email/ban/deletion/profile predicates and single role /
-- membership engine remain intact. Function metadata and ACL stay identical.
DO $canonical_forward$
DECLARE before_row record; after_row record; body text; definition text;
 old_text text:='select lower(u.email),';
 new_text text:='select coalesce(lower(u.email),public.gridex_staff_anchor_invitation_email_v1(v_invitation.id,v_invitation.company_id,u.id)),';
BEGIN
 SELECT p.*,to_jsonb(p)-'prosrc' metadata INTO STRICT before_row FROM pg_proc p WHERE oid='public.canonical_accept_tenant_invitation(jsonb)'::regprocedure;
 IF NOT before_row.prosecdef OR encode(sha256(convert_to(before_row.prosrc,'UTF8')),'hex')<>'1fa6349633150ab630282cb06524006eadf53559da393614ddc1f82dfd1bf19a'
 THEN RAISE EXCEPTION 'staff_external_canonical_predecessor_mismatch'; END IF;
 body:=replace(before_row.prosrc,old_text,new_text);
 IF body=before_row.prosrc OR (length(before_row.prosrc)-length(replace(before_row.prosrc,old_text,'')))<>length(old_text)
 THEN RAISE EXCEPTION 'staff_external_canonical_source_binding_failed'; END IF;
 definition:=pg_get_functiondef(before_row.oid); EXECUTE replace(definition,before_row.prosrc,body);
 SELECT p.*,to_jsonb(p)-'prosrc' metadata INTO STRICT after_row FROM pg_proc p WHERE oid=before_row.oid;
 IF after_row.metadata IS DISTINCT FROM before_row.metadata OR after_row.prosrc IS DISTINCT FROM body THEN RAISE EXCEPTION 'staff_external_canonical_metadata_changed'; END IF;
END $canonical_forward$;

DO $write_guards$
DECLARE signature text; before_row record; after_row record; body text; marker text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text)','public.gridex_assert_staff_command_v1(jsonb,boolean)'] LOOP
  SELECT p.*,to_jsonb(p)-'prosrc' metadata INTO STRICT before_row FROM pg_proc p WHERE oid=signature::regprocedure;
  IF NOT before_row.prosecdef OR encode(sha256(convert_to(before_row.prosrc,'UTF8')),'hex') IS DISTINCT FROM (CASE
   WHEN signature LIKE '%assert_write_actor%' THEN '8bf03abd6ff76843dfcef57ccd41db6535a05340b97705ec198ffb1d34f6b607'
   ELSE 'dbd36ef218b34da8fa187bf8d927d888c88eb51cef841f4b02a9c09cda87c601' END)
  THEN RAISE EXCEPTION 'staff_external_write_guard_predecessor_mismatch'; END IF;
  IF signature LIKE '%assert_write_actor%' THEN
   marker:='  -- Read eligibility again only after every potentially blocking lock.';
   body:=replace(before_row.prosrc,marker,'  PERFORM public.gridex_staff_assert_external_actor_v1(p_company_id,p_actor_user_id,p_api_client_id);'||chr(10)||marker);
  ELSE
   marker:='    -- Check eligibility after all potentially blocking row locks, before any';
   body:=replace(before_row.prosrc,marker,'    PERFORM public.gridex_staff_assert_external_actor_v1(v_company_id,v_actor_user_id,v_client_id);'||chr(10)||marker);
  END IF;
  IF body=before_row.prosrc OR (length(before_row.prosrc)-length(replace(before_row.prosrc,marker,'')))<>length(marker)
  THEN RAISE EXCEPTION 'staff_external_write_guard_source_binding_failed'; END IF;
  EXECUTE replace(pg_get_functiondef(before_row.oid),before_row.prosrc,body);
  SELECT p.*,to_jsonb(p)-'prosrc' metadata INTO STRICT after_row FROM pg_proc p WHERE oid=before_row.oid;
  IF after_row.metadata IS DISTINCT FROM before_row.metadata OR after_row.prosrc IS DISTINCT FROM body THEN RAISE EXCEPTION 'staff_external_write_guard_metadata_changed'; END IF;
 END LOOP;
END $write_guards$;

DO $acl$
DECLARE f record;
BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
 'gridex_staff_identity_immutable_v1','gridex_staff_anchor_no_login_v1','gridex_staff_identity_registration_v1','gridex_staff_identity_invitation_v1',
 'gridex_staff_anchor_invitation_email_v1','gridex_staff_assert_external_actor_v1','gridex_staff_tenant_onboarding_ready_v1','gridex_prepare_staff_identity_delivery_v1',
 'gridex_record_staff_identity_delivery_v1','gridex_lookup_pending_staff_identity_binding_v1','gridex_accept_external_staff_invitation_v1','gridex_resolve_staff_identity_v1','gridex_validate_staff_identity_binding_v1','gridex_create_external_staff_invitation_v1','gridex_refresh_staff_identity_binding_v1') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION public.gridex_staff_tenant_onboarding_ready_v1(jsonb),public.gridex_prepare_staff_identity_delivery_v1(jsonb),
 public.gridex_record_staff_identity_delivery_v1(jsonb),public.gridex_lookup_pending_staff_identity_binding_v1(jsonb),
 public.gridex_accept_external_staff_invitation_v1(jsonb),public.gridex_resolve_staff_identity_v1(jsonb),public.gridex_validate_staff_identity_binding_v1(jsonb),public.gridex_create_external_staff_invitation_v1(jsonb),public.gridex_refresh_staff_identity_binding_v1(jsonb) TO service_role;

-- Exact resolver machine authentication opt-in: the credential/network/rate
-- limiter core and the independent acceptance route remain unchanged.
DO $auth_identity_resolution$
DECLARE before_row record; after_row record; body text; definition text;
 old_text text:=$old$when p_route='/api/v1/staff-onboarding/invitations/accept' then array['staff_users.write']::text[]$old$;
 new_text text:=$new$when p_route='/api/v1/staff-onboarding/invitations/accept' then array['staff_users.write']::text[]
        when p_route='/api/v1/staff-onboarding/identity/resolve' then array['staff_users.read']::text[]$new$;
BEGIN
 SELECT p.*,to_jsonb(p)-'prosrc' metadata INTO STRICT before_row FROM pg_proc p
 WHERE oid='public.authenticate_integration_request_v1(text,text,text,text[],text[],text,text,integer,integer)'::regprocedure;
 IF NOT before_row.prosecdef OR encode(sha256(convert_to(before_row.prosrc,'UTF8')),'hex')<>'f0ec6bff6c6e749686d68ccc5957e9d52ed447d48139443c1d69c8f81b461ac5'
 THEN RAISE EXCEPTION 'staff_identity_auth_source_mismatch'; END IF;
 IF (length(before_row.prosrc)-length(replace(before_row.prosrc,old_text,'')))<>length(old_text) THEN RAISE EXCEPTION 'staff_identity_auth_source_mismatch'; END IF;
 body:=replace(before_row.prosrc,old_text,new_text); definition:=pg_get_functiondef(before_row.oid);
 EXECUTE replace(definition,before_row.prosrc,body);
 SELECT p.*,to_jsonb(p)-'prosrc' metadata INTO STRICT after_row FROM pg_proc p WHERE oid=before_row.oid;
 IF after_row.metadata IS DISTINCT FROM before_row.metadata OR after_row.prosrc IS DISTINCT FROM body THEN RAISE EXCEPTION 'staff_identity_auth_metadata_changed'; END IF;
END $auth_identity_resolution$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261005124901','tenant_staff_external_identity_bindings') on conflict (version) do nothing;

-- ===== 20261005130000_hard_delete_guard_companies_customers =====
-- DB-05 / F-DB-05-01: a raw DELETE of a company or customer must not silently
-- cascade away audit, journal and billing history (265 ON DELETE CASCADE
-- foreign keys hang off companies/customers).
--
-- Guard, not an FK rewrite (owner decision 2026-10-05): the cascade stays for
-- the two sanctioned paths and everything else is refused.
--   companies : only a disposable tenant (status = 'deleted_test_only') or the
--               database owner roles (migrations / maintenance).
--   customers : only the database owner roles (this is what the
--               SECURITY DEFINER command gridex_delete_test_customer_v1 runs
--               as). customers.company_id is NO ACTION, so no company delete
--               ever cascades into customers.
-- service_role / authenticated / anon directly are refused with 23001.
-- Independent review (2026-10-05) closed two bypasses:
--   * status shortcut: only owner roles (incl. SECURITY DEFINER lifecycle
--     commands) may move a company into 'deleted_test_only';
--   * TRUNCATE skips row triggers: a statement guard refuses TRUNCATE by
--     non-owner roles on companies, customers and every table referencing them.
--   * the canonical lifecycle allows pending_deletion -> deleted_test_only; no
--     role (owner/SECURITY DEFINER included) may mark or hard-delete a tenant as
--     disposable while it holds retained history (real customers, contracts,
--     invoices, settlement or charge ledgers).
-- Forward-only; retention-class purge workflows remain separate.

create or replace function public.gridex_company_retained_history_v1(p_company_id uuid)
returns text[]
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select array_remove(array[
    case when exists (select 1 from public.customers c where c.company_id = p_company_id
      and c.is_test_data is not true and coalesce(lower(c.source), '') not like '%test%') then 'customers' end,
    case when exists (select 1 from public.customer_contracts x where x.company_id = p_company_id) then 'customer_contracts' end,
    case when exists (select 1 from public.customer_invoices x where x.company_id = p_company_id) then 'customer_invoices' end,
    case when exists (select 1 from public.invoice_documents x where x.company_id = p_company_id) then 'invoice_documents' end,
    case when exists (select 1 from public.billing_underlays x where x.company_id = p_company_id) then 'billing_underlays' end,
    case when exists (select 1 from public.contract_charge_ledger x where x.company_id = p_company_id) then 'contract_charge_ledger' end
  ], null)
$function$;

-- Invoker rights on purpose: guards call it as the acting role, and it only sees rows that role can read.

create or replace function public.gridex_guard_company_hard_delete_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_retained text[];
begin
  if current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  if old.status = 'deleted_test_only' then
    v_retained := public.gridex_company_retained_history_v1(old.id);
    if cardinality(v_retained) = 0 then
      return old;
    end if;
    raise exception using
      errcode = '23001',
      message = 'company_hard_delete_blocked',
      detail = 'Disposable tenant still holds retained history: ' || array_to_string(v_retained, ',');
  end if;
  raise exception using
    errcode = '23001',
    message = 'company_hard_delete_blocked',
    detail = 'Retained audit, journal and billing history would be cascaded away; close the tenant through canonical_transition_tenant_lifecycle.';
end
$function$;

create or replace function public.gridex_guard_customer_hard_delete_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  raise exception using
    errcode = '23001',
    message = 'customer_hard_delete_blocked',
    detail = 'Use gridex_delete_test_customer_v1 for test customers; real customers keep their history.';
end
$function$;

revoke all on function public.gridex_guard_company_hard_delete_v1() from public, anon, authenticated, service_role;
revoke all on function public.gridex_guard_customer_hard_delete_v1() from public, anon, authenticated, service_role;

drop trigger if exists gridex_companies_hard_delete_guard on public.companies;
create trigger gridex_companies_hard_delete_guard
  before delete on public.companies
  for each row execute function public.gridex_guard_company_hard_delete_v1();

drop trigger if exists gridex_customers_hard_delete_guard on public.customers;
create trigger gridex_customers_hard_delete_guard
  before delete on public.customers
  for each row execute function public.gridex_guard_customer_hard_delete_v1();

create or replace function public.gridex_guard_company_disposable_status_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_retained text[];
begin
  if new.status = 'deleted_test_only' and old.status is distinct from 'deleted_test_only' then
    if current_user not in ('postgres', 'supabase_admin') then
      raise exception using
        errcode = '23001',
        message = 'company_disposable_status_blocked',
        detail = 'Only the canonical lifecycle command may mark a tenant disposable.';
    end if;
    -- Applies to every role, including the SECURITY DEFINER lifecycle command.
    v_retained := public.gridex_company_retained_history_v1(new.id);
    if cardinality(v_retained) > 0 then
      raise exception using
        errcode = '23001',
        message = 'company_disposable_retained_history',
        detail = 'Tenant holds retained history: ' || array_to_string(v_retained, ',');
    end if;
  end if;
  return new;
end
$function$;

create or replace function public.gridex_guard_history_truncate_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return null;
  end if;
  raise exception using
    errcode = '23001',
    message = 'history_truncate_blocked',
    detail = format('TRUNCATE of %I.%I would remove retained history.', tg_table_schema, tg_table_name);
end
$function$;

revoke all on function public.gridex_guard_company_disposable_status_v1() from public, anon, authenticated, service_role;
revoke all on function public.gridex_guard_history_truncate_v1() from public, anon, authenticated, service_role;

drop trigger if exists gridex_companies_disposable_status_guard on public.companies;
create trigger gridex_companies_disposable_status_guard
  before update of status on public.companies
  for each row execute function public.gridex_guard_company_disposable_status_v1();

do $guard$
declare
  t regclass;
begin
  for t in
    select distinct c.oid::regclass
    from pg_class c
    where c.oid in ('public.companies'::regclass, 'public.customers'::regclass)
       or c.oid in (
         select con.conrelid from pg_constraint con
         where con.contype = 'f'
           and con.confrelid in ('public.companies'::regclass, 'public.customers'::regclass))
  loop
    execute format('drop trigger if exists gridex_history_truncate_guard on %s', t);
    execute format('create trigger gridex_history_truncate_guard before truncate on %s for each statement execute function public.gridex_guard_history_truncate_v1()', t);
  end loop;
end
$guard$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261005130000','hard_delete_guard_companies_customers') on conflict (version) do nothing;

-- ===== 20261005160940_classify_tenant_staff_external_identity_tables =====
-- Classify the three private external staff identity tables without changing
-- their authority. Parent invitations have a globally unique id and each child
-- has a validated (invitation_id,company_id) FK with company_id NOT NULL, so the
-- company-scoped unique key admits exactly the same rows, including NULL
-- invitation ids on explicitly enrolled bindings. The isolation gate stays intact.
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';

DO $classify_staff_identity$
DECLARE
 v_table text;
 v_relation regclass;
 v_parent regclass := 'public.company_invitations'::regclass;
 v_parent_id smallint;
 v_parent_company smallint;
 v_invitation smallint;
 v_company smallint;
 v_unique record;
BEGIN
 SELECT attnum INTO STRICT v_parent_id FROM pg_catalog.pg_attribute
 WHERE attrelid=v_parent AND attname='id' AND NOT attisdropped;
 SELECT attnum INTO STRICT v_parent_company FROM pg_catalog.pg_attribute
 WHERE attrelid=v_parent AND attname='company_id' AND NOT attisdropped;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_constraint
  WHERE conrelid=v_parent AND contype='p' AND convalidated AND NOT condeferrable
   AND conkey=ARRAY[v_parent_id]::smallint[])
 THEN RAISE EXCEPTION 'staff_identity_classification_parent_mismatch'; END IF;

 FOREACH v_table IN ARRAY ARRAY['tenant_staff_actor_anchors','tenant_staff_identity_deliveries','tenant_staff_identity_bindings'] LOOP
  v_relation:=pg_catalog.to_regclass('public.'||v_table);
  IF v_relation IS NULL THEN RAISE EXCEPTION 'staff_identity_classification_table_missing: %',v_table; END IF;
  EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',v_relation);
  SELECT attnum INTO STRICT v_invitation FROM pg_catalog.pg_attribute
  WHERE attrelid=v_relation AND attname='invitation_id' AND atttypid='uuid'::regtype AND NOT attisdropped;
  SELECT attnum INTO v_company FROM pg_catalog.pg_attribute
  WHERE attrelid=v_relation AND attname='company_id' AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped;
  IF v_company IS NULL OR NOT EXISTS(SELECT FROM pg_catalog.pg_constraint
   WHERE conrelid=v_relation AND contype='f' AND convalidated AND NOT condeferrable
    AND conkey=ARRAY[v_invitation,v_company]::smallint[]
    AND confrelid=v_parent AND confkey=ARRAY[v_parent_id,v_parent_company]::smallint[])
  THEN RAISE EXCEPTION 'staff_identity_classification_company_fk_mismatch: %',v_table; END IF;
  SELECT c.*,i.indisunique,i.indisvalid,i.indnullsnotdistinct INTO v_unique
  FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_index i ON i.indexrelid=c.conindid
  WHERE c.conrelid=v_relation AND c.conname=v_table||'_invitation_id_key' AND c.contype='u'
   AND c.convalidated AND NOT c.condeferrable;
  IF NOT FOUND OR v_unique.conkey NOT IN(ARRAY[v_invitation]::smallint[],ARRAY[v_invitation,v_company]::smallint[])
   OR NOT v_unique.indisunique OR NOT v_unique.indisvalid OR v_unique.indnullsnotdistinct
  THEN RAISE EXCEPTION 'staff_identity_classification_unique_mismatch: %',v_table; END IF;
  IF EXISTS(SELECT FROM pg_catalog.pg_constraint WHERE contype='f' AND conindid=v_unique.conindid)
  THEN RAISE EXCEPTION 'staff_identity_classification_unique_dependency: %',v_table; END IF;
  IF v_unique.conkey=ARRAY[v_invitation]::smallint[] THEN
   -- No CASCADE: unexpected dependent objects must stop this atomic forward.
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I UNIQUE(invitation_id,company_id)',
    v_relation,v_unique.conname,v_unique.conname);
  END IF;
 END LOOP;

 INSERT INTO public.platform_table_classification(table_name,kind,rationale,null_company_meaning,classified_by)
 VALUES
  ('tenant_staff_actor_anchors','tenant','Company-owned no-login central staff actor anchors, bound to an invitation and protected by private RLS and canonical authority.',NULL,'migration:classify_tenant_staff_external_identity_tables'),
  ('tenant_staff_identity_deliveries','tenant','Company-owned staff invitation delivery intents and verified receipts, with composite company ownership and private RLS.',NULL,'migration:classify_tenant_staff_external_identity_tables'),
  ('tenant_staff_identity_bindings','tenant','Company-owned explicit tenant Auth to central staff actor bindings, with composite company ownership and private RLS.',NULL,'migration:classify_tenant_staff_external_identity_tables')
 ON CONFLICT(table_name) DO UPDATE SET kind=EXCLUDED.kind,rationale=EXCLUDED.rationale,
  null_company_meaning=EXCLUDED.null_company_meaning,classified_by=EXCLUDED.classified_by,classified_at=now()
 WHERE (platform_table_classification.kind,platform_table_classification.rationale,platform_table_classification.null_company_meaning,platform_table_classification.classified_by)
  IS DISTINCT FROM (EXCLUDED.kind,EXCLUDED.rationale,EXCLUDED.null_company_meaning,EXCLUDED.classified_by);
END $classify_staff_identity$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261005160940','classify_tenant_staff_external_identity_tables') on conflict (version) do nothing;

-- ===== 20261007110303_company_readiness_optional_esett =====
-- Optional historical company status must fail closed on current row shapes.
-- No column/status/evidence/grant is created; missing eSett status remains blocked.
-- Converge tenant/go-live readiness on canonical runtime state.
-- This migration is intentionally tenant-generic: no company IDs, Ediel IDs,
-- routes, test cases, counterparties, or credentials are hardcoded.

create or replace function public.gridex_company_go_live_readiness(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'extensions'
as $function$
declare
  c public.companies%rowtype;
  blockers text[] := array[]::text[];
  prodat_total integer := 6;
  utilts_total integer := 5;
  prodat_passed integer := 0;
  utilts_passed integer := 0;
  v_prod_actor_count integer := 0;
  v_test_actor_count integer := 0;
  v_prod_actor_id uuid;
  v_test_actor_id uuid;
  v_has_prod_route boolean := false;
  v_has_test_route boolean := false;
  v_has_brp boolean := false;
  v_has_prod_mailbox boolean := false;
  v_prod_receiver_source text;
  v_prod_dynamic_strategy text;
  v_prod_receiver_ediel_id text;
  v_prod_mailbox_id uuid;
  v_prod_application_reference text;
  v_prod_certificate_required boolean;
  v_prod_certificate_id uuid;
  v_prod_receiver_certificate_id uuid;
  v_dynamic_receiver boolean := false;
  v_evidence jsonb := '{}'::jsonb;
  v_evidence_ready boolean := false;
begin
  select * into c
  from public.companies
  where id = p_company_id;

  if not found then
    return jsonb_build_object(
      'company_id', p_company_id,
      'status', 'missing_company',
      'blockers', jsonb_build_array('Bolaget hittades inte')
    );
  end if;

  select count(*)
  into v_prod_actor_count
  from public.ediel_actor_settings eas
  where eas.company_id = p_company_id
    and eas.environment = 'production'
    and coalesce(eas.is_active, false) = true
    and lower(coalesce(eas.actor_role, eas.role, '')) in ('supplier', 'electricity_supplier');

  if v_prod_actor_count = 1 then
    select eas.id
    into v_prod_actor_id
    from public.ediel_actor_settings eas
    where eas.company_id = p_company_id
      and eas.environment = 'production'
      and coalesce(eas.is_active, false) = true
      and lower(coalesce(eas.actor_role, eas.role, '')) in ('supplier', 'electricity_supplier')
    order by eas.updated_at desc, eas.id
    limit 1;
  elsif v_prod_actor_count = 0 then
    blockers := array_append(blockers, 'Aktiv supplier-produktionsaktörsprofil saknas');
  else
    blockers := array_append(blockers, 'Flera aktiva supplier-produktionsaktörsprofiler finns');
  end if;

  select count(*)
  into v_test_actor_count
  from public.ediel_actor_settings eas
  where eas.company_id = p_company_id
    and eas.environment = 'test'
    and coalesce(eas.is_active, false) = true
    and lower(coalesce(eas.actor_role, eas.role, '')) in ('supplier', 'electricity_supplier');

  if v_test_actor_count = 1 then
    select eas.id
    into v_test_actor_id
    from public.ediel_actor_settings eas
    where eas.company_id = p_company_id
      and eas.environment = 'test'
      and coalesce(eas.is_active, false) = true
      and lower(coalesce(eas.actor_role, eas.role, '')) in ('supplier', 'electricity_supplier')
    order by eas.updated_at desc, eas.id
    limit 1;
  elsif v_test_actor_count = 0 then
    blockers := array_append(blockers, 'Aktiv supplier-testaktörsprofil saknas');
  else
    blockers := array_append(blockers, 'Flera aktiva supplier-testaktörsprofiler finns');
  end if;

  if v_prod_actor_id is not null then
    select exists(
      select 1
      from public.ediel_route_profiles erp
      where erp.company_id = p_company_id
        and erp.environment = 'production'
        and erp.actor_setting_id = v_prod_actor_id
        and coalesce(erp.is_enabled, false) = true
        and coalesce(erp.is_active, true) = true
        and upper(coalesce(erp.message_family, '')) = 'PRODAT'
    ) into v_has_prod_route;

    select
      erp.receiver_source,
      erp.dynamic_receiver_strategy,
      erp.receiver_ediel_id,
      erp.mailbox_id,
      erp.application_reference,
      coalesce(erp.certificate_required, false),
      erp.certificate_id,
      erp.receiver_certificate_id
    into
      v_prod_receiver_source,
      v_prod_dynamic_strategy,
      v_prod_receiver_ediel_id,
      v_prod_mailbox_id,
      v_prod_application_reference,
      v_prod_certificate_required,
      v_prod_certificate_id,
      v_prod_receiver_certificate_id
    from public.ediel_route_profiles erp
    where erp.company_id = p_company_id
      and erp.environment = 'production'
      and erp.actor_setting_id = v_prod_actor_id
      and coalesce(erp.is_enabled, false) = true
      and coalesce(erp.is_active, true) = true
      and upper(coalesce(erp.message_family, '')) = 'PRODAT'
    order by coalesce(erp.is_production_route, false) desc, erp.updated_at desc, erp.id
    limit 1;
  end if;

  if v_test_actor_id is not null then
    select exists(
      select 1
      from public.ediel_route_profiles erp
      where erp.company_id = p_company_id
        and erp.environment = 'test'
        and erp.actor_setting_id = v_test_actor_id
        and coalesce(erp.is_enabled, false) = true
        and coalesce(erp.is_active, true) = true
    ) into v_has_test_route;
  end if;

  v_dynamic_receiver :=
    lower(coalesce(v_prod_receiver_source, '')) in (
      'selected_metering_point_grid_owner',
      'selected_customer_site_grid_owner',
      'selected_supplier_switch_grid_owner',
      'selected_data_request_grid_owner',
      'original_inbound_sender',
      'original_inbound_receiver'
    )
    or (
      nullif(btrim(coalesce(v_prod_dynamic_strategy, '')), '') is not null
      and lower(v_prod_dynamic_strategy) <> 'resolve_from_counterparty_id'
    );

  select exists(
    select 1
    from public.ediel_brp_settings b
    where b.company_id = p_company_id
      and b.environment = 'production'
      and coalesce(b.is_active, true) = true
      and nullif(btrim(coalesce(b.brp_ediel_id, '')), '') is not null
  ) into v_has_brp;

  if v_prod_mailbox_id is not null then
    select exists(
      select 1
      from public.ediel_mailboxes m
      where m.id = v_prod_mailbox_id
        and m.environment = 'production'
        and coalesce(m.is_active, false) = true
        and (m.company_id = p_company_id or m.company_id is null)
    ) into v_has_prod_mailbox;
  end if;
  v_has_prod_mailbox := v_has_prod_mailbox
    or nullif(btrim(coalesce(c.production_mailbox, '')), '') is not null;

  begin
    v_evidence := public.canonical_ediel_production_evidence_readiness(p_company_id);
    v_evidence_ready := coalesce((v_evidence ->> 'ready')::boolean, false);
  exception when others then
    v_evidence := jsonb_build_object('ready', false, 'error', sqlerrm);
    v_evidence_ready := false;
  end;

  if v_evidence_ready then
    prodat_passed := prodat_total;
    utilts_passed := utilts_total;
  elsif to_regclass('public.actor_test_results') is not null then
    select
      count(*) filter (
        where package_key = 'PRODAT_SUPPLIER'
          and status in ('passed', 'manual_verified')
          and coalesce(is_stale, false) = false
      ),
      count(*) filter (
        where package_key = 'UTILTS_METERING'
          and status in ('passed', 'manual_verified')
          and coalesce(is_stale, false) = false
      )
    into prodat_passed, utilts_passed
    from public.actor_test_results
    where company_id = p_company_id;
  end if;

  if nullif(btrim(coalesce(c.org_number, '')), '') is null then
    blockers := array_append(blockers, 'Orgnummer saknas');
  end if;
  if nullif(btrim(coalesce(c.production_ediel_id, c.ediel_id, '')), '') is null then
    blockers := array_append(blockers, 'Produktions Ediel-id saknas');
  end if;
  if not v_has_brp then
    blockers := array_append(blockers, 'Aktiv production-BRP saknas');
  end if;
  if lower(coalesce(to_jsonb(c)->>'esett_status', 'missing')) <> 'ready' then
    blockers := array_append(blockers, 'eSett-status är inte klar');
  end if;
  if not v_has_prod_route then
    blockers := array_append(blockers, 'Supplier-bunden PRODAT-produktionsroute saknas');
  end if;
  if not v_has_test_route then
    blockers := array_append(blockers, 'Supplier-bunden test-route saknas');
  end if;
  if not v_has_prod_mailbox then
    blockers := array_append(blockers, 'Produktionsmailbox/transport saknas');
  end if;
  if v_has_prod_route and nullif(btrim(coalesce(v_prod_application_reference, c.production_application_reference, '')), '') is null then
    blockers := array_append(blockers, 'Produktions Application Reference saknas');
  end if;
  if v_has_prod_route and not v_dynamic_receiver and nullif(btrim(coalesce(v_prod_receiver_ediel_id, '')), '') is null then
    blockers := array_append(blockers, 'Fast produktionsmotpart saknas och dynamisk receiver är inte konfigurerad');
  end if;
  if v_has_prod_route
     and coalesce(v_prod_certificate_required, false)
     and not v_dynamic_receiver
     and v_prod_certificate_id is null
     and v_prod_receiver_certificate_id is null then
    blockers := array_append(blockers, 'Mottagarcertifikat saknas för fast PRODAT-produktionsroute');
  end if;

  if not v_evidence_ready then
    blockers := array_append(
      blockers,
      format(
        'Canonical Ediel-evidens är inte komplett (PRODAT %s/%s, UTILTS %s/%s)',
        prodat_passed, prodat_total, utilts_passed, utilts_total
      )
    );
  end if;

  return jsonb_build_object(
    'company_id', p_company_id,
    'status', case when cardinality(blockers) = 0 then 'ready' else 'blocked' end,
    'blockers', to_jsonb(blockers),
    'prodat_passed', prodat_passed,
    'prodat_total', prodat_total,
    'utilts_passed', utilts_passed,
    'utilts_total', utilts_total,
    'has_production_actor', v_prod_actor_count = 1,
    'has_test_actor', v_test_actor_count = 1,
    'has_production_route', v_has_prod_route,
    'has_test_route', v_has_test_route,
    'has_production_mailbox', v_has_prod_mailbox,
    'dynamic_receiver_capable', v_dynamic_receiver,
    'evidence_ready', v_evidence_ready,
    'evidence', v_evidence,
    'source', 'canonical_runtime_v2'
  );
end;
$function$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261007110303','company_readiness_optional_esett') on conflict (version) do nothing;

-- ===== 20261009090000_ops_api_exact_accepted_poa_document =====
-- OPS API review F42/F28 (2026-10-07): exact accepted power-of-attorney document.
--
-- F42: the deployed normalization trigger for powers_of_attorney legal
-- references existed only in the live catalog. Version it verbatim so clean
-- restores keep the tenant/module/lock guard.
--
-- F28: a website POA could reference another published, locked POA document of
-- the same company instead of the document in the accepted legal bundle. The
-- onboarding core records the accepted bundle (already checked against the
-- quote/offer by the wrapper) in customer_onboarding_legal_snapshots and links
-- the POA to that snapshot in the same transaction. Enforce equality there,
-- independent of the client payload.

CREATE OR REPLACE FUNCTION public.gridex_normalize_power_of_attorney_legal_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_candidate uuid;
  v_candidate_text text;
  v_document_company_id uuid;
  v_module_key text;
  v_locked_at timestamptz;
  v_linked_legacy_id uuid;
  v_legacy_exists boolean := false;
begin
  if new.legal_text_version_id is not null then
    select exists (
      select 1 from public.legal_text_versions legacy
      where legacy.id = new.legal_text_version_id
    ) into v_legacy_exists;
  end if;

  v_candidate := new.legal_bundle_version_document_id;

  -- Compatibility path for the website onboarding RPC that historically
  -- transported the canonical legal document id through legal_text_version_id.
  if v_candidate is null
     and new.legal_text_version_id is not null
     and not v_legacy_exists then
    v_candidate := new.legal_text_version_id;
    new.legal_text_version_id := null;
  end if;

  -- Other canonical writers already persist the immutable document id in their
  -- captured evidence/snapshot. Normalize those writes into the first-class
  -- column without changing their external behavior.
  if v_candidate is null then
    v_candidate_text := coalesce(
      nullif(new.evidence_payload->>'legal_bundle_version_document_id', ''),
      nullif(new.fullmakt_snapshot->>'legal_bundle_version_document_id', ''),
      nullif(new.metadata->>'legal_bundle_document_id', '')
    );
    if v_candidate_text is not null
       and v_candidate_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_candidate := v_candidate_text::uuid;
    end if;
  end if;

  if v_candidate is null then
    return new;
  end if;

  select lbv.company_id, d.module_key, lbv.locked_at, d.legacy_legal_text_version_id
    into v_document_company_id, v_module_key, v_locked_at, v_linked_legacy_id
    from public.legal_bundle_version_documents d
    join public.legal_bundle_versions lbv
      on lbv.id = d.legal_bundle_version_id
   where d.id = v_candidate;

  if not found then
    new.legal_bundle_version_document_id := v_candidate;
    return new; -- declarative FK returns the canonical 23503
  end if;

  if new.company_id is null or v_document_company_id is distinct from new.company_id then
    raise exception 'power_of_attorney_legal_document_tenant_mismatch' using errcode = '23514';
  end if;
  if v_module_key is distinct from 'power_of_attorney' then
    raise exception 'power_of_attorney_legal_document_type_mismatch' using errcode = '23514';
  end if;
  if v_locked_at is null then
    raise exception 'power_of_attorney_legal_document_not_locked' using errcode = '23514';
  end if;

  if new.legal_text_version_id is not null
     and v_linked_legacy_id is distinct from new.legal_text_version_id then
    raise exception 'power_of_attorney_legal_reference_mismatch' using errcode = '23514';
  end if;

  new.legal_bundle_version_document_id := v_candidate;
  return new;
end;
$function$;

drop trigger if exists powers_of_attorney_legal_reference_normalize_tg on public.powers_of_attorney;
create trigger powers_of_attorney_legal_reference_normalize_tg
  before insert or update on public.powers_of_attorney
  for each row execute function public.gridex_normalize_power_of_attorney_legal_reference();

create or replace function public.gridex_assert_onboarding_poa_matches_accepted_bundle()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.power_of_attorney_id is null or new.legal_bundle_version_id is null then
    return new;
  end if;
  if exists (
    select 1
      from public.powers_of_attorney poa
      join public.legal_bundle_version_documents d
        on d.id = poa.legal_bundle_version_document_id
     where poa.id = new.power_of_attorney_id
       and poa.company_id = new.company_id
       and d.legal_bundle_version_id is distinct from new.legal_bundle_version_id
  ) then
    raise exception 'power_of_attorney_offer_version_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.gridex_assert_poa_legal_snapshot_matches_bundle()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_bundle_id uuid;
begin
  if new.legal_snapshot_id is null or new.legal_bundle_version_document_id is null then
    return new;
  end if;
  select s.legal_bundle_version_id into v_bundle_id
    from public.customer_onboarding_legal_snapshots s
   where s.id = new.legal_snapshot_id
     and s.company_id = new.company_id;
  if v_bundle_id is not null and exists (
    select 1 from public.legal_bundle_version_documents d
     where d.id = new.legal_bundle_version_document_id
       and d.legal_bundle_version_id is distinct from v_bundle_id
  ) then
    raise exception 'power_of_attorney_offer_version_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.gridex_assert_onboarding_poa_matches_accepted_bundle() from public, anon, authenticated;
revoke all on function public.gridex_assert_poa_legal_snapshot_matches_bundle() from public, anon, authenticated;

drop trigger if exists customer_onboarding_legal_snapshots_poa_bundle_guard_tg on public.customer_onboarding_legal_snapshots;
create trigger customer_onboarding_legal_snapshots_poa_bundle_guard_tg
  before insert or update of power_of_attorney_id, legal_bundle_version_id on public.customer_onboarding_legal_snapshots
  for each row execute function public.gridex_assert_onboarding_poa_matches_accepted_bundle();

drop trigger if exists powers_of_attorney_legal_snapshot_bundle_guard_tg on public.powers_of_attorney;
create trigger powers_of_attorney_legal_snapshot_bundle_guard_tg
  before update of legal_snapshot_id, legal_bundle_version_document_id on public.powers_of_attorney
  for each row execute function public.gridex_assert_poa_legal_snapshot_matches_bundle();

insert into supabase_migrations.schema_migrations(version,name) values ('20261009090000','ops_api_exact_accepted_poa_document') on conflict (version) do nothing;

-- ===== 20261009100000_ops_api_contract_confirmation_delivery_continuation =====
-- OPS API review F27 (2026-10-07): durable signed-contract confirmation delivery.
--
-- Online signing finalizes the contract before archiving the PDF and queueing
-- the confirmation mail. A failure in between left no retry. A pending
-- continuation is now created in the same transaction that marks the
-- signature request used, so every signed contract has a tenant-bound delivery
-- record that a worker retries until the confirmation is queued.

create table if not exists public.customer_contract_confirmation_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_contract_id uuid not null,
  signature_request_id uuid not null references public.customer_contract_signature_requests(id) on delete restrict,
  state text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  queued_at timestamptz,
  document_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_contract_confirmation_deliveries_state_chk
    check (state in ('pending', 'queued', 'failed')),
  constraint customer_contract_confirmation_deliveries_attempts_chk check (attempts >= 0),
  constraint customer_contract_confirmation_deliveries_queued_chk
    check ((state = 'queued') = (queued_at is not null)),
  constraint customer_contract_confirmation_deliveries_request_key unique (signature_request_id)
);

comment on table public.customer_contract_confirmation_deliveries is
  'Durable continuation for the signed-contract confirmation mail (F27). Service-role only.';

create index if not exists customer_contract_confirmation_deliveries_due_idx
  on public.customer_contract_confirmation_deliveries (next_attempt_at)
  where state = 'pending';
create index if not exists customer_contract_confirmation_deliveries_company_contract_idx
  on public.customer_contract_confirmation_deliveries (company_id, customer_contract_id);

alter table public.customer_contract_confirmation_deliveries enable row level security;
revoke all on table public.customer_contract_confirmation_deliveries from public, anon, authenticated;
grant select, insert, update on table public.customer_contract_confirmation_deliveries to service_role;

create or replace function public.gridex_enqueue_contract_confirmation_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.customer_contract_confirmation_deliveries(
    company_id, customer_contract_id, signature_request_id
  ) values (
    new.company_id, new.customer_contract_id, new.id
  )
  on conflict (signature_request_id) do nothing;
  return new;
end;
$$;

revoke all on function public.gridex_enqueue_contract_confirmation_delivery() from public, anon, authenticated;

drop trigger if exists customer_contract_signature_requests_confirmation_delivery_tg
  on public.customer_contract_signature_requests;
create trigger customer_contract_signature_requests_confirmation_delivery_tg
  after update of used_at on public.customer_contract_signature_requests
  for each row
  when (old.used_at is null and new.used_at is not null)
  execute function public.gridex_enqueue_contract_confirmation_delivery();

insert into supabase_migrations.schema_migrations(version,name) values ('20261009100000','ops_api_contract_confirmation_delivery_continuation') on conflict (version) do nothing;

-- ===== 20261009110000_ops_api_session_guard_auth_revocation =====
-- OPS API review F30 (2026-10-07): Auth-level revocation ends tenant access.
--
-- gridex_is_current_session_allowed() checked only the profile status, so a
-- user banned or soft-deleted in Auth alone kept own-tenant RLS reads with a
-- still-valid access JWT. The guard now also requires the Auth user to exist,
-- not be soft-deleted and not be banned. Signature, owner and ACL unchanged;
-- gridex_user_company_ids() reuses this decision.

create or replace function public.gridex_is_current_session_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_catalog', 'pg_temp'
as $_$
declare
  v_user_id uuid := auth.uid();
  v_status text;
  v_disabled_at timestamptz;
begin
  if v_user_id is null then
    return false;
  end if;
  if not exists (
    select 1
      from auth.users u
     where u.id = v_user_id
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until <= now())
  ) then
    return false;
  end if;
  if to_regclass('public.user_profiles') is null then
    return true;
  end if;
  if exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'disabled_at'
  ) then
    execute
      'select profile.user_status,profile.disabled_at
       from public.user_profiles profile where profile.id=$1'
    into v_status, v_disabled_at
    using v_user_id;
  else
    select profile.user_status
    into v_status
    from public.user_profiles profile
    where profile.id = v_user_id;
  end if;
  if coalesce(v_status, 'active') in (
    'disabled',
    'locked_security',
    'removed_from_company',
    'invitation_revoked'
  ) then
    return false;
  end if;
  return v_disabled_at is null;
end
$_$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261009110000','ops_api_session_guard_auth_revocation') on conflict (version) do nothing;

-- ===== 20261009130000_portal_monthly_consumption_summary =====
-- ops-api-review F15: complete-month consumption totals for the OPS customer portal.
--
-- The portal previously summed only the newest 250/500 detail rows per month card. This function
-- aggregates the whole Europe/Stockholm calendar month natively, bounded to one tenant and the
-- authenticated portal customers, using only the current revision of each metering value
-- (corrections never double count) and only the gross consumption direction. Coverage fields let
-- the UI mark incomplete months (missing intervals) instead of presenting a partial sum as complete.

create or replace function public.gridex_portal_monthly_consumption_v1(
  p_company_id uuid,
  p_customer_ids uuid[],
  p_from_month date,
  p_to_month date
)
returns table (
  month_key text,
  total_kwh numeric,
  value_count bigint,
  metering_point_count bigint,
  covered_seconds bigint,
  expected_seconds bigint,
  is_complete boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_company_id is null
     or p_customer_ids is null
     or cardinality(p_customer_ids) = 0
     or cardinality(p_customer_ids) > 50
     or array_position(p_customer_ids, null) is not null then
    raise exception 'portal_consumption_scope_invalid' using errcode = '22023';
  end if;
  if p_from_month is null or p_to_month is null or p_from_month > p_to_month
     or p_to_month > (p_from_month + interval '36 months')::date then
    raise exception 'portal_consumption_period_invalid' using errcode = '22023';
  end if;
  -- Every requested customer must belong to the requested tenant.
  if exists (
    select 1
      from unnest(p_customer_ids) as requested(customer_id)
     where not exists (
       select 1 from public.customers c
        where c.id = requested.customer_id and c.company_id = p_company_id
     )
  ) then
    raise exception 'portal_consumption_customer_scope_invalid' using errcode = '42501';
  end if;

  v_from := date_trunc('month', p_from_month::timestamp) at time zone 'Europe/Stockholm';
  v_to := (date_trunc('month', p_to_month::timestamp) + interval '1 month') at time zone 'Europe/Stockholm';

  return query
  with current_values as (
    select
      to_char(date_trunc('month', mv.period_start at time zone 'Europe/Stockholm'), 'YYYY-MM') as month_key,
      coalesce(mv.metering_point_id::text, '') as metering_point,
      mv.value_kwh,
      case when mv.period_end > mv.period_start
           then extract(epoch from (mv.period_end - mv.period_start))
           else 0 end as seconds
    from public.metering_values mv
    where mv.company_id = p_company_id
      and mv.customer_id = any(p_customer_ids)
      and mv.period_start >= v_from
      and mv.period_start < v_to
      and mv.is_current
      and mv.revision_status = 'current'
      and mv.direction = 'consumption'
      and mv.value_kwh is not null
  ),
  months as (
    select
      cv.month_key,
      sum(cv.value_kwh)::numeric as total_kwh,
      count(*)::bigint as value_count,
      count(distinct cv.metering_point)::bigint as metering_point_count,
      sum(cv.seconds)::bigint as covered_seconds
    from current_values cv
    group by cv.month_key
  )
  select
    m.month_key,
    m.total_kwh,
    m.value_count,
    m.metering_point_count,
    m.covered_seconds,
    (m.metering_point_count * extract(epoch from (
      ((to_date(m.month_key, 'YYYY-MM') + interval '1 month')::timestamp at time zone 'Europe/Stockholm')
      - (to_date(m.month_key, 'YYYY-MM')::timestamp at time zone 'Europe/Stockholm')
    )))::bigint as expected_seconds,
    m.covered_seconds >= (m.metering_point_count * extract(epoch from (
      ((to_date(m.month_key, 'YYYY-MM') + interval '1 month')::timestamp at time zone 'Europe/Stockholm')
      - (to_date(m.month_key, 'YYYY-MM')::timestamp at time zone 'Europe/Stockholm')
    )))::bigint as is_complete
  from months m
  order by m.month_key desc;
end;
$$;

revoke all on function public.gridex_portal_monthly_consumption_v1(uuid, uuid[], date, date) from public;
revoke all on function public.gridex_portal_monthly_consumption_v1(uuid, uuid[], date, date) from anon;
revoke all on function public.gridex_portal_monthly_consumption_v1(uuid, uuid[], date, date) from authenticated;
grant execute on function public.gridex_portal_monthly_consumption_v1(uuid, uuid[], date, date) to service_role;

comment on function public.gridex_portal_monthly_consumption_v1(uuid, uuid[], date, date) is
  'OPS portal: complete Europe/Stockholm month consumption totals per tenant/customer set; current revision and gross consumption only; service_role only.';

insert into supabase_migrations.schema_migrations(version,name) values ('20261009130000','portal_monthly_consumption_summary') on conflict (version) do nothing;

-- ===== 20261009140000_customer_site_address_source_authority =====
-- OPS API review F21 (quality/audits/2026-10-07-ops-api-review/STATE-FAILURE-FINDINGS.md).
-- Forward replacement of gridex_commit_customer_site_address with the same
-- signature and ACL. The verified-source conflict decision is repeated under
-- the locked customer_sites row, and a same-hash commit from a lower-ranked
-- source no longer downgrades the canonical source or verification.

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
  v_address_changed boolean;
  v_previous_source text;
  v_previous_verified boolean;
  v_previous_rank integer;
  v_incoming_rank integer;
  v_keep_authority boolean;
begin
  select address_hash, address_source,
         (address_verified_at is not null or address_verification_method = 'grid_owner_response')
    into v_previous_hash, v_previous_source, v_previous_verified
    from public.customer_sites
   where id = p_site_id and company_id = p_company_id and customer_id = p_customer_id
   for update;
  if not found then raise exception 'customer_site_not_found' using errcode = 'P0002'; end if;
  if nullif(btrim(p_address_hash), '') is null then raise exception 'address_hash_required' using errcode = '22023'; end if;

  -- Source authority mirrors lib/customer-sites/addressIntake.ts sourceRank().
  -- Unknown stored/incoming values never trigger a conflict (rank NULL).
  v_previous_rank := case coalesce(v_previous_source, 'import')
    when 'grid_owner_response' then 70 when 'superadmin' then 60 when 'tenant_api' then 50
    when 'manual_intake' then 40 when 'website' then 30 when 'customer_portal' then 20 when 'import' then 10 end;
  v_incoming_rank := case p_source
    when 'grid_owner_response' then 70 when 'superadmin' then 60 when 'tenant_api' then 50
    when 'manual_intake' then 40 when 'website' then 30 when 'customer_portal' then 20 when 'import' then 10 end;

  -- NULL -> canonical hash is the first canonicalization of the address already
  -- present on the site. It is not a later customer address change and must not
  -- stale jobs, requests, grid context or metering context.
  v_address_changed := v_previous_hash is not null and v_previous_hash is distinct from p_address_hash;

  -- F21: repeat the verified-address conflict decision atomically under the
  -- locked row. A lower-ranked source may not replace a verified address.
  if v_address_changed and coalesce(v_previous_verified, false) and v_incoming_rank < v_previous_rank then
    raise exception 'verified_address_conflict' using errcode = 'P0001',
      detail = 'A lower-ranked address source cannot replace a verified facility address.';
  end if;
  -- Same physical address from a lower-ranked source keeps the canonical
  -- source, reference and verification; only receipt/informational fields move.
  v_keep_authority := not v_address_changed and v_previous_hash is not null and v_incoming_rank < v_previous_rank;

  if v_address_changed then
    update public.customer_operation_jobs
       set status = 'needs_review', stale_reason = 'site_address_changed_after_operation_started',
           last_error = 'Anläggningsadressen ändrades. Nätägar- och routinguppgifter har ogiltigförklarats.',
           completed_at = v_now, locked_at = null, locked_by = null, lock_token = null, updated_at = v_now
     where company_id = p_company_id and customer_site_id = p_site_id
       and status in ('queued','running','waiting_response');

    update public.customer_info_requests
       set status = 'manual_review_required', blocker_reason = 'Anläggningsadressen ändrades. Skapa en ny nätägarresolution och begäran.', updated_at = v_now
     where company_id = p_company_id and customer_id = p_customer_id and site_id = p_site_id
       and status in ('draft','ready_to_send','z01_prepared','waiting_for_z02','waiting_for_aperak','waiting_for_contrl');

    update public.grid_owner_information_requests
       set status = 'needs_review',
           last_error_code = 'site_address_changed',
           last_error_message = 'Begäran gäller en tidigare adress och får inte återanvändas.',
           metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('stale',true,'stale_at',v_now,'stale_reason','site_address_changed'),
           updated_at = v_now
     where company_id = p_company_id and customer_id = p_customer_id and customer_site_id = p_site_id
       and status in ('draft','ready_to_send','sent','waiting_response','blocked_missing_poa','blocked_missing_grid_owner_contact',
                      'blocked_missing_manual_mailbox','ready_to_send_manual_email','manual_email_queued','manual_email_sent','waiting_manual_response');

    update public.manual_email_outbox o
       set status = case when o.status in ('queued','sending') then 'failed' else o.status end,
           last_error = case when o.status in ('queued','sending') then 'Begäran ogiltigförklarades eftersom anläggningsadressen ändrades.' else o.last_error end,
           updated_at = v_now
      from public.grid_owner_information_requests r
     where o.request_id = r.id and r.company_id = p_company_id and r.customer_site_id = p_site_id
       and o.status in ('queued','sending');
  end if;

  update public.customer_sites
     set street = p_street, postal_code = p_postal_code, city = p_city, country = p_country,
         care_of = p_care_of, apartment_number = p_apartment_number,
         address_normalized = p_address_normalized, address_hash = p_address_hash,
         address_source = case when v_keep_authority then address_source else p_source end,
         address_source_reference = case when v_keep_authority then address_source_reference else p_source_reference end,
         address_received_at = v_now,
         address_verified_at = case when v_keep_authority then address_verified_at when p_source = 'grid_owner_response' then v_now else null end,
         address_verification_method = case when v_keep_authority then address_verification_method when p_source = 'grid_owner_response' then 'grid_owner_response' else null end,
         address_confidence = case when v_keep_authority then address_confidence when p_source = 'grid_owner_response' then 1 else null end,
         address_status = case when v_keep_authority then address_status when p_source = 'grid_owner_response' then 'verified' else 'candidate' end,
         address_quality_status = 'complete', address_quality_warnings = '[]'::jsonb,
         -- Canonical grid context is always derived by the resolver or a verified
         -- grid-owner response. Claimed values remain evidence in metadata only.
         grid_owner_id = case when v_address_changed then null else grid_owner_id end,
         selected_grid_owner_id = case when v_address_changed then null else selected_grid_owner_id end,
         grid_area_code = case when v_address_changed then null else grid_area_code end,
         price_area_code = case when v_address_changed then null else price_area_code end,
         bidding_zone_code = case when v_address_changed then null else bidding_zone_code end,
         resolution_id = case when v_address_changed then null else resolution_id end,
         resolution_status = case when v_address_changed then 'pending_resolution' else resolution_status end,
         resolution_confidence = case when v_address_changed then null else resolution_confidence end,
         facility_data_status = case when v_keep_authority then facility_data_status when p_source = 'grid_owner_response' then 'verified' when v_address_changed then 'unverified' else facility_data_status end,
         metadata = coalesce(metadata,'{}'::jsonb) || coalesce(p_metadata,'{}'::jsonb), updated_at = v_now
   where id = p_site_id and company_id = p_company_id and customer_id = p_customer_id;

  if v_address_changed then
    update public.metering_points
       set grid_owner_id = null, grid_area_code = null, price_area_code = null,
           verification_status = 'pending_verification', updated_at = v_now
     where company_id = p_company_id and (site_id = p_site_id or customer_site_id = p_site_id) and status <> 'closed';
  end if;

  select id into v_address_id from public.customer_addresses
   where company_id = p_company_id and customer_id = p_customer_id and type = 'facility'
     and metadata @> jsonb_build_object('customer_site_id', p_site_id)
   order by updated_at desc nulls last limit 1 for update;
  if v_address_id is null then
    insert into public.customer_addresses(company_id,customer_id,type,street_1,street_2,postal_code,city,country,is_active,metadata,created_at,updated_at)
    values(p_company_id,p_customer_id,'facility',p_street,p_care_of,p_postal_code,p_city,p_country,true,
      jsonb_build_object('customer_site_id',p_site_id,'address_hash',p_address_hash,'source',p_source),v_now,v_now);
  else
    update public.customer_addresses set street_1=p_street,street_2=p_care_of,postal_code=p_postal_code,city=p_city,country=p_country,
      is_active=true,metadata=jsonb_build_object('customer_site_id',p_site_id,'address_hash',p_address_hash,'source',p_source),updated_at=v_now
    where id=v_address_id;
  end if;

  insert into public.customer_site_address_history(company_id,customer_id,customer_site_id,address_hash,source,source_reference,actor_user_id,snapshot)
  values(p_company_id,p_customer_id,p_site_id,p_address_hash,p_source,p_source_reference,p_actor_user_id,
    jsonb_build_object('street',p_street,'postal_code',p_postal_code,'city',p_city,'country',p_country,'care_of',p_care_of,
      'apartment_number',p_apartment_number,'address_hash',p_address_hash,'source',p_source,'source_reference',p_source_reference,
      'claimed_grid_owner_id',p_metadata->>'claimed_grid_owner_id','claimed_grid_area_code',p_metadata->>'claimed_grid_area_code',
      'claimed_price_area_code',p_metadata->>'claimed_price_area_code','derived_context_invalidated',v_address_changed));
end;
$$;

revoke all on function public.gridex_commit_customer_site_address(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.gridex_commit_customer_site_address(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb,uuid) to service_role;

insert into supabase_migrations.schema_migrations(version,name) values ('20261009140000','customer_site_address_source_authority') on conflict (version) do nothing;

-- ===== 20261009160000_ops_api_service_only_restore_grants =====
-- OPS API review F5 (2026-10-07): make service-only ACLs explicit.
--
-- The canonical snapshot still grants authenticated EXECUTE on two legacy
-- SECURITY DEFINER helpers; convergence migration 20260904120000 revoked
-- PUBLIC and anon but not that explicit grant. Live already denies both roles.
-- This forward migration makes clean restores and upgrades converge to the
-- live, intended state without changing function bodies.

revoke all on function public.gridex_db4b_archive_customer_registry_row(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.gridex_db4b_archive_customer_registry_row(text, text, boolean, text) to service_role;

revoke all on function public.gridex_next_customer_number(uuid) from public, anon, authenticated;
grant execute on function public.gridex_next_customer_number(uuid) to service_role;

insert into supabase_migrations.schema_migrations(version,name) values ('20261009160000','ops_api_service_only_restore_grants') on conflict (version) do nothing;

-- ===== 20261009170000_ops_api_drop_duplicate_indexes =====
-- OPS API review F31 (2026-10-07): remove two verified duplicate indexes.
--
-- Each pair has identical definitions, no constraint owner and 16 kB size.
-- The canonical index of each pair is kept; a duplicate is dropped only when
-- its twin still exists with the same column list and predicate, so
-- uniqueness and query plans are unchanged.

do $dedupe$
declare
  pair record;
begin
  for pair in
    select * from (values
      ('ux_customers_company_customer_number', 'customers_company_customer_number_uk'),
      ('idx_fk_customer_case_events_b634ce08bab5', 'customer_case_events_customer_idx')
    ) as p(duplicate_name, keep_name)
  loop
    if to_regclass('public.' || pair.duplicate_name) is null then
      continue;
    end if;
    if to_regclass('public.' || pair.keep_name) is null then
      raise notice 'keeping % because % is missing', pair.duplicate_name, pair.keep_name;
      continue;
    end if;
    if exists (
      select 1
        from pg_index d, pg_index k
       where d.indexrelid = ('public.' || pair.duplicate_name)::regclass
         and k.indexrelid = ('public.' || pair.keep_name)::regclass
         and d.indrelid = k.indrelid
         and d.indkey = k.indkey
         and d.indisunique = k.indisunique
         and d.indclass = k.indclass
         and coalesce(pg_get_expr(d.indpred, d.indrelid), '') = coalesce(pg_get_expr(k.indpred, k.indrelid), '')
         and coalesce(pg_get_expr(d.indexprs, d.indrelid), '') = coalesce(pg_get_expr(k.indexprs, k.indrelid), '')
         and not exists (select 1 from pg_constraint c where c.conindid = d.indexrelid)
    ) then
      execute format('drop index public.%I', pair.duplicate_name);
    else
      raise notice 'keeping % because it is not an exact duplicate of %', pair.duplicate_name, pair.keep_name;
    end if;
  end loop;
end
$dedupe$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261009170000','ops_api_drop_duplicate_indexes') on conflict (version) do nothing;

-- ===== 20261009171000_ops_api_inbound_events_policy_initplan =====
-- OPS API review F33 (2026-10-07): evaluate auth helpers once per statement.
--
-- Same predicates as before; auth.role() and the platform-admin check are
-- wrapped in scalar subqueries so PostgreSQL evaluates them as initplans
-- instead of once per row. gridex_can_read_company(company_id) depends on the
-- row and stays per row.

alter policy inbound_operation_events_read on public.inbound_operation_events
  using (
    ((select auth.role()) = 'service_role'::text)
    or (select public.gridex_user_is_platform_admin())
    or ((company_id is not null) and public.gridex_can_read_company(company_id))
  );

alter policy inbound_operation_events_write on public.inbound_operation_events
  using (((select auth.role()) = 'service_role'::text) or (select public.gridex_user_is_platform_admin()))
  with check (((select auth.role()) = 'service_role'::text) or (select public.gridex_user_is_platform_admin()));

insert into supabase_migrations.schema_migrations(version,name) values ('20261009171000','ops_api_inbound_events_policy_initplan') on conflict (version) do nothing;

-- ===== 20261009190000_communication_log_events_processed_marker =====
-- Resend webhook events are stored before their status effects are applied.
-- processed_at marks an event whose effects were fully applied, so a provider
-- retry after a failed delivery re-processes a stored-but-unprocessed event
-- instead of short-circuiting on the stored row (inbound review #2).
alter table public.communication_log_events
  add column if not exists processed_at timestamptz;

-- Every event stored before this migration was handled by the previous
-- at-most-once code path; treat it as processed so nothing is replayed.
update public.communication_log_events
set processed_at = coalesce(created_at, now())
where processed_at is null;

comment on column public.communication_log_events.processed_at is
  'Set when all status effects of the provider event were applied. NULL means stored but not yet fully processed; a provider retry re-processes it.';

insert into supabase_migrations.schema_migrations(version,name) values ('20261009190000','communication_log_events_processed_marker') on conflict (version) do nothing;

-- ===== 20261009210000_poa_mail_stockholm_expiry_and_contact_channel_guard =====
-- POA mail review #13 and #15 (2026-10-09).
--
-- #13: power-of-attorney expiry compared valid_to with current_date, which is
-- the session (UTC) date. A POA valid through a Swedish calendar day was
-- expired up to two hours early/late around midnight. The sweep now compares
-- against the Europe/Stockholm calendar date. Same signature and ACL.
--
-- #15: tenant administrators could insert/update grid_owner_contact_channels
-- with is_verified=true directly through RLS, skipping e-mail validation, and
-- verified_at was never set. A BEFORE trigger now:
--   * validates the e-mail format;
--   * only lets service_role or a platform admin mark a channel verified (or
--     change the address of a verified channel);
--   * stamps verified_at when a channel becomes verified, clears it otherwise;
--   * refuses a verified manual channel whose address is a shared Ediel/EDIFACT
--     gateway (any grid_owners communication/contact/email address or an
--     ediel_mailboxes address), so a gateway used by many grid owners can never
--     become a manual recipient.
-- The admin UI writes with the service role and keeps working.

create or replace function public.gridex_expire_overdue_powers_of_attorney_v1(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_expired integer := 0;
  v_stockholm_today date := (now() at time zone 'Europe/Stockholm')::date;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'poa_expiry_service_role_required';
  end if;

  with due as (
    select id
    from public.powers_of_attorney
    where status in ('signed', 'active', 'accepted', 'sent', 'draft')
      and valid_to is not null
      and valid_to < v_stockholm_today
    order by valid_to, id
    limit v_limit
    for update skip locked
  ),
  expired as (
    update public.powers_of_attorney poa
    set status = 'expired', updated_at = now()
    from due
    where poa.id = due.id
    returning poa.id, poa.company_id, poa.valid_to
  ),
  events as (
    insert into public.power_of_attorney_events (company_id, power_of_attorney_id, event_type, payload)
    select company_id, id, 'expired',
           jsonb_build_object('valid_to', valid_to, 'source', 'customer_operations_cron', 'calendar', 'Europe/Stockholm')
    from expired
    returning 1
  )
  select count(*) into v_expired from events;

  return jsonb_build_object('expired', v_expired);
end
$function$;

revoke all on function public.gridex_expire_overdue_powers_of_attorney_v1(integer) from public, anon, authenticated;
grant execute on function public.gridex_expire_overdue_powers_of_attorney_v1(integer) to service_role;

create or replace function public.gridex_guard_grid_owner_contact_channel_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_email text;
  v_privileged boolean;
  v_verification_change boolean;
begin
  new.email := nullif(btrim(coalesce(new.email, '')), '');
  v_email := lower(new.email);

  if v_email is not null
     and v_email !~ '^[^[:space:]@<>(),;:"]+@[^[:space:]@<>(),;:"]+\.[^[:space:]@<>(),;:"]+$' then
    raise exception using
      errcode = '23514',
      message = 'grid_owner_contact_channel_invalid_email';
  end if;

  if coalesce(new.is_verified, false) is not true then
    new.verified_at := null;
    return new;
  end if;

  v_verification_change := tg_op = 'INSERT'
    or coalesce(old.is_verified, false) is not true
    or lower(coalesce(old.email, '')) is distinct from coalesce(v_email, '');

  if v_verification_change then
    v_privileged := coalesce(auth.role(), '') = 'service_role'
      or coalesce(public.gridex_user_is_platform_admin(), false);
    if not v_privileged then
      raise exception using
        errcode = '42501',
        message = 'grid_owner_contact_channel_verification_requires_platform_admin';
    end if;
    new.verified_at := now();
  elsif new.verified_at is null then
    new.verified_at := coalesce(old.verified_at, now());
  end if;

  if v_email is not null and coalesce(new.channel_type, '') <> 'ediel' then
    if exists (
      select 1
      from public.grid_owners g
      where lower(btrim(coalesce(g.communication_email, ''))) = v_email
         or lower(btrim(coalesce(g.contact_email, ''))) = v_email
         or lower(btrim(coalesce(g.email, ''))) = v_email
    ) or exists (
      select 1
      from public.ediel_mailboxes m
      where lower(btrim(coalesce(m.email_address, ''))) = v_email
    ) then
      raise exception using
        errcode = '23514',
        message = 'grid_owner_contact_channel_shared_ediel_gateway',
        detail = 'A verified manual grid-owner contact must not be an Ediel/EDIFACT gateway address shared through grid_owners or ediel_mailboxes.';
    end if;
  end if;

  return new;
end
$function$;

revoke all on function public.gridex_guard_grid_owner_contact_channel_v1() from public, anon, authenticated;

drop trigger if exists gridex_guard_grid_owner_contact_channel on public.grid_owner_contact_channels;
create trigger gridex_guard_grid_owner_contact_channel
  before insert or update on public.grid_owner_contact_channels
  for each row execute function public.gridex_guard_grid_owner_contact_channel_v1();

insert into supabase_migrations.schema_migrations(version,name) values ('20261009210000','poa_mail_stockholm_expiry_and_contact_channel_guard') on conflict (version) do nothing;

-- ===== 20261009220000_classify_contract_confirmation_deliveries =====
-- Tenant-isolation invariants (F-6, F-8) for the F27 confirmation continuation:
-- classify the table as tenant data and scope its unique key by company_id.

insert into public.platform_table_classification (table_name, kind, rationale, classified_by)
values (
  'customer_contract_confirmation_deliveries',
  'tenant',
  'Per-company durable continuation for the signed-contract confirmation mail; service-role only.',
  'migration'
)
on conflict (table_name) do update
  set kind = excluded.kind, rationale = excluded.rationale;

alter table public.customer_contract_confirmation_deliveries
  drop constraint if exists customer_contract_confirmation_deliveries_request_key;
alter table public.customer_contract_confirmation_deliveries
  add constraint customer_contract_confirmation_deliveries_company_request_key
  unique (company_id, signature_request_id);

create or replace function public.gridex_enqueue_contract_confirmation_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.customer_contract_confirmation_deliveries(
    company_id, customer_contract_id, signature_request_id
  ) values (
    new.company_id, new.customer_contract_id, new.id
  )
  on conflict (company_id, signature_request_id) do nothing;
  return new;
end;
$$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261009220000','classify_contract_confirmation_deliveries') on conflict (version) do nothing;

-- Kontroll
select to_regclass('public.customer_contract_confirmation_deliveries') confirmation_table,
       to_regclass('public.tenant_staff_identity_bindings') staff_table,
       to_regprocedure('public.gridex_portal_monthly_consumption_v1(uuid,uuid[],date,date)') is not null as portal_fn,
       (select count(*) from supabase_migrations.schema_migrations where version in ('20261005101527','20261005124901','20261005130000','20261005160940','20261007110303','20261009090000','20261009100000','20261009110000','20261009130000','20261009140000','20261009160000','20261009170000','20261009171000','20261009190000','20261009210000','20261009220000')) recorded;
rollback;
