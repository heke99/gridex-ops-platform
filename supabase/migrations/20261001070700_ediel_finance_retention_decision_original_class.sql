-- Finance retention decision original bytes form a separate class; no body
-- purge cascades here and no legal deadline or grant is supplied by migration.
BEGIN;
DO $$BEGIN PERFORM 'gridex_ediel_retention.finance_decisions'::regclass;PERFORM 'gridex_ediel_retention.finance_receipt_v1(gridex_ediel_retention.finance_decisions)'::regprocedure;END$$;
INSERT INTO gridex_ediel_retention.decision_evidence_catalog VALUES
 ('finance_retention_decision_original_bytes','finance_decisions','ediel.retention.finance_decision_evidence','finance_revocations','decision_id','finance_receipt_v1');
INSERT INTO public.permissions(key,name,category,description,is_active) VALUES('ediel.retention.finance_decision_evidence','Retention finance decision original','ediel','Explicit own original-byte class; no default assignment, issuer or deadline',true) ON CONFLICT(key) DO NOTHING;
DO $$DECLARE spec record;f record;body text;definition text;name text;before_oid oid;before_owner oid;before_acl aclitem[];before_config text[];BEGIN
 FOR spec IN SELECT * FROM gridex_ediel_retention.decision_evidence_catalog WHERE retention_class='finance_retention_decision_original_bytes' LOOP
  IF spec.source_table<>'decision_evidence_policies' THEN
   EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ADD COLUMN document_byte_length bigint,ADD COLUMN document_purged_at timestamptz,ALTER COLUMN document_bytes DROP NOT NULL',spec.source_table);
   EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ADD CONSTRAINT decision_original_byte_custody CHECK(document_bytes IS NOT NULL AND document_purged_at IS NULL OR document_bytes IS NULL AND document_purged_at IS NOT NULL AND document_byte_length>0)',spec.source_table);
   SELECT p.oid,p.proowner,p.proacl,p.proconfig,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE p.oid=format('gridex_ediel_retention.%I(gridex_ediel_retention.%I)',spec.receipt_function,spec.source_table)::regprocedure;
   IF f.prosrc!~*'\mBEGIN\M' OR f.prosrc!~'d\.issuer_receipt' THEN RAISE EXCEPTION 'decision_original_receipt_source_review_required';END IF;
   body:=regexp_replace(f.prosrc,'\mBEGIN\M','BEGIN IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),''hex'') IS DISTINCT FROM d.document_hash THEN RETURN NULL;END IF;','i');
   before_oid:=f.oid;before_owner:=f.proowner;before_acl:=f.proacl;before_config:=f.proconfig;EXECUTE replace(f.definition,f.prosrc,body);
   IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=before_oid AND p.proowner=before_owner AND p.proacl IS NOT DISTINCT FROM before_acl AND p.proconfig IS NOT DISTINCT FROM before_config) THEN RAISE EXCEPTION 'decision_original_receipt_identity_changed';END IF;
  END IF;
  EXECUTE format('CREATE TRIGGER decision_original_insert BEFORE INSERT ON gridex_ediel_retention.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.decision_evidence_original_insert_v1()',spec.source_table);
  SELECT t.oid trigger_oid,t.tgname,t.tgenabled,p.prosrc,p.proowner,p.proconfig,p.prosecdef INTO STRICT f FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=format('gridex_ediel_retention.%I',spec.source_table)::regclass AND t.tgname IN('immutable',spec.source_table||'_immutable') AND NOT t.tgisinternal;
  IF f.prosrc!~*'\mBEGIN\M' OR f.prosrc!~*'RAISE\s+EXCEPTION' OR f.tgenabled NOT IN('O','A') THEN RAISE EXCEPTION 'decision_original_guard_source_review_required';END IF;
  name:=spec.source_table||'_original_guard_v1';body:=regexp_replace(f.prosrc,'\mBEGIN\M','BEGIN IF TG_OP=''UPDATE'' AND gridex_ediel_retention.decision_evidence_transition_v1(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) IS TRUE THEN RETURN NEW;END IF;','i');
  EXECUTE format('CREATE FUNCTION gridex_ediel_retention.%I() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',name,body);EXECUTE format('ALTER FUNCTION gridex_ediel_retention.%I() OWNER TO gridex_ediel_retention_owner',name);EXECUTE format('REVOKE ALL ON FUNCTION gridex_ediel_retention.%I() FROM PUBLIC,anon,authenticated,service_role',name);
  definition:=pg_get_triggerdef(f.trigger_oid);EXECUTE format('DROP TRIGGER %I ON gridex_ediel_retention.%I',f.tgname,spec.source_table);EXECUTE regexp_replace(definition,'EXECUTE (FUNCTION|PROCEDURE) .*$',format('EXECUTE FUNCTION gridex_ediel_retention.%I()',name));IF f.tgenabled='A' THEN EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ENABLE ALWAYS TRIGGER %I',spec.source_table,f.tgname);END IF;
 END LOOP;
END$$;
DO $$DECLARE f record;body text;needle text:='''ediel.retention.settlement_copy_evidence'']';extra text:='''ediel.retention.settlement_copy_evidence'',''ediel.retention.finance_decision_evidence'']';BEGIN
 FOR f IN SELECT p.oid,p.proowner,p.proacl,p.proconfig,p.prosrc,pg_get_functiondef(p.oid) definition FROM pg_proc p WHERE p.oid IN('gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure,'public.ediel_current_retention_session_v1(uuid,uuid)'::regprocedure) LOOP
  IF position(needle in f.prosrc)=0 OR f.prosrc!~'ediel_retention_(lock_auth_actor|session_actor)_v1' OR f.prosrc!~'decision_evidence|retention_keys' THEN RAISE EXCEPTION 'finance_decision_evidence_current_scope_source_review_required';END IF;
  body:=replace(f.prosrc,needle,extra);EXECUTE replace(f.definition,f.prosrc,body);
  IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=f.oid AND p.proowner=f.proowner AND p.proacl IS NOT DISTINCT FROM f.proacl AND p.proconfig IS NOT DISTINCT FROM f.proconfig) THEN RAISE EXCEPTION 'finance_decision_evidence_current_scope_identity_changed';END IF;
 END LOOP;
END$$;
-- Expose only retained hashes/custody metadata needed to bind the next
-- independently signed policy; never private issuer bytes or caller authority.
DO $$DECLARE f record;body text;BEGIN
 SELECT p.oid,p.proowner,p.proacl,p.proconfig,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE p.oid='public.ediel_read_retention_decision_original_v1(uuid,uuid,text,uuid,boolean)'::regprocedure;
 IF position('''documentHash'',r->>''document_hash''' in f.prosrc)=0 OR f.prosrc!~'decision_evidence_original_custody_mismatch' THEN RAISE EXCEPTION 'decision_original_metadata_read_source_review_required';END IF;
 body:=replace(f.prosrc,'''documentHash'',r->>''document_hash''','''documentHash'',r->>''document_hash'',''targetMetadataHash'',encode(sha256(convert_to((r-ARRAY[''document_bytes'',''document_byte_length'',''document_purged_at''])::text,''UTF8'')),''hex'')');EXECUTE replace(f.definition,f.prosrc,body);
 IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=f.oid AND p.proowner=f.proowner AND p.proacl IS NOT DISTINCT FROM f.proacl AND p.proconfig IS NOT DISTINCT FROM f.proconfig) THEN RAISE EXCEPTION 'decision_original_metadata_read_identity_changed';END IF;
 SELECT p.oid,p.proowner,p.proacl,p.proconfig,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE p.oid='public.ediel_read_decision_evidence_policy_v1(uuid,uuid,uuid,boolean)'::regprocedure;
 IF position('''bytesAvailable'',d.document_bytes IS NOT NULL' in f.prosrc)=0 THEN RAISE EXCEPTION 'decision_policy_custody_read_source_review_required';END IF;
 body:=replace(f.prosrc,'''bytesAvailable'',d.document_bytes IS NOT NULL','''bytesAvailable'',d.document_bytes IS NOT NULL,''documentPurgedAt'',d.document_purged_at');EXECUTE replace(f.definition,f.prosrc,body);
 IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=f.oid AND p.proowner=f.proowner AND p.proacl IS NOT DISTINCT FROM f.proacl AND p.proconfig IS NOT DISTINCT FROM f.proconfig) THEN RAISE EXCEPTION 'decision_policy_custody_read_identity_changed';END IF;
END$$;
COMMIT;
