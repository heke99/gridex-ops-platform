-- Native per-class retention for canonical current customer personal fields.
-- It does not erase historical contract/invoice/meter/ACK records, select a
-- lawful period or provision an issuer. Operative customer closure is required.
BEGIN;
CREATE TABLE gridex_ediel_retention.customer_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),customer_id uuid NOT NULL REFERENCES public.customers(id),
 retention_class text NOT NULL CHECK(retention_class='customer_canonical_personal_fields'),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
 document_bytes bytea NOT NULL CHECK(octet_length(document_bytes) BETWEEN 1 AND 1048576),document_hash text NOT NULL CHECK(document_hash=encode(sha256(document_bytes),'hex')),issuer_receipt jsonb,
 submitted_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,customer_id,source_hash,document_hash));
CREATE TABLE gridex_ediel_retention.customer_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),decision_id uuid NOT NULL REFERENCES gridex_ediel_retention.customer_decisions(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),outcome text NOT NULL CHECK(outcome IN('approved','held','rejected')),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ediel_retention.customer_revocations(decision_id uuid PRIMARY KEY REFERENCES gridex_ediel_retention.customer_decisions(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ediel_retention.customer_tombstones(customer_id uuid PRIMARY KEY REFERENCES public.customers(id),company_id uuid NOT NULL,decision_id uuid NOT NULL REFERENCES gridex_ediel_retention.customer_decisions(id),review_id uuid NOT NULL REFERENCES gridex_ediel_retention.customer_reviews(id),source_hash text NOT NULL,retention_class text NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['customer_decisions','customer_reviews','customer_revocations','customer_tombstones'] LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_retention.%I OWNER TO gridex_ediel_retention_owner',t);EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_ediel_retention.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON gridex_ediel_retention.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_ediel_retention.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t||'_immutable',t);EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_ediel_retention.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t||'_no_truncate',t);END LOOP;END$$;
CREATE FUNCTION gridex_ediel_retention.customer_personal_fields_v1(c public.customers) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT to_jsonb(c)-ARRAY['normalized_personal_number','normalized_org_number','normalized_email','normalized_phone','created_at','updated_at','created_by','updated_by','anonymized_at','anonymized_by','data_retention_note']
$$;
CREATE FUNCTION gridex_ediel_retention.customer_receipt_v1(d gridex_ediel_retention.customer_decisions) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k gridex_ediel_retention.issuers%rowtype;p jsonb;bytes bytea;issued timestamptz;expires timestamptz;deadline timestamptz;
BEGIN
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO k FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 IF k.id IS NULL OR now()<k.valid_from OR now()>=k.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=k.id) OR EXISTS(SELECT FROM gridex_ediel_retention.customer_revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 bytes:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,k.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 p:=convert_from(bytes,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;deadline:=(p->>'retainUntil')::timestamptz;
 IF p->>'format' IS DISTINCT FROM 'ediel_customer_retention_policy_v1' OR p->>'retentionClass' IS DISTINCT FROM d.retention_class OR p->>'companyId' IS DISTINCT FROM d.company_id::text OR p->>'customerId' IS DISTINCT FROM d.customer_id::text OR p->>'sourceHash' IS DISTINCT FROM d.source_hash OR p->>'documentHash' IS DISTINCT FROM d.document_hash OR p->>'issuerLegalReference' IS DISTINCT FROM k.legal_reference OR nullif(p->>'legalBasisReference','') IS NULL
 OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR issued>now() OR expires<=now() OR issued<k.valid_from OR expires>k.valid_to THEN RETURN NULL;END IF;RETURN p;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;
END$$;
CREATE FUNCTION public.ediel_submit_customer_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_customer_id uuid,p_document_base64 text,p_issuer_receipt jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.customers%rowtype;d gridex_ediel_retention.customer_decisions%rowtype;bytes bytea;hash text;source text;
BEGIN PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.submit');
 IF gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'customers.write') IS NOT TRUE THEN RAISE EXCEPTION 'customer_retention_scoped_write_required' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT c FROM public.customers WHERE id=p_customer_id AND company_id=p_company_id FOR SHARE;
 IF length(p_document_base64)>1398104 THEN RAISE EXCEPTION 'customer_retention_document_limit';END IF;bytes:=decode(p_document_base64,'base64');IF octet_length(bytes) NOT BETWEEN 1 AND 1048576 THEN RAISE EXCEPTION 'customer_retention_document_required';END IF;
 hash:=encode(sha256(bytes),'hex');source:=encode(sha256(convert_to(gridex_ediel_retention.customer_personal_fields_v1(c)::text,'UTF8')),'hex');
 INSERT INTO gridex_ediel_retention.customer_decisions(company_id,customer_id,retention_class,source_hash,document_bytes,document_hash,issuer_receipt,submitted_by) VALUES(p_company_id,c.id,'customer_canonical_personal_fields',source,bytes,hash,p_issuer_receipt,p_actor_user_id) ON CONFLICT(company_id,customer_id,source_hash,document_hash) DO NOTHING;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.customer_decisions WHERE company_id=p_company_id AND customer_id=c.id AND source_hash=source AND document_hash=hash FOR SHARE;IF d.issuer_receipt IS DISTINCT FROM p_issuer_receipt THEN RAISE EXCEPTION 'customer_retention_original_receipt_conflict';END IF;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'customer_retention_decision',d.id,'ediel.retention.customer_submitted',jsonb_build_object('customerId',c.id,'sourceHash',source,'documentHash',hash));
 RETURN jsonb_build_object('status','submitted','decisionId',d.id,'sourceHash',source,'documentHash',hash,'retentionClass',d.retention_class,'issuerQualified',gridex_ediel_retention.customer_receipt_v1(d) IS NOT NULL);
END$$;
CREATE FUNCTION public.ediel_review_customer_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid,p_outcome text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.customer_decisions%rowtype;outcome text;r uuid;
BEGIN PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.review');SELECT * INTO STRICT d FROM gridex_ediel_retention.customer_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 IF p_outcome NOT IN('approve','hold','reject') OR nullif(p_reason,'') IS NULL OR length(p_reason)>4000 THEN RAISE EXCEPTION 'customer_retention_review_shape_required';END IF;
 IF p_outcome='approve' AND d.submitted_by=p_actor_user_id THEN RAISE EXCEPTION 'customer_retention_separate_reviewer_required';END IF;
 outcome:=CASE WHEN p_outcome='reject' THEN 'rejected' WHEN p_outcome='approve' AND gridex_ediel_retention.customer_receipt_v1(d) IS NOT NULL THEN 'approved' ELSE 'held' END;
 INSERT INTO gridex_ediel_retention.customer_reviews(decision_id,actor_user_id,outcome,reason) VALUES(d.id,p_actor_user_id,outcome,p_reason) RETURNING id INTO r;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'customer_retention_decision',d.id,'ediel.retention.customer_reviewed',jsonb_build_object('reviewId',r,'outcome',outcome));RETURN jsonb_build_object('status',outcome,'decisionId',d.id,'reviewId',r);
END$$;
CREATE FUNCTION public.ediel_revoke_customer_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.review');PERFORM id FROM gridex_ediel_retention.customer_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;IF NOT FOUND OR nullif(p_reason,'') IS NULL THEN RAISE EXCEPTION 'customer_retention_revoke_scope_required';END IF;
 INSERT INTO gridex_ediel_retention.customer_revocations(decision_id,actor_user_id,reason) VALUES(p_decision_id,p_actor_user_id,p_reason) ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'customer_retention_decision',p_decision_id,'ediel.retention.customer_revoked',jsonb_build_object('reason',p_reason));END$$;
CREATE FUNCTION public.ediel_pseudonymise_customer_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.customer_decisions%rowtype;r gridex_ediel_retention.customer_reviews%rowtype;c public.customers%rowtype;t gridex_ediel_retention.customer_tombstones%rowtype;claims jsonb;source text;at timestamptz:=clock_timestamp();
BEGIN PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'customers.write') IS NOT TRUE THEN RAISE EXCEPTION 'customer_retention_scoped_write_required' USING ERRCODE='42501';END IF;
 -- Prevent a new operational supply or portal grant from appearing while the
 -- native closed/readset check, access revocation and pseudonymisation commit.
 LOCK TABLE public.customer_supply_periods,public.customer_portal_accounts,public.customer_portal_claims IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.customer_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO STRICT c FROM public.customers WHERE id=d.customer_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO t FROM gridex_ediel_retention.customer_tombstones WHERE customer_id=c.id;
 IF FOUND THEN IF t.decision_id IS DISTINCT FROM d.id THEN RAISE EXCEPTION 'customer_retention_tombstone_conflict';END IF;RETURN jsonb_build_object('status','pseudonymised','customerId',c.id,'sourceHash',t.source_hash,'pseudonymisedAt',t.created_at,'replay',true);END IF;
 SELECT * INTO r FROM gridex_ediel_retention.customer_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 PERFORM id FROM auth.users WHERE id=r.actor_user_id FOR SHARE;PERFORM id FROM public.user_profiles WHERE id=r.actor_user_id FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=r.actor_user_id AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now())) OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=r.actor_user_id AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL) OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_retention_reviewer_authority']);END IF;
 claims:=gridex_ediel_retention.customer_receipt_v1(d);
 IF r.outcome IS DISTINCT FROM 'approved' OR claims IS NULL OR (claims->>'retainUntil')::timestamptz>now() THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_customer_class_legal_retention_deadline']);END IF;
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
CREATE FUNCTION gridex_ediel_retention.customer_tombstone_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t gridex_ediel_retention.customer_tombstones%rowtype;BEGIN
 SELECT * INTO t FROM gridex_ediel_retention.customer_tombstones WHERE customer_id=old.id;
 IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'customer_retention_no_tombstone_cascade';END IF;
 IF new.company_id IS DISTINCT FROM t.company_id OR new.status IS DISTINCT FROM 'archived' OR new.anonymized_at IS DISTINCT FROM t.created_at OR new.anonymized_by IS DISTINCT FROM t.actor_user_id
 OR new.first_name IS NOT NULL OR new.last_name IS NOT NULL OR new.full_name IS DISTINCT FROM 'Pseudonymiserad kund' OR new.company_name IS NOT NULL OR new.personal_number IS NOT NULL OR new.org_number IS NOT NULL OR new.email IS NOT NULL OR new.phone IS NOT NULL OR new.apartment_number IS NOT NULL OR new.identity_number IS NOT NULL OR new.organization_number IS NOT NULL OR new.name IS DISTINCT FROM 'Pseudonymiserad kund' OR new.billing_street IS NOT NULL OR new.billing_postal_code IS NOT NULL OR new.billing_city IS NOT NULL OR new.metadata IS DISTINCT FROM '{}'::jsonb OR new.onboarding_issues IS DISTINCT FROM '[]'::jsonb OR new.intake_missing_fields IS DISTINCT FROM '{}'::text[] OR new.intake_warnings IS DISTINCT FROM '{}'::text[] OR new.process_summary IS DISTINCT FROM '{}'::jsonb OR new.archive_reason IS NOT NULL OR new.next_action IS NOT NULL OR new.latest_customer_action IS NOT NULL THEN RAISE EXCEPTION 'customer_retention_personal_fields_tombstoned';END IF;RETURN new;
END$$;
CREATE TRIGGER customer_personal_fields_tombstone BEFORE UPDATE OR DELETE ON public.customers FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.customer_tombstone_guard_v1();
CREATE FUNCTION gridex_ediel_retention.customer_revocation_lock_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 PERFORM id FROM gridex_ediel_retention.customer_decisions WHERE id=new.decision_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'customer_retention_revocation_target_required';END IF;RETURN new;END$$;
CREATE TRIGGER customer_retention_revocation_lock BEFORE INSERT ON gridex_ediel_retention.customer_revocations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.customer_revocation_lock_v1();
GRANT SELECT,UPDATE ON public.customers,public.customer_supply_periods,public.customer_portal_accounts,public.customer_portal_claims TO gridex_ediel_retention_owner;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname IN('customer_personal_fields_v1','customer_receipt_v1','customer_tombstone_guard_v1','customer_revocation_lock_v1') OR n.nspname='public' AND p.proname IN('ediel_submit_customer_retention_v1','ediel_review_customer_retention_v1','ediel_revoke_customer_retention_v1','ediel_pseudonymise_customer_retention_v1') LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO gridex_ediel_retention_owner',f.identity);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.identity);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION public.ediel_submit_customer_retention_v1(uuid,uuid,uuid,text,jsonb),public.ediel_review_customer_retention_v1(uuid,uuid,uuid,text,text),public.ediel_revoke_customer_retention_v1(uuid,uuid,uuid,text),public.ediel_pseudonymise_customer_retention_v1(uuid,uuid,uuid) TO authenticated;
COMMIT;
