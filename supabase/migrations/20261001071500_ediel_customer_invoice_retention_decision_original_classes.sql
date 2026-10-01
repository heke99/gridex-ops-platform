-- Re-created after execution-environment loss from the exact published70700
-- mechanism. This new body/receipt is not restoration proof for lost805574d3.
-- Each policy binds one original class, target and hash, with current separate
-- review. No legal period, grant assignment or cascading erasure is invented.
BEGIN;
DO $$BEGIN
 PERFORM 'gridex_ediel_retention.invoice_file_decisions'::regclass;
 PERFORM 'gridex_ediel_retention.customer_decisions'::regclass;
END$$;
DO $$DECLARE constraint_name name;count_removed integer:=0;BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='gridex_ediel_retention.decision_evidence_catalog'::regclass AND contype='u' AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='gridex_ediel_retention.decision_evidence_catalog'::regclass AND attname='permission_key')]::smallint[] LOOP
  EXECUTE format('ALTER TABLE gridex_ediel_retention.decision_evidence_catalog DROP CONSTRAINT %I',constraint_name);count_removed:=count_removed+1;
 END LOOP;
 IF count_removed<>1 THEN RAISE EXCEPTION 'decision_original_exact_permission_uniqueness_review_required';END IF;
END$$;
INSERT INTO gridex_ediel_retention.decision_evidence_catalog VALUES
 ('invoice_file_retention_decision_original_bytes','invoice_file_decisions','ediel.retention.finance_decision_evidence','invoice_file_revocations','decision_id','invoice_file_receipt_v1'),
 ('customer_retention_decision_original_bytes','customer_decisions','ediel.retention.record_decision_evidence','customer_revocations','decision_id','customer_receipt_v1');
CREATE FUNCTION gridex_ediel_retention.decision_evidence_additional_transition_v1(tab text,o jsonb,n jsonb) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE k text;permission text;t gridex_ediel_retention.decision_evidence_tombstones%rowtype;d gridex_ediel_retention.decision_evidence_policies%rowtype;r gridex_ediel_retention.decision_evidence_reviews%rowtype;p jsonb;b jsonb;at timestamptz;BEGIN
 SELECT retention_class,permission_key INTO k,permission FROM gridex_ediel_retention.decision_evidence_catalog WHERE source_table=tab AND retention_class IN('invoice_file_retention_decision_original_bytes','customer_retention_decision_original_bytes');
 IF k IS NULL OR gridex_ediel_retention.decision_evidence_transition_v1(tab,o,n) IS NOT TRUE THEN RETURN false;END IF;
 SELECT * INTO STRICT t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE retention_class=k AND target_id=(o->>'id')::uuid AND company_id=(o->>'company_id')::uuid;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.decision_evidence_policies WHERE id=t.policy_id FOR UPDATE;
 SELECT * INTO r FROM gridex_ediel_retention.decision_evidence_reviews WHERE policy_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 IF r.id IS DISTINCT FROM t.review_id OR r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR d.company_id IS DISTINCT FROM t.company_id OR d.retention_class IS DISTINCT FROM k OR d.target_id IS DISTINCT FROM t.target_id OR d.source_hash IS DISTINCT FROM t.source_hash OR d.target_metadata_hash IS DISTINCT FROM t.target_metadata_hash THEN RETURN false;END IF;
 b:=gridex_ediel_retention.decision_evidence_basis_v1(t.company_id,k,t.target_id);IF b->>'sourceHash' IS DISTINCT FROM d.source_hash OR b->>'targetMetadataHash' IS DISTINCT FROM d.target_metadata_hash THEN RETURN false;END IF;
 p:=gridex_ediel_retention.decision_evidence_receipt_v1(d);IF p IS NULL THEN RETURN false;END IF;
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(t.company_id,t.actor_user_id,k,'ediel.retention.purge');PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(t.company_id,r.actor_user_id,k);
 p:=gridex_ediel_retention.decision_evidence_receipt_v1(d);IF p IS NULL THEN RETURN false;END IF;
 IF gridex_ediel_retention.permission_v1(t.company_id,t.actor_user_id,'ediel.retention.purge') IS NOT TRUE OR gridex_ediel_retention.permission_v1(t.company_id,t.actor_user_id,permission) IS NOT TRUE OR gridex_ediel_retention.permission_v1(t.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.permission_v1(t.company_id,r.actor_user_id,permission) IS NOT TRUE THEN RETURN false;END IF;
 at:=clock_timestamp();RETURN (p->>'retainUntil')::timestamptz<=at AND(p->>'issuedAt')::timestamptz<=at AND(p->>'expiresAt')::timestamptz>at AND(p->>'journalRetainUntil')::timestamptz>at;
END$$;
ALTER FUNCTION gridex_ediel_retention.decision_evidence_additional_transition_v1(text,jsonb,jsonb) OWNER TO gridex_ediel_retention_owner;
REVOKE ALL ON FUNCTION gridex_ediel_retention.decision_evidence_additional_transition_v1(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE spec record;f record;body text;definition text;name text;before_oid oid;before_owner oid;before_acl aclitem[];before_config text[];before_meta jsonb;BEGIN
 FOR spec IN SELECT * FROM gridex_ediel_retention.decision_evidence_catalog WHERE retention_class IN('invoice_file_retention_decision_original_bytes','customer_retention_decision_original_bytes') LOOP
  IF spec.source_table<>'decision_evidence_policies' THEN
   EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ADD COLUMN document_byte_length bigint,ADD COLUMN document_purged_at timestamptz,ALTER COLUMN document_bytes DROP NOT NULL',spec.source_table);
   EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ADD CONSTRAINT decision_original_byte_custody CHECK(document_bytes IS NOT NULL AND document_purged_at IS NULL OR document_bytes IS NULL AND document_purged_at IS NOT NULL AND document_byte_length>0)',spec.source_table);
   SELECT p.oid,p.proowner,p.proacl,p.proconfig,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE p.oid=format('gridex_ediel_retention.%I(gridex_ediel_retention.%I)',spec.receipt_function,spec.source_table)::regprocedure;
   IF f.prosrc!~*'\mBEGIN\M' OR f.prosrc!~'d\.issuer_receipt' THEN RAISE EXCEPTION 'decision_original_receipt_source_review_required';END IF;
   body:=regexp_replace(f.prosrc,'\mBEGIN\M','BEGIN IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),''hex'') IS DISTINCT FROM d.document_hash THEN RETURN NULL;END IF;','i');
   before_oid:=f.oid;before_owner:=f.proowner;before_acl:=f.proacl;before_config:=f.proconfig;before_meta:=f.metadata;EXECUTE replace(f.definition,f.prosrc,body);
   IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=before_oid AND p.proowner=before_owner AND p.proacl IS NOT DISTINCT FROM before_acl AND p.proconfig IS NOT DISTINCT FROM before_config AND(to_jsonb(p)-'prosrc')=before_meta) THEN RAISE EXCEPTION 'decision_original_receipt_identity_changed';END IF;
  END IF;
  EXECUTE format('CREATE TRIGGER decision_original_insert BEFORE INSERT ON gridex_ediel_retention.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.decision_evidence_original_insert_v1()',spec.source_table);
  SELECT t.oid trigger_oid,t.tgname,t.tgenabled,p.prosrc,p.proowner,p.proconfig,p.prosecdef INTO STRICT f FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=format('gridex_ediel_retention.%I',spec.source_table)::regclass AND t.tgname IN('immutable',spec.source_table||'_immutable') AND NOT t.tgisinternal;
  IF f.prosrc!~*'\mBEGIN\M' OR f.prosrc!~*'RAISE\s+EXCEPTION' OR f.tgenabled NOT IN('O','A') THEN RAISE EXCEPTION 'decision_original_guard_source_review_required';END IF;
  name:=spec.source_table||'_original_guard_v1';body:=regexp_replace(f.prosrc,'\mBEGIN\M','BEGIN IF TG_OP=''UPDATE'' AND gridex_ediel_retention.decision_evidence_additional_transition_v1(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) IS TRUE THEN RETURN NEW;END IF;','i');
  EXECUTE format('CREATE FUNCTION gridex_ediel_retention.%I() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',name,body);EXECUTE format('ALTER FUNCTION gridex_ediel_retention.%I() OWNER TO gridex_ediel_retention_owner',name);EXECUTE format('REVOKE ALL ON FUNCTION gridex_ediel_retention.%I() FROM PUBLIC,anon,authenticated,service_role',name);
  definition:=pg_get_triggerdef(f.trigger_oid);EXECUTE format('DROP TRIGGER %I ON gridex_ediel_retention.%I',f.tgname,spec.source_table);EXECUTE regexp_replace(definition,'EXECUTE (FUNCTION|PROCEDURE) .*$',format('EXECUTE FUNCTION gridex_ediel_retention.%I()',name));IF f.tgenabled='A' THEN EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ENABLE ALWAYS TRIGGER %I',spec.source_table,f.tgname);END IF;
 END LOOP;
END$$;
COMMIT;
