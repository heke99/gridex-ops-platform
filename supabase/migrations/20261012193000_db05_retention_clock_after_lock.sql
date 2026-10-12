-- DB-05: customer pseudonymisation must decide at the instant it actually holds
-- the customer lock. now() is the transaction start; after a lock wait it let
-- an expired policy/issuer, a scheduled DENY or a ban that became effective
-- during the wait still authorise erasure (reproduced by the three lock-wait
-- probes in scripts/db-05-customer-close-due-purge-native.test.ts).
-- * ediel_pseudonymise_customer_retention_v1: re-check the purger's
--   actor/permission authority after the customer lock (before a replay
--   answer) and again after the last blocking lock (review row, reviewer,
--   issuer); refresh reviewer operation/class authority there too, then compare
--   the deadline with the decision instant.
-- * customer_receipt_v1: evaluate issuer and policy validity at clock_timestamp()
--   sampled after the issuer FOR SHARE lock.
-- * ediel_retention_lock_auth_actor_v1: a ban counts as lifted only once
--   banned_until has passed at clock_timestamp() (a lifted ban can expire within
--   the transaction; a ban in force is caught either way).
-- Bodies are the current definitions otherwise unchanged; CREATE OR REPLACE
-- keeps owners, grants and comments.
BEGIN;

CREATE OR REPLACE FUNCTION public.ediel_retention_lock_auth_actor_v1(p_actor_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE active boolean;
BEGIN
 -- The same FOR SHARE lock as the installed actor/reviewer owners prevents a
 -- concurrent deletion/ban from passing a prior unlocked authorization check.
 SELECT deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=clock_timestamp())
 INTO active FROM auth.users WHERE id=p_actor_user_id FOR SHARE;
 IF active IS DISTINCT FROM true THEN RETURN false;END IF;
 PERFORM id FROM public.user_profiles WHERE id=p_actor_user_id FOR SHARE;
 RETURN EXISTS(SELECT FROM public.user_profiles p WHERE p.id=p_actor_user_id
               AND p.user_status='active' AND to_jsonb(p)->>'disabled_at' IS NULL);
END$$;


CREATE OR REPLACE FUNCTION gridex_ediel_retention.customer_receipt_v1(d gridex_ediel_retention.customer_decisions) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE k gridex_ediel_retention.issuers%rowtype;n timestamptz;p jsonb;bytes bytea;issued timestamptz;expires timestamptz;deadline timestamptz;
BEGIN IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash THEN RETURN NULL;END IF;
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO k FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 -- DB-05: the issuer lock can wait past issuer/policy validity; decide after it.
 n:=clock_timestamp();
 IF k.id IS NULL OR n<k.valid_from OR n>=k.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=k.id) OR EXISTS(SELECT FROM gridex_ediel_retention.customer_revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 bytes:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,k.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 p:=convert_from(bytes,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;deadline:=(p->>'retainUntil')::timestamptz;
 IF p->>'format' IS DISTINCT FROM 'ediel_customer_retention_policy_v1' OR p->>'retentionClass' IS DISTINCT FROM d.retention_class OR p->>'companyId' IS DISTINCT FROM d.company_id::text OR p->>'customerId' IS DISTINCT FROM d.customer_id::text OR p->>'sourceHash' IS DISTINCT FROM d.source_hash OR p->>'documentHash' IS DISTINCT FROM d.document_hash OR p->>'issuerLegalReference' IS DISTINCT FROM k.legal_reference OR nullif(p->>'legalBasisReference','') IS NULL
 OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR issued>n OR expires<=n OR issued<k.valid_from OR expires>k.valid_to THEN RETURN NULL;END IF;RETURN p;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;
END$_$;


CREATE OR REPLACE FUNCTION public.ediel_pseudonymise_customer_retention_v1(p_company_id uuid, p_actor_user_id uuid, p_decision_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE d gridex_ediel_retention.customer_decisions%rowtype;r gridex_ediel_retention.customer_reviews%rowtype;c public.customers%rowtype;t gridex_ediel_retention.customer_tombstones%rowtype;claims jsonb;source text;at timestamptz:=clock_timestamp();
BEGIN PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'ediel.retention.customer_fields') IS NOT TRUE THEN RAISE EXCEPTION 'customer_retention_scoped_write_required' USING ERRCODE='42501';END IF;
 -- Prevent a new operational supply or portal grant from appearing while the
 -- native closed/readset check, access revocation and pseudonymisation commit.
 LOCK TABLE public.customer_supply_periods,public.customer_portal_accounts,public.customer_portal_claims IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.customer_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO STRICT c FROM public.customers WHERE id=d.customer_id AND company_id=p_company_id FOR UPDATE;
 -- DB-05: a lock wait can outlast a scheduled DENY or a ban. Re-check the
 -- purger's current authority after the customer lock, before a replay answer.
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'ediel.retention.customer_fields') IS NOT TRUE THEN RAISE EXCEPTION 'customer_retention_scoped_write_required' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM gridex_ediel_retention.customer_tombstones WHERE customer_id=c.id;
 IF FOUND THEN IF t.decision_id IS DISTINCT FROM d.id THEN RAISE EXCEPTION 'customer_retention_tombstone_conflict';END IF;RETURN jsonb_build_object('status','pseudonymised','customerId',c.id,'sourceHash',t.source_hash,'pseudonymisedAt',t.created_at,'replay',true);END IF;
 SELECT * INTO r FROM gridex_ediel_retention.customer_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 PERFORM public.ediel_retention_lock_auth_actor_v1(r.actor_user_id);PERFORM id FROM public.user_profiles WHERE id=r.actor_user_id FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id FOR SHARE;
 IF NOT public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=r.actor_user_id AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL) OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_retention_reviewer_authority']);END IF;
 IF gridex_ediel_retention.class_permission_v1(p_company_id,r.actor_user_id,'customer_canonical_personal_fields') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_retention_class_reviewer_authority']);END IF;claims:=gridex_ediel_retention.customer_receipt_v1(d);
 -- DB-05: the review-row, reviewer and issuer locks above can wait too. After the
 -- last blocking lock, take the decision instant and re-check the purger's current
 -- authority before any effect; its locks are already held, so this cannot wait.
 at:=clock_timestamp();
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'ediel.retention.customer_fields') IS NOT TRUE THEN RAISE EXCEPTION 'customer_retention_scoped_write_required' USING ERRCODE='42501';END IF;
 -- The same issuer wait can outlast a scheduled reviewer DENY. All reviewer
 -- rows/registry locks are already held; refresh the time-dependent checks.
 IF NOT public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=r.actor_user_id AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL) OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_retention_reviewer_authority']);END IF;
 IF gridex_ediel_retention.class_permission_v1(p_company_id,r.actor_user_id,'customer_canonical_personal_fields') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_retention_class_reviewer_authority']);END IF;
 IF r.outcome IS DISTINCT FROM 'approved' OR claims IS NULL OR (claims->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_customer_class_legal_retention_deadline']);END IF;
 IF c.status IS DISTINCT FROM 'archived' OR EXISTS(SELECT FROM public.customer_supply_periods WHERE company_id=p_company_id AND customer_id=c.id AND status NOT IN('cancelled','rejected','terminated','ended','closed','inactive') AND (coalesce(actual_end_date,end_date) IS NULL OR coalesce(actual_end_date,end_date)>=current_date)) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['operative_customer_closed_and_no_active_supply']);END IF;
 source:=encode(sha256(convert_to(gridex_ediel_retention.customer_personal_fields_v1(c)::text,'UTF8')),'hex');IF source IS DISTINCT FROM d.source_hash THEN RETURN jsonb_build_object('status','held','missing',ARRAY['exact_native_customer_personal_fields_changed']);END IF;
 -- Access is revoked before physical current personal-field erasure. Tenant
 -- users, retained invoices, metering values and protocol journals are untouched.
 UPDATE public.customer_portal_accounts SET status='revoked',is_active=false,updated_at=at WHERE company_id=p_company_id AND customer_id=c.id;
 UPDATE public.customer_portal_claims SET status='revoked',updated_at=at WHERE company_id=p_company_id AND customer_id=c.id;
 INSERT INTO gridex_ediel_retention.customer_tombstones(customer_id,company_id,decision_id,review_id,source_hash,retention_class,actor_user_id,created_at) VALUES(c.id,p_company_id,d.id,r.id,source,d.retention_class,p_actor_user_id,at);
 UPDATE public.customers SET first_name=NULL,last_name=NULL,full_name='Pseudonymiserad kund',company_name=NULL,personal_number=NULL,org_number=NULL,email=NULL,phone=NULL,apartment_number=NULL,identity_number=NULL,organization_number=NULL,name='Pseudonymiserad kund',billing_street=NULL,billing_postal_code=NULL,billing_city=NULL,metadata='{}',onboarding_issues='[]',intake_missing_fields='{}',intake_warnings='{}',process_summary='{}',archive_reason=NULL,next_action=NULL,latest_customer_action=NULL,anonymized_at=at,anonymized_by=p_actor_user_id,data_retention_note=claims->>'legalBasisReference',updated_at=at,updated_by=p_actor_user_id WHERE id=c.id AND company_id=p_company_id;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'customer',c.id,'ediel.retention.customer_pseudonymised',jsonb_build_object('decisionId',d.id,'reviewId',r.id,'sourceHash',source,'retentionClass',d.retention_class,'pseudonymisedAt',at));
 RETURN jsonb_build_object('status','pseudonymised','customerId',c.id,'sourceHash',source,'pseudonymisedAt',at,'replay',false);
END$$;


COMMIT;
