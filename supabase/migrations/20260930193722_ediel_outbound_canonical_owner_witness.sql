-- Created by actual Supabase CLI2.118.0. Prospective actual canonical owner
-- witness is sealed before INSERT and consumed exactly once by actual raw row.
BEGIN;
CREATE SCHEMA gridex_ediel_outbound_owner;
REVOKE ALL ON SCHEMA gridex_ediel_outbound_owner FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_outbound_owner.witnesses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,actor_user_id uuid NOT NULL,
 environment text NOT NULL,payload_sha256 text NOT NULL,family text NOT NULL,code text NOT NULL,
 related_message_id uuid,observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),context jsonb NOT NULL,evidence jsonb NOT NULL
);
CREATE TABLE gridex_ediel_outbound_owner.consumptions(
 witness_id uuid PRIMARY KEY REFERENCES gridex_ediel_outbound_owner.witnesses(id),source_message_id uuid NOT NULL UNIQUE,
 company_id uuid NOT NULL,environment text NOT NULL,payload_sha256 text NOT NULL
);
CREATE FUNCTION gridex_ediel_outbound_owner.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'ediel_outbound_owner_witness_immutable';END $$;
DO $$DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['witnesses','consumptions'] LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_outbound_owner.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE gridex_ediel_outbound_owner.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON TABLE gridex_ediel_outbound_owner.%I FROM PUBLIC,anon,authenticated,service_role',tab);
 EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_ediel_outbound_owner.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_outbound_owner.immutable()',tab);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_outbound_owner.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_outbound_owner.immutable()',tab);
END LOOP;END $$;
CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid;actor uuid;env text;raw text;related uuid;m public.ediel_messages%rowtype;context jsonb;tokens jsonb;
 p public.ediel_message_profiles%rowtype;r public.ediel_rule_packs%rowtype;named_sources jsonb;e jsonb;witness uuid;original public.ediel_messages%rowtype;
BEGIN
 c:=(i->>'companyId')::uuid;actor:=(i->>'actorUserId')::uuid;env:=i->>'environment';raw:=i->>'rawPayload';related:=(i->>'relatedMessageId')::uuid;e:=i->'rulePackEvidence';
 IF c IS NULL OR actor IS NULL OR env IS NULL OR env NOT IN('test','production') OR nullif(raw,'') IS NULL OR octet_length(raw)>8388608 OR jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_required';END IF;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor FOR SHARE;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false) THEN RAISE EXCEPTION 'ediel_outbound_owner_actor_scope_required';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(raw);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')<>1 THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_required';END IF;
 SELECT t#>>'{elements,2,0}' INTO m.message_family FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';
 SELECT t#>>'{elements,1,0}' INTO m.message_code FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 IF m.message_family='UTILTS' AND m.message_code='ERR' THEN m.message_family:='UTILTS_ERR';END IF;
 IF m.message_family NOT IN('PRODAT','UTILTS','APERAK','UTILTS_ERR') THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_required';END IF;
 m.company_id:=c;m.environment:=env;m.direction:='outbound';m.raw_payload:=raw;m.related_message_id:=related;
 -- Reuse the single source-generated legal/transport/role authority. This
 -- prospective read grants no historical receipt or market activation.
 context:=gridex_ediel_inbound_context.derive(m,clock_timestamp());
 IF context->>'basisKind'='prescribed_outbound_ack' THEN
  SELECT * INTO original FROM public.ediel_messages WHERE id=related AND company_id=c AND environment=env AND direction='inbound' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_historical_rule_pack_basis_unavailable';END IF;
  IF e IS DISTINCT FROM gridex_ediel_source_rules.require_v1(c,original.id) THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_required';END IF;
 ELSE
  SELECT * INTO p FROM public.ediel_message_profiles WHERE id::text=e->>'messageProfileId' AND profile_key=e->>'profileKey' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_required';END IF;
  SELECT * INTO r FROM public.ediel_rule_packs WHERE id=p.rule_pack_id AND id::text=e->>'rulePackId' AND source_hash=e->>'sourceHash' FOR SHARE;
  IF NOT FOUND OR e->>'version' IS DISTINCT FROM r.guide_version||':r'||r.guide_revision OR nullif(e->>'version','') IS NULL
   OR e#>'{snapshot,rulePack}' IS DISTINCT FROM to_jsonb(r) OR e#>'{snapshot,messageProfile}' IS DISTINCT FROM to_jsonb(p)
   OR r.market IS DISTINCT FROM 'electricity' OR r.family IS DISTINCT FROM m.message_family OR r.status NOT IN('active','transition') OR r.valid_from>current_date OR (r.valid_to IS NOT NULL AND r.valid_to<current_date)
   OR NOT p.is_enabled OR p.message_code IS DISTINCT FROM m.message_code OR p.direction NOT IN('outbound','both') OR coalesce(p.transaction_subtype,'') IS DISTINCT FROM coalesce(context->>'subtype','') THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_required';END IF;
  PERFORM s.id FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=r.id ORDER BY s.id FOR SHARE;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') INTO named_sources FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=r.id;
  IF e#>'{snapshot,guideSources}' IS DISTINCT FROM named_sources THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_required';END IF;
 END IF;
 -- Source-facing snapshot fields are a projection of this exact owner witness;
 -- they cannot be replaced by independently matching mutable public columns.
 e:=e||jsonb_build_object('snapshot',(e->'snapshot')||jsonb_build_object('profileKey',e->>'profileKey','profileVersionId',e->>'messageProfileId','version',e->>'version','checksum',e->>'sourceHash'));
 INSERT INTO gridex_ediel_outbound_owner.witnesses(company_id,actor_user_id,environment,payload_sha256,family,code,related_message_id,context,evidence)
  VALUES(c,actor,env,encode(sha256(convert_to(raw,'UTF8')),'hex'),m.message_family,m.message_code,related,context,e) RETURNING id INTO witness;
 RETURN jsonb_build_object('version',1,'witnessId',witness,'evidence',e);
END $$;
CREATE FUNCTION public.ediel_prepare_outbound_owner_witness_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 RETURN gridex_ediel_outbound_owner.prepare_v1(p_input);END $$;
CREATE FUNCTION gridex_ediel_outbound_owner.assert_message_v1(m public.ediel_messages,w gridex_ediel_outbound_owner.witnesses) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF m.company_id IS DISTINCT FROM w.company_id OR m.environment IS DISTINCT FROM w.environment OR m.direction IS DISTINCT FROM 'outbound'
  OR m.message_family IS DISTINCT FROM w.family OR m.message_code IS DISTINCT FROM w.code OR m.related_message_id IS DISTINCT FROM w.related_message_id
  OR encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') IS DISTINCT FROM w.payload_sha256
  OR m.canonical_rule_pack_id::text IS DISTINCT FROM w.evidence->>'rulePackId' OR m.rule_profile_version_id::text IS DISTINCT FROM w.evidence->>'messageProfileId'
  OR m.rule_profile_key IS DISTINCT FROM w.evidence->>'profileKey' OR m.rule_profile_version IS DISTINCT FROM w.evidence->>'version' OR m.rule_pack_checksum IS DISTINCT FROM w.evidence->>'sourceHash'
  OR m.rule_pack_snapshot->>'profileKey' IS DISTINCT FROM w.evidence->>'profileKey' OR m.rule_pack_snapshot->>'profileVersionId' IS DISTINCT FROM w.evidence->>'messageProfileId'
  OR m.rule_pack_snapshot->>'version' IS DISTINCT FROM w.evidence->>'version' OR m.rule_pack_snapshot->>'checksum' IS DISTINCT FROM w.evidence->>'sourceHash' THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_scope_invalid';END IF;
END $$;
CREATE FUNCTION gridex_ediel_outbound_owner.consume() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_ediel_outbound_owner.witnesses%rowtype;prior gridex_ediel_outbound_owner.consumptions%rowtype;token uuid;
BEGIN
 IF NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_family NOT IN('PRODAT','UTILTS','APERAK','UTILTS_ERR') OR nullif(NEW.raw_payload,'') IS NULL THEN RETURN NEW;END IF;
 token:=(NEW.execution_context_snapshot->>'outboundOwnerWitnessId')::uuid;
 SELECT * INTO w FROM gridex_ediel_outbound_owner.witnesses WHERE id=token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_historical_outbound_owner_witness_unavailable';END IF;
 PERFORM gridex_ediel_outbound_owner.assert_message_v1(NEW,w);
 SELECT * INTO prior FROM gridex_ediel_outbound_owner.consumptions WHERE witness_id=w.id;
 IF FOUND THEN
  IF prior.source_message_id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_already_consumed';END IF;
  RETURN NEW;
 END IF;
 -- The same INSERT transaction owns both actual immutable physical message
 -- scope and one-use protected witness consumption. Failure rolls back both.
 INSERT INTO gridex_ediel_outbound_owner.consumptions VALUES(w.id,NEW.id,w.company_id,w.environment,w.payload_sha256);
 RETURN NEW;
END $$;
CREATE TRIGGER ediel_consume_outbound_owner_witness AFTER INSERT OR UPDATE OF raw_payload ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_outbound_owner.consume();
CREATE FUNCTION gridex_ediel_outbound_owner.require_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;w gridex_ediel_outbound_owner.witnesses%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id AND direction='outbound' FOR SHARE;
 SELECT witness.* INTO w FROM gridex_ediel_outbound_owner.consumptions c JOIN gridex_ediel_outbound_owner.witnesses witness ON witness.id=c.witness_id
  WHERE c.source_message_id=m.id AND c.company_id=m.company_id AND c.environment=m.environment AND c.payload_sha256=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') FOR SHARE OF witness;
 IF w.id IS NULL THEN RAISE EXCEPTION 'ediel_historical_outbound_owner_witness_unavailable';END IF;
 PERFORM gridex_ediel_outbound_owner.assert_message_v1(m,w);RETURN w.evidence;
END $$;
-- Existing protected receipt replay precedes fresh witness/current named-row
-- comparisons. Old unsealed messages receive no invented original witness.
ALTER FUNCTION gridex_ediel_source_rules.capture_v1(uuid,uuid) RENAME TO capture_before_outbound_owner_v1;
CREATE FUNCTION gridex_ediel_source_rules.capture_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;e jsonb;p public.ediel_message_profiles%rowtype;r public.ediel_rule_packs%rowtype;sources jsonb;context jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 IF EXISTS(SELECT FROM gridex_ediel_source_rules.receipts WHERE source_message_id=m.id) THEN RETURN gridex_ediel_source_rules.require_v1(p_company_id,p_message_id);END IF;
 IF m.direction IS DISTINCT FROM 'outbound' THEN RETURN gridex_ediel_source_rules.capture_before_outbound_owner_v1(p_company_id,p_message_id);END IF;
 IF m.message_sent_at IS NOT NULL THEN RAISE EXCEPTION 'ediel_historical_rule_pack_basis_unavailable';END IF;
 e:=gridex_ediel_outbound_owner.require_v1(p_company_id,p_message_id);
 context:=gridex_ediel_inbound_context.require_v1(p_company_id,p_message_id);
 IF context->>'basisKind' IS DISTINCT FROM 'prescribed_outbound_ack' THEN
  SELECT * INTO p FROM public.ediel_message_profiles WHERE id::text=e->>'messageProfileId' AND profile_key=e->>'profileKey' FOR SHARE;
  SELECT * INTO r FROM public.ediel_rule_packs WHERE id=p.rule_pack_id AND id::text=e->>'rulePackId' FOR SHARE;
  PERFORM s.id FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=r.id ORDER BY s.id FOR SHARE;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') INTO sources FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=r.id;
  IF p.id IS NULL OR r.id IS NULL OR e#>'{snapshot,rulePack}' IS DISTINCT FROM to_jsonb(r) OR e#>'{snapshot,messageProfile}' IS DISTINCT FROM to_jsonb(p) OR e#>'{snapshot,guideSources}' IS DISTINCT FROM sources THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_scope_invalid';END IF;
 END IF;
 INSERT INTO gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,original_source_message_id,evidence)
  VALUES(m.id,m.company_id,m.environment,m.direction,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),CASE WHEN context->>'basisKind'='prescribed_outbound_ack' THEN m.related_message_id ELSE NULL END,e);
 RETURN e;
END $$;
-- The H/Z08 provider lane is a separate native dispatch authority. Preserve
-- established entered/accepted observations before any new current selection;
-- new prepare/enter must bind the same protected original basis atomically.
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_original_basis_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;r gridex_outbound_dispatch.reservations%rowtype;
 a gridex_outbound_dispatch.attempts%rowtype;o gridex_outbound_dispatch.originals%rowtype;e gridex_outbound_dispatch.events%rowtype;
 c uuid:=(i->>'companyId')::uuid;actor uuid:=(i->>'actorUserId')::uuid;env text:=i->>'environment';basis jsonb;
BEGIN
 IF i->>'action' IN('prepare','enter') THEN
  SELECT * INTO m FROM public.ediel_messages WHERE id=(i->>'messageId')::uuid AND company_id=c AND environment=env AND direction='outbound' FOR UPDATE;
  SELECT * INTO r FROM gridex_outbound_dispatch.reservations WHERE message_id=m.id FOR UPDATE;
  IF r.state='provider_call_entered' THEN
   SELECT * INTO a FROM gridex_outbound_dispatch.attempts WHERE id=r.attempt_id AND message_id=m.id AND company_id=c AND environment=env FOR SHARE;
   SELECT * INTO o FROM gridex_outbound_dispatch.originals WHERE message_id=m.id AND company_id=c AND environment=env FOR SHARE;
   IF a.id IS NULL OR o.message_id IS NULL OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
    OR o.payload_hash IS DISTINCT FROM m.immutable_payload_hash OR o.raw_payload IS DISTINCT FROM m.raw_payload OR a.binding->>'originalHash' IS DISTINCT FROM o.payload_hash
    OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
    OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false)
    OR (i->>'action'='enter' AND (a.id::text IS DISTINCT FROM i->>'attemptId' OR a.actor_user_id IS DISTINCT FROM actor)) THEN RAISE EXCEPTION 'outbound_dispatch_replay_scope_invalid';END IF;
   SELECT ev.* INTO e FROM gridex_outbound_dispatch.events ev JOIN gridex_outbound_dispatch.witnesses w ON w.event_id=ev.id
    WHERE ev.attempt_id=a.id AND ev.kind='provider_result' AND ev.company_id=c AND ev.environment=env AND ev.facts->>'classification'='accepted';
   RETURN jsonb_build_object('scoped',true,'proceed',false,'state',r.state,'acceptedReceipt',CASE WHEN e.id IS NOT NULL THEN (e.facts->'provider')||jsonb_build_object('observedAt',e.observed_at) ELSE NULL END);
  END IF;
 END IF;
 result:=gridex_outbound_dispatch.mutate_before_original_basis_v1(i);
 IF i->>'action' NOT IN('prepare','enter') OR result->>'scoped' IS DISTINCT FROM 'true' OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 basis:=gridex_ediel_source_rules.capture_v1(c,m.id);
 SELECT * INTO STRICT a FROM gridex_outbound_dispatch.attempts WHERE id=(i->>'attemptId')::uuid AND message_id=m.id AND company_id=c AND environment=env FOR SHARE;
 IF (i->>'action'='prepare' AND i#>'{binding,sourceRulePackEvidence}' IS DISTINCT FROM basis) OR a.binding->'sourceRulePackEvidence' IS DISTINCT FROM basis THEN RAISE EXCEPTION 'outbound_dispatch_original_basis_binding_required';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_outbound_dispatch.mutate_before_original_basis_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) TO service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_outbound_owner FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gridex_ediel_outbound_owner TO service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_prepare_outbound_owner_witness_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_prepare_outbound_owner_witness_v1(jsonb) TO service_role;
REVOKE ALL ON FUNCTION gridex_ediel_source_rules.capture_before_outbound_owner_v1(uuid,uuid),gridex_ediel_source_rules.capture_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_source_rules.capture_v1(uuid,uuid) TO service_role;
COMMIT;
