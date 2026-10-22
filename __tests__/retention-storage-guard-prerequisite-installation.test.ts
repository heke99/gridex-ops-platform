// Finite actual-SQL installation boundary. No native owner-envelope, provider,
// physical Storage API, customer data, purge or market acceptance is asserted.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const schema = readFileSync('supabase/schema.sql', 'utf8') // Unchanged table shapes only.
const forward = readFileSync('supabase/migrations/20261020184151_retention_storage_guard_prerequisites.sql', 'utf8')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const owner = 'gridex_ediel_retention_owner'
const names = ['storage_guard_v1', 'contract_storage_guard_v1', 'invoice_file_storage_guard_v1'] as const
const preHashes = ['c13d549a2fc9ba39bcc543255493974cef4afd926660ada2e86ec55ea313744b', '9bb603eb46f8c7687868c80205613f5ae4315cca1b6d614bbb597aa3f0ed4275', 'b9900b63b92399a6a210d83767bef73c27ca8aa785152ef5377e2ac4b93e8b9d']
const postHashes = ['c29fe1d0b39ad2f642595dc4b476b78b1694732d78492a6adad03a2238a44d2d', 'a66d0f57efaed9882bf7ac353e3127f8d166e8afd7769f7b4142cc7a688e29c4', 'cfcad8fe52ef1000f5b0b8af6350821a1e6ebb73f35787f44a25acb1e07f1a71']
const triggerNames = ['ediel_retention_storage_guard', 'contract_retention_storage_guard', 'invoice_file_retention_storage_guard']
const relationNames = ['blob_decisions', 'blob_reviews', 'blob_tombstones', 'blob_events', 'record_decisions', 'record_reviews', 'record_tombstones', 'record_events', 'invoice_file_sources', 'invoice_file_decisions', 'invoice_file_reviews', 'invoice_file_tombstones', 'invoice_file_events']
const historical = {
  content: readFileSync('supabase/migrations/20261001000700_ediel_message_content_and_mime_retention.sql', 'utf8'),
  classAuthority: readFileSync('supabase/migrations/20261001000710_ediel_archived_tenant_retention_class_authority.sql', 'utf8'),
  contract: readFileSync('supabase/migrations/20261001012305_ediel_customer_record_class_retention.sql', 'utf8'),
  bridge: readFileSync('supabase/migrations/20261001025642_ediel_retention_current_auth_owner_bridge.sql', 'utf8'),
  invoice: readFileSync('supabase/migrations/20261001071000_ediel_invoice_file_copy_class_retention.sql', 'utf8'),
}
// Explicit captured FD4 source inputs: fd4acbc50e9d73c7f2f317d3e806723522708b16,
// schema blob48a6e2b3ccc67cfc4ccac7bf278ec213c8a323b5. Each body is pinned below.
// They remain immutable when GEN adopts other functions or the post869 guards.
const dependencies = [
  { signature: "gridex_ediel_retention.actor_v1(uuid, uuid, text)", owner: "gridex_ediel_retention_owner", bodyHash: "88a02a898d5d0b97e5da84cf71c763e81c2d7d409cf2229b45c0998db07ff785", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.actor_v1(c uuid, actor uuid, permission text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$BEGIN
 -- Hold the actual authorization registry, including insertion of new deny
 -- overrides, throughout this operation; a preceding server/UI check is not it.
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 PERFORM public.ediel_retention_lock_auth_actor_v1(actor);PERFORM id FROM public.companies WHERE id=c FOR SHARE;PERFORM id FROM public.user_profiles WHERE id=actor FOR SHARE;
 PERFORM user_id FROM public.company_memberships WHERE company_id=c AND user_id=actor FOR SHARE;
 IF public.ediel_retention_session_actor_v1() IS DISTINCT FROM actor OR permission NOT IN('ediel.retention.submit','ediel.retention.review','ediel.retention.purge')
 OR NOT public.ediel_retention_lock_auth_actor_v1(actor)
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR gridex_ediel_retention.permission_v1(c,actor,permission) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_retention_current_actor_forbidden' USING ERRCODE='42501';END IF;
END$$;` },
  { signature: "gridex_ediel_retention.blob_basis_v1(uuid, text, uuid)", owner: "gridex_ediel_retention_owner", bodyHash: "55e5c91036ea23f79637292f2d318b6392cae00841c16d00b22c61d220563c1c", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.blob_basis_v1(c uuid, k text, target uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE m public.ediel_messages%rowtype;s gridex_received_sources.sources%rowtype;p public.ediel_message_payloads%rowtype;facts jsonb;rawhash text;bytes bigint;path text;payloads jsonb;
BEGIN
 IF k='received_ediel_message_content' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=target AND company_id=c FOR SHARE;SELECT * INTO STRICT s FROM gridex_received_sources.sources WHERE source_message_id=m.id AND company_id=c FOR SHARE;
  IF m.direction IS DISTINCT FROM 'inbound' OR s.raw_payload IS NULL OR m.raw_payload IS DISTINCT FROM s.raw_payload OR s.payload_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'retention_actual_received_original_required';END IF;
  PERFORM id FROM public.ediel_message_payloads WHERE company_id=c AND ediel_message_id=m.id ORDER BY id FOR SHARE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'raw',raw_payload,'encrypted',encrypted_payload,'hash',raw_payload_hash,'kind',payload_kind) ORDER BY id),'[]') INTO payloads FROM public.ediel_message_payloads WHERE company_id=c AND ediel_message_id=m.id;
  rawhash:=s.payload_hash;bytes:=octet_length(convert_to(s.raw_payload,'UTF8'));facts:=jsonb_build_object('source',to_jsonb(s),'publicContent',gridex_ediel_retention.public_content_v1(m),'payloadCopies',payloads);
 ELSIF k='transport_raw_mime_bytes' THEN
  SELECT * INTO STRICT p FROM public.ediel_message_payloads WHERE id=target AND company_id=c FOR SHARE;SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p.ediel_message_id AND company_id=c FOR SHARE;
  rawhash:=p.metadata->>'archived_mime_sha256';bytes:=(p.metadata->>'archived_mime_bytes')::bigint;path:='transport/'||c::text||'/'||m.id::text||'/'||rawhash||'.eml';
  IF m.direction IS DISTINCT FROM 'outbound' OR p.payload_kind NOT IN('raw_mime','smime_enveloped') OR p.metadata->>'archive_verified' IS DISTINCT FROM 'true' OR rawhash!~'^[a-f0-9]{64}$' OR bytes NOT BETWEEN 1 AND 33554432 OR p.encrypted_payload_ref IS DISTINCT FROM 'storage://ediel-files/'||path
  OR NOT (EXISTS(SELECT FROM gridex_ediel_transport.attempts a WHERE a.company_id=c AND a.message_id=m.id AND a.entered_at IS NOT NULL AND a.binding->>'mimeSha256'=rawhash AND a.binding->>'mimeArchiveRef'=p.encrypted_payload_ref AND a.binding->>'mimeLength'=bytes::text AND a.binding->>'rfcMessageId'=p.metadata->>'archived_rfc_message_id')
   OR EXISTS(SELECT FROM gridex_outbound_dispatch.attempts a JOIN gridex_outbound_dispatch.events e ON e.attempt_id=a.id AND e.kind='provider_call_entered' WHERE a.company_id=c AND a.message_id=m.id AND a.binding->>'mimeSha256'=rawhash AND a.binding->>'mimeArchiveRef'=p.encrypted_payload_ref AND a.binding->>'mimeLength'=bytes::text AND a.binding->>'rfcMessageId'=p.metadata->>'archived_rfc_message_id')) THEN RAISE EXCEPTION 'retention_private_entered_mime_original_required';END IF;
  facts:=jsonb_build_object('snapshot',to_jsonb(p),'message',m.id,'company',c,'environment',m.environment);
 ELSE RAISE EXCEPTION 'retention_class_not_implemented';END IF;
 RETURN jsonb_build_object('companyId',c,'retentionClass',k,'targetId',target,'messageId',m.id,'sourceHash',rawhash,'targetHash',encode(sha256(convert_to(facts::text,'UTF8')),'hex'),'publicContentHash',encode(sha256(convert_to(gridex_ediel_retention.public_content_v1(m)::text,'UTF8')),'hex'),'byteLength',bytes,'storagePath',path);
END$_$;` },
  { signature: "gridex_ediel_retention.blob_current_v1(gridex_ediel_retention.blob_decisions)", owner: "gridex_ediel_retention_owner", bodyHash: "c3e008ce015bac1cf5643ed7708a6b68ff6c912c98421f6a4ac2415286c41e1c", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.blob_current_v1(d gridex_ediel_retention.blob_decisions) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE r gridex_ediel_retention.blob_reviews%rowtype;claims jsonb;observed_at timestamptz;BEGIN
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 SELECT * INTO r FROM gridex_ediel_retention.blob_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 PERFORM public.ediel_retention_lock_auth_actor_v1(r.actor_user_id);PERFORM id FROM public.user_profiles WHERE id=r.actor_user_id FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=d.company_id AND user_id=r.actor_user_id FOR SHARE;
 IF r.outcome IS DISTINCT FROM 'approved' OR NOT public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=r.actor_user_id AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=d.company_id AND user_id=r.actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL) OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN NULL;END IF;
 IF gridex_ediel_retention.class_permission_v1(d.company_id,r.actor_user_id,d.retention_class) IS NOT TRUE THEN RETURN NULL;END IF;claims:=gridex_ediel_retention.blob_receipt_v1(d);
 IF r.outcome IS DISTINCT FROM 'approved' OR NOT public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=r.actor_user_id AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=d.company_id AND user_id=r.actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL) OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN NULL;END IF;
 IF gridex_ediel_retention.class_permission_v1(d.company_id,r.actor_user_id,d.retention_class) IS NOT TRUE THEN RETURN NULL;END IF;
 observed_at:=clock_timestamp();IF claims IS NULL OR (claims->>'retainUntil')::timestamptz>observed_at THEN RETURN NULL;END IF;RETURN r.id;
END$$;` },
  { signature: "gridex_ediel_retention.class_permission_v1(uuid, uuid, text)", owner: "gridex_ediel_retention_owner", bodyHash: "676e260cb26519700f9796ca77ef4983eebf9bf22d7dfd8252c00b70ca7b260e", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.class_permission_v1(c uuid, actor uuid, retention_class text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
 SELECT gridex_ediel_retention.permission_v1(c,actor,CASE retention_class WHEN 'requested_change_source_artifact_bytes' THEN 'ediel.retention.source_bytes' WHEN 'customer_canonical_personal_fields' THEN 'ediel.retention.customer_fields' WHEN 'received_ediel_message_content' THEN 'ediel.retention.original_bytes' WHEN 'transport_raw_mime_bytes' THEN 'ediel.retention.mime_bytes' ELSE NULL END) IS TRUE
$$;` },
  { signature: "gridex_ediel_retention.invoice_file_actor_v1(uuid, uuid, text)", owner: "gridex_ediel_retention_owner", bodyHash: "d9ea2bfa9ecb070db90b93851763ea92991db48085fbdba9db71867b1b9de7b0", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.invoice_file_actor_v1(c uuid, actor uuid, op text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$BEGIN
 IF op='ediel.retention.read' THEN PERFORM gridex_ediel_retention.record_read_actor_v1(c,actor);ELSE PERFORM gridex_ediel_retention.actor_v1(c,actor,op);END IF;
 IF gridex_ediel_retention.permission_v1(c,actor,'ediel.retention.invoice_copy_evidence') IS NOT TRUE THEN RAISE EXCEPTION 'invoice_file_current_exact_class_required' USING ERRCODE='42501';END IF;END$$;` },
  { signature: "gridex_ediel_retention.invoice_file_basis_v1(uuid, text, uuid)", owner: "gridex_ediel_retention_owner", bodyHash: "9900585a85d5ef0614afad713247f273035887c8cd5a4dec3f8de3f5cd400c88", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.invoice_file_basis_v1(c uuid, k text, target uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE s gridex_ediel_retention.invoice_file_sources%rowtype;spec record;r jsonb;invoice jsonb;item jsonb;underlay jsonb;binding jsonb;scope jsonb;customer uuid;start_at timestamptz;end_at timestamptz;closed boolean;BEGIN
 SELECT * INTO STRICT s FROM gridex_ediel_retention.invoice_file_sources WHERE company_id=c AND retention_class=k AND target_id=target FOR SHARE;
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.invoice_file_catalog WHERE retention_class=k;
 LOCK TABLE public.customer_invoices,public.customer_invoice_documents,public.invoice_documents,public.invoice_export_items,public.invoice_export_attempts,public.customers,public.customer_supply_periods IN SHARE MODE;
 EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id=$1 AND company_id=$2 FOR SHARE',spec.source_table) INTO r USING target,c;
 IF r IS NULL THEN RAISE EXCEPTION 'invoice_file_actual_source_removed';END IF;
 IF spec.source_table='customer_invoices' THEN invoice:=r;
 ELSIF spec.source_table='customer_invoice_documents' THEN SELECT to_jsonb(x) INTO invoice FROM public.customer_invoices x WHERE id=(r->>'invoice_id')::uuid AND company_id=c FOR SHARE;
 ELSE SELECT to_jsonb(x) INTO item FROM public.invoice_export_items x WHERE id=(r->>'invoice_export_item_id')::uuid AND company_id=c FOR SHARE;END IF;
 customer:=coalesce(invoice->>'customer_id',item->>'customer_id')::uuid;
 SELECT to_jsonb(x) INTO underlay FROM public.billing_underlays x WHERE company_id=c AND id=coalesce(invoice->>'billing_underlay_id',item->>'billing_underlay_id')::uuid FOR SHARE;
 SELECT to_jsonb(x) INTO binding FROM gridex_billing_source.underlay_bindings x WHERE company_id=c AND underlay_id=(underlay->>'id')::uuid FOR SHARE;
 IF customer IS NULL OR underlay IS NULL OR binding IS NULL OR underlay->>'customer_id' IS DISTINCT FROM customer::text OR NOT EXISTS(SELECT FROM public.customers WHERE id=customer AND company_id=c) THEN RAISE EXCEPTION 'invoice_file_native_invoice_underlay_scope_required';END IF;
 IF binding->>'source_basis_hash' IS DISTINCT FROM encode(sha256(convert_to((binding->'source_basis')::text,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_ediel_retention.finance_tombstones WHERE company_id=c AND retention_class='billing_underlay_source_body' AND target_id=underlay->>'id') THEN RAISE EXCEPTION 'invoice_file_actual_billing_source_required';END IF;
 start_at:=(underlay->>'billing_period_start')::timestamptz;end_at:=(underlay->>'billing_period_end')::timestamptz;
 IF isfinite(start_at) IS NOT TRUE OR isfinite(end_at) IS NOT TRUE OR end_at<=start_at THEN RAISE EXCEPTION 'invoice_file_native_closed_period_required';END IF;
 SELECT jsonb_build_object('customer',to_jsonb(x),'supplies',(SELECT coalesce(jsonb_agg(to_jsonb(sp) ORDER BY sp.id),'[]') FROM public.customer_supply_periods sp WHERE sp.company_id=c AND sp.customer_id=customer),'invoices',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'status',i.status) ORDER BY i.id),'[]') FROM public.customer_invoices i WHERE i.company_id=c AND i.customer_id=customer),'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.invoice_export_attempts a WHERE a.company_id=c AND a.invoice_export_item_id=i.id)) ORDER BY i.id),'[]') FROM public.invoice_export_items i WHERE i.company_id=c AND i.customer_id=customer)) INTO scope FROM public.customers x WHERE id=customer AND company_id=c;
 closed:=end_at<=clock_timestamp() AND scope#>>'{customer,status}'='archived'
 AND NOT EXISTS(SELECT FROM public.customer_supply_periods WHERE company_id=c AND customer_id=customer AND (status IS NULL OR status NOT IN('cancelled','rejected','terminated','ended','closed','inactive') OR coalesce(actual_end_date,end_date) IS NULL OR coalesce(actual_end_date,end_date)>=current_date))
 AND NOT EXISTS(SELECT FROM public.customer_invoices WHERE company_id=c AND customer_id=customer AND (status IS NULL OR lower(status) NOT IN('paid','cancelled','void','credited')))
 AND NOT EXISTS(SELECT FROM public.invoice_export_items WHERE company_id=c AND customer_id=customer AND (status IS NULL OR upper(status) NOT IN('SENT','CREDITED','CANCELLED','REJECTED')))
 AND NOT EXISTS(SELECT FROM public.invoice_export_attempts a JOIN public.invoice_export_items i ON i.id=a.invoice_export_item_id WHERE i.company_id=c AND i.customer_id=customer AND (a.company_id IS DISTINCT FROM c OR a.finished_at IS NULL));
 RETURN jsonb_build_object('retentionClass',k,'targetId',target,'sourceId',s.id,'sourceHash',s.source_hash,'targetHash',encode(sha256(convert_to(jsonb_build_object('source',to_jsonb(s),'target',r)::text,'UTF8')),'hex'),'scopeHash',encode(sha256(convert_to(jsonb_build_object('scope',scope,'underlayId',underlay->>'id','sourceBasisHash',binding->>'source_basis_hash','periodStart',start_at,'periodEnd',end_at)::text,'UTF8')),'hex'),'storageBucket',s.storage_bucket,'storagePath',s.storage_path,'byteLength',s.byte_length,'periodStart',start_at,'periodEnd',end_at,'allIncludedScopesClosed',closed,'complete',false,'authority','none');END$_$;` },
  { signature: "gridex_ediel_retention.invoice_file_receipt_v1(gridex_ediel_retention.invoice_file_decisions)", owner: "gridex_ediel_retention_owner", bodyHash: "fd02a779fc8b39b5e9bf6e3b7511a663216f0b115a3297bffcb15761c57ee98f", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.invoice_file_receipt_v1(d gridex_ediel_retention.invoice_file_decisions) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE issuer gridex_ediel_retention.issuers%rowtype;s gridex_ediel_retention.invoice_file_sources%rowtype;p jsonb;b bytea;now_at timestamptz;issued timestamptz;expires timestamptz;retain timestamptz;journal timestamptz;BEGIN IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash THEN RETURN NULL;END IF;
 IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash OR jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO issuer FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 SELECT * INTO s FROM gridex_ediel_retention.invoice_file_sources WHERE id=d.source_id AND company_id=d.company_id FOR SHARE;now_at:=clock_timestamp();
 IF issuer.id IS NULL OR s.id IS NULL OR now_at<issuer.valid_from OR now_at>=issuer.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=issuer.id) OR EXISTS(SELECT FROM gridex_ediel_retention.invoice_file_revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 b:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(b,issuer.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 p:=convert_from(b,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;retain:=(p->>'retainUntil')::timestamptz;journal:=(p->>'journalRetainUntil')::timestamptz;
 IF p->>'format' IS DISTINCT FROM 'ediel_invoice_file_retention_policy_v1' OR p->>'companyId' IS DISTINCT FROM d.company_id::text OR p->>'retentionClass' IS DISTINCT FROM d.retention_class OR p->>'targetId' IS DISTINCT FROM d.target_id::text OR p->>'sourceId' IS DISTINCT FROM d.source_id::text OR p->>'sourceHash' IS DISTINCT FROM d.source_hash OR p->>'targetHash' IS DISTINCT FROM d.target_hash OR p->>'scopeHash' IS DISTINCT FROM d.scope_hash OR p->>'documentHash' IS DISTINCT FROM d.document_hash OR p->>'storageBucket' IS DISTINCT FROM s.storage_bucket OR p->>'storagePath' IS DISTINCT FROM s.storage_path OR p->>'byteLength' IS DISTINCT FROM s.byte_length::text OR p->>'operation' IS DISTINCT FROM 'delete_storage_pdf' OR p->>'issuerLegalReference' IS DISTINCT FROM issuer.legal_reference OR p->>'accessRevocationRequired' IS DISTINCT FROM 'true' OR nullif(p->>'legalBasisReference','') IS NULL OR nullif(p->>'journalPurposeReference','') IS NULL OR isfinite(issued) IS NOT TRUE OR isfinite(expires) IS NOT TRUE OR isfinite(retain) IS NOT TRUE OR isfinite(journal) IS NOT TRUE OR issued>now_at OR expires<=now_at OR issued<issuer.valid_from OR expires>issuer.valid_to OR journal<=now_at THEN RETURN NULL;END IF;
 RETURN p;EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;END$_$;` },
  { signature: "gridex_ediel_retention.permission_v1(uuid, uuid, text)", owner: "gridex_ediel_retention_owner", bodyHash: "b4027dcae1ce6e709fd37afb329589649197104c801aeb4110454a60045cc0fa", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.permission_v1(c uuid, actor uuid, wanted text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE retention_keys constant text[]:=ARRAY['ediel.retention.submit','ediel.retention.review','ediel.retention.purge','ediel.retention.source_bytes','ediel.retention.customer_fields','ediel.retention.original_bytes','ediel.retention.mime_bytes','ediel.retention.artifact_decision_evidence','ediel.retention.blob_decision_evidence','ediel.retention.record_decision_evidence','ediel.retention.process_decision_evidence','ediel.retention.decision_policy_evidence','ediel.retention.billing_source_evidence','ediel.retention.invoice_copy_evidence','ediel.retention.settlement_copy_evidence','ediel.retention.finance_decision_evidence','ediel.retention.completed_review_reason','ediel.retention.audit_normalized19_cleanup'];
retention_grant_observed_at timestamptz;
BEGIN
 IF wanted<>ALL(retention_keys) THEN RETURN gridex_requested_changes.scoped_permission_v1(c,actor,wanted) IS TRUE
 AND NOT EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)
 AND NOT EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted)
 AND public.gridex_actor_has_company_permission(actor,c,wanted) IS TRUE;END IF;
 IF NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status IN('active','archived','pending_deletion','closed'))
  OR NOT public.ediel_retention_lock_auth_actor_v1(actor)
  OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL) THEN RETURN false;END IF;
 retention_grant_observed_at:=clock_timestamp();
 IF NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active)
  OR EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)
  OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=retention_grant_observed_at) AND (o.valid_to IS NULL OR retention_grant_observed_at<o.valid_to))
  OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='deny' AND p.key=wanted) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key=wanted)
  OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key=wanted)
  OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND o.company_id=c AND o.is_active AND o.effect='allow' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=retention_grant_observed_at) AND (o.valid_to IS NULL OR retention_grant_observed_at<o.valid_to));
END$$;` },
  { signature: "gridex_ediel_retention.record_actor_v1(uuid, uuid, text, text)", owner: "gridex_ediel_retention_owner", bodyHash: "5028dca28d069a63f2fedd940a993fa7fdd64fb7c4a31e89c6c22f9ef80c00be", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.record_actor_v1(c uuid, actor uuid, k text, operation text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$BEGIN
 PERFORM gridex_ediel_retention.actor_v1(c,actor,operation);
 IF gridex_ediel_retention.record_permission_v1(c,actor,k) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_record_class_grant_required' USING ERRCODE='42501';END IF;
END$$;` },
  { signature: "gridex_ediel_retention.record_basis_v1(uuid, text, uuid)", owner: "gridex_ediel_retention_owner", bodyHash: "680b65319f1b24411b2014be87f9b32263dee195bacc36f9d2fa100be0379835", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.record_basis_v1(c uuid, k text, target uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE spec gridex_ediel_retention.record_class_catalog%rowtype;rowdata jsonb;route_row jsonb;route_customer uuid;route_contract uuid;customer uuid;contract uuid;source text;path text;bytes bigint;
BEGIN
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;
 -- Unlocked routing data supplies lock identities only; hashes use the locked reread.
 EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1 AND company_id=$2',spec.source_table) INTO STRICT route_row USING target,c;
 IF spec.source_table IN('customer_contract_documents','customer_contract_signature_requests','customer_contract_acceptances','customer_contract_evidence') THEN
  route_contract:=(route_row->>'customer_contract_id')::uuid;SELECT customer_id INTO STRICT route_customer FROM public.customer_contracts WHERE id=route_contract AND company_id=c;
 ELSIF spec.source_table='customer_contracts' THEN route_contract:=target;route_customer:=(route_row->>'customer_id')::uuid;
 ELSIF spec.source_table='domain_events' THEN route_customer:=(route_row->>'subject_customer_id')::uuid;
 ELSE route_customer:=(route_row->>'customer_id')::uuid;route_contract:=nullif(route_row->>'contract_id','')::uuid;END IF;
 IF route_contract IS NOT NULL THEN PERFORM id FROM public.customer_contracts WHERE id=route_contract AND company_id=c AND customer_id=route_customer FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'retention_actual_record_contract_scope_required';END IF;END IF;
 PERFORM id FROM public.customers WHERE id=route_customer AND company_id=c FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'retention_actual_record_customer_scope_required';END IF;
 EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1 AND company_id=$2 FOR SHARE',spec.source_table) INTO STRICT rowdata USING target,c;
 IF spec.source_table IN('customer_contract_documents','customer_contract_signature_requests','customer_contract_acceptances','customer_contract_evidence') THEN
  contract:=(rowdata->>'customer_contract_id')::uuid;customer:=route_customer;
 ELSIF spec.source_table='customer_contracts' THEN contract:=target;customer:=(rowdata->>'customer_id')::uuid;
 ELSIF spec.source_table='domain_events' THEN customer:=(rowdata->>'subject_customer_id')::uuid;
 ELSE customer:=(rowdata->>'customer_id')::uuid;contract:=nullif(rowdata->>'contract_id','')::uuid;END IF;
 IF customer IS DISTINCT FROM route_customer OR contract IS DISTINCT FROM route_contract THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='retention_actual_record_scope_changed';END IF;
 source:=encode(sha256(convert_to(rowdata::text,'UTF8')),'hex');bytes:=octet_length(convert_to(rowdata::text,'UTF8'));
 IF k='contract_signed_pdf_bytes' THEN
  source:=rowdata->>'document_sha256';path:=rowdata->>'storage_path';
  IF rowdata->>'document_type' IS DISTINCT FROM 'signed_contract_pdf' OR rowdata->>'storage_bucket' IS DISTINCT FROM 'customer-contract-documents' OR rowdata->>'mime_type' IS DISTINCT FROM 'application/pdf' OR rowdata->>'verified_at' IS NULL OR rowdata->>'archived_at' IS NULL OR source!~'^[a-f0-9]{64}$' OR path IS DISTINCT FROM c::text||'/'||contract::text||'/signed-contract-'||source||'.pdf' THEN RAISE EXCEPTION 'retention_actual_signed_pdf_archive_required';END IF;
  SELECT (metadata->>'size')::bigint INTO STRICT bytes FROM storage.objects WHERE bucket_id='customer-contract-documents' AND name=path FOR SHARE;
  IF bytes NOT BETWEEN 1 AND 2097152 THEN RAISE EXCEPTION 'retention_actual_signed_pdf_byte_length_required';END IF;
 END IF;
 RETURN jsonb_build_object('companyId',c,'retentionClass',k,'sourceTable',spec.source_table,'targetId',target,'customerId',customer,'contractId',contract,'sourceHash',source,'targetHash',encode(sha256(convert_to(rowdata::text,'UTF8')),'hex'),'byteLength',bytes,'storagePath',path,'operation',spec.operation);
END$_$;` },
  { signature: "gridex_ediel_retention.record_current_review_v1(gridex_ediel_retention.record_decisions)", owner: "gridex_ediel_retention_owner", bodyHash: "a71d65848192e63cda8a5252fddc1403c332102d450821316962550c22d0da62", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.record_current_review_v1(d gridex_ediel_retention.record_decisions) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE r gridex_ediel_retention.record_reviews%rowtype;claims jsonb;observed_at timestamptz;BEGIN
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 SELECT * INTO r FROM gridex_ediel_retention.record_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 PERFORM public.ediel_retention_lock_auth_actor_v1(r.actor_user_id);PERFORM id FROM public.user_profiles WHERE id=r.actor_user_id FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=d.company_id AND user_id=r.actor_user_id FOR SHARE;
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.record_permission_v1(d.company_id,r.actor_user_id,d.retention_class) IS NOT TRUE THEN RETURN NULL;END IF;
 claims:=gridex_ediel_retention.record_receipt_v1(d);
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.record_permission_v1(d.company_id,r.actor_user_id,d.retention_class) IS NOT TRUE THEN RETURN NULL;END IF;
 observed_at:=clock_timestamp();IF claims IS NULL OR (claims->>'retainUntil')::timestamptz>observed_at THEN RETURN NULL;END IF;RETURN r.id;
END$$;` },
  { signature: "gridex_ediel_retention.record_permission_v1(uuid, uuid, text)", owner: "gridex_ediel_retention_owner", bodyHash: "90609c2ea24dbd62637fd83a5f654820dc2f235afae774019dc4cc61ac0dbcf3", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.record_permission_v1(c uuid, actor uuid, k text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE wanted text;observed_at timestamptz;BEGIN
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 PERFORM public.ediel_retention_lock_auth_actor_v1(actor);
 PERFORM id FROM public.companies WHERE id=c FOR SHARE;
 PERFORM id FROM public.user_profiles WHERE id=actor FOR SHARE;
 PERFORM user_id FROM public.company_memberships WHERE company_id=c AND user_id=actor FOR SHARE;
 observed_at:=clock_timestamp();
 IF k='__read_scope__' THEN wanted:='ediel.retention.read';ELSE SELECT permission_key INTO wanted FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;END IF;
 IF wanted IS NULL OR NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status IN('active','archived','pending_deletion','closed'))
 OR NOT public.ediel_retention_lock_auth_actor_v1(actor)
 OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active' AND to_jsonb(u)->>'disabled_at' IS NULL)
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active) THEN RETURN false;END IF;
 IF EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=observed_at) AND (o.valid_to IS NULL OR observed_at<o.valid_to))
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='deny' AND p.key=wanted) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND o.company_id=c AND o.is_active AND o.effect='allow' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=observed_at) AND (o.valid_to IS NULL OR observed_at<o.valid_to));
END$$;` },
  { signature: "public.ediel_retention_lock_auth_actor_v1(uuid)", owner: "postgres", bodyHash: "06dc571efe2101ab7991f60817d087451739115392a8bd14fe2cd73454a66d8a", ddl: String.raw`CREATE FUNCTION public.ediel_retention_lock_auth_actor_v1(p_actor_user_id uuid) RETURNS boolean
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
END$$;` },
  { signature: "public.ediel_retention_session_actor_v1()", owner: "postgres", bodyHash: "f501d732e4247434820ab322cf3caf4b20f7391cc1e98f4c7e5f6618c507c1e3", ddl: String.raw`CREATE FUNCTION public.ediel_retention_session_actor_v1() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$SELECT auth.uid()$$;` },
  { signature: "gridex_ediel_retention.invoice_file_shared_scope_v1(text, text)", owner: "gridex_ediel_retention_owner", bodyHash: "5d01db80cb304e3b4ffa746342dae6929662418ff9101e83e3adef7453390722", ddl: String.raw`CREATE FUNCTION gridex_ediel_retention.invoice_file_shared_scope_v1(bucket text, path text) RETURNS SETOF gridex_ediel_retention.invoice_file_sources
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$DECLARE spec record;row record;s gridex_ediel_retention.invoice_file_sources%rowtype;l jsonb;BEGIN
 LOCK TABLE public.customer_invoice_documents,public.invoice_documents,public.customer_invoices IN SHARE MODE;
 FOR spec IN SELECT * FROM gridex_ediel_retention.invoice_file_catalog ORDER BY retention_class LOOP
  IF EXISTS(SELECT FROM pg_class WHERE oid=('public.'||spec.source_table)::regclass) THEN
   FOR row IN EXECUTE format('SELECT id FROM public.%I x WHERE coalesce(to_jsonb(x)->>%L,'''') NOT IN($1,$2,$3) AND (position($2 IN coalesce(to_jsonb(x)->>''public_url'',''''))>0 OR position($2 IN coalesce(to_jsonb(x)->>''pdf_url'',''''))>0)',spec.source_table,spec.body_column) USING path,bucket||'/'||path,'storage://'||bucket||'/'||path LOOP RAISE EXCEPTION 'invoice_file_remote_or_ambiguous_shared_copy_held';END LOOP;
  END IF;
  FOR row IN EXECUTE format('SELECT id,company_id FROM public.%I WHERE %I=$1 OR %I=$2 OR %I=$3 ORDER BY id',spec.source_table,spec.body_column,spec.body_column,spec.body_column) USING path,bucket||'/'||path,'storage://'||bucket||'/'||path LOOP
   SELECT * INTO s FROM gridex_ediel_retention.invoice_file_sources WHERE retention_class=spec.retention_class AND target_id=row.id AND company_id=row.company_id FOR SHARE;
   IF s.id IS NULL OR s.storage_bucket<>bucket OR s.storage_path<>path THEN RAISE EXCEPTION 'invoice_file_every_shared_reference_capture_required';END IF;RETURN NEXT s;
  END LOOP;
 END LOOP;END$_$;` },
] as const

// Actual root-observed provider source, no application/JWT value is captured.
const authUID = "CREATE OR REPLACE FUNCTION auth.uid()\n RETURNS uuid\n LANGUAGE sql\n STABLE\nAS $function$\n  select \n  coalesce(\n    nullif(current_setting('request.jwt.claim.sub', true), ''),\n    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')\n  )::uuid\n$function$\n;"

// Captured complete immutable PR8690051681 SQL, SHA2151204a… . This avoids
// sibling/private files or requiring unmerged869 source at standalone test time.
const authorityForward = String.raw`-- Recheck selected authority after the three ordered retention BEFORE guards'
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
`

const policyDDL = [
  "CREATE POLICY customer_documents_storage_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING ((bucket_id = 'customer-documents'::text) AND gridex_private.customer_document_path_allows(name, 'write'::text));",
  "CREATE POLICY customer_documents_storage_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'customer-documents'::text) AND gridex_private.customer_document_path_allows(name, 'write'::text));",
  "CREATE POLICY customer_documents_storage_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'customer-documents'::text) AND gridex_private.customer_document_path_allows(name, 'read'::text));",
  "CREATE POLICY customer_documents_storage_service_role_all ON storage.objects AS PERMISSIVE FOR ALL TO service_role USING (bucket_id = 'customer-documents'::text) WITH CHECK (bucket_id = 'customer-documents'::text);",
  "CREATE POLICY customer_documents_storage_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING ((bucket_id = 'customer-documents'::text) AND gridex_private.customer_document_path_allows(name, 'write'::text)) WITH CHECK ((bucket_id = 'customer-documents'::text) AND gridex_private.customer_document_path_allows(name, 'write'::text));",
  "CREATE POLICY grid_owner_agreements_platform_read ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC USING ((bucket_id = 'grid-owner-agreements'::text) AND (EXISTS ( SELECT 1\n   FROM (user_roles ur\n     JOIN roles r ON ((r.id = ur.role_id)))\n  WHERE ((ur.user_id = auth.uid()) AND (COALESCE(ur.is_active, true) = true) AND (lower(COALESCE(r.key, r.name, ''::text)) = ANY (ARRAY['super_admin'::text, 'superadmin'::text, 'platform_admin'::text]))))));",
  "CREATE POLICY grid_owner_agreements_platform_write ON storage.objects AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((bucket_id = 'grid-owner-agreements'::text) AND (EXISTS ( SELECT 1\n   FROM (user_roles ur\n     JOIN roles r ON ((r.id = ur.role_id)))\n  WHERE ((ur.user_id = auth.uid()) AND (COALESCE(ur.is_active, true) = true) AND (lower(COALESCE(r.key, r.name, ''::text)) = ANY (ARRAY['super_admin'::text, 'superadmin'::text, 'platform_admin'::text]))))));"
]

// Captured exact post865 invoice-current DDL, bc75b25c10897cbfcea16173083bbb9d0b845d8c;
// body259ef215… . It is a declared successor fixture, never taken from GEN.
const postInvoiceCurrent = String.raw`CREATE OR REPLACE FUNCTION gridex_ediel_retention.invoice_file_current_v1(d gridex_ediel_retention.invoice_file_decisions) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$DECLARE r gridex_ediel_retention.invoice_file_reviews%rowtype;basis jsonb;p jsonb;BEGIN
 SELECT * INTO r FROM gridex_ediel_retention.invoice_file_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) IS NOT TRUE OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.invoice_copy_evidence') IS NOT TRUE THEN RETURN NULL;END IF;
 basis:=gridex_ediel_retention.invoice_file_basis_v1(d.company_id,d.retention_class,d.target_id);p:=gridex_ediel_retention.invoice_file_receipt_v1(d);
 -- Basis/issuer reads may wait; use the same reviewer predicates afterwards.
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) IS NOT TRUE OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.invoice_copy_evidence') IS NOT TRUE THEN RETURN NULL;END IF;
 IF p IS NULL OR (p->>'retainUntil')::timestamptz>clock_timestamp() OR basis->>'targetHash' IS DISTINCT FROM d.target_hash OR basis->>'scopeHash' IS DISTINCT FROM d.scope_hash OR basis->>'sourceHash' IS DISTINCT FROM d.source_hash OR basis->>'allIncludedScopesClosed' IS DISTINCT FROM 'true' OR p->>'periodStart' IS DISTINCT FROM basis->>'periodStart' OR p->>'periodEnd' IS DISTINCT FROM basis->>'periodEnd' THEN RETURN NULL;END IF;RETURN r.id;END$$;`

function definition(source: string, name: string) {
  const start = source.search(new RegExp('CREATE(?: OR REPLACE)? FUNCTION ' + name.replaceAll('.', '[.]') + '[(]', 'i'))
  if (start < 0) throw new Error('Missing immutable definition: ' + name)
  const marker = /AS +([$][^$]*[$])/i.exec(source.slice(start))
  if (!marker) throw new Error('Missing definition delimiter: ' + name)
  const bodyStart = start + marker.index + marker[0].length, end = source.indexOf(marker[1], bodyStart)
  if (end < 0) throw new Error('Unterminated definition: ' + name)
  const tail = source.slice(end + marker[1].length), terminator = tail.indexOf(';')
  if (terminator < 0 || tail.slice(0, terminator).trim()) throw new Error('Missing definition terminator: ' + name)
  return { ddl: source.slice(start, end + marker[1].length + terminator + 1), body: source.slice(bodyStart, end) }
}
function replaceOnce(value: string, before: string, after: string) {
  if (value.split(before).length !== 2) throw new Error('Immutable replacement count mismatch')
  return value.replace(before, () => after)
}
function originalGuard(index: number) {
  const fullName = 'gridex_ediel_retention.' + names[index]
  let ddl = definition(index === 0 ? historical.content : index === 1 ? historical.contract : historical.invoice, fullName).ddl
  if (index === 0) ddl = replaceOnce(ddl, "gridex_ediel_retention.permission_v1(t.company_id,actor,'communication.write')", 'gridex_ediel_retention.class_permission_v1(t.company_id,actor,t.retention_class)')
  if (index < 2) ddl = replaceOnce(ddl, 'auth.uid()', 'public.ediel_retention_session_actor_v1()')
  expect(hash(definition(ddl, fullName).body)).toBe(preHashes[index])
  return ddl
}
function sourceTable(name: string) {
  const start = schema.indexOf('CREATE TABLE ' + name + ' (')
  if (start < 0) throw new Error('Missing unchanged source table: ' + name)
  return schema.slice(start, schema.indexOf('\n);', start) + 3)
}
function canonicalTriggers() {
  return [historical.content, historical.contract, historical.invoice].map(source => {
    const ddl = source.match(/^CREATE TRIGGER \w+ BEFORE INSERT OR UPDATE OR DELETE ON storage\.objects[^;]+;/m)?.[0]
    if (!ddl) throw new Error('Missing immutable canonical trigger')
    return ddl
  })
}
let db: PGlite
async function snapshot(includeTargets = true) {
  const excluded = includeTargets ? [] : names.map(n => 'gridex_ediel_retention.' + n)
  const catalog = (await db.query<{ state: unknown }>(`SELECT jsonb_build_object(
    'roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY oid) FROM pg_roles r),
    'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY oid) FROM pg_auth_members m),
    'namespaces',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_namespace n),
    'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','auth','storage','fixture','gridex_ediel_retention') AND NOT(n.nspname||'.'||p.proname=ANY($1::text[]))),
    'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t WHERE NOT(tgname=ANY($2::text[]))),
    'objectsProfile',(SELECT to_jsonb(c) FROM pg_class c WHERE c.oid='storage.objects'::regclass),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p),
    'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_attrdef d),
    'business',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM fixture.business t),
    'storage',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM storage.objects t),
    'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY sequence) FROM fixture.visits t)
  ) AS state`, [excluded, includeTargets ? [] : triggerNames])).rows[0].state
  const retention: Record<string, unknown> = {}
  for (const name of relationNames) retention[name] = (await db.query('SELECT to_jsonb(t) value FROM gridex_ediel_retention.' + name + ' t ORDER BY to_jsonb(t)::text')).rows
  return { catalog, retention }
}
async function targetState() {
  return (await db.query<{ signature: string; body_hash: string }>(`SELECT p.oid::regprocedure::text signature,encode(sha256(convert_to(prosrc,'UTF8')),'hex') body_hash
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname=ANY($1::text[]) ORDER BY array_position($1::text[],p.proname)`, [names])).rows
}
async function run(sql = forward, actor = 'postgres') {
  await db.exec('SET SESSION AUTHORIZATION ' + actor)
  try { await db.exec(sql) }
  catch (error) { await db.exec('ROLLBACK;SET SESSION AUTHORIZATION supabase_admin'); throw error }
  await db.exec('SET SESSION AUTHORIZATION supabase_admin')
}
async function bootstrap() {
  db = new PGlite()
  await db.exec(`CREATE ROLE fixture_setup_admin LOGIN SUPERUSER;SET SESSION AUTHORIZATION fixture_setup_admin;ALTER ROLE postgres RENAME TO supabase_admin;SET SESSION AUTHORIZATION supabase_admin;
    CREATE ROLE postgres LOGIN NOSUPERUSER INHERIT CREATEROLE CREATEDB REPLICATION BYPASSRLS;
    CREATE ROLE ${owner} NOLOGIN NOINHERIT BYPASSRLS;
    CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT;CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;CREATE ROLE dashboard_user;
    CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    ALTER DATABASE postgres OWNER TO postgres;ALTER SCHEMA public OWNER TO postgres;
    CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin;
    CREATE SCHEMA gridex_ediel_retention AUTHORIZATION ${owner};CREATE SCHEMA fixture;
    CREATE TABLE storage.buckets(id text PRIMARY KEY);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,owner uuid);
    ALTER TABLE storage.objects OWNER TO supabase_storage_admin;ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE TABLE fixture.business(id integer PRIMARY KEY,value text);INSERT INTO fixture.business VALUES(1,'SYNTHETIC unchanged business');
    CREATE TABLE fixture.visits(sequence bigint GENERATED ALWAYS AS IDENTITY,operation text);
    -- Explicit inert sentinels model existing provider triggers; no claim about
    -- the managed provider trigger implementation or physical deletion rules.
    CREATE FUNCTION storage.protect_delete() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture.visits(operation) VALUES('DELETE statement');RETURN NULL;END$$;
    CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture.visits(operation) VALUES('UPDATE row');RETURN NEW;END$$;
    ALTER FUNCTION storage.protect_delete() OWNER TO supabase_storage_admin;ALTER FUNCTION storage.update_updated_at_column() OWNER TO supabase_storage_admin;
    CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
    CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();
    CREATE TABLE public.ediel_message_payloads(encrypted_payload_ref text,metadata jsonb NOT NULL DEFAULT '{}');
    CREATE TABLE public.customer_contract_documents(storage_bucket text,storage_path text);ALTER TABLE public.customer_contract_documents OWNER TO postgres;ALTER TABLE public.customer_contract_documents ENABLE ROW LEVEL SECURITY;ALTER TABLE public.ediel_message_payloads OWNER TO postgres;ALTER TABLE public.ediel_message_payloads ENABLE ROW LEVEL SECURITY;
    CREATE TABLE public.roles(id uuid,key text,name text);CREATE TABLE public.user_roles(user_id uuid,role_id uuid,is_active boolean);
    CREATE SCHEMA gridex_private;
    CREATE FUNCTION gridex_private.customer_document_path_allows(text,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    ${authUID}
    ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;GRANT EXECUTE ON FUNCTION auth.uid() TO dashboard_user;
    SET check_function_bodies=off;`)
  for (const name of relationNames) await db.exec(sourceTable('gridex_ediel_retention.' + name))
  for (const row of dependencies) {
    expect(hash(definition(row.ddl, row.signature.split('(')[0]).body)).toBe(row.bodyHash)
    await db.exec(row.ddl)
    await db.exec(`ALTER FUNCTION ${row.signature} OWNER TO ${row.owner};REVOKE ALL ON FUNCTION ${row.signature} FROM PUBLIC,anon,authenticated,service_role;`)
    if (row.owner === 'postgres') await db.exec(`GRANT EXECUTE ON FUNCTION ${row.signature} TO ${owner}`)
  }
  // The changed invoice-current BEFORE comes from immutable71000, never GEN.
  const beforeCurrent = definition(historical.invoice, 'gridex_ediel_retention.invoice_file_current_v1')
  expect(hash(beforeCurrent.body)).toBe('d719359fff25150bdd326b0df579385a4d6f1975e45d88023695d58ddff19c9d')
  await db.exec(beforeCurrent.ddl)
  await db.exec(`ALTER FUNCTION gridex_ediel_retention.invoice_file_current_v1(gridex_ediel_retention.invoice_file_decisions) OWNER TO ${owner};REVOKE ALL ON FUNCTION gridex_ediel_retention.invoice_file_current_v1(gridex_ediel_retention.invoice_file_decisions) FROM PUBLIC;
    SET check_function_bodies=on;
    GRANT USAGE ON SCHEMA auth,storage,public,fixture,gridex_ediel_retention TO ${owner};
    GRANT USAGE ON SCHEMA auth,storage,gridex_ediel_retention TO postgres;
    GRANT SELECT,UPDATE ON storage.objects TO ${owner};GRANT TRIGGER ON storage.objects TO postgres;GRANT SELECT ON public.customer_contract_documents,public.ediel_message_payloads TO ${owner};
    GRANT ALL ON ALL TABLES IN SCHEMA fixture TO ${owner};GRANT USAGE ON ALL SEQUENCES IN SCHEMA fixture TO ${owner};`)
  for (const name of relationNames) await db.exec(`ALTER TABLE gridex_ediel_retention.${name} OWNER TO ${owner};ALTER TABLE gridex_ediel_retention.${name} ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_ediel_retention.${name} FORCE ROW LEVEL SECURITY;`)
  for (const sql of policyDDL) await db.exec(sql)
  await db.exec(`GRANT ${owner} TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
    SET SESSION AUTHORIZATION postgres;GRANT ${owner} TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;SET SESSION AUTHORIZATION supabase_admin;
    INSERT INTO storage.buckets SELECT unnest(ARRAY['fixture','ediel-files','customer-contract-documents','customer-documents','billing-exports','contract-pdfs','grid-owner-agreements']);
    INSERT INTO storage.objects(id,bucket_id,name) VALUES('00000000-0000-4000-8000-000000000001','fixture','SYNTHETIC unrelated object');`)
}


async function seedTargets(post = false, indices = [0, 1, 2], triggers = true) {
  for (const index of indices) {
    const ddl = post ? definition(authorityForward, 'gridex_ediel_retention.' + names[index]).ddl : originalGuard(index)
    await db.exec(ddl)
    await db.exec(`ALTER FUNCTION gridex_ediel_retention.${names[index]}() OWNER TO ${owner};REVOKE ALL ON FUNCTION gridex_ediel_retention.${names[index]}() FROM PUBLIC,anon,authenticated,service_role;`)
  }
  if (triggers) for (const index of indices) await db.exec(canonicalTriggers()[index])
}
async function rejected(sql = forward, code = '42501', actor = 'postgres') {
  const before = await snapshot()
  await expect(run(sql, actor)).rejects.toMatchObject({ code })
  expect(await snapshot()).toEqual(before)
}
async function canonical(expected: readonly string[]) {
  expect((await targetState()).map(row => row.body_hash)).toEqual(expected)
  const profiles = (await db.query<{ good: boolean; app_execute: boolean }>(`SELECT
    p.proowner=$2::regrole AND l.lanname='plpgsql' AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']
    AND p.pronargs=0 AND p.proargnames IS NULL AND p.proargmodes IS NULL AND p.proallargtypes IS NULL
    AND p.prorettype='trigger'::regtype AND NOT p.proretset AND NOT p.proisstrict AND NOT p.proleakproof
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.pronargdefaults=0 AND p.proargdefaults IS NULL
    AND p.provariadic=0 AND p.prosupport=0 AND p.procost=100 AND p.prorows=0
    AND (SELECT jsonb_agg(jsonb_build_array(a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type,a.is_grantable)) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)
      =jsonb_build_array(jsonb_build_array($2::text,$2::text,'EXECUTE',false)) AS good,
    has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE') OR has_function_privilege('postgres',p.oid,'EXECUTE') AS app_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='gridex_ediel_retention' AND p.proname=ANY($1::text[])`, [names, owner])).rows
  expect(profiles).toHaveLength(3)
  expect(profiles.every(row => row.good && !row.app_execute)).toBe(true)
  const triggers = (await db.query<{ tgname: string; good: boolean }>(`SELECT tgname,
    tgtype=31 AND tgenabled='O' AND NOT tgisinternal AND tgnargs=0 AND tgqual IS NULL AND tgconstraint=0
    AND tgconstrrelid=0 AND tgconstrindid=0 AND NOT tgdeferrable AND NOT tginitdeferred AND tgparentid=0
    AND tgattr=''::int2vector AND tgargs=''::bytea AND tgoldtable IS NULL AND tgnewtable IS NULL
    AND tgfoid=to_regprocedure('gridex_ediel_retention.'||($2::text[])[array_position($1::text[],tgname)]||'()') AS good
    FROM pg_trigger WHERE tgrelid='storage.objects'::regclass AND tgname=ANY($1::text[])`, [triggerNames, names])).rows
  expect(triggers).toHaveLength(3)
  expect(triggers.every(row => row.good)).toBe(true)
}

describe('strict missing retention Storage guard installation using actual SQL', () => {
  beforeAll(async () => {
    for (const [name, expected] of Object.entries({content:'3bd194eff1595b35b79478b7a1875bb0c042691956baae1e192c729f9af307e2',classAuthority:'f959f8fa359b3eee07fa6530580bf06e477cb1f6423be891cd9938f6f114e461',contract:'b78d093f625a476a990b3786e8a02c87d41176586f673c172bf21a8830488db2',bridge:'ea2d087bd5860778b4125eb5e1bd52fccb79a7cf991da92a55ce5e830b07571f',invoice:'1b07b113b8e48923326c6d2d0fce0dea0f5fdb515a76161c345b94b538ffa9e9'})) expect(hash(historical[name as keyof typeof historical])).toBe(expected)
    expect(hash(authorityForward)).toBe('2151204a44d45a1aa63005ffb804cf73e980f911ae015a09d6e4348f6cb10280')
    expect(hash(definition(authUID, 'auth.uid').body)).toBe('9ab5ea099e74ec09e83b1505c51a3647791195aed7c742dcc3f257dfc7d2f300')
    names.forEach((_, index) => originalGuard(index))
  })
  beforeEach(bootstrap, 30_000)
  afterEach(async () => { await db?.close() })
  it('I01 installs exactly the three canonical private PRE guards and row triggers from all-missing state', async () => {
    const before = await snapshot(false)
    expect(await targetState()).toEqual([])
    await run()
    await canonical(preHashes)
    expect((await db.query<{ tgname: string }>(`SELECT tgname FROM pg_trigger WHERE tgrelid='storage.objects'::regclass AND tgname=ANY($1::text[]) ORDER BY array_position($1::text[],tgname)`, [triggerNames])).rows.map(row => row.tgname)).toEqual(triggerNames)
    expect(await snapshot(false)).toEqual(before)
  })

  it('I02 accepts the complete canonical PRE state as an exact OID/metadata/row no-op', async () => {
    await seedTargets();const before = await snapshot();await run();await canonical(preHashes);expect(await snapshot()).toEqual(before)
  })
  it('I03 accepts the complete canonical POST869 state as an exact no-op without regressing bodies', async () => {
    await seedTargets(true);const before = await snapshot();await run();await canonical(postHashes);expect(await snapshot()).toEqual(before)
  })
  it('I04 repeats a new installation as a true no-op', async () => {
    await run();await canonical(preHashes);const before = await snapshot();await run();expect(await snapshot()).toEqual(before)
  })
  it.each([{indices:[0]}, {indices:[1,2]}])('I05 rejects a partial function/trigger subset %j unchanged', async ({indices}) => {
    await seedTargets(false, indices);await rejected()
  })
  it('I05 rejects complete functions with missing triggers and rejects mixed PRE/POST bodies', async () => {
    await seedTargets(false, [0, 1, 2], false);await rejected()
    for (const ddl of canonicalTriggers()) await db.exec(ddl)
    await db.exec(definition(authorityForward, 'gridex_ediel_retention.storage_guard_v1').ddl)
    await rejected()
  })
  it.each([
    ['body', `CREATE OR REPLACE FUNCTION gridex_ediel_retention.storage_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RETURN NEW;END$$;`],
    ['owner', 'ALTER FUNCTION gridex_ediel_retention.storage_guard_v1() OWNER TO postgres'],
    ['security', 'ALTER FUNCTION gridex_ediel_retention.storage_guard_v1() SECURITY INVOKER'],
    ['config', 'ALTER FUNCTION gridex_ediel_retention.storage_guard_v1() SET search_path=pg_catalog,pg_temp'],
    ['strict', 'ALTER FUNCTION gridex_ediel_retention.storage_guard_v1() STRICT'],
    ['volatile', 'ALTER FUNCTION gridex_ediel_retention.storage_guard_v1() STABLE'],
    ['cost', 'ALTER FUNCTION gridex_ediel_retention.storage_guard_v1() COST 200'],
    ['public ACL', 'GRANT EXECUTE ON FUNCTION gridex_ediel_retention.storage_guard_v1() TO PUBLIC'],
    ['app ACL', 'GRANT EXECUTE ON FUNCTION gridex_ediel_retention.storage_guard_v1() TO authenticated'],
    ['grantable ACL', 'GRANT EXECUTE ON FUNCTION gridex_ediel_retention.storage_guard_v1() TO gridex_ediel_retention_owner WITH GRANT OPTION'],
    ['overload', 'CREATE FUNCTION gridex_ediel_retention.storage_guard_v1(integer) RETURNS integer LANGUAGE sql AS $$SELECT 1$$;'],
  ])('I06 rejects unknown target %s profile without repairing it', async (_name, sql) => {
    await seedTargets();await db.exec(sql);await rejected()
  })
  it.each([
    ['disabled', 'ALTER TABLE storage.objects DISABLE TRIGGER ediel_retention_storage_guard'],
    ['always', 'ALTER TABLE storage.objects ENABLE ALWAYS TRIGGER ediel_retention_storage_guard'],
    ['renamed', 'ALTER TRIGGER ediel_retention_storage_guard ON storage.objects RENAME TO not_canonical'],
    ['wrong event', 'DROP TRIGGER ediel_retention_storage_guard ON storage.objects;CREATE TRIGGER ediel_retention_storage_guard BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.storage_guard_v1()'],
    ['statement', 'DROP TRIGGER ediel_retention_storage_guard ON storage.objects;CREATE TRIGGER ediel_retention_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_retention.storage_guard_v1()'],
    ['WHEN', 'DROP TRIGGER ediel_retention_storage_guard ON storage.objects;CREATE TRIGGER ediel_retention_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH ROW WHEN(true) EXECUTE FUNCTION gridex_ediel_retention.storage_guard_v1()'],
    ['args', "DROP TRIGGER ediel_retention_storage_guard ON storage.objects;CREATE TRIGGER ediel_retention_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.storage_guard_v1('unexpected')"],
    ['column', 'DROP TRIGGER ediel_retention_storage_guard ON storage.objects;CREATE TRIGGER ediel_retention_storage_guard BEFORE UPDATE OF name ON storage.objects FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.storage_guard_v1()'],
    ['function', 'DROP TRIGGER ediel_retention_storage_guard ON storage.objects;CREATE TRIGGER ediel_retention_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.contract_storage_guard_v1()'],
    ['extra attachment', 'CREATE TABLE fixture.other_objects(LIKE storage.objects);CREATE TRIGGER extra_guard BEFORE INSERT ON fixture.other_objects FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.storage_guard_v1()'],
  ])('I07 rejects noncanonical trigger %s without touching builtins', async (_name, sql) => {
    await seedTargets();await db.exec(sql);await rejected()
  })
  it.each([
    ['missing helper', 'DROP FUNCTION gridex_ediel_retention.class_permission_v1(uuid,uuid,text)'],
    ['helper header', 'ALTER FUNCTION public.ediel_retention_session_actor_v1() SECURITY INVOKER'],
    ['private execute', 'REVOKE EXECUTE ON FUNCTION public.ediel_retention_session_actor_v1() FROM gridex_ediel_retention_owner'],
    ['provider body', 'CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;'],
    ['column type', 'ALTER TABLE storage.objects ALTER COLUMN owner TYPE text USING owner::text'],
    ['column absent', 'ALTER TABLE gridex_ediel_retention.blob_tombstones DROP COLUMN storage_path'],
    ['table owner', 'ALTER TABLE gridex_ediel_retention.blob_tombstones OWNER TO postgres'],
  ])('I08 rejects unqualified direct dependency %s unchanged', async (_name, sql) => {
    await db.exec(sql);await rejected()
  })
  it.each([
    ['retowner login', 'ALTER ROLE gridex_ediel_retention_owner LOGIN'],
    ['retowner inherit', 'ALTER ROLE gridex_ediel_retention_owner INHERIT'],
    ['retowner superuser', 'ALTER ROLE gridex_ediel_retention_owner SUPERUSER'],
    ['retowner createrole', 'ALTER ROLE gridex_ediel_retention_owner CREATEROLE'],
    ['retowner bypass', 'ALTER ROLE gridex_ediel_retention_owner NOBYPASSRLS'],
    ['extra member', 'GRANT gridex_ediel_retention_owner TO authenticated WITH INHERIT FALSE,SET FALSE'],
    ['namespace owner', 'ALTER SCHEMA gridex_ediel_retention OWNER TO postgres'],
  ])('I09 rejects unexpected role/namespace %s without broadening capabilities', async (_name, sql) => {
    await db.exec(sql);await rejected()
  })
  it('I09 rejects a different actual installer session identity', async () => { await rejected(forward, '42501', 'supabase_admin') })
  it('I10 installs under non-super postgres without SET or inherited Storage-owner rights', async () => {
    expect((await db.query(`SELECT rolsuper,pg_has_role('postgres','supabase_storage_admin','SET') can_set,pg_has_role('postgres','supabase_storage_admin','USAGE') inherits FROM pg_roles WHERE rolname='postgres'`)).rows[0]).toEqual({rolsuper:false,can_set:false,inherits:false})
    await run();await canonical(preHashes)
  })
  it('I10 preserves the qualified installer profile without requiring unused CREATEDB or REPLICATION capabilities', async () => {
    await db.exec('ALTER ROLE postgres NOCREATEDB NOREPLICATION')
    const before = await snapshot(false)
    await run();await canonical(preHashes)
    expect(await snapshot(false)).toEqual(before)
  })
  it.each(['REVOKE TRIGGER ON storage.objects FROM postgres', 'REVOKE USAGE ON SCHEMA storage FROM postgres'])('I10 refuses unavailable existing installer capability: %s', async sql => { await db.exec(sql);await rejected() })
  it('I11 rolls back DDL and elevated membership on an actual late transaction fault', async () => {
    const faulted = replaceOnce(forward, '-- Restore existing membership exactly.', "RAISE EXCEPTION 'fixture_late_failure'; -- Restore existing membership exactly.")
    await rejected(faulted, 'P0001')
  })
  it('I11 rolls back new DDL when post-install metadata validation detects an extra grant', async () => {
    const faulted = replaceOnce(forward, '-- Validate exact target profiles.', 'GRANT EXECUTE ON FUNCTION gridex_ediel_retention.storage_guard_v1() TO authenticated; -- Validate exact target profiles.')
    await rejected(faulted)
  })
  it('I12 preserves arbitrary preexisting policies, builtins, unrelated ACL/comment/defaults and rows', async () => {
    await db.exec("CREATE FUNCTION fixture.unrelated() RETURNS text LANGUAGE sql AS $$SELECT 'SYNTHETIC unrelated'$$;GRANT EXECUTE ON FUNCTION fixture.unrelated() TO authenticated WITH GRANT OPTION;COMMENT ON FUNCTION fixture.unrelated() IS 'SYNTHETIC preserved comment';CREATE POLICY fixture_extra_read ON storage.objects FOR SELECT TO anon USING(false)")
    const before = await snapshot(false);await run();await canonical(preHashes);expect(await snapshot(false)).toEqual(before)
  })
  it('I13 admits the complete actual frozen869 forward after installation, then preserves its POST state', async () => {
    await run();await canonical(preHashes)
    const metadata = (await db.query(`SELECT to_jsonb(p)-'prosrc' profile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname=ANY($1::text[]) ORDER BY p.oid`, [names])).rows
    await run(authorityForward);await canonical(postHashes)
    expect((await db.query(`SELECT to_jsonb(p)-'prosrc' profile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname=ANY($1::text[]) ORDER BY p.oid`, [names])).rows).toEqual(metadata)
    const before = await snapshot();await run();expect(await snapshot()).toEqual(before)
  })
  it('I14 keeps ordinary non-target INSERT/UPDATE/DELETE and existing sentinel trigger effects', async () => {
    await run();await canonical(preHashes)
    await db.exec("INSERT INTO storage.objects(id,bucket_id,name) VALUES('00000000-0000-4000-8000-000000000002','fixture','SYNTHETIC ordinary');UPDATE storage.objects SET name='SYNTHETIC changed' WHERE id='00000000-0000-4000-8000-000000000002';DELETE FROM storage.objects WHERE id='00000000-0000-4000-8000-000000000002'")
    expect((await db.query('SELECT operation FROM fixture.visits ORDER BY sequence')).rows).toEqual([{operation:'UPDATE row'},{operation:'DELETE statement'}])
    expect((await db.query('SELECT name FROM storage.objects ORDER BY id')).rows).toEqual([{name:'SYNTHETIC unrelated object'}])
  })
  it('I14 the actual newly installed canonical MIME guard rejects a tombstoned INSERT unchanged', async () => {
    await run();await canonical(preHashes)
    await db.exec("INSERT INTO gridex_ediel_retention.blob_tombstones(retention_class,target_id,company_id,message_id,decision_id,review_id,source_hash,target_hash,byte_length,storage_path,actor_user_id) VALUES('transport_raw_mime_bytes','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000010',repeat('a',64),repeat('b',64),12,'SYNTHETIC tombstone','00000000-0000-4000-8000-000000000012')")
    const before = await snapshot()
    await expect(db.exec("INSERT INTO storage.objects(bucket_id,name) VALUES('ediel-files','SYNTHETIC tombstone')")).rejects.toThrow('ediel_storage_retention_object_tombstoned')
    expect(await snapshot()).toEqual(before)
  })

  it('I08 qualifies provider auth.uid through its actual postgres caller without requiring extra retowner auth USAGE', async () => {
    await db.exec('REVOKE USAGE ON SCHEMA auth FROM gridex_ediel_retention_owner')
    expect((await db.query(`SELECT has_schema_privilege($1,'auth','USAGE') allowed`, [owner])).rows[0]).toEqual({allowed:false})
    await run();await canonical(preHashes)
  })
  it('I08 rejects unknown dependency COST rather than just matching its body', async () => {
    await db.exec('ALTER FUNCTION gridex_ediel_retention.blob_basis_v1(uuid,text,uuid) COST 200');await rejected()
  })
  it.each(['public.customer_contract_documents','public.ediel_message_payloads'])('I08 refuses missing actual direct SELECT capability on %s', async relation => {
    await db.exec(`REVOKE SELECT ON ${relation} FROM ${owner}`);await rejected()
  })
  it.each([0,1])('I08 accepts only exact qualified historical permission epoch %i', async stage => {
    const row = dependencies.find(item => item.signature==='gridex_ediel_retention.permission_v1(uuid, uuid, text)')!
    let ddl = replaceOnce(row.ddl, "'ediel.retention.completed_review_reason','ediel.retention.audit_normalized19_cleanup'", "'ediel.retention.completed_review_reason'")
    if (stage===0) ddl = replaceOnce(ddl, "'ediel.retention.finance_decision_evidence','ediel.retention.completed_review_reason'", "'ediel.retention.finance_decision_evidence'")
    expect(hash(definition(ddl, 'gridex_ediel_retention.permission_v1').body)).toBe(['32c79a9f30939ab51637d1fbd3ca524766836ec6df5d2371d20e051d2601a51b','6bedde3f4c01c504eae815ba0895b0872603dd2f6d8adace45669b640db689c7'][stage])
    await db.exec(ddl.replace('CREATE FUNCTION ', 'CREATE OR REPLACE FUNCTION '));await run();await canonical(preHashes)
  })
  it('I08 accepts the exact separately qualified post865 invoice-current dependency without changing it', async () => {
    expect(hash(definition(postInvoiceCurrent, 'gridex_ediel_retention.invoice_file_current_v1').body)).toBe('259ef215edf8e783ea994e224ad4c3e5391026229287a2d9459f7201aaefa35f')
    await db.exec(postInvoiceCurrent);await run();await canonical(preHashes)
    expect((await db.query<{ body_hash: string }>("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') body_hash FROM pg_proc WHERE oid='gridex_ediel_retention.invoice_file_current_v1(gridex_ediel_retention.invoice_file_decisions)'::regprocedure")).rows[0].body_hash).toBe('259ef215edf8e783ea994e224ad4c3e5391026229287a2d9459f7201aaefa35f')
  })
  it('I06 unexpected non-API default ACL grant rolls back rather than becoming public installed authority', async () => {
    await db.exec(`CREATE ROLE fixture_observer;ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA gridex_ediel_retention GRANT EXECUTE ON FUNCTIONS TO fixture_observer`)
    await rejected()
  })
  it.each(['PARALLEL SAFE','LEAKPROOF'])('I06 rejects additional target header drift %s', async flag => {
    await seedTargets();await db.exec('ALTER FUNCTION gridex_ediel_retention.storage_guard_v1() '+flag);await rejected()
  })
  it('I05 rejects canonical trigger names without the three target functions', async () => {
    await db.exec('CREATE FUNCTION fixture.shadow_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;')
    for (const name of triggerNames) await db.exec(`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION fixture.shadow_guard()`)
    await rejected()
  })

  it('I11 a late extra same-name overload outside the exact three objects rolls back the entire installation', async () => {
    const faulted = replaceOnce(forward, '-- Validate exact target profiles.', 'CREATE FUNCTION gridex_ediel_retention.storage_guard_v1(integer) RETURNS integer LANGUAGE sql AS $$SELECT 1$$; -- Validate exact target profiles.')
    await rejected(faulted)
  })
})
