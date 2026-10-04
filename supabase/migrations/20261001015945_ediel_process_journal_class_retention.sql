-- E035 copies have separate native class/target/source/scope decisions. Historical
-- hash/identity/epoch metadata survives; a tombstone never attests completeness.
-- Also narrow the earlier customer-wide fresh-operation guard to consumed sources.
BEGIN;
CREATE TABLE gridex_ediel_retention.process_class_catalog(retention_class text PRIMARY KEY,source_table text NOT NULL UNIQUE,operation text NOT NULL);
INSERT INTO gridex_ediel_retention.process_class_catalog VALUES
 ('correction_process_fact_body','facts','redact_process_fact_body'),
 ('correction_process_readset_body','readsets','redact_process_readset_body'),
 ('correction_process_combined_readset_body','combined_snapshots','redact_process_combined_readset_body');
CREATE TABLE gridex_ediel_retention.process_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 retention_class text NOT NULL REFERENCES gridex_ediel_retention.process_class_catalog(retention_class),target_id text NOT NULL,
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),target_hash text NOT NULL CHECK(target_hash~'^[a-f0-9]{64}$'),scope_hash text NOT NULL CHECK(scope_hash~'^[a-f0-9]{64}$'),
 document_bytes bytea NOT NULL CHECK(octet_length(document_bytes) BETWEEN 1 AND 1048576),document_hash text NOT NULL CHECK(document_hash=encode(sha256(document_bytes),'hex')),
 issuer_receipt jsonb,submitted_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,retention_class,target_id,target_hash,scope_hash,document_hash));
CREATE TABLE gridex_ediel_retention.process_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),decision_id uuid NOT NULL REFERENCES gridex_ediel_retention.process_decisions(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),outcome text NOT NULL CHECK(outcome IN('approved','held','rejected')),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ediel_retention.process_revocations(decision_id uuid PRIMARY KEY REFERENCES gridex_ediel_retention.process_decisions(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ediel_retention.process_tombstones(retention_class text NOT NULL REFERENCES gridex_ediel_retention.process_class_catalog(retention_class),target_id text NOT NULL,company_id uuid NOT NULL,decision_id uuid NOT NULL REFERENCES gridex_ediel_retention.process_decisions(id),review_id uuid NOT NULL REFERENCES gridex_ediel_retention.process_reviews(id),source_hash text NOT NULL,target_hash text NOT NULL,scope_hash text NOT NULL,byte_length bigint NOT NULL CHECK(byte_length>0),actor_user_id uuid NOT NULL REFERENCES auth.users(id),journal_retain_until timestamptz NOT NULL,journal_purpose_reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(retention_class,target_id));
CREATE TABLE gridex_ediel_retention.process_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),retention_class text NOT NULL,target_id text NOT NULL,actor_user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(retention_class,target_id) REFERENCES gridex_ediel_retention.process_tombstones(retention_class,target_id),UNIQUE(retention_class,target_id));
CREATE TABLE gridex_ediel_retention.process_retention_origins(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,source_table text NOT NULL,target_id uuid NOT NULL,decision_id uuid NOT NULL REFERENCES gridex_ediel_retention.record_decisions(id),original_hash text NOT NULL,redacted_hash text NOT NULL,journal_retain_until timestamptz NOT NULL,journal_purpose_reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(source_table,target_id,decision_id));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['process_class_catalog','process_decisions','process_reviews','process_revocations','process_tombstones','process_events','process_retention_origins'] LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_retention.%I OWNER TO gridex_ediel_retention_owner',t);EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_ediel_retention.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON gridex_ediel_retention.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_ediel_retention.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON gridex_ediel_retention.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
 END LOOP;END$$;
-- Decode only actual stored JSON, including embedded native serialized bodies.
-- No caller list of customers or a caller closure flag is consulted.
CREATE FUNCTION gridex_ediel_retention.process_nodes_v1(body jsonb) RETURNS TABLE(key text,value jsonb) LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE queue jsonb[]:=ARRAY[body];node jsonb;item record;count integer:=0;BEGIN
 WHILE cardinality(queue)>0 LOOP node:=queue[1];queue:=queue[2:];count:=count+1;IF count>100000 THEN RAISE EXCEPTION 'process_retention_scope_node_bound';END IF;
  IF jsonb_typeof(node)='object' THEN FOR item IN SELECT * FROM jsonb_each(node) LOOP key:=item.key;value:=item.value;RETURN NEXT;
   IF item.key IN('readsetText','factsText') AND jsonb_typeof(item.value)='string' THEN queue:=array_append(queue,(item.value#>>'{}')::jsonb);ELSE queue:=array_append(queue,item.value);END IF;END LOOP;
  ELSIF jsonb_typeof(node)='array' THEN FOR item IN SELECT v FROM jsonb_array_elements(node) v LOOP queue:=array_append(queue,item.v);END LOOP;END IF;
 END LOOP;
END$$;
CREATE FUNCTION gridex_ediel_retention.process_basis_v1(c uuid,k text,target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row_body jsonb;body jsonb;source_hash text;bytes bigint;cust uuid;ref uuid;found_company uuid;found_customer uuid;node record;included_ids uuid[]:=ARRAY[]::uuid[];wildcard boolean:=false;scope jsonb;closed boolean;table_name text;BEGIN
 SELECT source_table INTO STRICT table_name FROM gridex_ediel_retention.process_class_catalog WHERE retention_class=k;
 IF EXISTS(SELECT FROM gridex_ediel_retention.process_tombstones WHERE retention_class=k AND target_id=target AND company_id=c) THEN RAISE EXCEPTION 'process_journal_retention_tombstoned';END IF;
 IF k='correction_process_fact_body' THEN
  IF target!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'process_retention_fact_selector_required';END IF;
  SELECT to_jsonb(f) INTO row_body FROM gridex_correction_process.facts f WHERE id=target::bigint AND company_id=c FOR SHARE;
  body:=jsonb_build_object('table',row_body->>'table_name','rowId',row_body->>'row_id','operation',row_body->>'operation','old',row_body->'old_fact','new',row_body->'new_fact');source_hash:=row_body->>'facts_hash';bytes:=octet_length(body::text);
 ELSE
  IF target!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'process_retention_snapshot_selector_required';END IF;
  EXECUTE format('SELECT to_jsonb(f) FROM gridex_correction_process.%I f WHERE id=$1 AND company_id=$2 FOR SHARE',table_name) INTO row_body USING target::uuid,c;
  body:=(row_body->>'readset_text')::jsonb;source_hash:=row_body->>'readset_hash';bytes:=octet_length(row_body->>'readset_text');
 END IF;
 IF row_body IS NULL OR bytes NOT BETWEEN 1 AND 20971520 OR source_hash IS DISTINCT FROM encode(sha256(convert_to(CASE WHEN k='correction_process_fact_body' THEN body::text ELSE row_body->>'readset_text' END,'UTF8')),'hex') THEN RAISE EXCEPTION 'process_retention_actual_original_hash_required';END IF;
 -- Hold range writes while the actual entire included customer/supply graph is
 -- qualified. Unknown scope expands to every native customer in this company;
 -- it can qualify when every scope is closed, without inventing completeness.
 LOCK TABLE public.customers,public.customer_supply_periods IN SHARE ROW EXCLUSIVE MODE;
 FOR node IN SELECT * FROM gridex_ediel_retention.process_nodes_v1(body||jsonb_build_object('customer_id',row_body->'customer_id','subjectMessageId',row_body->'subject_message_id')) LOOP
  IF node.key IN('companyId','company_id') AND jsonb_typeof(node.value)='string' AND (node.value#>>'{}') IS DISTINCT FROM c::text THEN RAISE EXCEPTION 'process_retention_foreign_included_scope';END IF;
  IF node.key IN('customerId','customer_id','contractId','contract_id','customer_contract_id','sourceMessageId','source_message_id','subjectMessageId','messageId','originalMessageId','outbound_z03_message_id','inbound_z04_message_id') AND jsonb_typeof(node.value)='string' THEN
   BEGIN ref:=(node.value#>>'{}')::uuid;EXCEPTION WHEN invalid_text_representation THEN wildcard:=true;CONTINUE;END;
   found_company:=NULL;found_customer:=NULL;
   IF node.key IN('customerId','customer_id') THEN SELECT company_id,id INTO found_company,found_customer FROM public.customers WHERE id=ref;
   ELSIF node.key IN('contractId','contract_id','customer_contract_id') THEN SELECT company_id,customer_id INTO found_company,found_customer FROM public.customer_contracts WHERE id=ref;
   ELSE SELECT company_id,customer_id INTO found_company,found_customer FROM public.ediel_messages WHERE id=ref;END IF;
   IF found_company IS NOT NULL AND found_company IS DISTINCT FROM c THEN RAISE EXCEPTION 'process_retention_foreign_included_scope';END IF;
   IF found_company IS NULL OR found_customer IS NULL THEN wildcard:=true;ELSE included_ids:=array_append(included_ids,found_customer);END IF;
  END IF;
 END LOOP;
 IF cardinality(included_ids)>10000 THEN RAISE EXCEPTION 'process_retention_customer_scope_bound';END IF;
 IF cardinality(included_ids)=0 OR k<>'correction_process_fact_body' THEN wildcard:=true;END IF;
 IF wildcard THEN SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO included_ids FROM public.customers WHERE company_id=c;ELSE SELECT array_agg(DISTINCT v ORDER BY v) INTO included_ids FROM unnest(included_ids)v;END IF;
 IF cardinality(included_ids)>10000 THEN RAISE EXCEPTION 'process_retention_customer_scope_bound';END IF;
 PERFORM id FROM public.customers WHERE company_id=c AND id=ANY(included_ids) ORDER BY id FOR SHARE;
 SELECT coalesce(jsonb_agg(jsonb_build_object('customerId',u.id,'status',u.status,'supply',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_supply_periods s WHERE s.company_id=c AND s.customer_id=u.id)) ORDER BY u.id),'[]'),
  coalesce(bool_and(u.status='archived' AND NOT EXISTS(SELECT FROM public.customer_supply_periods s WHERE s.company_id=c AND s.customer_id=u.id AND s.status NOT IN('cancelled','rejected','terminated','ended','closed','inactive') AND (coalesce(s.actual_end_date,s.end_date) IS NULL OR coalesce(s.actual_end_date,s.end_date)>=current_date))),true)
 INTO scope,closed FROM public.customers u WHERE u.company_id=c AND u.id=ANY(included_ids);
 RETURN jsonb_build_object('retentionClass',k,'targetId',target,'sourceTable',table_name,'sourceHash',source_hash,'targetHash',encode(sha256(convert_to(row_body::text,'UTF8')),'hex'),'scopeHash',encode(sha256(convert_to(jsonb_build_object('companyId',c,'wildcard',wildcard,'scopes',scope)::text,'UTF8')),'hex'),'byteLength',bytes,'includedCustomers',included_ids,'allIncludedScopesClosed',closed,'unknownScopeExpandedToCompany',wildcard,'complete',false,'authority','none');
END$$;
CREATE FUNCTION gridex_ediel_retention.process_receipt_v1(d gridex_ediel_retention.process_decisions) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE issuer gridex_ediel_retention.issuers%rowtype;p jsonb;bytes bytea;issued timestamptz;expires timestamptz;deadline timestamptz;journal_end timestamptz;operation text;BEGIN
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO issuer FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 IF issuer.id IS NULL OR now()<issuer.valid_from OR now()>=issuer.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=issuer.id) OR EXISTS(SELECT FROM gridex_ediel_retention.process_revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 bytes:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,issuer.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 p:=convert_from(bytes,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;deadline:=(p->>'retainUntil')::timestamptz;journal_end:=(p->>'journalRetainUntil')::timestamptz;
 SELECT x.operation INTO STRICT operation FROM gridex_ediel_retention.process_class_catalog x WHERE retention_class=d.retention_class;
 IF p->>'format' IS DISTINCT FROM 'ediel_process_journal_retention_policy_v1' OR p->>'retentionClass' IS DISTINCT FROM d.retention_class OR p->>'targetId' IS DISTINCT FROM d.target_id OR p->>'companyId' IS DISTINCT FROM d.company_id::text
 OR p->>'sourceTable' IS DISTINCT FROM (SELECT source_table FROM gridex_ediel_retention.process_class_catalog WHERE retention_class=d.retention_class)
 OR p->>'sourceHash' IS DISTINCT FROM d.source_hash OR p->>'targetHash' IS DISTINCT FROM d.target_hash OR p->>'scopeHash' IS DISTINCT FROM d.scope_hash OR p->>'documentHash' IS DISTINCT FROM d.document_hash OR p->>'operation' IS DISTINCT FROM operation
 OR p->>'issuerLegalReference' IS DISTINCT FROM issuer.legal_reference OR nullif(p->>'legalBasisReference','') IS NULL OR nullif(p->>'journalPurposeReference','') IS NULL OR p->>'accessRevocationRequired' IS DISTINCT FROM 'true'
 OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR isfinite(journal_end) IS DISTINCT FROM true OR journal_end<=now() OR issued>now() OR expires<=now() OR issued<issuer.valid_from OR expires>issuer.valid_to THEN RETURN NULL;END IF;RETURN p;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;END$$;
CREATE FUNCTION public.ediel_process_journal_retention_basis_v1(p_company_id uuid,p_actor_user_id uuid,p_retention_class text,p_target_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,'__read_scope__') IS TRUE THEN PERFORM gridex_ediel_retention.record_read_actor_v1(p_company_id,p_actor_user_id);ELSE PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.review');END IF;IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot') IS NOT TRUE THEN RAISE EXCEPTION 'process_retention_current_class_scope_required' USING ERRCODE='42501';END IF;
 RETURN gridex_ediel_retention.process_basis_v1(p_company_id,p_retention_class,p_target_id);END$$;
CREATE FUNCTION public.ediel_submit_process_journal_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_retention_class text,p_target_id text,p_document_base64 text,p_issuer_receipt jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;bytes bytea;d gridex_ediel_retention.process_decisions%rowtype;BEGIN
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.submit');basis:=gridex_ediel_retention.process_basis_v1(p_company_id,p_retention_class,p_target_id);
 IF length(p_document_base64)>1398104 THEN RAISE EXCEPTION 'process_retention_document_limit';END IF;bytes:=decode(p_document_base64,'base64');IF octet_length(bytes) NOT BETWEEN 1 AND 1048576 THEN RAISE EXCEPTION 'process_retention_document_required';END IF;
 INSERT INTO gridex_ediel_retention.process_decisions(company_id,retention_class,target_id,source_hash,target_hash,scope_hash,document_bytes,document_hash,issuer_receipt,submitted_by) VALUES(p_company_id,p_retention_class,p_target_id,basis->>'sourceHash',basis->>'targetHash',basis->>'scopeHash',bytes,encode(sha256(bytes),'hex'),p_issuer_receipt,p_actor_user_id) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.process_decisions WHERE company_id=p_company_id AND retention_class=p_retention_class AND target_id=p_target_id AND target_hash=basis->>'targetHash' AND scope_hash=basis->>'scopeHash' AND document_hash=encode(sha256(bytes),'hex') FOR SHARE;
 IF d.issuer_receipt IS DISTINCT FROM p_issuer_receipt THEN RAISE EXCEPTION 'process_retention_original_receipt_conflict';END IF;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'process_journal_retention',d.id,'ediel.retention.process_submitted',jsonb_build_object('retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'scopeHash',d.scope_hash));
 RETURN jsonb_build_object('status','submitted','decisionId',d.id,'retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'targetHash',d.target_hash,'scopeHash',d.scope_hash,'documentHash',d.document_hash,'issuerQualified',gridex_ediel_retention.process_receipt_v1(d) IS NOT NULL);END$$;
CREATE FUNCTION public.ediel_read_process_journal_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE d gridex_ediel_retention.process_decisions%rowtype;p jsonb;BEGIN
 IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,'__read_scope__') IS TRUE THEN PERFORM gridex_ediel_retention.record_read_actor_v1(p_company_id,p_actor_user_id);ELSE PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.review');END IF;IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot') IS NOT TRUE THEN RAISE EXCEPTION 'process_retention_current_class_scope_required' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.process_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR SHARE;p:=gridex_ediel_retention.process_receipt_v1(d);
 RETURN jsonb_build_object('decisionId',d.id,'retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'targetHash',d.target_hash,'scopeHash',d.scope_hash,'documentHash',d.document_hash,'documentBase64',encode(d.document_bytes,'base64'),'submittedBy',d.submitted_by,'issuerQualified',p IS NOT NULL,'retainUntil',p->>'retainUntil','journalRetainUntil',p->>'journalRetainUntil','journalPurposeReference',p->>'journalPurposeReference');END$$;
CREATE FUNCTION public.ediel_review_process_journal_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid,p_outcome text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE d gridex_ediel_retention.process_decisions%rowtype;basis jsonb;outcome text;r uuid;BEGIN
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.review');SELECT * INTO STRICT d FROM gridex_ediel_retention.process_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 IF p_outcome NOT IN('approve','hold','reject') OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>4000 THEN RAISE EXCEPTION 'process_retention_review_shape_required';END IF;IF p_outcome='approve' AND d.submitted_by=p_actor_user_id THEN RAISE EXCEPTION 'process_retention_separate_reviewer_required';END IF;
 basis:=gridex_ediel_retention.process_basis_v1(p_company_id,d.retention_class,d.target_id);outcome:=CASE WHEN p_outcome='reject' THEN 'rejected' WHEN p_outcome='approve' AND gridex_ediel_retention.process_receipt_v1(d) IS NOT NULL AND basis->>'sourceHash'=d.source_hash AND basis->>'targetHash'=d.target_hash AND basis->>'scopeHash'=d.scope_hash AND basis->>'allIncludedScopesClosed'='true' THEN 'approved' ELSE 'held' END;
 INSERT INTO gridex_ediel_retention.process_reviews(decision_id,actor_user_id,outcome,reason) VALUES(d.id,p_actor_user_id,outcome,p_reason) RETURNING id INTO r;INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'process_journal_retention',d.id,'ediel.retention.process_reviewed',jsonb_build_object('reviewId',r,'outcome',outcome));RETURN jsonb_build_object('status',outcome,'decisionId',d.id,'reviewId',r);END$$;
CREATE FUNCTION public.ediel_revoke_process_journal_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.review');PERFORM id FROM gridex_ediel_retention.process_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;IF NOT FOUND OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>4000 THEN RAISE EXCEPTION 'process_retention_revoke_scope_required';END IF;
 INSERT INTO gridex_ediel_retention.process_revocations(decision_id,actor_user_id,reason) VALUES(p_decision_id,p_actor_user_id,p_reason) ON CONFLICT DO NOTHING;END$$;
CREATE FUNCTION gridex_ediel_retention.process_revocation_lock_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN PERFORM id FROM gridex_ediel_retention.process_decisions WHERE id=NEW.decision_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'process_retention_revocation_target_required';END IF;RETURN NEW;END$$;
CREATE TRIGGER process_retention_revocation_lock BEFORE INSERT ON gridex_ediel_retention.process_revocations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.process_revocation_lock_v1();
CREATE FUNCTION gridex_ediel_retention.process_redacted_v1(k text,b jsonb,h text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN k='correction_process_fact_body' THEN b||jsonb_build_object('old_fact',null,'new_fact',jsonb_build_object('retentionUnavailable',true,'sourceHash',h,'complete',false,'authority','none')) ELSE b||jsonb_build_object('readset_text',jsonb_build_object('retentionUnavailable',true,'sourceHash',h,'complete',false,'authority','none')::text) END
$$;
CREATE FUNCTION public.ediel_is_qualified_process_retention_transition_v1(p_table text,p_old jsonb,p_new jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE t gridex_ediel_retention.process_tombstones%rowtype;k text;BEGIN
 SELECT retention_class INTO k FROM gridex_ediel_retention.process_class_catalog WHERE source_table=p_table;SELECT * INTO t FROM gridex_ediel_retention.process_tombstones WHERE retention_class=k AND target_id=p_old->>'id';
 RETURN t.target_id IS NOT NULL AND t.company_id::text=p_old->>'company_id' AND t.target_hash=encode(sha256(convert_to(p_old::text,'UTF8')),'hex') AND p_new=gridex_ediel_retention.process_redacted_v1(k,p_old,t.source_hash);END$$;
-- Clone only the three actual body table guard bindings. Other private process
-- immutability, gaps/witnesses, TRUNCATE and ordinary capture remain unchanged.
DO $$DECLARE spec record;f record;name text;body text;definition text;setting text;BEGIN FOR spec IN SELECT source_table FROM gridex_ediel_retention.process_class_catalog LOOP
 FOR f IN SELECT t.oid trigger_oid,t.tgname,p.prosrc,p.proowner,p.proconfig,p.prosecdef FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=format('gridex_correction_process.%I',spec.source_table)::regclass AND t.tgname='immutable' LOOP
  IF f.prosrc!~*'\mBEGIN\M' THEN RAISE EXCEPTION 'process_retention_guard_source_review_required';END IF;name:='process_'||spec.source_table||'_guard_v1';body:=regexp_replace(f.prosrc,'\mBEGIN\M','BEGIN IF TG_OP=''UPDATE'' AND public.ediel_is_qualified_process_retention_transition_v1(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW;END IF;','i');
  EXECUTE format('CREATE FUNCTION gridex_ediel_retention.%I() RETURNS trigger LANGUAGE plpgsql SECURITY %s SET search_path=pg_catalog AS %L',name,CASE WHEN f.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END,body);FOREACH setting IN ARRAY coalesce(f.proconfig,ARRAY[]::text[]) LOOP EXECUTE format('ALTER FUNCTION gridex_ediel_retention.%I() SET %I TO %L',name,split_part(setting,'=',1),substring(setting from position('=' in setting)+1));END LOOP;
  EXECUTE format('ALTER FUNCTION gridex_ediel_retention.%I() OWNER TO %I',name,(SELECT rolname FROM pg_roles WHERE oid=f.proowner));EXECUTE format('REVOKE ALL ON FUNCTION gridex_ediel_retention.%I() FROM PUBLIC,anon,authenticated,service_role',name);definition:=pg_get_triggerdef(f.trigger_oid);EXECUTE format('DROP TRIGGER %I ON gridex_correction_process.%I',f.tgname,spec.source_table);EXECUTE regexp_replace(definition,'EXECUTE (FUNCTION|PROCEDURE) .*$',format('EXECUTE FUNCTION gridex_ediel_retention.%I()',name));
 END LOOP;END LOOP;END$$;
CREATE FUNCTION gridex_ediel_retention.process_target_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE k text;target text;BEGIN
 SELECT retention_class INTO STRICT k FROM gridex_ediel_retention.process_class_catalog WHERE source_table=TG_TABLE_NAME;target:=(CASE WHEN TG_OP='INSERT' THEN to_jsonb(NEW) ELSE to_jsonb(OLD) END)->>'id';
 IF EXISTS(SELECT FROM gridex_ediel_retention.process_tombstones WHERE retention_class=k AND target_id=target) AND NOT (TG_OP='UPDATE' AND public.ediel_is_qualified_process_retention_transition_v1(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW))) THEN RAISE EXCEPTION 'process_journal_retention_tombstoned';END IF;IF TG_OP='DELETE' THEN RAISE EXCEPTION 'process_journal_native_class_retention_required';END IF;RETURN NEW;END$$;
DO $$DECLARE spec record;BEGIN FOR spec IN SELECT source_table FROM gridex_ediel_retention.process_class_catalog LOOP EXECUTE format('CREATE TRIGGER zz_process_retention_target BEFORE INSERT OR UPDATE OR DELETE ON gridex_correction_process.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.process_target_guard_v1()',spec.source_table);END LOOP;END$$;
CREATE FUNCTION public.ediel_purge_process_journal_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE d gridex_ediel_retention.process_decisions%rowtype;t gridex_ediel_retention.process_tombstones%rowtype;p jsonb;basis jsonb;r gridex_ediel_retention.process_reviews%rowtype;spec gridex_ediel_retention.process_class_catalog%rowtype;at timestamptz:=clock_timestamp();BEGIN
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.purge');SELECT * INTO STRICT d FROM gridex_ediel_retention.process_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO t FROM gridex_ediel_retention.process_tombstones WHERE retention_class=d.retention_class AND target_id=d.target_id;IF FOUND THEN IF t.decision_id IS DISTINCT FROM d.id OR t.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'process_retention_replay_conflict';END IF;RETURN jsonb_build_object('status','redacted','retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'byteLength',t.byte_length,'replay',true);END IF;
 SELECT * INTO r FROM gridex_ediel_retention.process_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1;IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR gridex_ediel_retention.record_permission_v1(p_company_id,r.actor_user_id,'legal_acceptance_personal_snapshot') IS NOT TRUE OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_separate_exact_class_review']);END IF;
 -- Re-lock the separate reviewer's actual auth/row/grant graph, not a cached UI.
 PERFORM gridex_ediel_retention.record_lock_review_actor_v1(p_company_id,r.actor_user_id);
 p:=gridex_ediel_retention.process_receipt_v1(d);IF p IS NULL OR (p->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_deadline']);END IF;
 basis:=gridex_ediel_retention.process_basis_v1(p_company_id,d.retention_class,d.target_id);IF basis->>'sourceHash' IS DISTINCT FROM d.source_hash OR basis->>'targetHash' IS DISTINCT FROM d.target_hash OR basis->>'scopeHash' IS DISTINCT FROM d.scope_hash OR basis->>'allIncludedScopesClosed' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unchanged_source_and_all_included_scopes_closed']);END IF;
 LOCK TABLE public.customer_portal_accounts,public.customer_portal_claims IN SHARE ROW EXCLUSIVE MODE;
 UPDATE public.customer_portal_accounts SET status='revoked',is_active=false,updated_at=at WHERE company_id=p_company_id AND customer_id IN(SELECT value::uuid FROM jsonb_array_elements_text(basis->'includedCustomers'));UPDATE public.customer_portal_claims SET status='revoked',updated_at=at WHERE company_id=p_company_id AND customer_id IN(SELECT value::uuid FROM jsonb_array_elements_text(basis->'includedCustomers'));
 INSERT INTO gridex_ediel_retention.process_tombstones(retention_class,target_id,company_id,decision_id,review_id,source_hash,target_hash,scope_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference,created_at) VALUES(d.retention_class,d.target_id,p_company_id,d.id,r.id,d.source_hash,d.target_hash,d.scope_hash,(basis->>'byteLength')::bigint,p_actor_user_id,(p->>'journalRetainUntil')::timestamptz,p->>'journalPurposeReference',at);
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.process_class_catalog WHERE retention_class=d.retention_class;
 IF d.retention_class='correction_process_fact_body' THEN UPDATE gridex_correction_process.facts f SET old_fact=NULL,new_fact=jsonb_build_object('retentionUnavailable',true,'sourceHash',d.source_hash,'complete',false,'authority','none') WHERE id=d.target_id::bigint AND company_id=p_company_id;
 ELSE EXECUTE format('UPDATE gridex_correction_process.%I SET readset_text=$1 WHERE id=$2 AND company_id=$3',spec.source_table) USING jsonb_build_object('retentionUnavailable',true,'sourceHash',d.source_hash,'complete',false,'authority','none')::text,d.target_id::uuid,p_company_id;END IF;
 INSERT INTO gridex_ediel_retention.process_events(retention_class,target_id,actor_user_id) VALUES(d.retention_class,d.target_id,p_actor_user_id);INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'process_journal_retention',d.id,'ediel.retention.process_redacted',jsonb_build_object('retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'scopeHash',d.scope_hash,'journalRetainUntil',p->>'journalRetainUntil','journalPurposeReference',p->>'journalPurposeReference','complete',false,'authority','none'));
 RETURN jsonb_build_object('status','redacted','retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'byteLength',(basis->>'byteLength')::bigint,'replay',false);END$$;
-- Current reviewer lock uses the already installed native actor bridge's body;
-- it must not require the submitter's JWT to equal the separate reviewer.
CREATE FUNCTION gridex_ediel_retention.record_lock_review_actor_v1(c uuid,actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF public.ediel_retention_lock_auth_actor_v1(actor) IS NOT TRUE THEN RAISE EXCEPTION 'process_retention_current_review_actor_required';END IF;
 PERFORM id FROM public.user_profiles WHERE id=actor FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=c AND user_id=actor FOR SHARE;
 IF gridex_ediel_retention.record_permission_v1(c,actor,'legal_acceptance_personal_snapshot') IS NOT TRUE OR gridex_ediel_retention.permission_v1(c,actor,'ediel.retention.review') IS NOT TRUE THEN RAISE EXCEPTION 'process_retention_current_review_actor_required';END IF;END$$;
-- Only an actual class tombstone and exact OLD/NEW qualified transition can
-- suppress the minimal prospective process copy of a retention operation.
CREATE FUNCTION public.ediel_capture_customer_record_retention_origin_v1(p_table text,p_old jsonb,p_new jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE t gridex_ediel_retention.record_tombstones%rowtype;BEGIN
 IF public.ediel_is_qualified_customer_record_transition_v1(p_table,p_old,p_new) IS NOT TRUE THEN RETURN false;END IF;
 SELECT x.* INTO STRICT t FROM gridex_ediel_retention.record_tombstones x JOIN gridex_ediel_retention.record_class_catalog k ON k.retention_class=x.retention_class WHERE k.source_table=p_table AND x.target_id=(p_old->>'id')::uuid AND x.target_hash=encode(sha256(convert_to(p_old::text,'UTF8')),'hex');
 INSERT INTO gridex_ediel_retention.process_retention_origins(company_id,source_table,target_id,decision_id,original_hash,redacted_hash,journal_retain_until,journal_purpose_reference) VALUES(t.company_id,p_table,t.target_id,t.decision_id,t.target_hash,encode(sha256(convert_to(p_new::text,'UTF8')),'hex'),t.journal_retain_until,t.journal_purpose_reference) ON CONFLICT DO NOTHING;RETURN true;END$$;
DO $$DECLARE body text;BEGIN SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_correction_process.capture_v1()'::regprocedure;IF body!~*'\mBEGIN\M' THEN RAISE EXCEPTION 'process_retention_capture_source_review_required';END IF;body:=regexp_replace(body,'\mBEGIN\M','BEGIN IF TG_OP=''UPDATE'' AND public.ediel_capture_customer_record_retention_origin_v1(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW;END IF;','i');EXECUTE replace(pg_get_functiondef('gridex_correction_process.capture_v1()'::regprocedure),(SELECT prosrc FROM pg_proc WHERE oid='gridex_correction_process.capture_v1()'::regprocedure),body);END$$;
CREATE FUNCTION public.ediel_require_process_journal_available_v1(p_company_id uuid,p_retention_class text,p_target_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF EXISTS(SELECT FROM gridex_ediel_retention.process_tombstones WHERE company_id=p_company_id AND retention_class=p_retention_class AND target_id=p_target_id) THEN RAISE EXCEPTION 'process_journal_retention_tombstoned';END IF;PERFORM gridex_ediel_retention.process_basis_v1(p_company_id,p_retention_class,p_target_id);END$$;
CREATE FUNCTION public.ediel_process_journal_tombstoned_v1(p_company_id uuid,p_retention_class text,p_target_id text,p_source_hash text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT FROM gridex_ediel_retention.process_tombstones WHERE company_id=p_company_id AND retention_class=p_retention_class AND target_id=p_target_id AND source_hash=p_source_hash) $$;
CREATE FUNCTION gridex_ediel_retention.process_witness_source_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM id FROM gridex_correction_process.facts WHERE id=NEW.fact_id AND company_id=NEW.company_id AND facts_hash=NEW.facts_hash FOR SHARE;
 IF NOT FOUND OR public.ediel_process_journal_tombstoned_v1(NEW.company_id,'correction_process_fact_body',NEW.fact_id::text,NEW.facts_hash) THEN RAISE EXCEPTION 'process_journal_retention_tombstoned';END IF;RETURN NEW;END$$;
CREATE TRIGGER zz_process_witness_source_retention BEFORE INSERT ON gridex_correction_process.witnesses FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.process_witness_source_guard_v1();
-- Existing visibility receipts are immutable past observations. A purged fact
-- cannot acquire a fresh availability witness; replay returns the existing
-- metadata explicitly without claiming old body bytes are still available.
DO $$DECLARE body text;needle text:=' SELECT * INTO f FROM gridex_correction_process.facts';BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_correction_process.witness_v1(uuid,bigint,text,uuid)'::regprocedure;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'process_retention_witness_source_review_required';END IF;
 body:=replace(body,needle,' IF public.ediel_process_journal_tombstoned_v1(p_company_id,''correction_process_fact_body'',p_fact_id::text,p_facts_hash) THEN SELECT * INTO w FROM gridex_correction_process.witnesses WHERE fact_id=p_fact_id AND company_id=p_company_id AND facts_hash=p_facts_hash;IF NOT FOUND THEN RAISE EXCEPTION ''process_journal_retention_tombstoned'';END IF;RETURN jsonb_build_object(''factId'',p_fact_id,''factsHash'',p_facts_hash,''witnessId'',w.id,''availableAt'',w.observed_at,''coverage'',''incomplete'',''authority'',''none'',''retentionUnavailable'',true,''bytesAvailable'',false);END IF;'||needle);
 EXECUTE replace(pg_get_functiondef('gridex_correction_process.witness_v1(uuid,bigint,text,uuid)'::regprocedure),(SELECT prosrc FROM pg_proc WHERE oid='gridex_correction_process.witness_v1(uuid,bigint,text,uuid)'::regprocedure),body);
END$$;
-- Correct the original broad guard in place, preserving its OID, ACL, owner and
-- receipt-first delegate. Future wrappers remain installed around this owner.
DO $$DECLARE body text;needle text;BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_ediel_transport.mutate_v1(jsonb)'::regprocedure;
 needle:='IF EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones t JOIN public.ediel_messages m ON m.company_id=t.company_id AND m.customer_id=t.customer_id WHERE m.id=(p_input->>''messageId'')::uuid AND m.company_id=(p_input->>''companyId'')::uuid) THEN RAISE EXCEPTION ''customer_source_records_retention_tombstoned'';END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'process_retention_generic_guard_source_review_required';END IF;
 body:=replace(body,needle,'PERFORM public.ediel_require_message_consumed_records_v1((p_input->>''companyId'')::uuid,(p_input->>''messageId'')::uuid);');EXECUTE replace(pg_get_functiondef('gridex_ediel_transport.mutate_v1(jsonb)'::regprocedure),(SELECT prosrc FROM pg_proc WHERE oid='gridex_ediel_transport.mutate_v1(jsonb)'::regprocedure),body);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_outbound_dispatch.mutate_v1(jsonb)'::regprocedure;
 needle:='AND EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones t JOIN public.ediel_messages m ON m.company_id=t.company_id AND m.customer_id=t.customer_id WHERE m.id=(p_input->>''messageId'')::uuid AND m.company_id=(p_input->>''companyId'')::uuid) THEN RAISE EXCEPTION ''customer_source_records_retention_tombstoned'';';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'process_retention_dispatch_guard_source_review_required';END IF;
 body:=replace(body,needle,'THEN PERFORM public.ediel_require_message_consumed_records_v1((p_input->>''companyId'')::uuid,(p_input->>''messageId'')::uuid);');EXECUTE replace(pg_get_functiondef('gridex_outbound_dispatch.mutate_v1(jsonb)'::regprocedure),(SELECT prosrc FROM pg_proc WHERE oid='gridex_outbound_dispatch.mutate_v1(jsonb)'::regprocedure),body);
END$$;
CREATE FUNCTION public.ediel_require_message_consumed_records_v1(p_company_id uuid,p_message_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE contract uuid;source uuid;BEGIN
 PERFORM id FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'retention_consumed_message_scope_required';END IF;
 FOR contract IN SELECT o.contract_id FROM gridex_received_sources.switch_originals o WHERE o.company_id=p_company_id AND o.message_id=p_message_id UNION SELECT e.contract_id FROM gridex_requested_changes.events e JOIN public.ediel_messages m ON m.company_id=e.company_id AND m.source_operation_id=e.id::text WHERE m.id=p_message_id AND e.company_id=p_company_id LOOP PERFORM public.ediel_require_contract_records_available_v1(p_company_id,contract);END LOOP;
 -- Immutable original-message links are native source selectors, never body
 -- metadata or an untrusted caller array. Byte retention has its own owner.
 SELECT original_message_id INTO source FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id;IF source IS NOT NULL THEN PERFORM public.ediel_require_source_bytes_available_v1(p_company_id,source);END IF;
END$$;
-- These native consumers discover their contract/source through their actual
-- private prospective owner. An old address or portal-history tombstone is not
-- evidence that a new, independent source consumes the old personal fields.
CREATE FUNCTION gridex_ediel_retention.process_customer_version_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE contract uuid;BEGIN
 IF NEW.event_id IS NOT NULL THEN SELECT e.contract_id INTO contract FROM gridex_requested_changes.events e WHERE e.id=NEW.event_id AND e.company_id=NEW.company_id FOR SHARE;
 ELSIF NEW.bilateral_artifact_id IS NOT NULL THEN SELECT a.contract_id INTO contract FROM gridex_bilateral_customer_sources.artifacts a WHERE a.id=NEW.bilateral_artifact_id AND a.company_id=NEW.company_id FOR SHARE;END IF;
 IF contract IS NULL THEN RAISE EXCEPTION 'retention_customer_version_actual_prospective_contract_required';END IF;
 PERFORM public.ediel_require_contract_records_available_v1(NEW.company_id,contract);PERFORM public.ediel_require_source_bytes_available_v1(NEW.company_id,NEW.source_message_id);RETURN NEW;END$$;
CREATE TRIGGER zz_customer_version_consumed_retention BEFORE INSERT ON gridex_requested_changes.confirmed_customer_versions FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.process_customer_version_guard_v1();
DO $$DECLARE body text;needle text:='PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);';BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure;
 IF position(needle IN body)=0 OR position('normal_supply_activations' IN body)=0 THEN RAISE EXCEPTION 'retention_activation_source_review_required';END IF;
 body:=replace(body,needle,'PERFORM public.ediel_require_contract_records_available_v1(p_company_id,proof.contract_id);PERFORM public.ediel_require_source_bytes_available_v1(p_company_id,proof.source_message_id);PERFORM public.ediel_require_source_bytes_available_v1(p_company_id,proof.original_message_id);'||needle);
 -- Full current function definition preserves its result columns/defaults,
 -- SECURITY DEFINER owner and ACL. Only the bounded source-consumption body is
 -- replaced, after the immutable existing activation has already returned.
 EXECUTE replace(pg_get_functiondef('public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure),(SELECT prosrc FROM pg_proc WHERE oid='public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure),body);
END$$;
-- Fresh native producer INSERTs consume actual immutable proofs. Existing
-- source/activation replay is returned by its owner before these INSERTs.
CREATE FUNCTION gridex_ediel_retention.consumed_source_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE contract uuid;source uuid;origin uuid;BEGIN
 IF TG_TABLE_NAME='normal_supply_activations' THEN
  SELECT contract_id,source_message_id,original_message_id INTO STRICT contract,source,origin FROM gridex_received_sources.normal_switch_confirmations WHERE period_id=NEW.period_id AND company_id=NEW.company_id FOR SHARE;
 ELSIF TG_TABLE_NAME='normal_switch_confirmations' THEN contract:=NEW.contract_id;source:=NEW.source_message_id;origin:=NEW.original_message_id;
 ELSE
  source:=NEW.source_message_id;
  IF NEW.event_id IS NOT NULL THEN SELECT contract_id INTO STRICT contract FROM gridex_requested_changes.events WHERE id=NEW.event_id AND company_id=NEW.company_id FOR SHARE;
  ELSE SELECT contract_id INTO STRICT contract FROM gridex_bilateral_customer_sources.artifacts WHERE id=NEW.bilateral_artifact_id AND company_id=NEW.company_id FOR SHARE;END IF;
 END IF;
 IF contract IS NULL THEN RAISE EXCEPTION 'retention_actual_consumed_contract_required';END IF;
 PERFORM public.ediel_require_contract_records_available_v1(NEW.company_id,contract);PERFORM public.ediel_require_source_bytes_available_v1(NEW.company_id,source);IF origin IS NOT NULL THEN PERFORM public.ediel_require_source_bytes_available_v1(NEW.company_id,origin);END IF;RETURN NEW;
END$$;
CREATE TRIGGER retention_actual_consumed_source BEFORE INSERT ON gridex_received_sources.normal_switch_confirmations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.consumed_source_guard_v1();
CREATE TRIGGER retention_actual_consumed_source BEFORE INSERT ON gridex_received_sources.normal_supply_activations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.consumed_source_guard_v1();
CREATE TRIGGER retention_actual_consumed_source BEFORE INSERT ON gridex_requested_changes.confirmed_customer_versions FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.consumed_source_guard_v1();
CREATE OR REPLACE FUNCTION public.ediel_require_portal_retention_access_v1(p_company_id uuid,p_customer_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE revoked_at timestamptz;BEGIN
 PERFORM id FROM public.customers WHERE id=p_customer_id AND company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'customer_record_customer_scope_required';END IF;
 IF EXISTS(SELECT FROM gridex_ediel_retention.customer_tombstones WHERE company_id=p_company_id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'portal_customer_retention_access_revoked';END IF;
 SELECT max(created_at) INTO revoked_at FROM gridex_ediel_retention.record_tombstones WHERE company_id=p_company_id AND customer_id=p_customer_id;
 IF revoked_at IS NOT NULL AND NOT (EXISTS(SELECT FROM public.customer_portal_accounts WHERE company_id=p_company_id AND customer_id=p_customer_id AND status='active' AND is_active AND created_at>revoked_at) AND EXISTS(SELECT FROM public.customer_portal_claims WHERE company_id=p_company_id AND customer_id=p_customer_id AND status='approved' AND created_at>revoked_at)) THEN RAISE EXCEPTION 'portal_customer_retention_access_revoked';END IF;
END$$;
GRANT USAGE ON SCHEMA gridex_correction_process,gridex_received_sources,gridex_requested_changes TO gridex_ediel_retention_owner;
GRANT SELECT,UPDATE ON public.ediel_messages TO gridex_ediel_retention_owner;
GRANT SELECT,UPDATE ON gridex_correction_process.facts,gridex_correction_process.readsets,gridex_correction_process.combined_snapshots TO gridex_ediel_retention_owner;
GRANT USAGE ON SCHEMA gridex_bilateral_customer_sources TO gridex_ediel_retention_owner;
GRANT SELECT ON gridex_received_sources.switch_originals,gridex_received_sources.normal_switch_confirmations,gridex_requested_changes.events,gridex_bilateral_customer_sources.artifacts TO gridex_ediel_retention_owner;
-- PostgreSQL FOR SHARE needs UPDATE on at least one column. Actual immutable
-- owner guards still reject mutation; no app role receives this lock privilege.
GRANT UPDATE(contract_id) ON gridex_received_sources.normal_switch_confirmations,gridex_requested_changes.events,gridex_bilateral_customer_sources.artifacts TO gridex_ediel_retention_owner;
GRANT EXECUTE ON FUNCTION public.ediel_require_source_bytes_available_v1(uuid,uuid) TO gridex_ediel_retention_owner;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname LIKE 'process_%' AND p.proname NOT IN('process_facts_guard_v1','process_readsets_guard_v1','process_combined_snapshots_guard_v1') OR n.nspname='gridex_ediel_retention' AND p.proname IN('record_lock_review_actor_v1','consumed_source_guard_v1') OR n.nspname='public' AND p.proname IN('ediel_process_journal_retention_basis_v1','ediel_submit_process_journal_retention_v1','ediel_read_process_journal_retention_v1','ediel_review_process_journal_retention_v1','ediel_revoke_process_journal_retention_v1','ediel_purge_process_journal_retention_v1','ediel_is_qualified_process_retention_transition_v1','ediel_capture_customer_record_retention_origin_v1','ediel_require_process_journal_available_v1','ediel_require_message_consumed_records_v1','ediel_process_journal_tombstoned_v1') LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO gridex_ediel_retention_owner',f.signature);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION public.ediel_process_journal_retention_basis_v1(uuid,uuid,text,text),public.ediel_submit_process_journal_retention_v1(uuid,uuid,text,text,text,jsonb),public.ediel_read_process_journal_retention_v1(uuid,uuid,uuid),public.ediel_review_process_journal_retention_v1(uuid,uuid,uuid,text,text),public.ediel_revoke_process_journal_retention_v1(uuid,uuid,uuid,text),public.ediel_purge_process_journal_retention_v1(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_process_journal_available_v1(uuid,text,text),public.ediel_require_message_consumed_records_v1(uuid,uuid) TO service_role;
-- Original process trigger owner can ask only whether an exact native qualified
-- transition exists. It cannot insert a tombstone or issue operation authority.
DO $$DECLARE owner_name text;BEGIN SELECT r.rolname INTO owner_name FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='gridex_correction_process.capture_v1()'::regprocedure;EXECUTE format('GRANT EXECUTE ON FUNCTION public.ediel_capture_customer_record_retention_origin_v1(text,jsonb,jsonb),public.ediel_is_qualified_process_retention_transition_v1(text,jsonb,jsonb) TO %I',owner_name);END$$;
DO $$DECLARE owner_name text;BEGIN SELECT r.rolname INTO owner_name FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='gridex_correction_process.witness_v1(uuid,bigint,text,uuid)'::regprocedure;EXECUTE format('GRANT EXECUTE ON FUNCTION public.ediel_process_journal_tombstoned_v1(uuid,text,text,text) TO %I',owner_name);END$$;
COMMIT;
