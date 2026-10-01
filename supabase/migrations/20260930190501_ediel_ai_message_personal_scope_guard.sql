-- Forward first-message storage fence. A processing decision alone does not
-- bind physical AI/BI legal header parties to the selected tenant/network.
-- Old sources remain immutable evidence; no historical approval is inferred.
BEGIN;
-- Shared first-storage authority: keep current actor membership/profile stable
-- while the actual personal source is stored. The existing decision resolver
-- still owns all authorization and legal/retention decisions.
CREATE OR REPLACE FUNCTION gridex_ai_processing.personal_storage_basis_v1(c uuid,actor uuid,env text,raw text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE line text;h text[];assessment jsonb;basis jsonb;previous jsonb;
BEGIN
 FOR line IN SELECT l FROM regexp_split_to_table(replace(raw,E'\r\n',E'\n'),E'\n') l WHERE l ~ '^[\t ]*(AI|BI);' OR l LIKE chr(65279)||'AI;%' OR l LIKE chr(65279)||'BI;%' LOOP
  IF left(line,1)=chr(65279) THEN line:=substring(line FROM 2); END IF;
  h:=string_to_array(line,';');
  IF cardinality(h)<>10 OR h[1] NOT IN ('AI','BI') THEN RAISE EXCEPTION 'ai_bi_personal_storage_header_required'; END IF;
  PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
  PERFORM p.id FROM public.user_profiles p WHERE p.id=actor FOR SHARE;
  assessment:=gridex_ai_processing.current_decision_v1(c,actor,h[1]);
  IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(assessment->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501'; END IF;
  basis:=jsonb_build_object('listType',h[1],'decisionId',assessment#>>'{decision,id}','headerBasis',gridex_ai_processing.header_company_basis_v1(c,env,h[4],h[2]));
  IF previous IS NOT NULL AND previous IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ai_bi_personal_storage_mixed_scope'; END IF;
  previous:=basis;
 END LOOP;
 RETURN previous;
END $$;
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
 basis:=gridex_ai_processing.personal_storage_basis_v1(NEW.company_id,NEW.created_by,NEW.environment,NEW.raw_payload);
 IF basis IS NULL THEN RAISE EXCEPTION 'ai_bi_personal_storage_header_required'; END IF;
 NEW.immutable_payload_hash:=encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex');
 NEW.immutable_rendered_at:=clock_timestamp();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.guard_message_storage_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER ai_bi_message_requires_legal_decision ON public.ediel_messages;
CREATE TRIGGER ai_bi_message_requires_legal_decision BEFORE INSERT OR UPDATE OF raw_payload,company_id,environment,direction,created_by,
 sender_ediel_id,receiver_ediel_id,message_standard,message_family,message_code,immutable_payload_hash,immutable_rendered_at
 ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ai_processing.guard_message_storage_v1();
COMMIT;
