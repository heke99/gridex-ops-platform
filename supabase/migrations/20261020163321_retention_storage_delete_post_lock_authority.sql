-- Recheck selected authority after the three ordered retention BEFORE guards'
-- read/write waits, including earlier classes and every shared invoice copy.
-- This is a per-object SQL guard boundary, not authority-at-commit, native,
-- legal-original or physical Storage deletion evidence. No audit19 consumer
-- changes and no completed-policy replay bypass are introduced.
BEGIN;
-- DB05_INSTALL_OWNER_SCOPE_BEGIN
-- Same guarded atomic install capability as existing OPS part03/part11.
-- No role/owner/application capability persists outside this transaction.
DO $db05_install_preflight$
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolinherit AND rolcreaterole AND rolbypassrls)
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls)
 OR (SELECT nspowner FROM pg_namespace WHERE nspname='gridex_ediel_retention') IS DISTINCT FROM 'gridex_ediel_retention_owner'::regrole::oid
 OR EXISTS(SELECT FROM pg_auth_members WHERE roleid='gridex_ediel_retention_owner'::regrole AND member<>'postgres'::regrole)
 OR (SELECT jsonb_agg(jsonb_build_array(g.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY g.rolname COLLATE "C") FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid='gridex_ediel_retention_owner'::regrole AND m.member='postgres'::regrole)
 IS DISTINCT FROM '[["postgres",false,false,true],["supabase_admin",true,false,false]]'::jsonb
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 OR pg_has_role('postgres','gridex_ediel_retention_owner','SET') IS DISTINCT FROM true
 OR pg_has_role('postgres','gridex_ediel_retention_owner','MEMBER') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'db05_qualified_non_super_migration_owner_profile_required' USING ERRCODE='42501';END IF;
 IF to_regclass('pg_temp.gridex_retention_storage_install_scope') IS NOT NULL THEN RAISE EXCEPTION 'db05_unexpected_existing_install_scope';END IF;
END $db05_install_preflight$;
CREATE TEMPORARY TABLE gridex_retention_storage_install_scope ON COMMIT DROP AS
 SELECT (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) AS memberships,
 (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) AS roles,
 (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention')) AS namespaces,
 has_schema_privilege('gridex_ediel_retention_owner','public','CREATE') AS owner_public_create;
GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
DO $db05_install_capability$ BEGIN
 IF NOT pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') THEN RAISE EXCEPTION 'db05_atomic_owner_inheritance_unavailable';END IF;
 -- No new public-function owner transfer; no temporary public CREATE.
END $db05_install_capability$;
-- DB05_INSTALL_OWNER_SCOPE_END

DO $retention_storage_body_preflight$
DECLARE expected record;actual record;BEGIN
 FOR expected IN SELECT * FROM (VALUES
 ('gridex_ediel_retention.storage_guard_v1()','c13d549a2fc9ba39bcc543255493974cef4afd926660ada2e86ec55ea313744b'),
 ('gridex_ediel_retention.contract_storage_guard_v1()','9bb603eb46f8c7687868c80205613f5ae4315cca1b6d614bbb597aa3f0ed4275'),
 ('gridex_ediel_retention.invoice_file_storage_guard_v1()','b9900b63b92399a6a210d83767bef73c27ca8aa785152ef5377e2ac4b93e8b9d')
 ) AS v(signature,body_hash) LOOP
  SELECT p.* INTO actual FROM pg_proc p WHERE p.oid=to_regprocedure(expected.signature);
  IF NOT FOUND OR actual.proowner IS DISTINCT FROM 'gridex_ediel_retention_owner'::regrole::oid
   OR NOT actual.prosecdef OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   OR actual.pronargs<>0 OR actual.proargnames IS NOT NULL OR actual.prorettype IS DISTINCT FROM 'trigger'::regtype::oid
   OR actual.proretset OR actual.proisstrict OR actual.proleakproof OR actual.prokind<>'f' OR actual.provolatile<>'v' OR actual.proparallel<>'u'
   OR encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.body_hash
   OR EXISTS(SELECT FROM aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl WHERE acl.privilege_type<>'EXECUTE' OR acl.grantee<>actual.proowner)
  THEN RAISE EXCEPTION 'retention_storage_exact_source_owner_acl_header_required: %',expected.signature USING ERRCODE='42501';END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='storage.objects'::regclass AND tgname IN('contract_retention_storage_guard','ediel_retention_storage_guard','invoice_file_retention_storage_guard'))<>3
 OR EXISTS(SELECT FROM pg_trigger t JOIN (VALUES
  ('contract_retention_storage_guard','gridex_ediel_retention.contract_storage_guard_v1()'::regprocedure::oid),
  ('ediel_retention_storage_guard','gridex_ediel_retention.storage_guard_v1()'::regprocedure::oid),
  ('invoice_file_retention_storage_guard','gridex_ediel_retention.invoice_file_storage_guard_v1()'::regprocedure::oid)
 ) trigger_expected(name,function_oid) ON trigger_expected.name=t.tgname WHERE t.tgrelid='storage.objects'::regclass
 AND (t.tgfoid<>trigger_expected.function_oid OR t.tgtype<>31 OR t.tgenabled<>'O' OR t.tgisinternal OR t.tgnargs<>0 OR t.tgqual IS NOT NULL OR t.tgconstraint<>0))
 THEN RAISE EXCEPTION 'retention_storage_exact_ordered_trigger_profile_required' USING ERRCODE='42501';END IF;
END $retention_storage_body_preflight$;

CREATE TEMPORARY TABLE gridex_retention_storage_function_scope ON COMMIT DROP AS
 SELECT (SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) FROM pg_proc p WHERE p.oid=ANY(ARRAY['gridex_ediel_retention.storage_guard_v1()'::regprocedure::oid,'gridex_ediel_retention.contract_storage_guard_v1()'::regprocedure::oid,'gridex_ediel_retention.invoice_file_storage_guard_v1()'::regprocedure::oid])) AS profiles,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid='storage.objects'::regclass) AS triggers;

CREATE OR REPLACE FUNCTION gridex_ediel_retention.storage_guard_v1() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE t gridex_ediel_retention.blob_tombstones%rowtype;d gridex_ediel_retention.blob_decisions%rowtype;basis jsonb;r uuid;actor uuid:=public.ediel_retention_session_actor_v1();BEGIN
 IF TG_OP<>'DELETE' AND new.bucket_id='ediel-files' AND EXISTS(SELECT FROM gridex_ediel_retention.blob_tombstones WHERE retention_class='transport_raw_mime_bytes' AND storage_path=new.name) THEN RAISE EXCEPTION 'ediel_storage_retention_object_tombstoned';END IF;
 IF (CASE WHEN TG_OP='INSERT' THEN new.bucket_id ELSE old.bucket_id END) IS DISTINCT FROM 'ediel-files' THEN IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 SELECT * INTO t FROM gridex_ediel_retention.blob_tombstones WHERE retention_class='transport_raw_mime_bytes' AND storage_path=(CASE WHEN TG_OP='INSERT' THEN new.name ELSE old.name END);
 IF NOT FOUND THEN IF TG_OP='UPDATE' AND old.name LIKE 'transport/%' AND EXISTS(SELECT FROM public.ediel_message_payloads p WHERE p.encrypted_payload_ref='storage://ediel-files/'||old.name AND p.metadata->>'archive_verified'='true') THEN RAISE EXCEPTION 'ediel_storage_archived_object_immutable';END IF;IF TG_OP='DELETE' AND old.name LIKE 'transport/%' THEN RAISE EXCEPTION 'ediel_storage_native_class_purge_required';END IF;IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 IF TG_OP<>'DELETE' THEN RAISE EXCEPTION 'ediel_storage_retention_object_tombstoned';END IF;
 PERFORM gridex_ediel_retention.actor_v1(t.company_id,actor,'ediel.retention.purge');IF gridex_ediel_retention.class_permission_v1(t.company_id,actor,t.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'blob_retention_scoped_communication_required';END IF;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.blob_decisions WHERE id=t.decision_id FOR UPDATE;r:=gridex_ediel_retention.blob_current_v1(d);basis:=gridex_ediel_retention.blob_basis_v1(t.company_id,t.retention_class,t.target_id);
 IF r IS NULL OR basis->>'targetHash' IS DISTINCT FROM t.target_hash OR basis->>'storagePath' IS DISTINCT FROM old.name THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;
 -- Qualify the same selected review after basis waits, then after event waits.
 IF gridex_ediel_retention.blob_current_v1(d) IS DISTINCT FROM r THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;
 PERFORM gridex_ediel_retention.actor_v1(t.company_id,actor,'ediel.retention.purge');
 IF gridex_ediel_retention.class_permission_v1(t.company_id,actor,t.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'blob_retention_scoped_communication_required';END IF;
 INSERT INTO gridex_ediel_retention.blob_events(retention_class,target_id,kind,actor_user_id) VALUES(t.retention_class,t.target_id,'storage_delete_authorized',actor) ON CONFLICT DO NOTHING;
 IF gridex_ediel_retention.blob_current_v1(d) IS DISTINCT FROM r THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;
 PERFORM gridex_ediel_retention.actor_v1(t.company_id,actor,'ediel.retention.purge');
 IF gridex_ediel_retention.class_permission_v1(t.company_id,actor,t.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'blob_retention_scoped_communication_required';END IF;
 RETURN old;
END$$;

CREATE OR REPLACE FUNCTION gridex_ediel_retention.contract_storage_guard_v1() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE t gridex_ediel_retention.record_tombstones%rowtype;d gridex_ediel_retention.record_decisions%rowtype;basis jsonb;r uuid;actor uuid:=public.ediel_retention_session_actor_v1();BEGIN
 IF TG_OP<>'DELETE' AND new.bucket_id='customer-contract-documents' AND EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones WHERE retention_class='contract_signed_pdf_bytes' AND storage_path=new.name) THEN RAISE EXCEPTION 'contract_pdf_retention_tombstoned';END IF;
 IF (CASE WHEN TG_OP='INSERT' THEN new.bucket_id ELSE old.bucket_id END) IS DISTINCT FROM 'customer-contract-documents' THEN IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 SELECT * INTO t FROM gridex_ediel_retention.record_tombstones WHERE retention_class='contract_signed_pdf_bytes' AND storage_path=(CASE WHEN TG_OP='INSERT' THEN new.name ELSE old.name END);
 IF NOT FOUND THEN IF TG_OP IN('UPDATE','DELETE') AND EXISTS(SELECT FROM public.customer_contract_documents WHERE storage_bucket='customer-contract-documents' AND storage_path=old.name) THEN RAISE EXCEPTION 'contract_pdf_native_class_purge_required';END IF;IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 IF TG_OP<>'DELETE' THEN RAISE EXCEPTION 'contract_pdf_retention_tombstoned';END IF;
 PERFORM gridex_ediel_retention.record_actor_v1(t.company_id,actor,t.retention_class,'ediel.retention.purge');SELECT * INTO STRICT d FROM gridex_ediel_retention.record_decisions WHERE id=t.decision_id FOR UPDATE;
 r:=gridex_ediel_retention.record_current_review_v1(d);basis:=gridex_ediel_retention.record_basis_v1(t.company_id,t.retention_class,t.target_id);
 IF r IS NULL OR basis->>'targetHash' IS DISTINCT FROM t.target_hash OR basis->>'storagePath' IS DISTINCT FROM old.name THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;
 -- The object is still present; this is not a completed-replay shortcut.
 IF gridex_ediel_retention.record_current_review_v1(d) IS DISTINCT FROM r THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;
 PERFORM gridex_ediel_retention.record_actor_v1(t.company_id,actor,t.retention_class,'ediel.retention.purge');
 INSERT INTO gridex_ediel_retention.record_events(retention_class,target_id,kind,actor_user_id) VALUES(t.retention_class,t.target_id,'storage_delete_authorized',actor) ON CONFLICT DO NOTHING;
 IF gridex_ediel_retention.record_current_review_v1(d) IS DISTINCT FROM r THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;
 PERFORM gridex_ediel_retention.record_actor_v1(t.company_id,actor,t.retention_class,'ediel.retention.purge');
 RETURN old;
END$$;

CREATE OR REPLACE FUNCTION gridex_ediel_retention.invoice_file_storage_guard_v1() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE s gridex_ediel_retention.invoice_file_sources%rowtype;t gridex_ediel_retention.invoice_file_tombstones%rowtype;d gridex_ediel_retention.invoice_file_decisions%rowtype;
 bt gridex_ediel_retention.blob_tombstones%rowtype;bd gridex_ediel_retention.blob_decisions%rowtype;br uuid;
 rt gridex_ediel_retention.record_tombstones%rowtype;rd gridex_ediel_retention.record_decisions%rowtype;rr uuid;
 actor uuid;bucket text;path text;basis jsonb;review record;i integer;
 chosen_sources uuid[]:='{}';chosen_companies uuid[]:='{}';chosen_decisions uuid[]:='{}';chosen_reviews uuid[]:='{}';BEGIN
 bucket:=CASE WHEN TG_OP='INSERT' THEN NEW.bucket_id ELSE OLD.bucket_id END;path:=CASE WHEN TG_OP='INSERT' THEN NEW.name ELSE OLD.name END;
 -- This is the last of the three ordered retention BEFORE guards. Capture the
 -- already-qualified classes before any later invoice-scope/copy/event wait,
 -- including a contract object with no invoice copies. Keep its chosen review,
 -- not the tombstone's older review and not an unbound new latest review.
 IF TG_OP='DELETE' AND bucket='ediel-files' THEN
  SELECT * INTO bt FROM gridex_ediel_retention.blob_tombstones WHERE retention_class='transport_raw_mime_bytes' AND storage_path=path;
  IF FOUND THEN
   actor:=public.ediel_retention_session_actor_v1();SELECT * INTO STRICT bd FROM gridex_ediel_retention.blob_decisions WHERE id=bt.decision_id FOR UPDATE;
   br:=gridex_ediel_retention.blob_current_v1(bd);IF br IS NULL THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' AND bucket='customer-contract-documents' THEN
  SELECT * INTO rt FROM gridex_ediel_retention.record_tombstones WHERE retention_class='contract_signed_pdf_bytes' AND storage_path=path;
  IF FOUND THEN
   actor:=public.ediel_retention_session_actor_v1();SELECT * INTO STRICT rd FROM gridex_ediel_retention.record_decisions WHERE id=rt.decision_id FOR UPDATE;
   rr:=gridex_ediel_retention.record_current_review_v1(rd);IF rr IS NULL THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;
  END IF;
 END IF;
 -- Preserve discovery of uncaptured actual PDF references even for a zero-copy
 -- loop; skipping this shared-scope check would weaken existing custody.
 IF TG_OP='DELETE' AND bucket IN('customer-documents','customer-contract-documents','contract-pdfs','billing-exports') THEN PERFORM 1 FROM gridex_ediel_retention.invoice_file_shared_scope_v1(bucket,path);END IF;
 IF TG_OP='UPDATE' AND (NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.name IS DISTINCT FROM OLD.name) AND EXISTS(SELECT FROM gridex_ediel_retention.invoice_file_sources WHERE storage_bucket=NEW.bucket_id AND storage_path=NEW.name) THEN RAISE EXCEPTION 'invoice_file_storage_target_immutable';END IF;
 FOR s IN SELECT * FROM gridex_ediel_retention.invoice_file_sources WHERE storage_bucket=bucket AND storage_path=path ORDER BY id FOR SHARE LOOP
  IF TG_OP<>'DELETE' THEN RAISE EXCEPTION 'invoice_file_storage_original_immutable';END IF;
  actor:=public.ediel_retention_session_actor_v1();PERFORM gridex_ediel_retention.invoice_file_actor_v1(s.company_id,actor,'ediel.retention.purge');
  SELECT * INTO t FROM gridex_ediel_retention.invoice_file_tombstones WHERE source_id=s.id;
  IF t.source_id IS NULL THEN RAISE EXCEPTION 'invoice_file_native_tombstone_required';END IF;
  SELECT * INTO STRICT d FROM gridex_ediel_retention.invoice_file_decisions WHERE id=t.decision_id FOR UPDATE;
  IF gridex_ediel_retention.invoice_file_current_v1(d) IS DISTINCT FROM t.review_id THEN RAISE EXCEPTION 'invoice_file_storage_current_legal_review_required';END IF;
  PERFORM 1 FROM gridex_ediel_retention.invoice_file_shared_scope_v1(bucket,path);
  IF gridex_ediel_retention.invoice_file_current_v1(d) IS DISTINCT FROM t.review_id THEN RAISE EXCEPTION 'invoice_file_storage_current_legal_review_required';END IF;
  PERFORM gridex_ediel_retention.invoice_file_actor_v1(s.company_id,actor,'ediel.retention.purge');
  chosen_sources:=array_append(chosen_sources,s.id);chosen_companies:=array_append(chosen_companies,s.company_id);
  chosen_decisions:=array_append(chosen_decisions,t.decision_id);chosen_reviews:=array_append(chosen_reviews,t.review_id);
  INSERT INTO gridex_ediel_retention.invoice_file_events(source_id,kind,actor_user_id) VALUES(s.id,'storage_delete_authorized',actor) ON CONFLICT DO NOTHING;
 END LOOP;
 IF TG_OP='DELETE' THEN
  -- Finish every potentially waiting current/basis/receipt read before the
  -- batch's final authority pass. An event or a later copy can invalidate an
  -- earlier reviewer/company even when the final copy remains authorized.
  FOR i IN SELECT generate_subscripts(chosen_sources,1) LOOP
   SELECT * INTO STRICT d FROM gridex_ediel_retention.invoice_file_decisions WHERE id=chosen_decisions[i];
   IF gridex_ediel_retention.invoice_file_current_v1(d) IS DISTINCT FROM chosen_reviews[i] THEN RAISE EXCEPTION 'invoice_file_storage_current_legal_review_required';END IF;
  END LOOP;
  IF br IS NOT NULL THEN
   IF gridex_ediel_retention.blob_current_v1(bd) IS DISTINCT FROM br THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;
   basis:=gridex_ediel_retention.blob_basis_v1(bt.company_id,bt.retention_class,bt.target_id);
   IF basis->>'targetHash' IS DISTINCT FROM bt.target_hash OR basis->>'storagePath' IS DISTINCT FROM path THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;
  END IF;
  IF rr IS NOT NULL THEN
   IF gridex_ediel_retention.record_current_review_v1(rd) IS DISTINCT FROM rr THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;
   basis:=gridex_ediel_retention.record_basis_v1(rt.company_id,rt.retention_class,rt.target_id);
   IF basis->>'targetHash' IS DISTINCT FROM rt.target_hash OR basis->>'storagePath' IS DISTINCT FROM path THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;
  END IF;
  -- The selected rows and authorization graph were locked by the earlier
  -- passes. These last predicates reuse those locks without reentering source
  -- or receipt ports; q2's final receipt must not leave q1's grant unchecked.
  FOR i IN SELECT generate_subscripts(chosen_sources,1) LOOP
   SELECT * INTO STRICT d FROM gridex_ediel_retention.invoice_file_decisions WHERE id=chosen_decisions[i];
   SELECT * INTO STRICT review FROM gridex_ediel_retention.invoice_file_reviews WHERE id=chosen_reviews[i] AND decision_id=d.id;
   IF review.outcome IS DISTINCT FROM 'approved' OR review.actor_user_id=d.submitted_by
    OR public.ediel_retention_lock_auth_actor_v1(review.actor_user_id) IS NOT TRUE
    OR gridex_ediel_retention.permission_v1(d.company_id,review.actor_user_id,'ediel.retention.review') IS NOT TRUE
    OR gridex_ediel_retention.permission_v1(d.company_id,review.actor_user_id,'ediel.retention.invoice_copy_evidence') IS NOT TRUE
   THEN RAISE EXCEPTION 'invoice_file_storage_current_legal_review_required';END IF;
  END LOOP;
  IF br IS NOT NULL THEN
   SELECT * INTO STRICT review FROM gridex_ediel_retention.blob_reviews WHERE id=br AND decision_id=bd.id;
   IF review.outcome IS DISTINCT FROM 'approved' OR public.ediel_retention_lock_auth_actor_v1(review.actor_user_id) IS NOT TRUE
    OR gridex_ediel_retention.permission_v1(bd.company_id,review.actor_user_id,'ediel.retention.review') IS NOT TRUE
    OR gridex_ediel_retention.class_permission_v1(bd.company_id,review.actor_user_id,bd.retention_class) IS NOT TRUE
   THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;
  END IF;
  IF rr IS NOT NULL THEN
   SELECT * INTO STRICT review FROM gridex_ediel_retention.record_reviews WHERE id=rr AND decision_id=rd.id;
   IF review.outcome IS DISTINCT FROM 'approved' OR review.actor_user_id=rd.submitted_by
    OR gridex_ediel_retention.permission_v1(rd.company_id,review.actor_user_id,'ediel.retention.review') IS NOT TRUE
    OR gridex_ediel_retention.record_permission_v1(rd.company_id,review.actor_user_id,rd.retention_class) IS NOT TRUE
   THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;
  END IF;
  IF br IS NOT NULL THEN
   PERFORM gridex_ediel_retention.actor_v1(bt.company_id,actor,'ediel.retention.purge');
   IF gridex_ediel_retention.class_permission_v1(bt.company_id,actor,bt.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'blob_retention_scoped_communication_required';END IF;
  END IF;
  IF rr IS NOT NULL THEN PERFORM gridex_ediel_retention.record_actor_v1(rt.company_id,actor,rt.retention_class,'ediel.retention.purge');END IF;
  FOR i IN SELECT generate_subscripts(chosen_sources,1) LOOP
   PERFORM gridex_ediel_retention.invoice_file_actor_v1(chosen_companies[i],actor,'ediel.retention.purge');
  END LOOP;
  RETURN OLD;
 ELSE RETURN NEW;END IF;
END$$;

DO $retention_storage_profiles_preserved$
BEGIN
 IF (SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) FROM pg_proc p WHERE p.oid=ANY(ARRAY['gridex_ediel_retention.storage_guard_v1()'::regprocedure::oid,'gridex_ediel_retention.contract_storage_guard_v1()'::regprocedure::oid,'gridex_ediel_retention.invoice_file_storage_guard_v1()'::regprocedure::oid])) IS DISTINCT FROM (SELECT profiles FROM pg_temp.gridex_retention_storage_function_scope)
 OR (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid='storage.objects'::regclass) IS DISTINCT FROM (SELECT triggers FROM pg_temp.gridex_retention_storage_function_scope)
 THEN RAISE EXCEPTION 'retention_storage_function_and_trigger_profiles_must_restore' USING ERRCODE='42501';END IF;
END $retention_storage_profiles_preserved$;

-- DB05_INSTALL_OWNER_RESTORE_BEGIN
DO $db05_install_restore$
DECLARE before_row record;BEGIN
 SELECT * INTO STRICT before_row FROM pg_temp.gridex_retention_storage_install_scope;
 -- No temporary public CREATE was introduced.
 GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) IS DISTINCT FROM before_row.memberships
 OR (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) IS DISTINCT FROM before_row.roles
 OR (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention')) IS DISTINCT FROM before_row.namespaces
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'db05_install_roles_memberships_namespaces_must_restore';END IF;
END $db05_install_restore$;
-- DB05_INSTALL_OWNER_RESTORE_END
COMMIT;
