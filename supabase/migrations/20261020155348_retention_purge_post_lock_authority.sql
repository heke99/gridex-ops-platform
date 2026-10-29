-- Recheck existing authority after identified read/write waits. This does not
-- assert authority at commit or qualify the separate Storage DELETE guards.
-- Completed immutable replay retains its existing no-policy-reactivation rule.
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
 IF to_regclass('pg_temp.gridex_retention_begin_install_scope') IS NOT NULL THEN RAISE EXCEPTION 'db05_unexpected_existing_install_scope';END IF;
END $db05_install_preflight$;
CREATE TEMPORARY TABLE gridex_retention_begin_install_scope ON COMMIT DROP AS
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

DO $retention_begin_body_preflight$
DECLARE expected record; actual record;BEGIN
 FOR expected IN SELECT * FROM (VALUES
 ('public.ediel_begin_blob_purge_v1(uuid,uuid,uuid)','e5b9584f96b87d8d7aa932e69a884f727dfcbdade3e0902451a341bcec230378',true,ARRAY['p_company_id','p_actor_user_id','p_decision_id'],'jsonb'),
 ('public.ediel_begin_invoice_file_purge_v1(uuid,uuid,uuid)','897064c598486fd654ed7eb31433a1e61b9436241ca1e9d6caa9ca4ee428ffda',true,ARRAY['p_company_id','p_actor_user_id','p_decision_id'],'jsonb'),
 ('gridex_ediel_retention.invoice_file_current_v1(gridex_ediel_retention.invoice_file_decisions)','d719359fff25150bdd326b0df579385a4d6f1975e45d88023695d58ddff19c9d',true,ARRAY['d'],'uuid'),
 ('gridex_ediel_retention.audit19_source_contract_v1(text)','3125b10daf69038fe4d4c5bd25ba26b34a9fdaeae4c5cbc5d5a0693e1fe0bf3b',false,ARRAY['action'],'jsonb')
 ) AS v(signature,body_hash,security_definer,argument_names,result_type) LOOP
  SELECT p.* INTO actual FROM pg_proc p WHERE p.oid=to_regprocedure(expected.signature);
  IF NOT FOUND OR actual.proowner IS DISTINCT FROM 'gridex_ediel_retention_owner'::regrole::oid
   OR actual.prosecdef IS DISTINCT FROM expected.security_definer
   OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   OR actual.proargnames IS DISTINCT FROM expected.argument_names
   OR actual.prorettype IS DISTINCT FROM to_regtype(expected.result_type)::oid
   OR actual.proretset OR actual.proisstrict OR actual.proleakproof
   OR actual.prokind<>'f' OR actual.provolatile<>'v' OR actual.proparallel<>'u'
   OR encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.body_hash
   OR has_function_privilege('anon',actual.oid,'EXECUTE')
   OR has_function_privilege('service_role',actual.oid,'EXECUTE')
   OR has_function_privilege('authenticated',actual.oid,'EXECUTE') IS DISTINCT FROM (expected.signature LIKE 'public.%')
   OR EXISTS(SELECT FROM aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
     WHERE acl.privilege_type<>'EXECUTE' OR acl.grantee<>actual.proowner AND
       (acl.grantee<>'authenticated'::regrole::oid OR expected.signature NOT LIKE 'public.%' OR acl.is_grantable))
  THEN RAISE EXCEPTION 'retention_begin_exact_source_owner_acl_header_required: %',expected.signature USING ERRCODE='42501';END IF;
 END LOOP;
END $retention_begin_body_preflight$;

CREATE TEMPORARY TABLE gridex_retention_begin_function_scope ON COMMIT DROP AS
 SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) AS profiles FROM pg_proc p
 WHERE p.oid=ANY(ARRAY['public.ediel_begin_blob_purge_v1(uuid,uuid,uuid)'::regprocedure::oid,
 'public.ediel_begin_invoice_file_purge_v1(uuid,uuid,uuid)'::regprocedure::oid,
 'gridex_ediel_retention.invoice_file_current_v1(gridex_ediel_retention.invoice_file_decisions)'::regprocedure::oid,
 'gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure::oid]);

CREATE OR REPLACE FUNCTION public.ediel_begin_blob_purge_v1(p_company_id uuid, p_actor_user_id uuid, p_decision_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE d gridex_ediel_retention.blob_decisions%rowtype;t gridex_ediel_retention.blob_tombstones%rowtype;basis jsonb;r uuid;at timestamptz:=clock_timestamp();response jsonb;BEGIN
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 LOCK TABLE public.ediel_message_payloads IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.blob_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_grant_required';END IF;PERFORM id FROM public.ediel_messages WHERE id=d.message_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO t FROM gridex_ediel_retention.blob_tombstones WHERE retention_class=d.retention_class AND target_id=d.target_id;
 IF FOUND THEN IF t.decision_id IS DISTINCT FROM d.id THEN RAISE EXCEPTION 'blob_retention_tombstone_conflict';END IF;response:=jsonb_build_object('status',CASE WHEN t.retention_class='received_ediel_message_content' OR EXISTS(SELECT FROM gridex_ediel_retention.blob_events e WHERE e.retention_class=t.retention_class AND e.target_id=t.target_id AND e.kind='physical_bytes_removed') THEN 'purged' ELSE 'storage_purge_pending' END,'targetId',t.target_id,'sourceHash',t.source_hash,'byteLength',t.byte_length,'storagePath',t.storage_path,'replay',true);
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_grant_required';END IF;
 RETURN response;END IF;
 r:=gridex_ediel_retention.blob_current_v1(d);IF r IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_blob_class_legal_review_deadline']);END IF;
 basis:=gridex_ediel_retention.blob_basis_v1(p_company_id,d.retention_class,d.target_id);IF basis->>'targetHash' IS DISTINCT FROM d.target_hash OR basis->>'sourceHash' IS DISTINCT FROM d.source_hash THEN RETURN jsonb_build_object('status','held','missing',ARRAY['exact_native_blob_target_changed']);END IF;
 -- Source/receipt waits precede fresh reviewer and executor qualification.
 r:=gridex_ediel_retention.blob_current_v1(d);IF r IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_blob_class_legal_review_deadline']);END IF;
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_grant_required';END IF;
 at:=clock_timestamp();
 INSERT INTO gridex_ediel_retention.blob_tombstones(retention_class,target_id,company_id,message_id,decision_id,review_id,source_hash,target_hash,public_content_hash,byte_length,storage_path,actor_user_id,created_at) VALUES(d.retention_class,d.target_id,d.company_id,d.message_id,d.id,r,d.source_hash,d.target_hash,basis->>'publicContentHash',(basis->>'byteLength')::bigint,basis->>'storagePath',p_actor_user_id,at);
 IF d.retention_class='received_ediel_message_content' THEN
  UPDATE gridex_received_sources.sources SET raw_payload=NULL,retention_purged_at=at WHERE source_message_id=d.target_id AND company_id=p_company_id;
  UPDATE public.ediel_message_payloads SET raw_payload=NULL,encrypted_payload=NULL WHERE company_id=p_company_id AND ediel_message_id=d.message_id;
  UPDATE public.ediel_messages SET raw_payload=NULL,parsed_payload='{}',validation_report='{}',metadata='{}' WHERE id=d.message_id AND company_id=p_company_id;
 END IF;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'ediel_message',d.message_id,'ediel.retention.blob_tombstoned',jsonb_build_object('decisionId',d.id,'targetId',d.target_id,'sourceHash',d.source_hash,'retentionClass',d.retention_class,'purgedAt',at));response:=jsonb_build_object('status',CASE WHEN d.retention_class='received_ediel_message_content' THEN 'purged' ELSE 'storage_purge_pending' END,'targetId',d.target_id,'sourceHash',d.source_hash,'byteLength',(basis->>'byteLength')::bigint,'storagePath',basis->>'storagePath','replay',false);
 -- A later row/trigger wait must abort every SQL effect on authority loss.
 IF gridex_ediel_retention.blob_current_v1(d) IS DISTINCT FROM r THEN RAISE EXCEPTION 'retention_current_blob_review_required';END IF;
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_grant_required';END IF;
 RETURN response;
END$$;

CREATE OR REPLACE FUNCTION public.ediel_begin_invoice_file_purge_v1(p_company_id uuid, p_actor_user_id uuid, p_decision_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$DECLARE d gridex_ediel_retention.invoice_file_decisions%rowtype;s gridex_ediel_retention.invoice_file_sources%rowtype;other gridex_ediel_retention.invoice_file_sources%rowtype;q gridex_ediel_retention.invoice_file_decisions%rowtype;r uuid;p jsonb;t record;selected_decisions uuid[]:=ARRAY[]::uuid[];selected_reviews uuid[]:=ARRAY[]::uuid[];i int;response jsonb;BEGIN
 PERFORM gridex_ediel_retention.invoice_file_actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');SELECT * INTO STRICT d FROM gridex_ediel_retention.invoice_file_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;SELECT * INTO STRICT s FROM gridex_ediel_retention.invoice_file_sources WHERE id=d.source_id FOR SHARE;
 -- Completed immutable receipt first: no reactivation of old policy or bytes.
 IF EXISTS(SELECT FROM gridex_ediel_retention.invoice_file_events WHERE source_id=s.id AND kind='storage_object_absent') THEN response:=jsonb_build_object('status','purged','sourceId',s.id,'sourceHash',s.source_hash,'byteLength',s.byte_length,'bytesAvailable',false,'replay',true);PERFORM gridex_ediel_retention.invoice_file_actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');RETURN response;END IF;
 FOR other IN SELECT * FROM gridex_ediel_retention.invoice_file_shared_scope_v1(s.storage_bucket,s.storage_path) ORDER BY id LOOP
  IF other.company_id<>p_company_id OR other.source_hash<>s.source_hash OR other.byte_length<>s.byte_length THEN RAISE EXCEPTION 'invoice_file_shared_foreign_or_changed_bytes';END IF;
  SELECT * INTO q FROM gridex_ediel_retention.invoice_file_decisions WHERE source_id=other.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'invoice_file_each_copy_legal_decision_required';END IF;r:=gridex_ediel_retention.invoice_file_current_v1(q);p:=gridex_ediel_retention.invoice_file_receipt_v1(q);IF r IS NULL OR p IS NULL THEN RAISE EXCEPTION 'invoice_file_each_copy_current_legal_review_required';END IF;
  PERFORM gridex_ediel_retention.invoice_file_actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
  selected_decisions:=array_append(selected_decisions,q.id);selected_reviews:=array_append(selected_reviews,r);
  INSERT INTO gridex_ediel_retention.invoice_file_tombstones(source_id,company_id,decision_id,review_id,actor_user_id,journal_retain_until,journal_purpose_reference) VALUES(other.id,p_company_id,q.id,r,p_actor_user_id,(p->>'journalRetainUntil')::timestamptz,p->>'journalPurposeReference') ON CONFLICT DO NOTHING;
 END LOOP;
 IF NOT EXISTS(SELECT FROM gridex_ediel_retention.invoice_file_tombstones WHERE source_id=s.id) THEN RAISE EXCEPTION 'invoice_file_actual_reference_scope_required';END IF;
 response:=jsonb_build_object('status','storage_purge_pending','sourceId',s.id,'sourceHash',s.source_hash,'byteLength',s.byte_length,'storageBucket',s.storage_bucket,'storagePath',s.storage_path,'replay',EXISTS(SELECT FROM gridex_ediel_retention.invoice_file_tombstones WHERE source_id=s.id AND decision_id<>d.id));
 -- Revisit the exact selected decisions/reviews after all shared-copy waits and
 -- writes. A newer appended policy must not silently replace the checked copy.
 FOR i IN 1..cardinality(selected_decisions) LOOP
  SELECT * INTO STRICT q FROM gridex_ediel_retention.invoice_file_decisions WHERE id=selected_decisions[i] FOR UPDATE;
  IF gridex_ediel_retention.invoice_file_current_v1(q) IS DISTINCT FROM selected_reviews[i] THEN RAISE EXCEPTION 'invoice_file_each_copy_current_legal_review_required';END IF;
 END LOOP;
 PERFORM gridex_ediel_retention.invoice_file_actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 RETURN response;END$$;

CREATE OR REPLACE FUNCTION gridex_ediel_retention.invoice_file_current_v1(d gridex_ediel_retention.invoice_file_decisions) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$DECLARE r gridex_ediel_retention.invoice_file_reviews%rowtype;basis jsonb;p jsonb;BEGIN
 SELECT * INTO r FROM gridex_ediel_retention.invoice_file_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) IS NOT TRUE OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.invoice_copy_evidence') IS NOT TRUE THEN RETURN NULL;END IF;
 basis:=gridex_ediel_retention.invoice_file_basis_v1(d.company_id,d.retention_class,d.target_id);p:=gridex_ediel_retention.invoice_file_receipt_v1(d);
 -- Basis/issuer reads may wait; use the same reviewer predicates afterwards.
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) IS NOT TRUE OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.invoice_copy_evidence') IS NOT TRUE THEN RETURN NULL;END IF;
 IF p IS NULL OR (p->>'retainUntil')::timestamptz>clock_timestamp() OR basis->>'targetHash' IS DISTINCT FROM d.target_hash OR basis->>'scopeHash' IS DISTINCT FROM d.scope_hash OR basis->>'sourceHash' IS DISTINCT FROM d.source_hash OR basis->>'allIncludedScopesClosed' IS DISTINCT FROM 'true' OR p->>'periodStart' IS DISTINCT FROM basis->>'periodStart' OR p->>'periodEnd' IS DISTINCT FROM basis->>'periodEnd' THEN RETURN NULL;END IF;RETURN r.id;END$$;

DO $retention_begin_audit19_slot$
DECLARE old_body text;new_body text;old_slot constant text:='"public.ediel_begin_blob_purge_v1":"e5b9584f96b87d8d7aa932e69a884f727dfcbdade3e0902451a341bcec230378"';new_slot constant text:='"public.ediel_begin_blob_purge_v1":"b5ac467ecbfd8f5565ed174d0050d28aa730e8c5f1183d525b8584a72b4fe711"';BEGIN
 SELECT prosrc INTO STRICT old_body FROM pg_proc WHERE oid='gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex')<>'3125b10daf69038fe4d4c5bd25ba26b34a9fdaeae4c5cbc5d5a0693e1fe0bf3b'
 OR length(old_body)-length(replace(old_body,old_slot,''))<>length(old_slot)
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.ediel_begin_blob_purge_v1(uuid,uuid,uuid)'::regprocedure)<>'b5ac467ecbfd8f5565ed174d0050d28aa730e8c5f1183d525b8584a72b4fe711'
 THEN RAISE EXCEPTION 'retention_begin_exact_audit19_blob_slot_required' USING ERRCODE='42501';END IF;
 new_body:=replace(old_body,old_slot,new_slot);
 IF encode(sha256(convert_to(new_body,'UTF8')),'hex')<>'eb61a02ed9353d68bf7e4048a70c746a0cd97bd6fdbdfd7c12b98a553ed78a3d' THEN RAISE EXCEPTION 'retention_begin_audit19_unrelated_change_forbidden' USING ERRCODE='42501';END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION gridex_ediel_retention.audit19_source_contract_v1(action text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS %L',new_body);
END $retention_begin_audit19_slot$;

DO $retention_begin_profiles_preserved$
DECLARE after_profiles jsonb;BEGIN
 SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) INTO after_profiles FROM pg_proc p
 WHERE p.oid=ANY(ARRAY['public.ediel_begin_blob_purge_v1(uuid,uuid,uuid)'::regprocedure::oid,
 'public.ediel_begin_invoice_file_purge_v1(uuid,uuid,uuid)'::regprocedure::oid,
 'gridex_ediel_retention.invoice_file_current_v1(gridex_ediel_retention.invoice_file_decisions)'::regprocedure::oid,
 'gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure::oid]);
 IF after_profiles IS DISTINCT FROM (SELECT profiles FROM pg_temp.gridex_retention_begin_function_scope)
 THEN RAISE EXCEPTION 'retention_begin_function_owner_acl_header_must_restore' USING ERRCODE='42501';END IF;
END $retention_begin_profiles_preserved$;

-- DB05_INSTALL_OWNER_RESTORE_BEGIN
DO $db05_install_restore$
DECLARE before_row record;BEGIN
 SELECT * INTO STRICT before_row FROM pg_temp.gridex_retention_begin_install_scope;
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
