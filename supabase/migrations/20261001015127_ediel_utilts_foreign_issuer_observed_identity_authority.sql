BEGIN;
-- U203 p72 / U505 p77 and frozen prior-identity amendment: over time, all
-- applications of the actual legal issuer; no annual reset or expiry of IDs.
-- This migration seeds NO foreign issuer, mandate, history or retention proof.
CREATE SCHEMA gridex_utilts_issuer;
REVOKE ALL ON SCHEMA gridex_utilts_issuer FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_utilts_issuer.namespaces(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),environment text NOT NULL CHECK(environment IN('test','production')),
 registry_actor_key text NOT NULL CHECK(length(registry_actor_key)>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(environment,registry_actor_key)
);
CREATE TABLE gridex_utilts_issuer.issuer_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),namespace_id uuid NOT NULL REFERENCES gridex_utilts_issuer.namespaces(id),
 legal_identity jsonb NOT NULL CHECK(jsonb_typeof(legal_identity)='array' AND jsonb_array_length(legal_identity)>=3),
 registry_version text NOT NULL CHECK(length(registry_version)>0),registry_original_uri text NOT NULL CHECK(length(registry_original_uri)>0),
 registry_original_bytes bytea NOT NULL CHECK(octet_length(registry_original_bytes)>0),registry_sha256 text NOT NULL CHECK(registry_sha256=encode(sha256(registry_original_bytes),'hex')),
 legal_decision_ref text NOT NULL CHECK(length(legal_decision_ref)>0),legal_decision_version text NOT NULL CHECK(length(legal_decision_version)>0),
 legal_decision_bytes bytea NOT NULL CHECK(octet_length(legal_decision_bytes)>0),legal_decision_sha256 text NOT NULL CHECK(legal_decision_sha256=encode(sha256(legal_decision_bytes),'hex')),
 valid_from timestamptz NOT NULL,valid_until timestamptz,approved_at timestamptz NOT NULL,approved_by uuid NOT NULL,
 CHECK(valid_until IS NULL OR valid_until>valid_from)
);
CREATE TABLE gridex_utilts_issuer.transport_mandate_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),issuer_version_id uuid NOT NULL REFERENCES gridex_utilts_issuer.issuer_versions(id),
 transport_sender jsonb NOT NULL CHECK(jsonb_typeof(transport_sender)='array' AND jsonb_array_length(transport_sender)>=1),
 mandate_ref text NOT NULL CHECK(length(mandate_ref)>0),mandate_version text NOT NULL CHECK(length(mandate_version)>0),
 mandate_original_uri text NOT NULL CHECK(length(mandate_original_uri)>0),mandate_original_bytes bytea NOT NULL CHECK(octet_length(mandate_original_bytes)>0),
 mandate_sha256 text NOT NULL CHECK(mandate_sha256=encode(sha256(mandate_original_bytes),'hex')),
 valid_from timestamptz NOT NULL,valid_until timestamptz,approved_at timestamptz NOT NULL,approved_by uuid NOT NULL,
 CHECK(valid_until IS NULL OR valid_until>valid_from)
);
CREATE TABLE gridex_utilts_issuer.revocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),namespace_id uuid NOT NULL REFERENCES gridex_utilts_issuer.namespaces(id),
 issuer_version_id uuid REFERENCES gridex_utilts_issuer.issuer_versions(id),mandate_version_id uuid REFERENCES gridex_utilts_issuer.transport_mandate_versions(id),
 effective_at timestamptz NOT NULL,decision_ref text NOT NULL CHECK(length(decision_ref)>0),decision_version text NOT NULL CHECK(length(decision_version)>0),
 decision_bytes bytea NOT NULL CHECK(octet_length(decision_bytes)>0),decision_sha256 text NOT NULL CHECK(decision_sha256=encode(sha256(decision_bytes),'hex')),
 approved_at timestamptz NOT NULL,approved_by uuid NOT NULL,CHECK(num_nonnulls(issuer_version_id,mandate_version_id)=1)
);
CREATE TABLE gridex_utilts_issuer.source_admissions(
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL,environment text NOT NULL,
 source_payload_hash text NOT NULL CHECK(source_payload_hash~'^[a-f0-9]{64}$'),observed_at timestamptz NOT NULL,
 namespace_id uuid REFERENCES gridex_utilts_issuer.namespaces(id),issuer_version_id uuid REFERENCES gridex_utilts_issuer.issuer_versions(id),
 mandate_version_id uuid REFERENCES gridex_utilts_issuer.transport_mandate_versions(id),namespace_epoch bigint,
 message_reference text,transactions jsonb NOT NULL,message_reference_collision boolean NOT NULL,transaction_reference_collisions jsonb NOT NULL,
 hold_reason text,CHECK((namespace_id IS NULL)=(issuer_version_id IS NULL)),CHECK((namespace_id IS NULL)=(mandate_version_id IS NULL)),CHECK((namespace_id IS NULL)=(namespace_epoch IS NULL))
);
CREATE TABLE gridex_utilts_issuer.observed_identifiers(
 source_message_id uuid NOT NULL REFERENCES gridex_utilts_issuer.source_admissions(source_message_id),namespace_id uuid NOT NULL REFERENCES gridex_utilts_issuer.namespaces(id),
 field_number text NOT NULL CHECK(field_number IN('203','505')),physical_reference text NOT NULL CHECK(length(physical_reference)>0),transaction_index integer NOT NULL CHECK(transaction_index>=-1),
 PRIMARY KEY(source_message_id,field_number,transaction_index)
);
CREATE INDEX observed_identifiers_exact_namespace ON gridex_utilts_issuer.observed_identifiers(namespace_id,field_number,physical_reference);
-- A reviewed normalized evidence contract, not an invented external registry
-- format. Original bytes/versions, deletion history and a lawful retention
-- decision must independently exist. An empty LOCAL observed table grants no
-- absence. The explicitly reviewed manifest describes OTHER prior issued
-- originals and includes each authentic issuance reference. Identical payload
-- hashes do not prove self/replay identity and never exclude a collision.
-- Each external decision is bound to one real prospective source and
-- its immutable issuer/mandate/epoch; nothing can populate historical sources.
CREATE TABLE gridex_utilts_issuer.source_absence_grounds(
 source_message_id uuid PRIMARY KEY REFERENCES gridex_utilts_issuer.source_admissions(source_message_id),source_payload_hash text NOT NULL,
 namespace_id uuid NOT NULL REFERENCES gridex_utilts_issuer.namespaces(id),issuer_version_id uuid NOT NULL REFERENCES gridex_utilts_issuer.issuer_versions(id),
 mandate_version_id uuid NOT NULL REFERENCES gridex_utilts_issuer.transport_mandate_versions(id),namespace_epoch bigint NOT NULL,
 scope text NOT NULL CHECK(scope='over_time_all_issuer_applications'),
 identifiers_scope text NOT NULL CHECK(identifiers_scope='other_prior_issued_originals'),
 registry_version text NOT NULL CHECK(length(registry_version)>0),registry_original_uri text NOT NULL CHECK(length(registry_original_uri)>0),
 registry_original_bytes bytea NOT NULL CHECK(octet_length(registry_original_bytes)>0),registry_sha256 text NOT NULL CHECK(registry_sha256=encode(sha256(registry_original_bytes),'hex')),
 deletion_history_version text NOT NULL CHECK(length(deletion_history_version)>0),deletion_history_original_uri text NOT NULL CHECK(length(deletion_history_original_uri)>0),
 deletion_history_bytes bytea NOT NULL CHECK(octet_length(deletion_history_bytes)>0),deletion_history_sha256 text NOT NULL CHECK(deletion_history_sha256=encode(sha256(deletion_history_bytes),'hex')),
 retention_decision_ref text NOT NULL CHECK(length(retention_decision_ref)>0),retention_decision_version text NOT NULL CHECK(length(retention_decision_version)>0),
 retention_decision_bytes bytea NOT NULL CHECK(octet_length(retention_decision_bytes)>0),retention_decision_sha256 text NOT NULL CHECK(retention_decision_sha256=encode(sha256(retention_decision_bytes),'hex')),
 normalized_issued_identifiers jsonb NOT NULL CHECK(jsonb_typeof(normalized_issued_identifiers)='array'),
 approval_ref text NOT NULL CHECK(length(approval_ref)>0),approval_version text NOT NULL CHECK(length(approval_version)>0),approval_bytes bytea NOT NULL CHECK(octet_length(approval_bytes)>0),
 approval_sha256 text NOT NULL CHECK(approval_sha256=encode(sha256(approval_bytes),'hex')),approved_at timestamptz NOT NULL,approved_by uuid NOT NULL
);
CREATE FUNCTION gridex_utilts_issuer.lock_namespace_v1(p_namespace uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF p_namespace IS NULL THEN RAISE EXCEPTION 'utilts_issuer_namespace_required' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ediel-utilts-issuer:'||p_namespace::text,0));
END $$;
-- Approval and admission serialize by the full legal identity even when
-- competing registry versions would name different namespace rows. Namespace
-- locks then serialize issuer-wide observations, grounds and fresh effects.
CREATE FUNCTION gridex_utilts_issuer.lock_legal_identity_v1(p_environment text,p_identity jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF p_environment IS NULL OR p_identity IS NULL THEN RAISE EXCEPTION 'utilts_issuer_identity_required' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ediel-utilts-legal-issuer:'||p_environment||':'||p_identity::text,0));
END $$;
CREATE FUNCTION gridex_utilts_issuer.fence_ground_insert_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE ns uuid;issuer gridex_utilts_issuer.issuer_versions%rowtype;env text;identity jsonb;admission gridex_utilts_issuer.source_admissions%rowtype;item jsonb;
BEGIN
 IF TG_TABLE_NAME='transport_mandate_versions' THEN SELECT * INTO issuer FROM gridex_utilts_issuer.issuer_versions WHERE id=NEW.issuer_version_id;ns:=issuer.namespace_id;identity:=issuer.legal_identity;
 ELSE ns:=NEW.namespace_id;IF TG_TABLE_NAME='issuer_versions' THEN identity:=NEW.legal_identity;END IF;END IF;
 IF identity IS NOT NULL THEN SELECT environment INTO env FROM gridex_utilts_issuer.namespaces WHERE id=ns;PERFORM gridex_utilts_issuer.lock_legal_identity_v1(env,identity);END IF;
 PERFORM gridex_utilts_issuer.lock_namespace_v1(ns);
 IF TG_TABLE_NAME='revocations' THEN
  IF NOT EXISTS(SELECT FROM gridex_utilts_issuer.issuer_versions v WHERE v.namespace_id=ns AND (v.id=NEW.issuer_version_id OR EXISTS(SELECT FROM gridex_utilts_issuer.transport_mandate_versions m WHERE m.id=NEW.mandate_version_id AND m.issuer_version_id=v.id))) THEN RAISE EXCEPTION 'utilts_issuer_revocation_scope_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='source_absence_grounds' THEN
  SELECT * INTO admission FROM gridex_utilts_issuer.source_admissions WHERE source_message_id=NEW.source_message_id;
  IF admission.namespace_id IS NULL OR ROW(NEW.namespace_id,NEW.issuer_version_id,NEW.mandate_version_id,NEW.namespace_epoch,NEW.source_payload_hash)
   IS DISTINCT FROM ROW(admission.namespace_id,admission.issuer_version_id,admission.mandate_version_id,admission.namespace_epoch,admission.source_payload_hash) THEN RAISE EXCEPTION 'utilts_issuer_absence_scope_invalid' USING ERRCODE='23514'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.normalized_issued_identifiers) LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['field','reference','originalIssuanceReference','originalSourceSha256','originEvidenceSha256']<>'{}'::jsonb
    OR jsonb_typeof(item->'field') IS DISTINCT FROM 'string' OR coalesce(item->>'field','') NOT IN('203','505') OR jsonb_typeof(item->'reference') IS DISTINCT FROM 'string' OR length(item->>'reference')=0
    OR jsonb_typeof(item->'originalIssuanceReference') IS DISTINCT FROM 'string' OR length(item->>'originalIssuanceReference')=0
    OR jsonb_typeof(item->'originalSourceSha256') IS DISTINCT FROM 'string' OR coalesce(item->>'originalSourceSha256','') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(item->'originEvidenceSha256') IS DISTINCT FROM 'string' OR coalesce(item->>'originEvidenceSha256','') !~ '^[a-f0-9]{64}$'
   THEN RAISE EXCEPTION 'utilts_issuer_history_projection_invalid' USING ERRCODE='23514';END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION gridex_utilts_issuer.capture_insert_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE src gridex_received_sources.sources%rowtype;wire jsonb;tokens jsonb;token jsonb;legal jsonb;sender jsonb;first_detail integer;v gridex_utilts_issuer.issuer_versions%rowtype;mandate gridex_utilts_issuer.transport_mandate_versions%rowtype;
 matches integer;epoch bigint;txs jsonb:='[]';collisions jsonb:='[]';ref text;duplicate_message boolean:=false;ordinal integer:=0;reason text:='ediel_utilts_foreign_issuer_basis_unavailable';
BEGIN
 IF NEW.direction IS DISTINCT FROM 'inbound' OR NEW.message_standard IS DISTINCT FROM 'edifact' OR NEW.message_family IS DISTINCT FROM 'UTILTS' THEN RETURN NEW;END IF;
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=NEW.id AND company_id=NEW.company_id AND environment=NEW.environment AND origin='database_insert';
 IF src.source_message_id IS NULL OR src.received_context->>'contextOrigin' IS DISTINCT FROM 'database_insert' OR src.raw_payload IS DISTINCT FROM NEW.raw_payload
  OR src.payload_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex') THEN RETURN NEW;END IF;
 wire:=gridex_ack_authority.wire_v1(NEW.raw_payload);tokens:=gridex_utilts_binding.wire_tokens_v1(NEW.raw_payload);
 IF wire IS NOT NULL AND tokens IS NOT NULL AND wire->>'family'='UTILTS' AND wire->>'code' IS DISTINCT FROM 'ERR' THEN
  SELECT min((x->>'index')::integer) INTO first_detail FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='IDE';
  SELECT count(*) INTO matches FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS' AND (first_detail IS NULL OR (x->>'index')::integer<first_detail);
  IF matches=1 THEN SELECT x#>'{elements,2}' INTO legal FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS' AND (first_detail IS NULL OR (x->>'index')::integer<first_detail);END IF;
  sender:=wire->'sender';ref:=wire->>'document';
  FOR token IN SELECT value FROM jsonb_array_elements(tokens) x(value) WHERE value->>'tag'='IDE' ORDER BY (value->>'index')::integer LOOP
   txs:=txs||jsonb_build_array(jsonb_build_object('transactionIndex',ordinal,'transactionId',token#>>'{elements,2,0}'));ordinal:=ordinal+1;
  END LOOP;
  IF legal IS NOT NULL THEN PERFORM gridex_utilts_issuer.lock_legal_identity_v1(NEW.environment,legal);END IF;
  SELECT count(*) INTO matches FROM gridex_utilts_issuer.issuer_versions i JOIN gridex_utilts_issuer.namespaces n ON n.id=i.namespace_id JOIN gridex_utilts_issuer.transport_mandate_versions m ON m.issuer_version_id=i.id
   WHERE n.environment=NEW.environment AND i.legal_identity=legal AND m.transport_sender=sender
    AND i.approved_at<=src.captured_at AND m.approved_at<=src.captured_at AND i.valid_from<=src.captured_at AND (i.valid_until IS NULL OR src.captured_at<i.valid_until)
    AND m.valid_from<=src.captured_at AND (m.valid_until IS NULL OR src.captured_at<m.valid_until)
    AND NOT EXISTS(SELECT FROM gridex_utilts_issuer.revocations r WHERE r.namespace_id=n.id AND (r.issuer_version_id=i.id OR r.mandate_version_id=m.id) AND r.approved_at<=src.captured_at AND r.effective_at<=src.captured_at);
  IF matches=1 THEN
   SELECT i.* INTO v FROM gridex_utilts_issuer.issuer_versions i JOIN gridex_utilts_issuer.namespaces n ON n.id=i.namespace_id JOIN gridex_utilts_issuer.transport_mandate_versions m ON m.issuer_version_id=i.id
    WHERE n.environment=NEW.environment AND i.legal_identity=legal AND m.transport_sender=sender
     AND i.approved_at<=src.captured_at AND m.approved_at<=src.captured_at AND i.valid_from<=src.captured_at AND (i.valid_until IS NULL OR src.captured_at<i.valid_until)
     AND m.valid_from<=src.captured_at AND (m.valid_until IS NULL OR src.captured_at<m.valid_until)
     AND NOT EXISTS(SELECT FROM gridex_utilts_issuer.revocations r WHERE r.namespace_id=n.id AND (r.issuer_version_id=i.id OR r.mandate_version_id=m.id) AND r.approved_at<=src.captured_at AND r.effective_at<=src.captured_at);
   SELECT * INTO mandate FROM gridex_utilts_issuer.transport_mandate_versions m WHERE m.issuer_version_id=v.id AND m.transport_sender=sender AND m.approved_at<=src.captured_at AND m.valid_from<=src.captured_at AND (m.valid_until IS NULL OR src.captured_at<m.valid_until)
    AND NOT EXISTS(SELECT FROM gridex_utilts_issuer.revocations r WHERE r.mandate_version_id=m.id AND r.approved_at<=src.captured_at AND r.effective_at<=src.captured_at);
   PERFORM gridex_utilts_issuer.lock_namespace_v1(v.namespace_id);
   -- Fence newly committed revocation/version observations after acquiring the
   -- same namespace lock as approval/revocation and first-effect consumers.
   IF EXISTS(SELECT FROM gridex_utilts_issuer.revocations r WHERE r.namespace_id=v.namespace_id AND (r.issuer_version_id=v.id OR r.mandate_version_id=mandate.id) AND r.approved_at<=src.captured_at AND r.effective_at<=src.captured_at) THEN v.id:=NULL;mandate.id:=NULL;v.namespace_id:=NULL;
   ELSE
    SELECT coalesce(max(a.namespace_epoch),0)+1 INTO epoch FROM gridex_utilts_issuer.source_admissions a WHERE a.namespace_id=v.namespace_id;
    duplicate_message:=ref IS NOT NULL AND EXISTS(SELECT FROM gridex_utilts_issuer.observed_identifiers o WHERE o.namespace_id=v.namespace_id AND o.field_number='203' AND o.physical_reference=ref);
    SELECT coalesce(jsonb_agg(own ORDER BY (own->>'transactionIndex')::integer),'[]') INTO collisions FROM jsonb_array_elements(txs) own WHERE EXISTS(SELECT FROM gridex_utilts_issuer.observed_identifiers o WHERE o.namespace_id=v.namespace_id AND o.field_number='505' AND o.physical_reference=own->>'transactionId');
    reason:='ediel_utilts_identity_history_coverage_unavailable';
   END IF;
  ELSIF matches>1 THEN reason:='ediel_utilts_foreign_issuer_binding_ambiguous';END IF;
 END IF;
 INSERT INTO gridex_utilts_issuer.source_admissions(source_message_id,company_id,environment,source_payload_hash,observed_at,namespace_id,issuer_version_id,mandate_version_id,namespace_epoch,message_reference,transactions,message_reference_collision,transaction_reference_collisions,hold_reason)
  VALUES(NEW.id,NEW.company_id,NEW.environment,src.payload_hash,src.captured_at,v.namespace_id,v.id,mandate.id,epoch,ref,txs,duplicate_message,collisions,reason);
 IF v.id IS NOT NULL THEN
  IF nullif(ref,'') IS NOT NULL THEN INSERT INTO gridex_utilts_issuer.observed_identifiers VALUES(NEW.id,v.namespace_id,'203',ref,-1);END IF;
  INSERT INTO gridex_utilts_issuer.observed_identifiers SELECT NEW.id,v.namespace_id,'505',own->>'transactionId',(own->>'transactionIndex')::integer FROM jsonb_array_elements(txs) own WHERE nullif(own->>'transactionId','') IS NOT NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gridex_utilts_issuer_capture AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_utilts_issuer.capture_insert_v1();
CREATE FUNCTION gridex_utilts_issuer.read_v1(p_company uuid,p_source uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;a gridex_utilts_issuer.source_admissions%rowtype;grounds gridex_utilts_issuer.source_absence_grounds%rowtype;known boolean;collisions jsonb;reason text;qualified boolean:=false;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source AND company_id=p_company AND direction='inbound' AND message_family='UTILTS' AND message_standard='edifact';
 IF m.id IS NULL THEN RAISE EXCEPTION 'utilts_issuer_source_scope_required' USING ERRCODE='23514';END IF;
 SELECT * INTO a FROM gridex_utilts_issuer.source_admissions WHERE source_message_id=m.id AND company_id=p_company AND environment=m.environment AND source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 reason:=coalesce(a.hold_reason,'ediel_utilts_historical_issuer_basis_unavailable');known:=coalesce(a.message_reference_collision,false);collisions:=coalesce(a.transaction_reference_collisions,'[]');
 IF a.namespace_id IS NOT NULL THEN
  SELECT * INTO grounds FROM gridex_utilts_issuer.source_absence_grounds WHERE source_message_id=a.source_message_id AND source_payload_hash=a.source_payload_hash AND namespace_id=a.namespace_id AND issuer_version_id=a.issuer_version_id AND mandate_version_id=a.mandate_version_id AND namespace_epoch=a.namespace_epoch AND approved_at<=statement_timestamp();
  IF EXISTS(SELECT FROM gridex_utilts_issuer.revocations r WHERE r.namespace_id=a.namespace_id AND (r.issuer_version_id=a.issuer_version_id OR r.mandate_version_id=a.mandate_version_id) AND r.approved_at<=statement_timestamp() AND r.effective_at<=statement_timestamp()) THEN
   -- A revocation holds new positive effects; it cannot rewrite an
   -- authenticated collision observed under the original issuer admission.
   reason:='ediel_utilts_foreign_issuer_basis_revoked';
  ELSE
   IF grounds.source_message_id IS NOT NULL THEN
    known:=known OR EXISTS(SELECT FROM jsonb_array_elements(grounds.normalized_issued_identifiers) x WHERE x->>'field'='203' AND x->>'reference'=a.message_reference);
    SELECT coalesce(jsonb_agg(own ORDER BY (own->>'transactionIndex')::integer),'[]') INTO collisions FROM jsonb_array_elements(a.transactions) own WHERE a.transaction_reference_collisions @>jsonb_build_array(own) OR EXISTS(SELECT FROM jsonb_array_elements(grounds.normalized_issued_identifiers) x WHERE x->>'field'='505' AND x->>'reference'=own->>'transactionId');
    qualified:=true;reason:=NULL;
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('version',1,'companyId',p_company,'environment',m.environment,'sourceMessageId',m.id,'sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),
  'status',CASE WHEN qualified THEN 'qualified' ELSE 'held' END,'authorityVersionId',a.issuer_version_id,'namespaceEpoch',a.namespace_epoch::text,
  'messageReferenceCollision',known,'transactionReferenceCollisions',collisions,'holdReason',reason);
END $$;
CREATE FUNCTION public.gridex_read_utilts_issuer_identity_authority_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' AND session_user<>'service_role' AND coalesce(current_setting('role',true),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 RETURN gridex_utilts_issuer.read_v1(p_company_id,p_message_id);
END $$;
CREATE FUNCTION gridex_utilts_issuer.require_first_effect_v1(p_company uuid,p_source uuid,p_transaction text,p_disposition text,p_issue_codes jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE a gridex_utilts_issuer.source_admissions%rowtype;facts jsonb;
BEGIN
 SELECT * INTO a FROM gridex_utilts_issuer.source_admissions WHERE source_message_id=p_source AND company_id=p_company;
 IF a.namespace_id IS NOT NULL THEN PERFORM gridex_utilts_issuer.lock_namespace_v1(a.namespace_id);END IF;
 facts:=gridex_utilts_issuer.read_v1(p_company,p_source);
 IF p_disposition='accepted' AND (facts->>'status' IS DISTINCT FROM 'qualified' OR facts->'messageReferenceCollision' IS DISTINCT FROM 'false'::jsonb
  OR EXISTS(SELECT FROM jsonb_array_elements(facts->'transactionReferenceCollisions') x WHERE x->>'transactionId'=p_transaction)) THEN RAISE EXCEPTION 'utilts_issuer_identity_first_effect_held' USING ERRCODE='P0U01';END IF;
 IF p_issue_codes ? 'UTILTS_ISSUER_MESSAGE_REFERENCE_DUPLICATE' AND facts->'messageReferenceCollision' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'utilts_issuer_duplicate_source_proof_required' USING ERRCODE='P0U01';END IF;
 IF p_issue_codes ? 'UTILTS_ISSUER_TRANSACTION_REFERENCE_DUPLICATE' AND NOT EXISTS(SELECT FROM jsonb_array_elements(facts->'transactionReferenceCollisions') x WHERE x->>'transactionId'=p_transaction) THEN RAISE EXCEPTION 'utilts_issuer_duplicate_source_proof_required' USING ERRCODE='P0U01';END IF;
END $$;
-- This existing gateway is entered only for new own outcomes. Its public
-- consumption wrapper already preserves authentic same-source/raw committed
-- V1/V2 positive and finalized negative replay BEFORE this fresh-owner gate.
ALTER FUNCTION gridex_received_sources.require_utilts_transaction_v1(uuid,uuid,text,text,text,jsonb) RENAME TO require_utilts_transaction_before_issuer_v1;
CREATE FUNCTION gridex_received_sources.require_utilts_transaction_v1(p_company uuid,p_source uuid,p_transaction text,p_disposition text,p_response text,p_issue_codes jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM gridex_received_sources.require_utilts_transaction_before_issuer_v1(p_company,p_source,p_transaction,p_disposition,p_response,p_issue_codes);
 PERFORM gridex_utilts_issuer.require_first_effect_v1(p_company,p_source,p_transaction,p_disposition,p_issue_codes);
END $$;
-- Whole-header duplicate203 has no ACW/ownIDE reference. The complete
-- existing committed header owner remains the authority; namespace proof is
-- additionally required only for this actual issuer-duplicate diagnostic.
ALTER FUNCTION gridex_received_sources.require_utilts_header_v1(uuid,uuid) RENAME TO require_utilts_header_before_issuer_v1;
CREATE FUNCTION gridex_received_sources.require_utilts_header_v1(p_company uuid,p_source uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE result jsonb;facts jsonb;
BEGIN
 result:=gridex_received_sources.require_utilts_header_before_issuer_v1(p_company,p_source);
 SELECT facts_text::jsonb INTO facts FROM gridex_received_sources.validation_assessments WHERE id=(result->>'assessmentId')::uuid AND company_id=p_company AND source_message_id=p_source;
 IF facts->'reasonCodes' ? 'UTILTS_ISSUER_MESSAGE_REFERENCE_DUPLICATE' THEN
  PERFORM gridex_utilts_issuer.require_first_effect_v1(p_company,p_source,NULL,'guide_rejected',facts->'reasonCodes');
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.require_utilts_header_v1(uuid,uuid),gridex_received_sources.require_utilts_header_before_issuer_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE rel text;BEGIN
 FOREACH rel IN ARRAY ARRAY['namespaces','issuer_versions','transport_mandate_versions','revocations','source_admissions','observed_identifiers','source_absence_grounds'] LOOP
  EXECUTE format('ALTER TABLE gridex_utilts_issuer.%I ENABLE ROW LEVEL SECURITY',rel);EXECUTE format('ALTER TABLE gridex_utilts_issuer.%I FORCE ROW LEVEL SECURITY',rel);
  EXECUTE format('REVOKE ALL ON TABLE gridex_utilts_issuer.%I FROM PUBLIC,anon,authenticated,service_role',rel);
  EXECUTE format('CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_utilts_issuer.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',rel);
  EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_utilts_issuer.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',rel);
 END LOOP;
 FOREACH rel IN ARRAY ARRAY['issuer_versions','transport_mandate_versions','revocations','source_absence_grounds'] LOOP
  EXECUTE format('CREATE TRIGGER namespace_fence BEFORE INSERT ON gridex_utilts_issuer.%I FOR EACH ROW EXECUTE FUNCTION gridex_utilts_issuer.fence_ground_insert_v1()',rel);
 END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_utilts_issuer FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_received_sources.require_utilts_transaction_v1(uuid,uuid,text,text,text,jsonb),gridex_received_sources.require_utilts_transaction_before_issuer_v1(uuid,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_read_utilts_issuer_identity_authority_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_utilts_issuer_identity_authority_v1(uuid,uuid) TO service_role;
COMMIT;
