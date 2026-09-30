-- Forward personal AI/BI storage guards, before raw mail/body/attachment copies.
-- No historical decision/source links are synthesized. Existing rows remain
-- historical evidence; new/changed personal sources require real current owners.
BEGIN;
ALTER TABLE public.inbound_email_messages ADD COLUMN ai_processing_actor_user_id uuid;
ALTER TABLE public.inbound_email_messages ADD COLUMN ai_processing_decision_id uuid REFERENCES gridex_ai_processing.decisions(id) ON DELETE RESTRICT;
ALTER TABLE public.ediel_message_payloads ADD COLUMN inbound_email_message_id uuid REFERENCES public.inbound_email_messages(id) ON DELETE RESTRICT;
CREATE FUNCTION gridex_ai_processing.personal_storage_basis_v1(c uuid,actor uuid,env text,raw text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE line text;h text[];assessment jsonb;basis jsonb;previous jsonb;
BEGIN
 FOR line IN SELECT l FROM regexp_split_to_table(replace(raw,E'\r\n',E'\n'),E'\n') l WHERE l ~ '^[\t ]*(AI|BI);' OR l LIKE chr(65279)||'AI;%' OR l LIKE chr(65279)||'BI;%' LOOP
  IF left(line,1)=chr(65279) THEN line:=substring(line FROM 2); END IF;
  h:=string_to_array(line,';');
  IF cardinality(h)<>10 OR h[1] NOT IN ('AI','BI') THEN RAISE EXCEPTION 'ai_bi_personal_storage_header_required'; END IF;
  assessment:=gridex_ai_processing.current_decision_v1(c,actor,h[1]);
  IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(assessment->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501'; END IF;
  basis:=jsonb_build_object('listType',h[1],'decisionId',assessment#>>'{decision,id}','headerBasis',gridex_ai_processing.header_company_basis_v1(c,env,h[4],h[2]));
  IF previous IS NOT NULL AND previous IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ai_bi_personal_storage_mixed_scope'; END IF;
  previous:=basis;
 END LOOP;
 RETURN previous;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.personal_storage_basis_v1(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ai_processing.guard_mail_storage_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE raw text;basis jsonb;candidate jsonb;old_ai boolean:=false;
BEGIN
 IF TG_OP='UPDATE' THEN
  FOREACH raw IN ARRAY ARRAY[OLD.raw_email,OLD.raw_edifact_payload,OLD.body_text,OLD.body_html] LOOP
   IF raw ~ '(^|\n)[\t ]*(AI|BI);' OR raw LIKE chr(65279)||'AI;%' OR raw LIKE chr(65279)||'BI;%' THEN old_ai:=true; END IF;
  END LOOP;
 END IF;
 IF TG_OP='UPDATE' AND (OLD.ai_processing_decision_id IS NOT NULL OR old_ai) AND (
  NEW.raw_email IS DISTINCT FROM OLD.raw_email OR NEW.raw_edifact_payload IS DISTINCT FROM OLD.raw_edifact_payload
  OR NEW.body_text IS DISTINCT FROM OLD.body_text OR NEW.body_html IS DISTINCT FROM OLD.body_html
  OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.ai_processing_actor_user_id IS DISTINCT FROM OLD.ai_processing_actor_user_id
  OR NEW.ai_processing_decision_id IS DISTINCT FROM OLD.ai_processing_decision_id) THEN RAISE EXCEPTION 'ai_bi_personal_source_immutable'; END IF;
 FOREACH raw IN ARRAY ARRAY[NEW.raw_email,NEW.raw_edifact_payload,NEW.body_text,NEW.body_html] LOOP
  candidate:=gridex_ai_processing.personal_storage_basis_v1(NEW.company_id,NEW.ai_processing_actor_user_id,NEW.environment,raw);
  IF candidate IS NOT NULL THEN
   IF basis IS NOT NULL AND basis IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'ai_bi_personal_storage_mixed_scope'; END IF;
   basis:=candidate;
  END IF;
 END LOOP;
 IF basis IS NULL THEN
  IF NEW.ai_processing_decision_id IS NOT NULL OR NEW.message_family IN ('AI_LIST','BI_LIST') THEN RAISE EXCEPTION 'ai_bi_personal_storage_complete_source_required'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.ai_processing_decision_id IS NULL OR NEW.ai_processing_decision_id::text IS DISTINCT FROM basis->>'decisionId' THEN RAISE EXCEPTION 'ai_bi_processing_decision_mismatch'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.guard_mail_storage_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ai_bi_mail_requires_legal_decision BEFORE INSERT OR UPDATE OF raw_email,raw_edifact_payload,body_text,body_html,company_id,environment,ai_processing_actor_user_id,ai_processing_decision_id ON public.inbound_email_messages FOR EACH ROW EXECUTE FUNCTION gridex_ai_processing.guard_mail_storage_v1();
CREATE FUNCTION gridex_ai_processing.guard_attachment_storage_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parent public.inbound_email_messages%rowtype;basis jsonb;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.raw_text ~ '(^|\n)[\t ]*(AI|BI);' OR OLD.raw_text LIKE chr(65279)||'AI;%' OR OLD.raw_text LIKE chr(65279)||'BI;%')
  AND (NEW.raw_text IS DISTINCT FROM OLD.raw_text OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.inbound_email_message_id IS DISTINCT FROM OLD.inbound_email_message_id) THEN RAISE EXCEPTION 'ai_bi_personal_source_immutable'; END IF;
 IF NEW.raw_text IS NULL OR NOT (NEW.raw_text ~ '(^|\n)[\t ]*(AI|BI);' OR NEW.raw_text LIKE chr(65279)||'AI;%' OR NEW.raw_text LIKE chr(65279)||'BI;%') THEN RETURN NEW; END IF;
 SELECT * INTO parent FROM public.inbound_email_messages m WHERE m.id=NEW.inbound_email_message_id AND m.company_id=NEW.company_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ai_bi_personal_storage_parent_required'; END IF;
 basis:=gridex_ai_processing.personal_storage_basis_v1(NEW.company_id,parent.ai_processing_actor_user_id,parent.environment,NEW.raw_text);
 IF basis IS NULL OR parent.ai_processing_decision_id IS NULL OR parent.ai_processing_decision_id::text IS DISTINCT FROM basis->>'decisionId' THEN RAISE EXCEPTION 'ai_bi_processing_decision_mismatch'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.guard_attachment_storage_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ai_bi_attachment_requires_legal_decision BEFORE INSERT OR UPDATE OF raw_text,company_id,inbound_email_message_id ON public.inbound_email_attachments FOR EACH ROW EXECUTE FUNCTION gridex_ai_processing.guard_attachment_storage_v1();
CREATE FUNCTION gridex_ai_processing.guard_payload_storage_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE env text;basis jsonb;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.raw_payload ~ '(^|\n)[\t ]*(AI|BI);' OR OLD.raw_payload LIKE chr(65279)||'AI;%' OR OLD.raw_payload LIKE chr(65279)||'BI;%')
  AND (NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
  OR NEW.ediel_message_id IS DISTINCT FROM OLD.ediel_message_id OR NEW.inbound_email_message_id IS DISTINCT FROM OLD.inbound_email_message_id) THEN RAISE EXCEPTION 'ai_bi_personal_source_immutable'; END IF;
 IF NEW.raw_payload IS NULL OR NOT (NEW.raw_payload ~ '(^|\n)[\t ]*(AI|BI);' OR NEW.raw_payload LIKE chr(65279)||'AI;%' OR NEW.raw_payload LIKE chr(65279)||'BI;%') THEN RETURN NEW; END IF;
 IF NEW.ediel_message_id IS NOT NULL THEN
  SELECT m.environment INTO env FROM public.ediel_messages m WHERE m.id=NEW.ediel_message_id AND m.company_id=NEW.company_id AND m.immutable_rendered_at IS NOT NULL FOR SHARE;
 ELSIF NEW.inbound_email_message_id IS NOT NULL THEN
  SELECT m.environment INTO env FROM public.inbound_email_messages m WHERE m.id=NEW.inbound_email_message_id AND m.company_id=NEW.company_id AND m.ai_processing_actor_user_id=NEW.created_by AND m.ai_processing_decision_id IS NOT NULL FOR SHARE;
 END IF;
 IF env IS NULL THEN RAISE EXCEPTION 'ai_bi_personal_storage_parent_required'; END IF;
 basis:=gridex_ai_processing.personal_storage_basis_v1(NEW.company_id,NEW.created_by,env,NEW.raw_payload);
 IF basis IS NULL THEN RAISE EXCEPTION 'ai_bi_personal_storage_header_required'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.guard_payload_storage_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ai_bi_payload_requires_legal_decision BEFORE INSERT OR UPDATE OF raw_payload,company_id,created_by,ediel_message_id,inbound_email_message_id ON public.ediel_message_payloads FOR EACH ROW EXECUTE FUNCTION gridex_ai_processing.guard_payload_storage_v1();
COMMIT;
