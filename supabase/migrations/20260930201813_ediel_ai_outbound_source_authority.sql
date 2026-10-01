-- AI01/AI02 independent all-family journal source admission. Export decisions
-- are prospective purpose-specific legal support, never reconciliation mandate.
-- No decisions/owners/originals/network versions or historical receipts seeded.
BEGIN;
CREATE FUNCTION gridex_ai_processing.native_profile_v1() RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
-- BEGIN CANONICAL AI PROFILE PROJECTION
 SELECT '{"sourceId":"AI","guideRevision":"14.A.3","technicalVersion":"Ver20140401","sourceSha256":"c5815bacbc40beb1ee1b36cb03c71a089fbc18cda3368811afadcdca78899351","format":"CSV","provenance":"frozen_masterplan_projection"}'::jsonb
-- END CANONICAL AI PROFILE PROJECTION
$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.native_profile_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE gridex_ai_processing.decisions DROP CONSTRAINT decisions_purpose_check;
ALTER TABLE gridex_ai_processing.decisions ADD CONSTRAINT decisions_purpose_check CHECK(purpose IN ('ediel_list_reconciliation','ediel_list_export'));
-- One purpose-aware decision consumption owner. The old API retains exactly
-- its incoming reconciliation purpose; no existing mandate is widened.
CREATE FUNCTION gridex_ai_processing.current_purpose_decision_v1(c uuid,actor uuid,list_type text,purpose text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidates integer;d gridex_ai_processing.decisions%rowtype;
BEGIN
 IF c IS NULL OR actor IS NULL OR list_type IS NULL OR list_type NOT IN ('AI','BI') OR purpose IS NULL OR purpose NOT IN ('ediel_list_reconciliation','ediel_list_export') THEN RAISE EXCEPTION 'ai_bi_processing_scope_required'; END IF;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
 PERFORM p.id FROM public.user_profiles p WHERE p.id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles p WHERE p.id=actor AND p.user_status='active')
 OR NOT (coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.write'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write'),false)) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO candidates FROM gridex_ai_processing.decisions x WHERE x.company_id=c AND x.list_type=current_purpose_decision_v1.list_type AND x.purpose=current_purpose_decision_v1.purpose
  AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions next WHERE next.previous_decision_id=x.id);
 IF candidates<>1 THEN RETURN jsonb_build_object('status','held','blocker',CASE WHEN candidates=0 THEN 'ai_bi_processing_decision_missing' ELSE 'ai_bi_processing_decision_ambiguous' END); END IF;
 SELECT * INTO d FROM gridex_ai_processing.decisions x WHERE x.company_id=c AND x.list_type=current_purpose_decision_v1.list_type AND x.purpose=current_purpose_decision_v1.purpose
  AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions next WHERE next.previous_decision_id=x.id) FOR SHARE;
 IF d.valid_from>statement_timestamp() OR d.valid_until<=statement_timestamp() THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_not_current'); END IF;
 -- The current repository has no authenticated decision-owner registry.
 -- A stored UUID, hash, tenant role or retention value cannot qualify one.
 RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_owner_registry_unqualified');
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.current_purpose_decision_v1(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gridex_ai_processing.current_decision_v1(c uuid,actor uuid,list_type text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT gridex_ai_processing.current_purpose_decision_v1(c,actor,list_type,'ediel_list_reconciliation') $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.current_decision_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ai_processing.require_export_decision_v1(c uuid,actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE decision jsonb;
BEGIN
 decision:=gridex_ai_processing.current_purpose_decision_v1(c,actor,'AI','ediel_list_export');
 IF decision->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(decision->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501'; END IF;
 IF decision#>>'{decision,companyId}' IS DISTINCT FROM c::text OR decision#>>'{decision,listType}' IS DISTINCT FROM 'AI'
 OR decision#>>'{decision,purpose}' IS DISTINCT FROM 'ediel_list_export' THEN RAISE EXCEPTION 'ai_list_export_decision_scope_mismatch'; END IF;
 RETURN decision;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_export_decision_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ai_processing.technical_date_v1(value text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result date;
BEGIN
 IF value IS NULL OR value !~ '^[0-9]{8}$' OR substring(value,1,4)::integer<1000 THEN RAISE EXCEPTION 'ai_list_date_invalid'; END IF;
 result:=make_date(substring(value,1,4)::integer,substring(value,5,2)::integer,substring(value,7,2)::integer);
 RETURN result;
EXCEPTION WHEN datetime_field_overflow THEN RAISE EXCEPTION 'ai_list_date_invalid';
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.technical_date_v1(text) FROM PUBLIC,anon,authenticated,service_role;
-- Native bounded whole-file projection of the shared positional codec. It
-- reads profile values only from the generated canonical-facade projection.
CREATE FUNCTION gridex_ai_processing.outbound_wire_v1(raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE profile jsonb:=gridex_ai_processing.native_profile_v1();normalized text;records text[];h text[];cols text[];i integer;
 from_date date;to_date date;start_date date;end_date date;
BEGIN
 IF raw IS NULL OR octet_length(raw)>10485760 THEN RAISE EXCEPTION 'ai_list_resource_bound'; END IF;
 normalized:=replace(raw,E'\r\n',E'\n');IF left(normalized,1)=chr(65279) THEN normalized:=substring(normalized FROM 2); END IF;
 IF right(normalized,1)=E'\n' THEN normalized:=left(normalized,length(normalized)-1); END IF;
 IF replace(normalized,E'\n','') ~ '[\r\x01-\x1f\x7f]' THEN RAISE EXCEPTION 'ai_list_cell_separator_invalid'; END IF;
 records:=string_to_array(normalized,E'\n');IF cardinality(records)>100001 OR cardinality(records)<1 OR ''=ANY(records) THEN RAISE EXCEPTION 'ai_list_record_empty'; END IF;
 h:=string_to_array(records[1],';');
 IF cardinality(h)<>10 OR h[1] IS DISTINCT FROM 'AI' THEN RAISE EXCEPTION 'ai_list_outbound_header_required'; END IF;
 IF h[10] IS DISTINCT FROM profile->>'technicalVersion' THEN RAISE EXCEPTION 'ai_list_version_unsupported'; END IF;
 IF h[2]!~ '^[0-9]{5}$' OR h[4]!~ '^[0-9]{5}$' OR btrim(h[3])='' OR btrim(h[5])='' THEN RAISE EXCEPTION 'ai_list_header_parties_required'; END IF;
 IF h[6]!~ '^[0-9]{12}$' OR substring(h[6],9,2)::integer>23 OR substring(h[6],11,2)::integer>59 THEN RAISE EXCEPTION 'ai_list_creation_date_invalid'; END IF;
 PERFORM gridex_ai_processing.technical_date_v1(substring(h[6],1,8));
 from_date:=gridex_ai_processing.technical_date_v1(h[8]);to_date:=gridex_ai_processing.technical_date_v1(h[9]);
 IF h[7]<>'' OR from_date>=to_date THEN RAISE EXCEPTION 'ai_list_search_period_invalid'; END IF;
 FOR i IN 2..cardinality(records) LOOP
  cols:=string_to_array(records[i],';');
  IF cardinality(cols)<>22 OR cols[22]<>'' OR cols[1]='' OR cols[2]='' OR cols[3] NOT IN ('9','89') OR cols[3]='9' AND cols[2]!~ '^[0-9]{18}$' THEN RAISE EXCEPTION 'ai_list_detail_object_invalid'; END IF;
  IF cols[4:7]<>ARRAY['','','',''] OR cols[11]='' OR cols[18]='' OR cols[19]='' THEN RAISE EXCEPTION 'ai_list_detail_required_fields_missing'; END IF;
  IF cols[12:17]<>ARRAY['','','','','',''] THEN RAISE EXCEPTION 'ai_list_supplier_network_fields_present'; END IF;
  start_date:=NULL;end_date:=NULL;
  IF cols[20]<>'' THEN start_date:=gridex_ai_processing.technical_date_v1(cols[20]);IF start_date<from_date OR start_date>=to_date THEN RAISE EXCEPTION 'ai_list_detail_period_invalid'; END IF; END IF;
  IF cols[21]<>'' THEN end_date:=gridex_ai_processing.technical_date_v1(cols[21]);IF end_date<from_date OR end_date>=to_date THEN RAISE EXCEPTION 'ai_list_detail_period_invalid'; END IF; END IF;
  IF start_date IS NOT NULL AND end_date IS NOT NULL AND start_date>=end_date THEN RAISE EXCEPTION 'ai_list_detail_period_invalid'; END IF;
 END LOOP;
 RETURN jsonb_build_object('networkEdielId',h[2],'supplierEdielId',h[4],'rowCount',greatest(cardinality(records)-1,0),'profile',profile);
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.outbound_wire_v1(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ai_processing.require_ai_outbound_source_v1(c uuid,message_id uuid,actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;wire jsonb;decision jsonb;basis jsonb;profile jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages s WHERE s.id=message_id AND s.company_id=c FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'ai_list' OR m.message_family IS DISTINCT FROM 'AI_LIST'
  OR m.message_code IS DISTINCT FROM 'AI' OR m.raw_payload IS NULL OR m.immutable_rendered_at IS NULL
  OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ai_list_sealed_outbound_source_required'; END IF;
 wire:=gridex_ai_processing.outbound_wire_v1(m.raw_payload);profile:=wire->'profile';
 IF m.sender_ediel_id IS DISTINCT FROM wire->>'supplierEdielId' OR m.receiver_ediel_id IS DISTINCT FROM wire->>'networkEdielId'
  OR m.message_version IS DISTINCT FROM profile->>'technicalVersion' THEN RAISE EXCEPTION 'ai_list_outbound_party_profile_scope_mismatch'; END IF;
 IF m.file_name IS NULL OR lower(m.file_name) NOT LIKE '%.csv' OR m.mime_type IS NULL
  OR m.mime_type!~* '^text/csv([ \t]*;[ \t]*charset[ \t]*=[ \t]*(utf-8|"utf-8"))?[ \t]*$' THEN RAISE EXCEPTION 'ai_list_csv_file_type_required'; END IF;
 decision:=gridex_ai_processing.require_export_decision_v1(c,actor);
 basis:=gridex_ai_processing.header_company_basis_v1(c,m.environment,wire->>'supplierEdielId',wire->>'networkEdielId');
 PERFORM public.ediel_require_scoped_capability_for_message_v1(c,m.id);
 IF m.environment='production' AND NOT EXISTS(SELECT FROM gridex_ediel_readiness.evidence e WHERE e.company_id=c AND e.scope->>'family'='AI_LIST'
  AND e.scope->>'code'='AI' AND e.expires_at>statement_timestamp() AND e.dependencies->>'rulepackHash'=profile->>'sourceSha256'
  AND e.dependencies->>'technicalFormatVersion'=profile->>'technicalVersion') THEN RAISE EXCEPTION 'ai_list_scoped_profile_dependency_required'; END IF;
 RETURN jsonb_build_object('sourceHash',m.immutable_payload_hash,'profile',profile,'headerBasis',basis,'decisionId',decision#>>'{decision,id}','rowCount',wire->'rowCount');
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_ai_outbound_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Fresh outgoing raw storage consumes the same purpose-specific owner before
-- the existing first-header/tenant/network/seal trigger. Old immutable rows are
-- not relabelled and old committed transport outcomes remain journal-owned.
CREATE FUNCTION gridex_ai_processing.guard_outbound_purpose_storage_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.direction='outbound' AND (NEW.message_standard='ai_list' OR NEW.message_family IN ('AI_LIST','BI_LIST') OR NEW.raw_payload ~ '(^|\n)[\t ]*(AI|BI);' OR NEW.raw_payload LIKE chr(65279)||'AI;%' OR NEW.raw_payload LIKE chr(65279)||'BI;%') THEN
  IF TG_OP='INSERT' THEN
   IF NEW.message_code IS DISTINCT FROM 'AI' THEN RAISE EXCEPTION 'ai_list_outbound_header_required'; END IF;
   PERFORM gridex_ai_processing.outbound_wire_v1(NEW.raw_payload);
   PERFORM gridex_ai_processing.require_export_decision_v1(NEW.company_id,NEW.created_by);
  ELSIF NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.direction IS DISTINCT FROM OLD.direction THEN
   PERFORM gridex_ai_processing.require_export_decision_v1(NEW.company_id,NEW.created_by);
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.guard_outbound_purpose_storage_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ai_a_outbound_requires_export_purpose BEFORE INSERT OR UPDATE OF raw_payload,company_id,created_by,direction ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_ai_processing.guard_outbound_purpose_storage_v1();
CREATE FUNCTION gridex_ai_processing.personal_storage_basis_for_purpose_v1(c uuid,actor uuid,env text,raw text,purpose text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE line text;h text[];assessment jsonb;basis jsonb;previous jsonb;
BEGIN
 FOR line IN SELECT l FROM regexp_split_to_table(replace(raw,E'\r\n',E'\n'),E'\n') l WHERE l ~ '^[\t ]*(AI|BI);' OR l LIKE chr(65279)||'AI;%' OR l LIKE chr(65279)||'BI;%' LOOP
  IF left(line,1)=chr(65279) THEN line:=substring(line FROM 2); END IF;
  h:=string_to_array(line,';');
  IF cardinality(h)<>10 OR h[1] NOT IN ('AI','BI') THEN RAISE EXCEPTION 'ai_bi_personal_storage_header_required'; END IF;
  PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
  PERFORM p.id FROM public.user_profiles p WHERE p.id=actor FOR SHARE;
  IF purpose='ediel_list_reconciliation' THEN assessment:=gridex_ai_processing.current_decision_v1(c,actor,h[1]);
  ELSE assessment:=gridex_ai_processing.current_purpose_decision_v1(c,actor,h[1],purpose); END IF;
  IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(assessment->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501'; END IF;
  basis:=jsonb_build_object('listType',h[1],'decisionId',assessment#>>'{decision,id}','headerBasis',gridex_ai_processing.header_company_basis_v1(c,env,h[4],h[2]));
  IF previous IS NOT NULL AND previous IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ai_bi_personal_storage_mixed_scope'; END IF;
  previous:=basis;
 END LOOP;
 RETURN previous;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.personal_storage_basis_for_purpose_v1(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gridex_ai_processing.personal_storage_basis_v1(c uuid,actor uuid,env text,raw text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT gridex_ai_processing.personal_storage_basis_for_purpose_v1(c,actor,env,raw,'ediel_list_reconciliation') $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.personal_storage_basis_v1(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gridex_ai_processing.guard_message_storage_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE header text;h text[];basis jsonb;old_ai boolean:=false;new_ai boolean;
BEGIN
 IF TG_OP='UPDATE' THEN
  old_ai:=OLD.message_standard='ai_list' OR OLD.message_family IN ('AI_LIST','BI_LIST')
   OR OLD.raw_payload ~ '(^|\n)[\t ]*(AI|BI);' OR OLD.raw_payload LIKE chr(65279)||'AI;%' OR OLD.raw_payload LIKE chr(65279)||'BI;%';
  IF old_ai THEN
   IF NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.direction IS DISTINCT FROM OLD.direction
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.sender_ediel_id IS DISTINCT FROM OLD.sender_ediel_id
    OR NEW.receiver_ediel_id IS DISTINCT FROM OLD.receiver_ediel_id OR NEW.message_standard IS DISTINCT FROM OLD.message_standard
    OR NEW.message_family IS DISTINCT FROM OLD.message_family OR NEW.message_code IS DISTINCT FROM OLD.message_code
    OR NEW.immutable_payload_hash IS DISTINCT FROM OLD.immutable_payload_hash OR NEW.immutable_rendered_at IS DISTINCT FROM OLD.immutable_rendered_at
    THEN RAISE EXCEPTION 'ai_bi_personal_source_immutable'; END IF;
   -- A no-op write stores no new personal source and grants no new approval.
   -- Replay authority still comes only from the private immutable receipt.
   RETURN NEW;
  END IF;
 END IF;
 new_ai:=NEW.message_standard='ai_list' OR NEW.message_family IN ('AI_LIST','BI_LIST')
  OR NEW.raw_payload ~ '(^|\n)[\t ]*(AI|BI);' OR NEW.raw_payload LIKE chr(65279)||'AI;%' OR NEW.raw_payload LIKE chr(65279)||'BI;%';
 IF NOT coalesce(new_ai,false) THEN RETURN NEW; END IF;
 header:=split_part(replace(NEW.raw_payload,E'\r\n',E'\n'),E'\n',1);
 IF left(header,1)=chr(65279) THEN header:=substring(header FROM 2); END IF;
 h:=string_to_array(header,';');
 IF h IS NULL OR cardinality(h)<>10 OR h[1] NOT IN ('AI','BI') THEN RAISE EXCEPTION 'ai_bi_personal_storage_header_required'; END IF;
 IF NEW.message_standard IS DISTINCT FROM 'ai_list' OR NEW.message_family IS DISTINCT FROM 'AI_LIST'
  OR NEW.message_code IS DISTINCT FROM h[1] OR NEW.direction IS NULL OR NEW.direction NOT IN ('inbound','outbound')
  OR NEW.sender_ediel_id IS DISTINCT FROM (CASE WHEN NEW.direction='inbound' THEN h[2] ELSE h[4] END)
  OR NEW.receiver_ediel_id IS DISTINCT FROM (CASE WHEN NEW.direction='inbound' THEN h[4] ELSE h[2] END)
  THEN RAISE EXCEPTION 'ai_bi_personal_storage_source_context_mismatch'; END IF;
 basis:=gridex_ai_processing.personal_storage_basis_for_purpose_v1(NEW.company_id,NEW.created_by,NEW.environment,NEW.raw_payload,CASE WHEN NEW.direction='outbound' THEN 'ediel_list_export' ELSE 'ediel_list_reconciliation' END);
 IF basis IS NULL THEN RAISE EXCEPTION 'ai_bi_personal_storage_header_required'; END IF;
 NEW.immutable_payload_hash:=encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex');
 NEW.immutable_rendered_at:=clock_timestamp();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.guard_message_storage_v1() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
