-- Forward AI/BI processing-decision consumption support. No legal decision or
-- owner authorization is seeded. Registration stays closed until a genuine
-- versioned decision-owner registry contract is supplied and implemented.
BEGIN;
CREATE SCHEMA gridex_ai_processing;
REVOKE ALL ON SCHEMA gridex_ai_processing FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA gridex_ai_processing TO service_role;
CREATE TABLE gridex_ai_processing.decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 list_type text NOT NULL CHECK(list_type IN ('AI','BI')),purpose text NOT NULL CHECK(purpose='ediel_list_reconciliation'),
 revision bigint NOT NULL CHECK(revision>0),previous_decision_id uuid UNIQUE REFERENCES gridex_ai_processing.decisions(id) ON DELETE RESTRICT,
 gdpr_basis text NOT NULL CHECK(length(btrim(gdpr_basis)) BETWEEN 1 AND 2000),retention_days integer NOT NULL CHECK(retention_days>0),
 valid_from timestamptz NOT NULL,valid_until timestamptz CHECK(valid_until>valid_from),
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 2000),source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 decision_owner_registry_id uuid NOT NULL,decision_owner_registry_version text NOT NULL CHECK(length(btrim(decision_owner_registry_version)) BETWEEN 1 AND 200),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,list_type,purpose,revision)
);
ALTER TABLE gridex_ai_processing.decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ai_processing.decisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ai_processing.decisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON gridex_ai_processing.decisions TO service_role;
CREATE POLICY ai_processing_decision_service_read ON gridex_ai_processing.decisions FOR SELECT TO service_role USING(true);
CREATE TRIGGER ai_processing_decisions_no_mutation BEFORE UPDATE OR DELETE ON gridex_ai_processing.decisions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER ai_processing_decisions_no_truncate BEFORE TRUNCATE ON gridex_ai_processing.decisions FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

-- Deliberately no registration/approval API or write grant: a stored UUID,
-- source hash or GDPR basis string cannot qualify a legal decision owner.
CREATE FUNCTION gridex_ai_processing.current_decision_v1(c uuid,actor uuid,list_type text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidates integer; d gridex_ai_processing.decisions%rowtype;
BEGIN
 IF c IS NULL OR actor IS NULL OR list_type IS NULL OR list_type NOT IN ('AI','BI') THEN RAISE EXCEPTION 'ai_bi_processing_scope_required'; END IF;
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles p WHERE p.id=actor AND p.user_status='active')
 OR NOT (coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.write'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write'),false)) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO candidates FROM gridex_ai_processing.decisions x WHERE x.company_id=c AND x.list_type=current_decision_v1.list_type AND x.purpose='ediel_list_reconciliation'
  AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions next WHERE next.previous_decision_id=x.id);
 IF candidates<>1 THEN RETURN jsonb_build_object('status','held','blocker',CASE WHEN candidates=0 THEN 'ai_bi_processing_decision_missing' ELSE 'ai_bi_processing_decision_ambiguous' END); END IF;
 SELECT * INTO d FROM gridex_ai_processing.decisions x WHERE x.company_id=c AND x.list_type=current_decision_v1.list_type AND x.purpose='ediel_list_reconciliation'
  AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions next WHERE next.previous_decision_id=x.id) FOR SHARE;
 IF d.valid_from>now() OR d.valid_until<=now() THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_not_current'); END IF;
 -- Qualification cannot be inferred from platform roles, a retention-days
 -- configuration, legal-template publication or a caller approval boolean.
 RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_owner_registry_unqualified');
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.current_decision_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.gridex_ai_bi_processing_decision_v1(p_company_id uuid,p_actor_user_id uuid,p_list_type text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_bi_processing_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_ai_processing.current_decision_v1(p_company_id,p_actor_user_id,p_list_type);
END $$;
REVOKE ALL ON FUNCTION public.gridex_ai_bi_processing_decision_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_ai_bi_processing_decision_v1(uuid,uuid,text) TO service_role;

ALTER TABLE public.ai_list_imports ADD COLUMN processing_decision_id uuid REFERENCES gridex_ai_processing.decisions(id) ON DELETE RESTRICT;
ALTER TABLE public.ai_list_imports ADD COLUMN source_ediel_message_id uuid UNIQUE REFERENCES public.ediel_messages(id) ON DELETE RESTRICT;
CREATE FUNCTION gridex_ai_processing.guard_import_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE assessment jsonb;
BEGIN
 assessment:=gridex_ai_processing.current_decision_v1(NEW.company_id,NEW.created_by,NEW.list_type);
 IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',assessment->>'blocker' USING ERRCODE='42501'; END IF;
 IF NEW.source_ediel_message_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.ediel_messages m WHERE m.id=NEW.source_ediel_message_id AND m.company_id=NEW.company_id AND m.direction='inbound'
  AND m.message_standard='ai_list' AND m.message_family='AI_LIST' AND m.message_code=NEW.list_type AND m.raw_payload=NEW.raw_payload AND m.immutable_rendered_at IS NOT NULL
  AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'ai_bi_reconciliation_sealed_source_required' USING ERRCODE='42501'; END IF;
 IF NEW.processing_decision_id IS NULL OR NEW.processing_decision_id::text IS DISTINCT FROM assessment#>>'{decision,id}'
  OR NEW.gdpr_basis IS DISTINCT FROM assessment#>>'{decision,gdprBasis}' OR NEW.retention_until IS DISTINCT FROM (assessment#>>'{decision,retentionUntil}')::date THEN RAISE EXCEPTION 'ai_bi_processing_decision_mismatch' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.guard_import_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ai_list_import_requires_legal_decision BEFORE INSERT ON public.ai_list_imports FOR EACH ROW EXECUTE FUNCTION gridex_ai_processing.guard_import_v1();

-- Covers actual ingress/direct storage as well as the reconciliation importer.
-- This is a storage gate, not a second CSV parser or market-role authority.
CREATE FUNCTION gridex_ai_processing.guard_message_storage_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE assessment jsonb; list_kind text;
BEGIN
 IF NEW.message_standard='ai_list' OR NEW.message_family IN ('AI_LIST','BI_LIST') OR NEW.raw_payload ~ '^[[:space:]]*(AI|BI);' THEN
  list_kind:=CASE WHEN NEW.raw_payload ~ '^[[:space:]]*BI;' THEN 'BI' WHEN NEW.raw_payload ~ '^[[:space:]]*AI;' THEN 'AI' ELSE NULL END;
  IF list_kind IS NULL THEN RAISE EXCEPTION 'ai_bi_processing_source_type_required' USING ERRCODE='42501'; END IF;
  assessment:=gridex_ai_processing.current_decision_v1(NEW.company_id,NEW.created_by,list_kind);
  IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',assessment->>'blocker' USING ERRCODE='42501'; END IF;
  NEW.immutable_payload_hash:=encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex');
  NEW.immutable_rendered_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.guard_message_storage_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ai_bi_message_requires_legal_decision BEFORE INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ai_processing.guard_message_storage_v1();
COMMENT ON TABLE gridex_ai_processing.decisions IS 'AI/BI processing-decision support only. No decision owner is qualified by this migration; no activation, approval, retention period or legal basis is fabricated.';
COMMIT;
