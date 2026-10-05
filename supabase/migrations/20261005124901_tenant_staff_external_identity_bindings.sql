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
