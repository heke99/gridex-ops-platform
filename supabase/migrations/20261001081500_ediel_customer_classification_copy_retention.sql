-- Additive, independently governed byte copies from actual 23512 source
-- custody. There are no periods, issuer registrations or grant defaults here.
-- Retained hashes and immutable completed receipts are history, not fresh
-- customer-classification authority. Published migration bytes remain intact.
BEGIN;
DO $$BEGIN
 PERFORM 'gridex_customer_life_events.inbound_classifications'::regclass;
 PERFORM 'gridex_customer_life_events.classification_revocations'::regclass;
 PERFORM 'gridex_ediel_ack_replay.lock_current_graph_v2()'::regprocedure;
 IF NOT EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_catalog WHERE permission_key='ediel.retention.record_decision_evidence') THEN RAISE EXCEPTION 'classification_copy_current_exact_permission_required';END IF;
END$$;
GRANT USAGE ON SCHEMA gridex_customer_life_events,gridex_ediel_ack_replay TO gridex_ediel_retention_owner;
GRANT SELECT,UPDATE ON gridex_customer_life_events.inbound_classifications,gridex_customer_life_events.classification_revocations,public.ediel_messages TO gridex_ediel_retention_owner;
GRANT EXECUTE ON FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() TO gridex_ediel_retention_owner;
CREATE TABLE gridex_ediel_retention.classification_copy_revocations(
 retention_class text NOT NULL REFERENCES gridex_ediel_retention.decision_evidence_catalog(retention_class),classification_id uuid NOT NULL REFERENCES gridex_customer_life_events.inbound_classifications(id),company_id uuid NOT NULL,source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),
 policy_id uuid NOT NULL REFERENCES gridex_ediel_retention.decision_evidence_policies(id),review_id uuid NOT NULL REFERENCES gridex_ediel_retention.decision_evidence_reviews(id),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),actor_user_id uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(retention_class,classification_id));
ALTER TABLE gridex_ediel_retention.classification_copy_revocations OWNER TO gridex_ediel_retention_owner;
ALTER TABLE gridex_ediel_retention.classification_copy_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_retention.classification_copy_revocations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_retention.classification_copy_revocations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_ediel_retention.classification_copy_revocations FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON gridex_ediel_retention.classification_copy_revocations FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
ALTER TABLE gridex_customer_life_events.inbound_classifications ALTER COLUMN source_original DROP NOT NULL,ALTER COLUMN classification_original DROP NOT NULL;
ALTER TABLE gridex_customer_life_events.classification_revocations ALTER COLUMN source_original DROP NOT NULL;
-- No new columns on the signed classification row: 54122 binds its full hash.
CREATE VIEW gridex_ediel_retention.customer_classification_source_originals WITH(security_barrier=true) AS
 SELECT q.id,q.company_id,q.source_original document_bytes,q.source_sha256 document_hash,NULL::bigint document_byte_length,NULL::timestamptz document_purged_at,to_jsonb(q)-ARRAY['source_original','classification_original'] source_metadata FROM gridex_customer_life_events.inbound_classifications q;
CREATE VIEW gridex_ediel_retention.customer_classification_receipt_originals WITH(security_barrier=true) AS
 SELECT q.id,q.company_id,q.classification_original document_bytes,q.classification_sha256 document_hash,NULL::bigint document_byte_length,NULL::timestamptz document_purged_at,to_jsonb(q)-ARRAY['source_original','classification_original'] source_metadata FROM gridex_customer_life_events.inbound_classifications q;
CREATE VIEW gridex_ediel_retention.customer_classification_revocation_originals WITH(security_barrier=true) AS
 SELECT q.id,q.company_id,r.source_original document_bytes,r.source_sha256 document_hash,NULL::bigint document_byte_length,NULL::timestamptz document_purged_at,jsonb_build_object('classification',to_jsonb(q)-ARRAY['source_original','classification_original'],'revocation',to_jsonb(r)-'source_original') source_metadata FROM gridex_customer_life_events.classification_revocations r JOIN gridex_customer_life_events.inbound_classifications q ON q.id=r.classification_id;
INSERT INTO gridex_ediel_retention.decision_evidence_catalog VALUES
 ('life_event_classification_source_original_bytes','customer_classification_source_originals','ediel.retention.record_decision_evidence','classification_copy_revocations','classification_id','classification_copy_source_current_v1'),
 ('life_event_classification_receipt_original_bytes','customer_classification_receipt_originals','ediel.retention.record_decision_evidence','classification_copy_revocations','classification_id','classification_copy_source_current_v1'),
 ('life_event_classification_revocation_original_bytes','customer_classification_revocation_originals','ediel.retention.record_decision_evidence','classification_copy_revocations','classification_id','classification_copy_source_current_v1');
DO $$DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['customer_classification_source_originals','customer_classification_receipt_originals','customer_classification_revocation_originals'] LOOP
 EXECUTE format('ALTER VIEW gridex_ediel_retention.%I OWNER TO gridex_ediel_retention_owner',tab);EXECUTE format('REVOKE ALL ON gridex_ediel_retention.%I FROM PUBLIC,anon,authenticated,service_role',tab);
END LOOP;END$$;

-- A STABLE caller may SELECT a VOLATILE callee. The callee itself owns the
-- locks AND the fresh revocation decision; the old caller snapshot does not.
CREATE FUNCTION gridex_ediel_retention.classification_copy_source_current_v1(c uuid,mid uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE actual_company uuid;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT company_id INTO actual_company FROM public.ediel_messages WHERE id=mid AND(c IS NULL OR company_id=c) FOR SHARE;
 IF actual_company IS NULL THEN RETURN false;END IF;
 PERFORM id FROM gridex_customer_life_events.inbound_classifications WHERE source_message_id=mid AND company_id=actual_company FOR SHARE;
 RETURN NOT EXISTS(SELECT FROM gridex_ediel_retention.classification_copy_revocations WHERE source_message_id=mid AND company_id=actual_company);
END$$;
CREATE FUNCTION gridex_ediel_retention.classification_copy_row_v1(c uuid,k text,target uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE q gridex_customer_life_events.inbound_classifications%rowtype;v gridex_customer_life_events.classification_revocations%rowtype;bytes bytea;h text;meta jsonb;t gridex_ediel_retention.decision_evidence_tombstones%rowtype;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO q FROM gridex_customer_life_events.inbound_classifications WHERE id=target AND company_id=c;
 IF q.id IS NULL THEN RAISE EXCEPTION 'decision_evidence_original_scope_required';END IF;
 PERFORM id FROM public.ediel_messages WHERE id=q.source_message_id AND company_id=c FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'decision_evidence_original_scope_required';END IF;
 SELECT * INTO STRICT q FROM gridex_customer_life_events.inbound_classifications WHERE id=target AND company_id=c FOR UPDATE;
 meta:=to_jsonb(q)-ARRAY['source_original','classification_original'];
 IF k='life_event_classification_source_original_bytes' THEN bytes:=q.source_original;h:=q.source_sha256;
 ELSIF k='life_event_classification_receipt_original_bytes' THEN bytes:=q.classification_original;h:=q.classification_sha256;
 ELSIF k='life_event_classification_revocation_original_bytes' THEN
  SELECT * INTO v FROM gridex_customer_life_events.classification_revocations WHERE classification_id=target FOR UPDATE;IF v.classification_id IS NULL THEN RAISE EXCEPTION 'decision_evidence_original_scope_required';END IF;
  bytes:=v.source_original;h:=v.source_sha256;meta:=jsonb_build_object('classification',meta,'revocation',to_jsonb(v)-'source_original');
 ELSE RAISE EXCEPTION 'classification_copy_class_required';END IF;
 SELECT * INTO t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE retention_class=k AND target_id=target AND company_id=c;
 IF bytes IS NOT NULL AND encode(sha256(bytes),'hex') IS DISTINCT FROM h OR bytes IS NULL AND(t.target_id IS NULL OR t.source_hash IS DISTINCT FROM h) THEN RAISE EXCEPTION 'decision_evidence_original_custody_mismatch';END IF;
 RETURN jsonb_build_object('id',target,'company_id',c,'document_bytes',CASE WHEN bytes IS NULL THEN NULL ELSE '\x'||encode(bytes,'hex') END,'document_hash',h,'document_byte_length',CASE WHEN bytes IS NULL THEN t.byte_length ELSE NULL END,'document_purged_at',t.created_at,'source_metadata',meta);
END$$;
CREATE FUNCTION gridex_ediel_retention.classification_copy_basis_v1(c uuid,k text,target uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r jsonb;bytes bytea;BEGIN
 r:=gridex_ediel_retention.classification_copy_row_v1(c,k,target);bytes:=decode(substr(r->>'document_bytes',3),'hex');
 IF bytes IS NULL OR octet_length(bytes)<1 THEN RAISE EXCEPTION 'decision_evidence_actual_original_bytes_required';END IF;
 RETURN jsonb_build_object('retentionClass',k,'targetId',target,'sourceHash',r->>'document_hash','targetMetadataHash',encode(sha256(convert_to((r-ARRAY['document_bytes','document_byte_length','document_purged_at'])::text,'UTF8')),'hex'),'byteLength',octet_length(bytes));
END$$;

-- The tombstone alone cannot qualify a transition. Resolve its immutable
-- policy/review, source and issuer locks, then recheck current actor/reviewer
-- operation+class grants and native time immediately before the physical write.
CREATE FUNCTION gridex_ediel_retention.classification_copy_transition_v1(k text,o jsonb,n jsonb) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE target uuid:=coalesce(o->>'id',o->>'classification_id')::uuid;q gridex_customer_life_events.inbound_classifications%rowtype;t gridex_ediel_retention.decision_evidence_tombstones%rowtype;d gridex_ediel_retention.decision_evidence_policies%rowtype;r gridex_ediel_retention.decision_evidence_reviews%rowtype;p jsonb;b jsonb;bytes bytea;h text;field text;permission text;at timestamptz;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO q FROM gridex_customer_life_events.inbound_classifications WHERE id=target;
 PERFORM id FROM public.ediel_messages WHERE id=q.source_message_id AND company_id=q.company_id FOR UPDATE;IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO STRICT q FROM gridex_customer_life_events.inbound_classifications WHERE id=target FOR UPDATE;
 field:=CASE k WHEN 'life_event_classification_source_original_bytes' THEN 'source_original' WHEN 'life_event_classification_receipt_original_bytes' THEN 'classification_original' WHEN 'life_event_classification_revocation_original_bytes' THEN 'source_original' END;
 IF field IS NULL OR o->>field IS NULL OR n->>field IS NOT NULL OR(o-field) IS DISTINCT FROM(n-field) THEN RETURN false;END IF;
 bytes:=decode(substr(o->>field,3),'hex');h:=encode(sha256(bytes),'hex');
 SELECT * INTO t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE retention_class=k AND target_id=target AND company_id=q.company_id;
 IF t.target_id IS NULL OR h IS DISTINCT FROM t.source_hash OR octet_length(bytes) IS DISTINCT FROM t.byte_length OR NOT EXISTS(SELECT FROM gridex_ediel_retention.classification_copy_revocations WHERE retention_class=k AND classification_id=target AND company_id=q.company_id AND source_message_id=q.source_message_id AND policy_id=t.policy_id AND review_id=t.review_id AND source_hash=h AND actor_user_id=t.actor_user_id) THEN RETURN false;END IF;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.decision_evidence_policies WHERE id=t.policy_id FOR UPDATE;
 SELECT * INTO r FROM gridex_ediel_retention.decision_evidence_reviews WHERE policy_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 IF r.id IS DISTINCT FROM t.review_id OR r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR d.retention_class IS DISTINCT FROM k OR d.target_id IS DISTINCT FROM target OR d.company_id IS DISTINCT FROM q.company_id OR d.source_hash IS DISTINCT FROM h OR d.target_metadata_hash IS DISTINCT FROM t.target_metadata_hash THEN RETURN false;END IF;
 b:=gridex_ediel_retention.classification_copy_basis_v1(q.company_id,k,target);
 IF b->>'sourceHash' IS DISTINCT FROM d.source_hash OR b->>'targetMetadataHash' IS DISTINCT FROM d.target_metadata_hash THEN RETURN false;END IF;
 p:=gridex_ediel_retention.decision_evidence_receipt_v1(d);IF p IS NULL THEN RETURN false;END IF;
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(q.company_id,t.actor_user_id,k,'ediel.retention.purge');
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(q.company_id,r.actor_user_id,k);
 p:=gridex_ediel_retention.decision_evidence_receipt_v1(d);IF p IS NULL THEN RETURN false;END IF;
 SELECT permission_key INTO STRICT permission FROM gridex_ediel_retention.decision_evidence_catalog WHERE retention_class=k;
 IF gridex_ediel_retention.permission_v1(q.company_id,t.actor_user_id,'ediel.retention.purge') IS NOT TRUE OR gridex_ediel_retention.permission_v1(q.company_id,t.actor_user_id,permission) IS NOT TRUE OR gridex_ediel_retention.permission_v1(q.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.permission_v1(q.company_id,r.actor_user_id,permission) IS NOT TRUE THEN RETURN false;END IF;
 at:=clock_timestamp();RETURN (p->>'retainUntil')::timestamptz<=at AND(p->>'issuedAt')::timestamptz<=at AND(p->>'expiresAt')::timestamptz>at AND(p->>'journalRetainUntil')::timestamptz>at;
END$$;
CREATE FUNCTION gridex_ediel_retention.classification_copy_insert_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF NEW.source_original IS NULL OR encode(sha256(NEW.source_original),'hex') IS DISTINCT FROM NEW.source_sha256 OR TG_TABLE_NAME='inbound_classifications' AND(to_jsonb(NEW)->>'classification_original' IS NULL OR encode(sha256(decode(substr(to_jsonb(NEW)->>'classification_original',3),'hex')),'hex') IS DISTINCT FROM to_jsonb(NEW)->>'classification_sha256') THEN RAISE EXCEPTION 'classification_copy_new_actual_bytes_required';END IF;RETURN NEW;
END$$;
CREATE TRIGGER classification_copy_insert BEFORE INSERT ON gridex_customer_life_events.inbound_classifications FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.classification_copy_insert_v1();
CREATE TRIGGER classification_copy_insert BEFORE INSERT ON gridex_customer_life_events.classification_revocations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.classification_copy_insert_v1();
CREATE FUNCTION gridex_ediel_retention.classification_copy_view_update_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE k text;t gridex_ediel_retention.decision_evidence_tombstones%rowtype;BEGIN
 SELECT retention_class INTO STRICT k FROM gridex_ediel_retention.decision_evidence_catalog WHERE source_table=TG_TABLE_NAME;
 SELECT * INTO t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE retention_class=k AND target_id=OLD.id AND company_id=OLD.company_id;
 IF t.target_id IS NULL OR OLD.document_bytes IS NULL OR NEW.document_bytes IS NOT NULL OR(to_jsonb(OLD)-ARRAY['document_bytes','document_byte_length','document_purged_at']) IS DISTINCT FROM(to_jsonb(NEW)-ARRAY['document_bytes','document_byte_length','document_purged_at']) OR NEW.document_byte_length IS DISTINCT FROM t.byte_length OR NEW.document_purged_at IS DISTINCT FROM t.created_at THEN RAISE EXCEPTION 'classification_copy_physical_transition_required';END IF;
 IF k='life_event_classification_source_original_bytes' THEN UPDATE gridex_customer_life_events.inbound_classifications SET source_original=NULL WHERE id=OLD.id AND company_id=OLD.company_id;
 ELSIF k='life_event_classification_receipt_original_bytes' THEN UPDATE gridex_customer_life_events.inbound_classifications SET classification_original=NULL WHERE id=OLD.id AND company_id=OLD.company_id;
 ELSE UPDATE gridex_customer_life_events.classification_revocations SET source_original=NULL WHERE classification_id=OLD.id;END IF;RETURN NEW;
END$$;
DO $$DECLARE tab text;f record;body text;definition text;name text;BEGIN
 FOREACH tab IN ARRAY ARRAY['inbound_classifications','classification_revocations'] LOOP
  SELECT t.oid,t.tgname,t.tgenabled,p.prosrc INTO STRICT f FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=format('gridex_customer_life_events.%I',tab)::regclass AND t.tgname='customer_event_classification_immutable' AND NOT t.tgisinternal;
  IF f.prosrc!~*'RAISE\s+EXCEPTION' OR f.tgenabled NOT IN('O','A') THEN RAISE EXCEPTION 'classification_copy_original_guard_review_required';END IF;
  name:=tab||'_classification_copy_guard_v1';
  body:=regexp_replace(f.prosrc,'\mBEGIN\M',CASE WHEN tab='inbound_classifications' THEN 'BEGIN IF TG_OP=''UPDATE'' AND (gridex_ediel_retention.classification_copy_transition_v1(''life_event_classification_source_original_bytes'',to_jsonb(OLD),to_jsonb(NEW)) IS TRUE OR gridex_ediel_retention.classification_copy_transition_v1(''life_event_classification_receipt_original_bytes'',to_jsonb(OLD),to_jsonb(NEW)) IS TRUE) THEN RETURN NEW;END IF;' ELSE 'BEGIN IF TG_OP=''UPDATE'' AND gridex_ediel_retention.classification_copy_transition_v1(''life_event_classification_revocation_original_bytes'',to_jsonb(OLD),to_jsonb(NEW)) IS TRUE THEN RETURN NEW;END IF;' END,'i');
  EXECUTE format('CREATE FUNCTION gridex_ediel_retention.%I() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',name,body);
  EXECUTE format('ALTER FUNCTION gridex_ediel_retention.%I() OWNER TO gridex_ediel_retention_owner',name);EXECUTE format('REVOKE ALL ON FUNCTION gridex_ediel_retention.%I() FROM PUBLIC,anon,authenticated,service_role',name);
  definition:=pg_get_triggerdef(f.oid);EXECUTE format('DROP TRIGGER %I ON gridex_customer_life_events.%I',f.tgname,tab);EXECUTE regexp_replace(definition,'EXECUTE (FUNCTION|PROCEDURE) .*$',format('EXECUTE FUNCTION gridex_ediel_retention.%I()',name));IF f.tgenabled='A' THEN EXECUTE format('ALTER TABLE gridex_customer_life_events.%I ENABLE ALWAYS TRIGGER %I',tab,f.tgname);END IF;
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['customer_classification_source_originals','customer_classification_receipt_originals','customer_classification_revocation_originals'] LOOP EXECUTE format('CREATE TRIGGER classification_copy_view_update INSTEAD OF UPDATE ON gridex_ediel_retention.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.classification_copy_view_update_v1()',tab);END LOOP;
END$$;

-- Preserve the complete installed old function definitions, including STABLE,
-- owner, ACL, security configuration and OID. Only exact checked ports change.
DO $$DECLARE f record;body text;needle text;prefix text;signature text;copy_classes text:='''life_event_classification_source_original_bytes'',''life_event_classification_receipt_original_bytes'',''life_event_classification_revocation_original_bytes''';BEGIN
 FOR signature IN SELECT unnest(ARRAY['gridex_ediel_retention.decision_evidence_basis_v1(uuid,text,uuid)','public.ediel_read_retention_decision_original_v1(uuid,uuid,text,uuid,boolean)','public.ediel_purge_decision_evidence_retention_v1(uuid,uuid,uuid)','gridex_ediel_retention.decision_evidence_receipt_v1(gridex_ediel_retention.decision_evidence_policies)','gridex_customer_life_events.inbound_basis_v1(uuid,uuid,uuid)','gridex_customer_life_events.owner_proof_consistent_v1(jsonb,jsonb,uuid)']) LOOP
  SELECT p.oid,p.proowner,p.proacl,p.proconfig,p.provolatile,p.prosecdef,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE p.oid=signature::regprocedure;body:=f.prosrc;
  IF signature LIKE '%decision_evidence_basis_v1%' THEN
   needle:='SELECT source_table INTO STRICT tab';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'classification_copy_basis_port_review_required';END IF;
   body:=replace(body,needle,'IF k IN('||copy_classes||') THEN RETURN gridex_ediel_retention.classification_copy_basis_v1(c,k,target);END IF; '||needle);
  ELSIF signature LIKE '%ediel_read_retention_decision_original_v1%' THEN
   needle:='SELECT source_table INTO STRICT tab';IF position(needle IN body)=0 OR body!~'decision_evidence_read_actor_v1' THEN RAISE EXCEPTION 'classification_copy_read_port_review_required';END IF;
   body:=replace(body,needle,'IF p_retention_class IN('||copy_classes||') THEN r:=gridex_ediel_retention.classification_copy_row_v1(p_company_id,p_retention_class,p_target_id);b:=decode(substr(r->>''document_bytes'',3),''hex''); SELECT * INTO t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE retention_class=p_retention_class AND target_id=p_target_id AND company_id=p_company_id; RETURN jsonb_build_object(''companyId'',p_company_id,''retentionClass'',p_retention_class,''targetId'',p_target_id,''documentHash'',r->>''document_hash'',''targetMetadataHash'',encode(sha256(convert_to((r-ARRAY[''document_bytes'',''document_byte_length'',''document_purged_at''])::text,''UTF8'')),''hex''),''documentByteLength'',coalesce(octet_length(b),t.byte_length),''bytesAvailable'',b IS NOT NULL,''documentBase64'',CASE WHEN p_include_document AND b IS NOT NULL THEN replace(encode(b,''base64''),E''\n'','''') ELSE NULL END,''purgedAt'',t.created_at,''authority'',''none'');END IF; '||needle);
  ELSIF signature LIKE '%ediel_purge_decision_evidence_retention_v1%' THEN
   needle:='EXECUTE format(''INSERT INTO gridex_ediel_retention.%I(%I,actor_user_id,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING'',spec.revocation_table,spec.revocation_id_column) USING d.target_id,p_actor_user_id,left(''Qualified decision-original policy: ''||(p->>''legalBasisReference''),4000);';
   IF position(needle IN body)=0 OR body!~'replay'',true' THEN RAISE EXCEPTION 'classification_copy_purge_port_review_required';END IF;
   body:=replace(body,needle,'IF d.retention_class IN('||copy_classes||') THEN INSERT INTO gridex_ediel_retention.classification_copy_revocations(retention_class,classification_id,company_id,source_message_id,policy_id,review_id,source_hash,actor_user_id) SELECT d.retention_class,d.target_id,d.company_id,q.source_message_id,d.id,r.id,d.source_hash,p_actor_user_id FROM gridex_customer_life_events.inbound_classifications q WHERE q.id=d.target_id AND q.company_id=d.company_id;ELSE '||needle||' END IF;');
  ELSIF signature LIKE '%decision_evidence_receipt_v1%' THEN
   IF body!~'issuer.legal_evidence' OR body!~'journal_end<=now\(\)' OR body!~'decision_evidence_revocations' THEN RAISE EXCEPTION 'classification_copy_native_clock_receipt_review_required';END IF;body:=replace(body,'now()','clock_timestamp()');
  ELSIF signature LIKE '%owner_proof_consistent_v1%' THEN
   IF f.provolatile<>'s' OR body!~'classificationRecordId' OR body!~'source_bound_customer_history' THEN RAISE EXCEPTION 'classification_copy_actual_stable_owner_review_required';END IF;
   body:=regexp_replace(body,'\mBEGIN\M','BEGIN IF gridex_ediel_retention.classification_copy_source_current_v1(NULL,mid) IS NOT TRUE THEN RETURN false;END IF;','i');
  ELSE
   IF body!~'FOR UPDATE' OR body!~'inbound_classifications' THEN RAISE EXCEPTION 'classification_copy_actual_inbound_port_review_required';END IF;
   body:=regexp_replace(body,'\mBEGIN\M','BEGIN IF gridex_ediel_retention.classification_copy_source_current_v1(c,mid) IS NOT TRUE THEN RETURN jsonb_build_object(''status'',''held'',''companyId'',c,''messageId'',mid,''missing'',ARRAY[''classification_original_copy_retained_history_only'']);END IF;','i');
  END IF;
  EXECUTE replace(f.definition,f.prosrc,body);
  IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=f.oid AND p.proowner=f.proowner AND p.proacl IS NOT DISTINCT FROM f.proacl AND p.proconfig IS NOT DISTINCT FROM f.proconfig AND p.provolatile=f.provolatile AND p.prosecdef=f.prosecdef AND(to_jsonb(p)-'prosrc')=f.metadata) THEN RAISE EXCEPTION 'classification_copy_function_identity_changed';END IF;
 END LOOP;
 -- All six actual workflow entrypoints take the common graph prefix before
 -- old actor/company/policy/source locks, not a late nested helper prefix.
 FOR f IN SELECT p.oid,p.proowner,p.proacl,p.proconfig,p.provolatile,p.prosecdef,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('ediel_submit_decision_evidence_retention_v1','ediel_review_decision_evidence_retention_v1','ediel_revoke_decision_evidence_retention_v1','ediel_purge_decision_evidence_retention_v1','ediel_read_retention_decision_original_v1','ediel_read_decision_evidence_policy_v1') LOOP
  IF f.prosrc!~'decision_evidence_lock_v1' THEN RAISE EXCEPTION 'classification_copy_entry_prefix_review_required';END IF;
  body:=regexp_replace(f.prosrc,'\mBEGIN\M','BEGIN PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();','i');EXECUTE replace(f.definition,f.prosrc,body);
  IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=f.oid AND p.proowner=f.proowner AND p.proacl IS NOT DISTINCT FROM f.proacl AND p.proconfig IS NOT DISTINCT FROM f.proconfig AND p.provolatile=f.provolatile AND p.prosecdef=f.prosecdef AND(to_jsonb(p)-'prosrc')=f.metadata) THEN RAISE EXCEPTION 'classification_copy_entry_identity_changed';END IF;
 END LOOP;
END$$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname LIKE 'classification_copy_%' LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO gridex_ediel_retention_owner',f.signature);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
END LOOP;END$$;
COMMIT;
