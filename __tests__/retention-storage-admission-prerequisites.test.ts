// Finite actual PostgreSQL/PGlite constructor and policy boundary only.
// No managed supautils hook, native/API DELETE RETURNING, physical purge,
// issuer/legal decision or production acceptance is inferred from these tests.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const forward = readFileSync('supabase/migrations/20261020191228_retention_storage_admission_prerequisites.sql', 'utf8')
const owner = 'gridex_ediel_retention_owner'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
// Immutable fd4 schema/authority captures; independent constructor oracle.
// Guard input is exact reviewed post869 SQL 2151204a..., not mutable future GEN.
const captured = {
  "helpers": [
    {
      "name": "public.ediel_storage_retention_target_v1",
      "signature": "public.ediel_storage_retention_target_v1(text)",
      "definition": "CREATE FUNCTION public.ediel_storage_retention_target_v1(p_path text) RETURNS SETOF boolean\n    LANGUAGE sql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$\n SELECT true FROM gridex_ediel_retention.blob_tombstones t WHERE t.retention_class='transport_raw_mime_bytes' AND t.storage_path=p_path AND gridex_ediel_retention.permission_v1(t.company_id,public.ediel_retention_session_actor_v1(),'ediel.retention.purge') IS TRUE AND EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=t.company_id AND m.user_id=public.ediel_retention_session_actor_v1() AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)\n$$;",
      "bodySha256": "9d80cea8248ec1ffc98f26a4a668a79d29b1a8a0ea937bb12bd5091421149d04"
    },
    {
      "name": "public.ediel_contract_retention_storage_target_v1",
      "signature": "public.ediel_contract_retention_storage_target_v1(text)",
      "definition": "CREATE FUNCTION public.ediel_contract_retention_storage_target_v1(p_path text) RETURNS SETOF boolean\n    LANGUAGE sql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$\n SELECT true FROM gridex_ediel_retention.record_tombstones t WHERE t.retention_class='contract_signed_pdf_bytes' AND t.storage_path=p_path AND gridex_ediel_retention.permission_v1(t.company_id,public.ediel_retention_session_actor_v1(),'ediel.retention.purge') IS TRUE AND gridex_ediel_retention.record_permission_v1(t.company_id,public.ediel_retention_session_actor_v1(),t.retention_class) IS TRUE\n$$;",
      "bodySha256": "7c06de86b54e1c86aebf9e50e2c607731cf84770ef9ce8a71b1d887283971b8e"
    },
    {
      "name": "public.ediel_invoice_file_storage_delete_target_v1",
      "signature": "public.ediel_invoice_file_storage_delete_target_v1(text,text)",
      "definition": "CREATE FUNCTION public.ediel_invoice_file_storage_delete_target_v1(p_bucket text, p_path text) RETURNS boolean\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$DECLARE s gridex_ediel_retention.invoice_file_sources%rowtype;actor uuid:=public.ediel_retention_session_actor_v1();n int:=0;BEGIN FOR s IN SELECT * FROM gridex_ediel_retention.invoice_file_sources WHERE storage_bucket=p_bucket AND storage_path=p_path LOOP n:=n+1;IF NOT EXISTS(SELECT FROM gridex_ediel_retention.invoice_file_tombstones WHERE source_id=s.id) OR gridex_ediel_retention.permission_v1(s.company_id,actor,'ediel.retention.purge') IS NOT TRUE OR gridex_ediel_retention.permission_v1(s.company_id,actor,'ediel.retention.invoice_copy_evidence') IS NOT TRUE THEN RETURN false;END IF;END LOOP;RETURN n>0;END$$;",
      "bodySha256": "df85a493255a141377588f42df213d54e6081a924c091baf3bdf63e25f944c03"
    }
  ],
  "shared": [
    {
      "name": "gridex_ediel_retention.permission_v1",
      "definition": "CREATE FUNCTION gridex_ediel_retention.permission_v1(c uuid, actor uuid, wanted text) RETURNS boolean\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$\nDECLARE retention_keys constant text[]:=ARRAY['ediel.retention.submit','ediel.retention.review','ediel.retention.purge','ediel.retention.source_bytes','ediel.retention.customer_fields','ediel.retention.original_bytes','ediel.retention.mime_bytes','ediel.retention.artifact_decision_evidence','ediel.retention.blob_decision_evidence','ediel.retention.record_decision_evidence','ediel.retention.process_decision_evidence','ediel.retention.decision_policy_evidence','ediel.retention.billing_source_evidence','ediel.retention.invoice_copy_evidence','ediel.retention.settlement_copy_evidence','ediel.retention.finance_decision_evidence','ediel.retention.completed_review_reason','ediel.retention.audit_normalized19_cleanup'];\nretention_grant_observed_at timestamptz;\nBEGIN\n IF wanted<>ALL(retention_keys) THEN RETURN gridex_requested_changes.scoped_permission_v1(c,actor,wanted) IS TRUE\n AND NOT EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)\n AND NOT EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted)\n AND public.gridex_actor_has_company_permission(actor,c,wanted) IS TRUE;END IF;\n IF NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status IN('active','archived','pending_deletion','closed'))\n  OR NOT public.ediel_retention_lock_auth_actor_v1(actor)\n  OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')\n  OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL) THEN RETURN false;END IF;\n retention_grant_observed_at:=clock_timestamp();\n IF NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active)\n  OR EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)\n  OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=retention_grant_observed_at) AND (o.valid_to IS NULL OR retention_grant_observed_at<o.valid_to))\n  OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='deny' AND p.key=wanted) THEN RETURN false;END IF;\n RETURN EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key=wanted)\n  OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key=wanted)\n  OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND o.company_id=c AND o.is_active AND o.effect='allow' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=retention_grant_observed_at) AND (o.valid_to IS NULL OR retention_grant_observed_at<o.valid_to));\nEND$$;",
      "bodySha256": "b4027dcae1ce6e709fd37afb329589649197104c801aeb4110454a60045cc0fa"
    },
    {
      "name": "gridex_ediel_retention.record_permission_v1",
      "definition": "CREATE FUNCTION gridex_ediel_retention.record_permission_v1(c uuid, actor uuid, k text) RETURNS boolean\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$\nDECLARE wanted text;observed_at timestamptz;BEGIN\n LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;\n PERFORM public.ediel_retention_lock_auth_actor_v1(actor);\n PERFORM id FROM public.companies WHERE id=c FOR SHARE;\n PERFORM id FROM public.user_profiles WHERE id=actor FOR SHARE;\n PERFORM user_id FROM public.company_memberships WHERE company_id=c AND user_id=actor FOR SHARE;\n observed_at:=clock_timestamp();\n IF k='__read_scope__' THEN wanted:='ediel.retention.read';ELSE SELECT permission_key INTO wanted FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;END IF;\n IF wanted IS NULL OR NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status IN('active','archived','pending_deletion','closed'))\n OR NOT public.ediel_retention_lock_auth_actor_v1(actor)\n OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active' AND to_jsonb(u)->>'disabled_at' IS NULL)\n OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)\n OR NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active) THEN RETURN false;END IF;\n IF EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)\n OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=observed_at) AND (o.valid_to IS NULL OR observed_at<o.valid_to))\n OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='deny' AND p.key=wanted) THEN RETURN false;END IF;\n RETURN EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key=wanted)\n OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key=wanted)\n OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND o.company_id=c AND o.is_active AND o.effect='allow' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=observed_at) AND (o.valid_to IS NULL OR observed_at<o.valid_to));\nEND$$;",
      "bodySha256": "90609c2ea24dbd62637fd83a5f654820dc2f235afae774019dc4cc61ac0dbcf3"
    },
    {
      "name": "public.ediel_retention_session_actor_v1",
      "definition": "CREATE FUNCTION public.ediel_retention_session_actor_v1() RETURNS uuid\n    LANGUAGE sql STABLE SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$SELECT auth.uid()$$;",
      "bodySha256": "f501d732e4247434820ab322cf3caf4b20f7391cc1e98f4c7e5f6618c507c1e3"
    },
    {
      "name": "public.ediel_retention_lock_auth_actor_v1",
      "definition": "CREATE FUNCTION public.ediel_retention_lock_auth_actor_v1(p_actor_user_id uuid) RETURNS boolean\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$\nDECLARE active boolean;\nBEGIN\n -- The same FOR SHARE lock as the installed actor/reviewer owners prevents a\n -- concurrent deletion/ban from passing a prior unlocked authorization check.\n SELECT deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=clock_timestamp())\n INTO active FROM auth.users WHERE id=p_actor_user_id FOR SHARE;\n IF active IS DISTINCT FROM true THEN RETURN false;END IF;\n PERFORM id FROM public.user_profiles WHERE id=p_actor_user_id FOR SHARE;\n RETURN EXISTS(SELECT FROM public.user_profiles p WHERE p.id=p_actor_user_id\n               AND p.user_status='active' AND to_jsonb(p)->>'disabled_at' IS NULL);\nEND$$;",
      "bodySha256": "06dc571efe2101ab7991f60817d087451739115392a8bd14fe2cd73454a66d8a"
    }
  ],
  "guards": [
    {
      "name": "gridex_ediel_retention.storage_guard_v1",
      "signature": "gridex_ediel_retention.storage_guard_v1()",
      "hash": "c29fe1d0b39ad2f642595dc4b476b78b1694732d78492a6adad03a2238a44d2d",
      "ddl": "CREATE FUNCTION gridex_ediel_retention.storage_guard_v1() RETURNS trigger\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$\nDECLARE t gridex_ediel_retention.blob_tombstones%rowtype;d gridex_ediel_retention.blob_decisions%rowtype;basis jsonb;r uuid;actor uuid:=public.ediel_retention_session_actor_v1();BEGIN\n IF TG_OP<>'DELETE' AND new.bucket_id='ediel-files' AND EXISTS(SELECT FROM gridex_ediel_retention.blob_tombstones WHERE retention_class='transport_raw_mime_bytes' AND storage_path=new.name) THEN RAISE EXCEPTION 'ediel_storage_retention_object_tombstoned';END IF;\n IF (CASE WHEN TG_OP='INSERT' THEN new.bucket_id ELSE old.bucket_id END) IS DISTINCT FROM 'ediel-files' THEN IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;\n SELECT * INTO t FROM gridex_ediel_retention.blob_tombstones WHERE retention_class='transport_raw_mime_bytes' AND storage_path=(CASE WHEN TG_OP='INSERT' THEN new.name ELSE old.name END);\n IF NOT FOUND THEN IF TG_OP='UPDATE' AND old.name LIKE 'transport/%' AND EXISTS(SELECT FROM public.ediel_message_payloads p WHERE p.encrypted_payload_ref='storage://ediel-files/'||old.name AND p.metadata->>'archive_verified'='true') THEN RAISE EXCEPTION 'ediel_storage_archived_object_immutable';END IF;IF TG_OP='DELETE' AND old.name LIKE 'transport/%' THEN RAISE EXCEPTION 'ediel_storage_native_class_purge_required';END IF;IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;\n IF TG_OP<>'DELETE' THEN RAISE EXCEPTION 'ediel_storage_retention_object_tombstoned';END IF;\n PERFORM gridex_ediel_retention.actor_v1(t.company_id,actor,'ediel.retention.purge');IF gridex_ediel_retention.class_permission_v1(t.company_id,actor,t.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'blob_retention_scoped_communication_required';END IF;\n SELECT * INTO STRICT d FROM gridex_ediel_retention.blob_decisions WHERE id=t.decision_id FOR UPDATE;r:=gridex_ediel_retention.blob_current_v1(d);basis:=gridex_ediel_retention.blob_basis_v1(t.company_id,t.retention_class,t.target_id);\n IF r IS NULL OR basis->>'targetHash' IS DISTINCT FROM t.target_hash OR basis->>'storagePath' IS DISTINCT FROM old.name THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;\n -- Qualify the same selected review after basis waits, then after event waits.\n IF gridex_ediel_retention.blob_current_v1(d) IS DISTINCT FROM r THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;\n PERFORM gridex_ediel_retention.actor_v1(t.company_id,actor,'ediel.retention.purge');\n IF gridex_ediel_retention.class_permission_v1(t.company_id,actor,t.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'blob_retention_scoped_communication_required';END IF;\n INSERT INTO gridex_ediel_retention.blob_events(retention_class,target_id,kind,actor_user_id) VALUES(t.retention_class,t.target_id,'storage_delete_authorized',actor) ON CONFLICT DO NOTHING;\n IF gridex_ediel_retention.blob_current_v1(d) IS DISTINCT FROM r THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;\n PERFORM gridex_ediel_retention.actor_v1(t.company_id,actor,'ediel.retention.purge');\n IF gridex_ediel_retention.class_permission_v1(t.company_id,actor,t.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'blob_retention_scoped_communication_required';END IF;\n RETURN old;\nEND$$;",
      "trigger": "ediel_retention_storage_guard"
    },
    {
      "name": "gridex_ediel_retention.contract_storage_guard_v1",
      "signature": "gridex_ediel_retention.contract_storage_guard_v1()",
      "hash": "a66d0f57efaed9882bf7ac353e3127f8d166e8afd7769f7b4142cc7a688e29c4",
      "ddl": "CREATE FUNCTION gridex_ediel_retention.contract_storage_guard_v1() RETURNS trigger\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$\nDECLARE t gridex_ediel_retention.record_tombstones%rowtype;d gridex_ediel_retention.record_decisions%rowtype;basis jsonb;r uuid;actor uuid:=public.ediel_retention_session_actor_v1();BEGIN\n IF TG_OP<>'DELETE' AND new.bucket_id='customer-contract-documents' AND EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones WHERE retention_class='contract_signed_pdf_bytes' AND storage_path=new.name) THEN RAISE EXCEPTION 'contract_pdf_retention_tombstoned';END IF;\n IF (CASE WHEN TG_OP='INSERT' THEN new.bucket_id ELSE old.bucket_id END) IS DISTINCT FROM 'customer-contract-documents' THEN IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;\n SELECT * INTO t FROM gridex_ediel_retention.record_tombstones WHERE retention_class='contract_signed_pdf_bytes' AND storage_path=(CASE WHEN TG_OP='INSERT' THEN new.name ELSE old.name END);\n IF NOT FOUND THEN IF TG_OP IN('UPDATE','DELETE') AND EXISTS(SELECT FROM public.customer_contract_documents WHERE storage_bucket='customer-contract-documents' AND storage_path=old.name) THEN RAISE EXCEPTION 'contract_pdf_native_class_purge_required';END IF;IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;\n IF TG_OP<>'DELETE' THEN RAISE EXCEPTION 'contract_pdf_retention_tombstoned';END IF;\n PERFORM gridex_ediel_retention.record_actor_v1(t.company_id,actor,t.retention_class,'ediel.retention.purge');SELECT * INTO STRICT d FROM gridex_ediel_retention.record_decisions WHERE id=t.decision_id FOR UPDATE;\n r:=gridex_ediel_retention.record_current_review_v1(d);basis:=gridex_ediel_retention.record_basis_v1(t.company_id,t.retention_class,t.target_id);\n IF r IS NULL OR basis->>'targetHash' IS DISTINCT FROM t.target_hash OR basis->>'storagePath' IS DISTINCT FROM old.name THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;\n -- The object is still present; this is not a completed-replay shortcut.\n IF gridex_ediel_retention.record_current_review_v1(d) IS DISTINCT FROM r THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;\n PERFORM gridex_ediel_retention.record_actor_v1(t.company_id,actor,t.retention_class,'ediel.retention.purge');\n INSERT INTO gridex_ediel_retention.record_events(retention_class,target_id,kind,actor_user_id) VALUES(t.retention_class,t.target_id,'storage_delete_authorized',actor) ON CONFLICT DO NOTHING;\n IF gridex_ediel_retention.record_current_review_v1(d) IS DISTINCT FROM r THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;\n PERFORM gridex_ediel_retention.record_actor_v1(t.company_id,actor,t.retention_class,'ediel.retention.purge');\n RETURN old;\nEND$$;",
      "trigger": "contract_retention_storage_guard"
    },
    {
      "name": "gridex_ediel_retention.invoice_file_storage_guard_v1",
      "signature": "gridex_ediel_retention.invoice_file_storage_guard_v1()",
      "hash": "cfcad8fe52ef1000f5b0b8af6350821a1e6ebb73f35787f44a25acb1e07f1a71",
      "ddl": "CREATE FUNCTION gridex_ediel_retention.invoice_file_storage_guard_v1() RETURNS trigger\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$\nDECLARE s gridex_ediel_retention.invoice_file_sources%rowtype;t gridex_ediel_retention.invoice_file_tombstones%rowtype;d gridex_ediel_retention.invoice_file_decisions%rowtype;\n bt gridex_ediel_retention.blob_tombstones%rowtype;bd gridex_ediel_retention.blob_decisions%rowtype;br uuid;\n rt gridex_ediel_retention.record_tombstones%rowtype;rd gridex_ediel_retention.record_decisions%rowtype;rr uuid;\n actor uuid;bucket text;path text;basis jsonb;review record;i integer;\n chosen_sources uuid[]:='{}';chosen_companies uuid[]:='{}';chosen_decisions uuid[]:='{}';chosen_reviews uuid[]:='{}';BEGIN\n bucket:=CASE WHEN TG_OP='INSERT' THEN NEW.bucket_id ELSE OLD.bucket_id END;path:=CASE WHEN TG_OP='INSERT' THEN NEW.name ELSE OLD.name END;\n -- This is the last of the three ordered retention BEFORE guards. Capture the\n -- already-qualified classes before any later invoice-scope/copy/event wait,\n -- including a contract object with no invoice copies. Keep its chosen review,\n -- not the tombstone's older review and not an unbound new latest review.\n IF TG_OP='DELETE' AND bucket='ediel-files' THEN\n  SELECT * INTO bt FROM gridex_ediel_retention.blob_tombstones WHERE retention_class='transport_raw_mime_bytes' AND storage_path=path;\n  IF FOUND THEN\n   actor:=public.ediel_retention_session_actor_v1();SELECT * INTO STRICT bd FROM gridex_ediel_retention.blob_decisions WHERE id=bt.decision_id FOR UPDATE;\n   br:=gridex_ediel_retention.blob_current_v1(bd);IF br IS NULL THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;\n  END IF;\n END IF;\n IF TG_OP='DELETE' AND bucket='customer-contract-documents' THEN\n  SELECT * INTO rt FROM gridex_ediel_retention.record_tombstones WHERE retention_class='contract_signed_pdf_bytes' AND storage_path=path;\n  IF FOUND THEN\n   actor:=public.ediel_retention_session_actor_v1();SELECT * INTO STRICT rd FROM gridex_ediel_retention.record_decisions WHERE id=rt.decision_id FOR UPDATE;\n   rr:=gridex_ediel_retention.record_current_review_v1(rd);IF rr IS NULL THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;\n  END IF;\n END IF;\n -- Preserve discovery of uncaptured actual PDF references even for a zero-copy\n -- loop; skipping this shared-scope check would weaken existing custody.\n IF TG_OP='DELETE' AND bucket IN('customer-documents','customer-contract-documents','contract-pdfs','billing-exports') THEN PERFORM 1 FROM gridex_ediel_retention.invoice_file_shared_scope_v1(bucket,path);END IF;\n IF TG_OP='UPDATE' AND (NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.name IS DISTINCT FROM OLD.name) AND EXISTS(SELECT FROM gridex_ediel_retention.invoice_file_sources WHERE storage_bucket=NEW.bucket_id AND storage_path=NEW.name) THEN RAISE EXCEPTION 'invoice_file_storage_target_immutable';END IF;\n FOR s IN SELECT * FROM gridex_ediel_retention.invoice_file_sources WHERE storage_bucket=bucket AND storage_path=path ORDER BY id FOR SHARE LOOP\n  IF TG_OP<>'DELETE' THEN RAISE EXCEPTION 'invoice_file_storage_original_immutable';END IF;\n  actor:=public.ediel_retention_session_actor_v1();PERFORM gridex_ediel_retention.invoice_file_actor_v1(s.company_id,actor,'ediel.retention.purge');\n  SELECT * INTO t FROM gridex_ediel_retention.invoice_file_tombstones WHERE source_id=s.id;\n  IF t.source_id IS NULL THEN RAISE EXCEPTION 'invoice_file_native_tombstone_required';END IF;\n  SELECT * INTO STRICT d FROM gridex_ediel_retention.invoice_file_decisions WHERE id=t.decision_id FOR UPDATE;\n  IF gridex_ediel_retention.invoice_file_current_v1(d) IS DISTINCT FROM t.review_id THEN RAISE EXCEPTION 'invoice_file_storage_current_legal_review_required';END IF;\n  PERFORM 1 FROM gridex_ediel_retention.invoice_file_shared_scope_v1(bucket,path);\n  IF gridex_ediel_retention.invoice_file_current_v1(d) IS DISTINCT FROM t.review_id THEN RAISE EXCEPTION 'invoice_file_storage_current_legal_review_required';END IF;\n  PERFORM gridex_ediel_retention.invoice_file_actor_v1(s.company_id,actor,'ediel.retention.purge');\n  chosen_sources:=array_append(chosen_sources,s.id);chosen_companies:=array_append(chosen_companies,s.company_id);\n  chosen_decisions:=array_append(chosen_decisions,t.decision_id);chosen_reviews:=array_append(chosen_reviews,t.review_id);\n  INSERT INTO gridex_ediel_retention.invoice_file_events(source_id,kind,actor_user_id) VALUES(s.id,'storage_delete_authorized',actor) ON CONFLICT DO NOTHING;\n END LOOP;\n IF TG_OP='DELETE' THEN\n  -- Finish every potentially waiting current/basis/receipt read before the\n  -- batch's final authority pass. An event or a later copy can invalidate an\n  -- earlier reviewer/company even when the final copy remains authorized.\n  FOR i IN SELECT generate_subscripts(chosen_sources,1) LOOP\n   SELECT * INTO STRICT d FROM gridex_ediel_retention.invoice_file_decisions WHERE id=chosen_decisions[i];\n   IF gridex_ediel_retention.invoice_file_current_v1(d) IS DISTINCT FROM chosen_reviews[i] THEN RAISE EXCEPTION 'invoice_file_storage_current_legal_review_required';END IF;\n  END LOOP;\n  IF br IS NOT NULL THEN\n   IF gridex_ediel_retention.blob_current_v1(bd) IS DISTINCT FROM br THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;\n   basis:=gridex_ediel_retention.blob_basis_v1(bt.company_id,bt.retention_class,bt.target_id);\n   IF basis->>'targetHash' IS DISTINCT FROM bt.target_hash OR basis->>'storagePath' IS DISTINCT FROM path THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;\n  END IF;\n  IF rr IS NOT NULL THEN\n   IF gridex_ediel_retention.record_current_review_v1(rd) IS DISTINCT FROM rr THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;\n   basis:=gridex_ediel_retention.record_basis_v1(rt.company_id,rt.retention_class,rt.target_id);\n   IF basis->>'targetHash' IS DISTINCT FROM rt.target_hash OR basis->>'storagePath' IS DISTINCT FROM path THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;\n  END IF;\n  -- The selected rows and authorization graph were locked by the earlier\n  -- passes. These last predicates reuse those locks without reentering source\n  -- or receipt ports; q2's final receipt must not leave q1's grant unchecked.\n  FOR i IN SELECT generate_subscripts(chosen_sources,1) LOOP\n   SELECT * INTO STRICT d FROM gridex_ediel_retention.invoice_file_decisions WHERE id=chosen_decisions[i];\n   SELECT * INTO STRICT review FROM gridex_ediel_retention.invoice_file_reviews WHERE id=chosen_reviews[i] AND decision_id=d.id;\n   IF review.outcome IS DISTINCT FROM 'approved' OR review.actor_user_id=d.submitted_by\n    OR public.ediel_retention_lock_auth_actor_v1(review.actor_user_id) IS NOT TRUE\n    OR gridex_ediel_retention.permission_v1(d.company_id,review.actor_user_id,'ediel.retention.review') IS NOT TRUE\n    OR gridex_ediel_retention.permission_v1(d.company_id,review.actor_user_id,'ediel.retention.invoice_copy_evidence') IS NOT TRUE\n   THEN RAISE EXCEPTION 'invoice_file_storage_current_legal_review_required';END IF;\n  END LOOP;\n  IF br IS NOT NULL THEN\n   SELECT * INTO STRICT review FROM gridex_ediel_retention.blob_reviews WHERE id=br AND decision_id=bd.id;\n   IF review.outcome IS DISTINCT FROM 'approved' OR public.ediel_retention_lock_auth_actor_v1(review.actor_user_id) IS NOT TRUE\n    OR gridex_ediel_retention.permission_v1(bd.company_id,review.actor_user_id,'ediel.retention.review') IS NOT TRUE\n    OR gridex_ediel_retention.class_permission_v1(bd.company_id,review.actor_user_id,bd.retention_class) IS NOT TRUE\n   THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;\n  END IF;\n  IF rr IS NOT NULL THEN\n   SELECT * INTO STRICT review FROM gridex_ediel_retention.record_reviews WHERE id=rr AND decision_id=rd.id;\n   IF review.outcome IS DISTINCT FROM 'approved' OR review.actor_user_id=rd.submitted_by\n    OR gridex_ediel_retention.permission_v1(rd.company_id,review.actor_user_id,'ediel.retention.review') IS NOT TRUE\n    OR gridex_ediel_retention.record_permission_v1(rd.company_id,review.actor_user_id,rd.retention_class) IS NOT TRUE\n   THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;\n  END IF;\n  IF br IS NOT NULL THEN\n   PERFORM gridex_ediel_retention.actor_v1(bt.company_id,actor,'ediel.retention.purge');\n   IF gridex_ediel_retention.class_permission_v1(bt.company_id,actor,bt.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'blob_retention_scoped_communication_required';END IF;\n  END IF;\n  IF rr IS NOT NULL THEN PERFORM gridex_ediel_retention.record_actor_v1(rt.company_id,actor,rt.retention_class,'ediel.retention.purge');END IF;\n  FOR i IN SELECT generate_subscripts(chosen_sources,1) LOOP\n   PERFORM gridex_ediel_retention.invoice_file_actor_v1(chosen_companies[i],actor,'ediel.retention.purge');\n  END LOOP;\n  RETURN OLD;\n ELSE RETURN NEW;END IF;\nEND$$;",
      "trigger": "invoice_file_retention_storage_guard"
    }
  ],
  "columns": [
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "actor_user_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "byte_length",
      "type": "bigint",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "company_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "created_at",
      "type": "timestamp with time zone",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "decision_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "message_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "public_content_hash",
      "type": "text",
      "attnotnull": false
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "retention_class",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "review_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "source_hash",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "storage_path",
      "type": "text",
      "attnotnull": false
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "target_hash",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.blob_tombstones",
      "col": "target_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "byte_length",
      "type": "bigint",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "captured_at",
      "type": "timestamp with time zone",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "captured_by",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "company_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "retention_class",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "source_hash",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "storage_bucket",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "storage_object_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "storage_path",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "target_hash",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_sources",
      "col": "target_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_tombstones",
      "col": "actor_user_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_tombstones",
      "col": "company_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_tombstones",
      "col": "created_at",
      "type": "timestamp with time zone",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_tombstones",
      "col": "decision_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_tombstones",
      "col": "journal_purpose_reference",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_tombstones",
      "col": "journal_retain_until",
      "type": "timestamp with time zone",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_tombstones",
      "col": "review_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.invoice_file_tombstones",
      "col": "source_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "actor_user_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "byte_length",
      "type": "bigint",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "company_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "contract_id",
      "type": "uuid",
      "attnotnull": false
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "created_at",
      "type": "timestamp with time zone",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "customer_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "decision_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "journal_purpose_reference",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "journal_retain_until",
      "type": "timestamp with time zone",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "retention_class",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "review_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "source_hash",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "storage_path",
      "type": "text",
      "attnotnull": false
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "target_hash",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "gridex_ediel_retention.record_tombstones",
      "col": "target_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "public.company_memberships",
      "col": "accepted_at",
      "type": "timestamp with time zone",
      "attnotnull": false
    },
    {
      "relation": "public.company_memberships",
      "col": "company_id",
      "type": "uuid",
      "attnotnull": true
    },
    {
      "relation": "public.company_memberships",
      "col": "is_active",
      "type": "boolean",
      "attnotnull": false
    },
    {
      "relation": "public.company_memberships",
      "col": "membership_role",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "public.company_memberships",
      "col": "role",
      "type": "text",
      "attnotnull": false
    },
    {
      "relation": "public.company_memberships",
      "col": "role_key",
      "type": "text",
      "attnotnull": false
    },
    {
      "relation": "public.company_memberships",
      "col": "status",
      "type": "text",
      "attnotnull": true
    },
    {
      "relation": "public.company_memberships",
      "col": "user_id",
      "type": "uuid",
      "attnotnull": true
    }
  ],
  "policies": [
    "CREATE POLICY ediel_qualified_retention_storage_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='ediel-files' AND EXISTS(SELECT FROM public.ediel_storage_retention_target_v1(name)));",
    "CREATE POLICY contract_qualified_retention_storage_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='customer-contract-documents' AND EXISTS(SELECT FROM public.ediel_contract_retention_storage_target_v1(name)));",
    "CREATE POLICY invoice_file_qualified_retention_storage_delete ON storage.objects FOR DELETE TO authenticated USING(public.ediel_invoice_file_storage_delete_target_v1(bucket_id,name));",
    "CREATE POLICY ediel_qualified_retention_storage_delete_visibility ON storage.objects FOR SELECT TO authenticated\n USING (bucket_id='ediel-files' AND storage.operation()='storage.object.delete_many'\n  AND EXISTS(SELECT FROM public.ediel_storage_retention_target_v1(objects.name)));",
    "CREATE POLICY contract_qualified_retention_storage_delete_visibility ON storage.objects FOR SELECT TO authenticated\n USING (bucket_id='customer-contract-documents' AND storage.operation()='storage.object.delete_many'\n  AND EXISTS(SELECT FROM public.ediel_contract_retention_storage_target_v1(objects.name)));",
    "CREATE POLICY invoice_file_qualified_retention_storage_delete_visibility ON storage.objects FOR SELECT TO authenticated\n USING (storage.operation()='storage.object.delete_many'\n  AND public.ediel_invoice_file_storage_delete_target_v1(bucket_id,name));"
  ],
  "authUID": "CREATE OR REPLACE FUNCTION auth.uid()\n RETURNS uuid\n LANGUAGE sql\n STABLE\nAS $function$\n  select \n  coalesce(\n    nullif(current_setting('request.jwt.claim.sub', true), ''),\n    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')\n  )::uuid\n$function$\n",
  "operation": "CREATE OR REPLACE FUNCTION storage.operation()\n RETURNS text\n LANGUAGE plpgsql\n STABLE\nAS $function$\nBEGIN\n    RETURN current_setting('storage.operation', true);\nEND;\n$function$\n"
} as const

const names = captured.helpers.map(x => x.name)
const policyNames = captured.policies.map(x => /CREATE POLICY (\w+)/.exec(x)![1])
let db: PGlite
let base: Awaited<ReturnType<PGlite['dumpDataDir']>>
let expected: unknown
function body(ddl: string) {
  const m = /\bAS (\$\w*\$)/.exec(ddl)!
  const start = m.index + m[0].length
  return ddl.slice(start, ddl.indexOf(m[1], start))
}
async function canonicalHelpers(client: PGlite, indices = [0, 1, 2]) {
  for (const i of indices) {
    const helper = captured.helpers[i]
    expect(hash(body(helper.definition))).toBe(helper.bodySha256)
    await client.exec(`${helper.definition}
      ALTER FUNCTION ${helper.signature} OWNER TO ${owner};
      SET LOCAL ROLE ${owner};
      REVOKE ALL ON FUNCTION ${helper.signature} FROM PUBLIC,anon,authenticated,service_role,postgres;
      GRANT EXECUTE ON FUNCTION ${helper.signature} TO authenticated;
      RESET ROLE;`)
  }
}
async function targetState(client = db) {
  return (await client.query<{ state: unknown }>(`SELECT jsonb_build_object(
    'helpers',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
      'result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'config',p.proconfig,
      'acl',(SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) ORDER BY a.grantee,a.grantor,a.privilege_type) FROM aclexplode(p.proacl) a)) ORDER BY p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND n.nspname||'.'||p.proname=ANY($1::text[])),
    'policies',(SELECT jsonb_agg(jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,
      'roles',(SELECT jsonb_agg(rolname ORDER BY rolname) FROM pg_roles WHERE oid=ANY(polroles)),
      'using',pg_get_expr(polqual,polrelid,false),'check',pg_get_expr(polwithcheck,polrelid,false)) ORDER BY polname)
      FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname=ANY($2::text[]))
  ) AS state`, [names, policyNames])).rows[0].state
}
async function snapshot(includeTargets = true) {
  const result = (await db.query<{ state: unknown }>(`SELECT jsonb_build_object(
    'roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY oid) FROM pg_roles r),
    'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY oid) FROM pg_auth_members m),
    'namespaces',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_namespace n),
    'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE NOT(n.nspname||'.'||p.proname=ANY($1::text[]))),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p WHERE NOT(polrelid='storage.objects'::regclass AND polname=ANY($2::text[]))),
    'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t),
    'tables',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','auth','storage','gridex_ediel_retention')),
    'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d),
    'objects',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM storage.objects t)
  ) AS state`, [includeTargets ? [] : names, includeTargets ? [] : policyNames])).rows[0].state
  const data: Record<string, unknown> = {}
  for (const relation of [...new Set(captured.columns.map(x => x.relation)), 'auth.users',
    'public.companies', 'public.user_profiles', 'public.permissions', 'public.user_permissions',
    'public.user_permission_overrides', 'public.roles', 'public.user_roles', 'public.role_permissions',
    'gridex_ediel_retention.record_class_catalog']) {
    data[relation] = (await db.query(`SELECT to_jsonb(t) value FROM ${relation} t ORDER BY to_jsonb(t)::text`)).rows
  }
  return { catalog: result, data }
}
async function run(sql = forward) {
  await db.exec('SET SESSION AUTHORIZATION postgres')
  try { await db.exec(sql) }
  catch (error) {
    const detail = error as Error & { position?: string; internalPosition?: string; internalQuery?: string; where?: string }
    detail.message += ` [SQL position=${detail.position ?? ''}; internal=${detail.internalPosition ?? ''}; where=${detail.where ?? ''}; query=${detail.internalQuery ?? ''}]`
    await db.exec('ROLLBACK;SET SESSION AUTHORIZATION supabase_admin')
    throw error
  }
  await db.exec('SET SESSION AUTHORIZATION supabase_admin')
}
async function setup() {
  // A fresh PGlite session initially opens template1. Reopen its empty dump
  // in postgres before creating the fixture that subsequent cases restore.
  const bootstrap = new PGlite()
  const empty = await bootstrap.dumpDataDir()
  await bootstrap.close()
  const client = new PGlite({ loadDataDir: empty, database: 'postgres' })
  await client.exec(`CREATE ROLE fixture_setup_admin LOGIN SUPERUSER;SET SESSION AUTHORIZATION fixture_setup_admin;
    ALTER ROLE postgres RENAME TO supabase_admin;SET SESSION AUTHORIZATION supabase_admin;
    CREATE ROLE postgres LOGIN NOSUPERUSER INHERIT CREATEROLE CREATEDB REPLICATION BYPASSRLS;
    CREATE ROLE ${owner} NOLOGIN NOINHERIT BYPASSRLS;
    CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT;CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;
    CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE ROLE dashboard_user;
    ALTER DATABASE postgres OWNER TO postgres;ALTER SCHEMA public OWNER TO pg_database_owner;
    CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin;CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
    CREATE SCHEMA gridex_ediel_retention AUTHORIZATION ${owner};CREATE SCHEMA gridex_private;
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    -- Ordinary owner branch is real PostgreSQL; PGlite has no supautils hook.
    ALTER TABLE storage.objects OWNER TO postgres;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,anon,service_role;
    CREATE TABLE auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);
    ALTER TABLE auth.users OWNER TO supabase_auth_admin;GRANT SELECT,UPDATE ON auth.users TO postgres;
    CREATE TABLE public.companies(id uuid,status text);CREATE TABLE public.user_profiles(id uuid,user_status text,disabled_at timestamptz);
    CREATE TABLE public.permissions(id uuid,key text,is_active boolean);
    CREATE TABLE public.roles(id uuid,key text,name text,is_active boolean);
    CREATE TABLE public.user_roles(user_id uuid,company_id uuid,role_id uuid,is_active boolean,status text);
    CREATE TABLE public.role_permissions(role_id uuid,permission_id uuid,permission_key text,effect text);
    CREATE TABLE public.user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
    CREATE TABLE public.user_permission_overrides(user_id uuid,company_id uuid,is_active boolean,effect text,permission_key text,valid_from timestamptz,valid_to timestamptz);
    CREATE TABLE gridex_ediel_retention.record_class_catalog(retention_class text,permission_key text);
    CREATE TABLE gridex_ediel_retention.blob_decisions(id uuid);CREATE TABLE gridex_ediel_retention.record_decisions(id uuid);CREATE TABLE gridex_ediel_retention.invoice_file_decisions(id uuid);
    CREATE FUNCTION gridex_private.customer_document_path_allows(text,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    ${captured.authUID};
    ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;GRANT EXECUTE ON FUNCTION auth.uid() TO dashboard_user;
    ${captured.operation};
    ALTER FUNCTION storage.operation() OWNER TO supabase_storage_admin;`)
  const relations = [...new Set(captured.columns.map(x => x.relation))]
  for (const relation of relations) {
    const cols = captured.columns.filter(x => x.relation === relation).map(x => `${x.col} ${x.type}${x.attnotnull ? ' NOT NULL' : ''}`)
    await client.exec(`CREATE TABLE ${relation}(${cols.join(',')});ALTER TABLE ${relation} ENABLE ROW LEVEL SECURITY;${relation.startsWith('gridex_') ? `ALTER TABLE ${relation} FORCE ROW LEVEL SECURITY;ALTER TABLE ${relation} OWNER TO ${owner};` : 'ALTER TABLE '+relation+' OWNER TO postgres;'}`)
  }
  for (const f of captured.shared) {
    expect(hash(body(f.definition))).toBe(f.bodySha256)
    await client.exec(f.definition)
    const name = f.name, signature = name + (name.endsWith('session_actor_v1') ? '()' : name.endsWith('lock_auth_actor_v1') ? '(uuid)' : '(uuid,uuid,text)')
    const own = name.startsWith('public.') ? 'postgres' : owner
    await client.exec(`ALTER FUNCTION ${signature} OWNER TO ${own};REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated,service_role;`)
    if (own === 'postgres') await client.exec(`GRANT EXECUTE ON FUNCTION ${signature} TO ${owner}`)
  }
  for (const table of ['companies', 'user_profiles', 'permissions', 'roles', 'user_roles', 'role_permissions', 'user_permissions', 'user_permission_overrides']) {
    await client.exec(`ALTER TABLE public.${table} OWNER TO postgres;ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
  }
  await client.exec(`ALTER TABLE gridex_ediel_retention.record_class_catalog OWNER TO ${owner};
    ALTER TABLE gridex_ediel_retention.record_class_catalog ENABLE ROW LEVEL SECURITY;
    ALTER TABLE gridex_ediel_retention.record_class_catalog FORCE ROW LEVEL SECURITY;`)
  await client.exec('SET check_function_bodies=off')
  for (const g of captured.guards) {
    expect(hash(body(g.ddl))).toBe(g.hash)
    await client.exec(`${g.ddl} ALTER FUNCTION ${g.signature} OWNER TO ${owner};REVOKE ALL ON FUNCTION ${g.signature} FROM PUBLIC,anon,authenticated,service_role;
      CREATE TRIGGER ${g.trigger} BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION ${g.signature};`)
  }
  await client.exec(`SET check_function_bodies=on;
    GRANT USAGE ON SCHEMA public,storage,gridex_ediel_retention TO postgres;
    GRANT USAGE ON SCHEMA public,storage,gridex_ediel_retention TO ${owner};GRANT USAGE ON SCHEMA auth TO postgres;
    GRANT USAGE ON SCHEMA public,storage,gridex_private TO authenticated,anon,service_role;
    GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO ${owner};
    GRANT SELECT ON public.roles,public.user_roles TO authenticated,anon;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO postgres,service_role;
    GRANT ${owner} TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
    SET SESSION AUTHORIZATION postgres;GRANT ${owner} TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
    SET SESSION AUTHORIZATION supabase_admin;`)
  for (const [command, name] of [['DELETE','delete'],['INSERT','insert'],['SELECT','read'],['UPDATE','update'],['ALL','service_role_all']] as const) {
    const role = command === 'ALL' ? 'service_role' : 'authenticated'
    const predicate = command === 'ALL' ? `bucket_id='customer-documents'` : `bucket_id='customer-documents' AND gridex_private.customer_document_path_allows(name,'${command === 'SELECT' ? 'read' : 'write'}')`
    await client.exec(`CREATE POLICY customer_documents_storage_${name} ON storage.objects FOR ${command} TO ${role} ${command === 'INSERT' ? '' : `USING(${predicate})`} ${['INSERT','UPDATE','ALL'].includes(command) ? `WITH CHECK(${predicate})` : ''}`)
  }
  for (const [command, name] of [['SELECT','read'],['INSERT','write']] as const) await client.exec(`CREATE POLICY grid_owner_agreements_platform_${name} ON storage.objects FOR ${command} TO PUBLIC ${command === 'SELECT' ? 'USING' : 'WITH CHECK'}(bucket_id='grid-owner-agreements' AND EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=auth.uid() AND coalesce(ur.is_active,true) AND lower(coalesce(r.key,r.name,''))=ANY(ARRAY['super_admin','superadmin','platform_admin'])))`)
  return client
}
beforeAll(async () => {
  db = await setup()
  base = await db.dumpDataDir()
  await canonicalHelpers(db)
  for (const ddl of captured.policies) await db.exec(ddl)
  await db.exec('SET search_path=pg_catalog')
  expected = await targetState(db)
  await db.close()
}, 30_000)
beforeEach(async () => { db = new PGlite({ loadDataDir: base, database: 'postgres', username: 'supabase_admin' }) })
afterEach(async () => { await db.close() })

async function policies(indices = [0, 1, 2, 3, 4, 5]) {
  for (const i of indices) await db.exec(captured.policies[i])
}
async function rejectUnchanged(sql = forward, code = '42501') {
  const before = await snapshot()
  await expect(run(sql)).rejects.toMatchObject({ code })
  expect(await snapshot()).toEqual(before)
}
async function helperProfiles() {
  return (await db.query(`SELECT to_jsonb(p) value FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND n.nspname||'.'||p.proname=ANY($1::text[]) ORDER BY p.oid`, [names])).rows
}
const actor = '00000000-0000-4000-8000-000000000001'
const foreignActor = '00000000-0000-4000-8000-000000000002'
const company = '00000000-0000-4000-8000-000000000011'
const foreignCompany = '00000000-0000-4000-8000-000000000012'
const invoiceSource = '00000000-0000-4000-8000-000000000103'
async function row(relation: string, overrides: Record<string, string | number | boolean>) {
  const cols = captured.columns.filter(x => x.relation === relation)
  const values = cols.map(x => overrides[x.col] ?? (x.attnotnull
    ? x.type === 'uuid' ? '00000000-0000-4000-8000-000000000099'
      : x.type === 'bigint' ? 1 : x.type === 'timestamp with time zone' ? '2020-01-01T00:00:00Z'
        : 'SYNTHETIC'
    : null))
  await db.query(`INSERT INTO ${relation}(${cols.map(x => x.col).join(',')}) VALUES(${cols.map((_, i) => '$' + (i + 1)).join(',')})`, values)
}
async function seedAuthorization() {
  await db.exec(`INSERT INTO auth.users(id) VALUES('${actor}'),('${foreignActor}');
    INSERT INTO public.user_profiles(id,user_status) VALUES('${actor}','active'),('${foreignActor}','active');
    INSERT INTO public.companies VALUES('${company}','archived'),('${foreignCompany}','active');
    INSERT INTO public.permissions(id,key,is_active) VALUES
      ('00000000-0000-4000-8000-000000000021','ediel.retention.purge',true),
      ('00000000-0000-4000-8000-000000000022','ediel.retention.invoice_copy_evidence',true),
      ('00000000-0000-4000-8000-000000000023','ediel.retention.contract_pdf',true);
    INSERT INTO gridex_ediel_retention.record_class_catalog VALUES('contract_signed_pdf_bytes','ediel.retention.contract_pdf');
    INSERT INTO public.user_permissions(user_id,company_id,permission_key,is_active,status,effect)
      SELECT '${actor}'::uuid,'${company}'::uuid,key,true,'active','allow' FROM public.permissions;`)
  await row('public.company_memberships', { user_id: actor, company_id: company, status: 'active', is_active: true, accepted_at: '2020-01-01Z' })
  // INSERT objects before installing their actual guards. No physical object or
  // full legal DELETE guard is exercised by this isolated admission fixture.
  await db.exec(`ALTER TABLE storage.objects DISABLE TRIGGER USER;
    INSERT INTO storage.objects(bucket_id,name) VALUES('ediel-files','synthetic.eml'),('customer-contract-documents','synthetic.pdf'),('billing-exports','synthetic.csv');
    ALTER TABLE storage.objects ENABLE TRIGGER USER;`)
  await row('gridex_ediel_retention.blob_tombstones', { retention_class: 'transport_raw_mime_bytes', storage_path: 'synthetic.eml', company_id: company })
  await row('gridex_ediel_retention.record_tombstones', { retention_class: 'contract_signed_pdf_bytes', storage_path: 'synthetic.pdf', company_id: company })
  await row('gridex_ediel_retention.invoice_file_sources', { id: invoiceSource, company_id: company, storage_bucket: 'billing-exports', storage_path: 'synthetic.csv' })
  await row('gridex_ediel_retention.invoice_file_tombstones', { source_id: invoiceSource, company_id: company })
}
async function visible(operation = 'storage.object.delete_many', user = actor) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('storage.operation',$2,false)", [user, operation])
  await db.exec('SET ROLE authenticated')
  try { return (await db.query<{ name: string }>('SELECT name FROM storage.objects ORDER BY name')).rows.map(x => x.name) }
  finally { await db.exec('RESET ROLE') }
}
describe('whole final retention Storage admission prerequisite forward', () => {
  it('installs exact three canonical owner-only/authenticated helpers and six policies while preserving all prior metadata', async () => {
    const before = await snapshot(false)
    await run()
    await db.exec('SET search_path=pg_catalog')
    expect(await targetState()).toEqual(expected)
    expect(await snapshot(false)).toEqual(before)
  })
  it('is a true no-op on a complete independently constructed canonical state and on repeat application', async () => {
    await canonicalHelpers(db); await policies()
    const before = await snapshot()
    await run(); expect(await snapshot()).toEqual(before)
    await run(); expect(await snapshot()).toEqual(before)
  })
  it('preserves existing complete helper OIDs/headers/ACLs while installing only six missing policies', async () => {
    await canonicalHelpers(db)
    const helpers = await helperProfiles(), before = await snapshot(false)
    await run()
    expect(await helperProfiles()).toEqual(helpers)
    expect(await snapshot(false)).toEqual(before)
    await db.exec('SET search_path=pg_catalog')
    expect(await targetState()).toEqual(expected)
  })
  it.each([{ indices: [0] }, { indices: [1, 2] }])('refuses partial helper group $indices', async ({ indices }) => {
    await canonicalHelpers(db, indices)
    await rejectUnchanged()
  })
  it.each([{ indices: [0] }, { indices: [2, 3, 4] }, { indices: [0, 1, 2, 3, 4] }])('refuses partial policy group $indices', async ({ indices }) => {
    await canonicalHelpers(db); await policies(indices)
    await rejectUnchanged()
  })
  it('refuses six policies pointing at renamed helpers rather than constructing replacements', async () => {
    await canonicalHelpers(db); await policies()
    for (const h of captured.helpers) await db.exec(`ALTER FUNCTION ${h.signature} RENAME TO renamed_${h.name.split('.')[1]}`)
    await rejectUnchanged()
  })
  it('refuses a same-name helper overload', async () => {
    await canonicalHelpers(db)
    await db.exec('CREATE FUNCTION public.ediel_storage_retention_target_v1(integer) RETURNS boolean LANGUAGE sql AS $$SELECT true$$')
    await rejectUnchanged()
  })
  it.each([
    'ALTER FUNCTION public.ediel_storage_retention_target_v1(text) COST 101',
    'ALTER FUNCTION public.ediel_storage_retention_target_v1(text) STABLE',
    'ALTER FUNCTION public.ediel_storage_retention_target_v1(text) SECURITY INVOKER',
    'ALTER FUNCTION public.ediel_storage_retention_target_v1(text) SET search_path=public',
    'ALTER FUNCTION public.ediel_storage_retention_target_v1(text) STRICT',
    'ALTER FUNCTION public.ediel_storage_retention_target_v1(text) PARALLEL SAFE',
    'ALTER FUNCTION public.ediel_storage_retention_target_v1(text) ROWS 2',
    'ALTER FUNCTION public.ediel_storage_retention_target_v1(text) OWNER TO postgres',
    'GRANT EXECUTE ON FUNCTION public.ediel_storage_retention_target_v1(text) TO service_role',
    'GRANT EXECUTE ON FUNCTION public.ediel_storage_retention_target_v1(text) TO authenticated WITH GRANT OPTION',
  ])('refuses unknown canonical-helper metadata: %s', async change => {
    await canonicalHelpers(db); await db.exec(change); await rejectUnchanged()
  })
  it('refuses an unknown helper body without replacing it', async () => {
    await canonicalHelpers(db)
    await db.exec('CREATE OR REPLACE FUNCTION public.ediel_storage_retention_target_v1(p_path text) RETURNS SETOF boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT true$$')
    await rejectUnchanged()
  })
  it.each([
    'ALTER POLICY ediel_qualified_retention_storage_delete ON storage.objects TO anon',
    'ALTER POLICY ediel_qualified_retention_storage_delete ON storage.objects USING(true)',
    "ALTER POLICY ediel_qualified_retention_storage_delete_visibility ON storage.objects USING(bucket_id='ediel-files' AND EXISTS(SELECT FROM public.ediel_storage_retention_target_v1(name)))",
    "DROP POLICY invoice_file_qualified_retention_storage_delete ON storage.objects;CREATE POLICY invoice_file_qualified_retention_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(public.ediel_invoice_file_storage_delete_target_v1(bucket_id,name))",
  ])('refuses unknown complete policy state: %s', async change => {
    await canonicalHelpers(db); await policies(); await db.exec(change); await rejectUnchanged()
  })
  it.each(captured.guards.map(x => x.trigger))('requires canonical post869 trigger %s', async name => {
    await db.exec(`ALTER TABLE storage.objects DISABLE TRIGGER ${name}`)
    await rejectUnchanged()
  })
  it('rejects a wrong guard body without replacing it', async () => {
    await db.exec("CREATE OR REPLACE FUNCTION gridex_ediel_retention.storage_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RETURN OLD;END$$")
    await rejectUnchanged()
  })
  it('rejects an additional trigger alias for a canonical guard', async () => {
    await db.exec('CREATE TRIGGER unknown_guard_alias BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.storage_guard_v1()')
    await rejectUnchanged()
  })
  it.each([
    { keys: ['ediel.retention.audit_normalized19_cleanup'], hash: '6bedde3f4c01c504eae815ba0895b0872603dd2f6d8adace45669b640db689c7' },
    { keys: ['ediel.retention.audit_normalized19_cleanup', 'ediel.retention.completed_review_reason'], hash: '32c79a9f30939ab51637d1fbd3ca524766836ec6df5d2371d20e051d2601a51b' },
  ])('does not mistake genuine predecessor $hash for final b402', async ({ keys, hash: expectedHash }) => {
    let ddl: string = captured.shared.find(x => x.name === 'gridex_ediel_retention.permission_v1')!.definition
    for (const key of keys) ddl = ddl.replace(",'" + key + "'", '')
    expect(hash(body(ddl))).toBe(expectedHash)
    await db.exec(ddl.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
    await rejectUnchanged()
  })
  it.each([
    'ALTER ROLE postgres SUPERUSER',
    `GRANT ${owner} TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres`,
    `GRANT ${owner} TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET FALSE GRANTED BY postgres`,
    `GRANT CREATE ON SCHEMA public TO ${owner}`,
    'ALTER SCHEMA public OWNER TO supabase_admin',
    'ALTER TABLE gridex_ediel_retention.invoice_file_sources ALTER company_id DROP NOT NULL',
    'ALTER TABLE gridex_ediel_retention.blob_tombstones NO FORCE ROW LEVEL SECURITY',
    'GRANT SELECT ON gridex_ediel_retention.blob_tombstones TO authenticated',
    `REVOKE SELECT ON public.company_memberships FROM ${owner}`,
  ])('fails closed without repairing unexpected installer/dependency state: %s', async change => {
    await db.exec(change); await rejectUnchanged()
  })
  it.each(['', '{"postgres":["public.other"]}', '{"postgres":["storage.objects"]}'])('never forges managed policy capability from a PGlite custom setting: %s', async setting => {
    await db.exec('ALTER TABLE storage.objects OWNER TO supabase_storage_admin;GRANT TRIGGER ON storage.objects TO postgres')
    if (setting) await db.query("SELECT set_config('supautils.policy_grants',$1,false)", [setting])
    await rejectUnchanged()
  })
  it.each(['after_helpers', 'after_policies'])('rolls back every object and temporary capability after injected late failure %s', async point => {
    const marker = point === 'after_helpers' ? '    -- Legitimate owner context' : '  FOR spec IN SELECT value FROM jsonb_array_elements(routine_specs) LOOP'
    expect(forward.split(marker)).toHaveLength(2)
    const fault = point === 'after_helpers' ? "    RAISE EXCEPTION 'SYNTHETIC late constructor fault';\n" : "  IF phase=1 THEN RAISE EXCEPTION 'SYNTHETIC late constructor fault';END IF;\n"
    await rejectUnchanged(forward.replace(marker, fault + marker), 'P0001')
  })
  it('rolls back the real constructor when an unknown default grantee would leak helper EXECUTE', async () => {
    await db.exec('CREATE ROLE fixture_extra_grantee;ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO fixture_extra_grantee')
    await rejectUnchanged()
  })
  it('preserves an unrelated routine outside every retention namespace when a DDL hook changes it', async () => {
    await db.exec(`CREATE SCHEMA other_private;
      CREATE FUNCTION other_private.sentinel() RETURNS text LANGUAGE sql AS $body$SELECT 'original'::text$body$;
      CREATE FUNCTION other_private.change_on_policy() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $event$
      BEGIN EXECUTE $ddl$CREATE OR REPLACE FUNCTION other_private.sentinel() RETURNS text LANGUAGE sql AS $body$SELECT 'changed'::text$body$;$ddl$;END;
      $event$;
      CREATE EVENT TRIGGER fixture_unrelated_routine_change ON ddl_command_end WHEN TAG IN ('CREATE POLICY') EXECUTE FUNCTION other_private.change_on_policy();`)
    await rejectUnchanged()
    expect((await db.query<{ value: string }>('SELECT other_private.sentinel() value')).rows).toEqual([{ value: 'original' }])
  })
  it.each([
    'REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner;',
    'GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;',
  ])('detects an omitted capability restoration and rolls back the whole constructor: %s', async restore => {
    expect(forward.split(restore)).toHaveLength(2)
    await rejectUnchanged(forward.replace(restore, 'PERFORM 1;'))
  })
  it('requires the existing current-session helper rather than installing an alternative', async () => {
    await db.exec('DROP FUNCTION public.ediel_retention_session_actor_v1()')
    await rejectUnchanged()
  })
  it('refuses the genuine canonical pre869 guard even when its header and trigger remain correct', async () => {
    const source = readFileSync('supabase/migrations/20261001000700_ediel_message_content_and_mime_retention.sql', 'utf8')
    const start = source.indexOf('CREATE FUNCTION gridex_ediel_retention.storage_guard_v1(')
    const marker = /\bAS (\$\w*\$)/.exec(source.slice(start))!
    const end = source.indexOf(marker[1], start + marker.index + marker[0].length) + marker[1].length + 1
    const ddl = source.slice(start, end).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
      .replace('auth.uid()', 'public.ediel_retention_session_actor_v1()')
      .replace("gridex_ediel_retention.permission_v1(t.company_id,actor,'communication.write')", 'gridex_ediel_retention.class_permission_v1(t.company_id,actor,t.retention_class)')
    expect(hash(body(ddl))).toBe('c13d549a2fc9ba39bcc543255493974cef4afd926660ada2e86ec55ea313744b')
    await db.exec('SET check_function_bodies=off;' + ddl + 'SET check_function_bodies=on;')
    await rejectUnchanged()
  })
  it('grants the exact canonical helper ACL and denies direct private access to every application role', async () => {
    await run()
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const permissions = (await db.query<{ direct: boolean; helper: boolean }>(`SELECT has_schema_privilege($1,'gridex_ediel_retention','USAGE') direct,
        has_function_privilege($1,'public.ediel_storage_retention_target_v1(text)','EXECUTE') helper`, [role])).rows[0]
      expect(permissions).toEqual({ direct: false, helper: role === 'authenticated' })
    }
  })
  it('uses the actual actor/company/class helpers to admit only matching delete_many targets', async () => {
    await seedAuthorization(); const before = await snapshot(false); await run()
    expect(await snapshot(false)).toEqual(before)
    expect(await visible()).toEqual(['synthetic.csv', 'synthetic.eml', 'synthetic.pdf'])
    for (const op of ['', 'storage.object.list', 'storage.object.get', 'storage.object.sign']) expect(await visible(op)).toEqual([])
    expect(await visible('storage.object.delete_many', foreignActor)).toEqual([])
  })
  it.each(['deny', 'expired_grant', 'unaccepted_membership', 'inactive_actor', 'missing_invoice_permission', 'missing_invoice_tombstone', 'shared_foreign_invoice_target'])('keeps actual SQL authority failure %s closed', async mode => {
    await seedAuthorization(); await run()
    if (mode === 'deny') await db.exec(`INSERT INTO public.user_permission_overrides(user_id,company_id,is_active,effect,permission_key) VALUES('${actor}','${company}',true,'deny','ediel.retention.purge')`)
    if (mode === 'expired_grant') await db.exec(`DELETE FROM public.user_permissions;INSERT INTO public.user_permission_overrides(user_id,company_id,is_active,effect,permission_key,valid_to) SELECT '${actor}','${company}',true,'allow',key,'2000-01-01Z'::timestamptz FROM public.permissions`)
    if (mode === 'unaccepted_membership') await db.exec('UPDATE public.company_memberships SET accepted_at=NULL')
    if (mode === 'inactive_actor') await db.exec("UPDATE public.user_profiles SET user_status='disabled'")
    if (mode === 'missing_invoice_permission') await db.exec("DELETE FROM public.user_permissions WHERE permission_key='ediel.retention.invoice_copy_evidence'")
    if (mode === 'missing_invoice_tombstone') await db.exec('DELETE FROM gridex_ediel_retention.invoice_file_tombstones')
    if (mode === 'shared_foreign_invoice_target') await row('gridex_ediel_retention.invoice_file_sources', { id: '00000000-0000-4000-8000-000000000104', company_id: foreignCompany, storage_bucket: 'billing-exports', storage_path: 'synthetic.csv' })
    const rows = await visible()
    expect(rows).toEqual(['missing_invoice_permission', 'missing_invoice_tombstone', 'shared_foreign_invoice_target'].includes(mode) ? ['synthetic.eml', 'synthetic.pdf'] : [])
  })
  it.each([
    { change: "UPDATE gridex_ediel_retention.blob_tombstones SET retention_class='received_ediel_message_content'", names: ['synthetic.csv', 'synthetic.pdf'] },
    { change: 'DELETE FROM gridex_ediel_retention.blob_tombstones', names: ['synthetic.csv', 'synthetic.pdf'] },
    { change: `UPDATE gridex_ediel_retention.record_tombstones SET company_id='${foreignCompany}'`, names: ['synthetic.csv', 'synthetic.eml'] },
    { change: "UPDATE gridex_ediel_retention.invoice_file_sources SET storage_path='different.csv'", names: ['synthetic.eml', 'synthetic.pdf'] },
  ])('binds the actual helper to class/company/tombstone/exact target: $change', async ({ change, names: allowed }) => {
    await seedAuthorization(); await run(); await db.exec(change)
    expect(await visible()).toEqual(allowed)
  })
})
