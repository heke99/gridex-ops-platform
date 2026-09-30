-- Created by actual Supabase CLI2.118.0. Forward corrections preserve the
-- applied original witness migration and reuse the existing U14 storage owner.
BEGIN;
CREATE FUNCTION gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(m public.ediel_messages,p_sending boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;tokens jsonb;code text;transaction_id text;
BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'APERAK' THEN RETURN;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND company_id=m.company_id AND environment=m.environment AND direction='inbound' FOR SHARE;
 IF source.message_family IS DISTINCT FROM 'UTILTS' THEN RETURN;END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='APERAK' AND t#>>'{elements,2,1}'='D' AND t#>>'{elements,2,2}'='04A' AND t#>>'{elements,2,3}'='UN' AND t#>>'{elements,2,4}'='E5SE5A')<>1 THEN RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable';END IF;
 SELECT t#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 IF code='313' THEN RETURN;END IF;
 IF code IS DISTINCT FROM '312' OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW') THEN RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable';END IF;
 -- Each actual physical original IDE has its own durable storage/final-ACK
 -- reservation. No whole-message acceptance flag, parsed hint or first object.
 FOR transaction_id IN SELECT t#>>'{elements,1,1}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' LOOP
  PERFORM public.gridex_require_utilts_positive_ack_authority_v1(m.company_id,m.environment,source.id,transaction_id,
   CASE WHEN p_sending THEN m.id ELSE NULL END,CASE WHEN p_sending THEN m.raw_payload ELSE NULL END);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.prepare_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid;actor uuid;env text;raw text;related uuid;m public.ediel_messages%rowtype;context jsonb;tokens jsonb;
 p public.ediel_message_profiles%rowtype;r public.ediel_rule_packs%rowtype;named_sources jsonb;e jsonb;witness uuid;original public.ediel_messages%rowtype;observed timestamptz:=clock_timestamp();business_date date;
BEGIN
 business_date:=(observed AT TIME ZONE 'Europe/Stockholm')::date;
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
 IF m.message_family='APERAK' AND m.message_code IN('312','313') THEN m.message_code:='APERAK';END IF;
 IF m.message_family='UTILTS' AND m.message_code='ERR' THEN m.message_family:='UTILTS_ERR';END IF;
 IF m.message_family NOT IN('PRODAT','UTILTS','APERAK','UTILTS_ERR') THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_required';END IF;
 m.company_id:=c;m.environment:=env;m.direction:='outbound';m.raw_payload:=raw;m.related_message_id:=related;
 -- Reuse the single source-generated legal/transport/role authority. This
 -- prospective read grants no historical receipt or market activation.
 context:=gridex_ediel_inbound_context.derive(m,observed);
 PERFORM gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(m,false);
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
   OR r.market IS DISTINCT FROM 'electricity' OR r.family IS DISTINCT FROM m.message_family OR r.status NOT IN('active','transition') OR r.valid_from>business_date OR (r.valid_to IS NOT NULL AND r.valid_to<business_date)
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
CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.assert_message_v1(m public.ediel_messages,w gridex_ediel_outbound_owner.witnesses) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF m.company_id IS DISTINCT FROM w.company_id OR m.environment IS DISTINCT FROM w.environment OR m.direction IS DISTINCT FROM 'outbound'
  OR m.message_family IS DISTINCT FROM w.family OR m.message_code IS DISTINCT FROM w.code OR m.related_message_id IS DISTINCT FROM w.related_message_id
  OR encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') IS DISTINCT FROM w.payload_sha256
  OR m.canonical_rule_pack_id::text IS DISTINCT FROM w.evidence->>'rulePackId' OR m.rule_profile_version_id::text IS DISTINCT FROM w.evidence->>'messageProfileId'
  OR m.rule_profile_key IS DISTINCT FROM w.evidence->>'profileKey' OR m.rule_profile_version IS DISTINCT FROM w.evidence->>'version' OR m.rule_pack_checksum IS DISTINCT FROM w.evidence->>'sourceHash'
  OR m.rule_pack_snapshot->>'profileKey' IS DISTINCT FROM w.evidence->>'profileKey' OR m.rule_pack_snapshot->>'profileVersionId' IS DISTINCT FROM w.evidence->>'messageProfileId'
  OR m.rule_pack_snapshot#>'{rulePack}' IS DISTINCT FROM w.evidence#>'{snapshot,rulePack}'
  OR m.rule_pack_snapshot#>'{messageProfile}' IS DISTINCT FROM w.evidence#>'{snapshot,messageProfile}'
  OR m.rule_pack_snapshot#>'{guideSources}' IS DISTINCT FROM w.evidence#>'{snapshot,guideSources}'
  OR m.rule_pack_snapshot->>'version' IS DISTINCT FROM w.evidence->>'version' OR m.rule_pack_snapshot->>'checksum' IS DISTINCT FROM w.evidence->>'sourceHash' THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_scope_invalid';END IF;
END $$;
CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.consume() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_ediel_outbound_owner.witnesses%rowtype;prior gridex_ediel_outbound_owner.consumptions%rowtype;token uuid;
BEGIN
 IF NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_family NOT IN('PRODAT','UTILTS','APERAK','UTILTS_ERR') OR nullif(NEW.raw_payload,'') IS NULL THEN RETURN NEW;END IF;
 token:=(NEW.execution_context_snapshot->>'outboundOwnerWitnessId')::uuid;
 SELECT * INTO w FROM gridex_ediel_outbound_owner.witnesses WHERE id=token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_historical_outbound_owner_witness_unavailable';END IF;
 PERFORM gridex_ediel_outbound_owner.assert_message_v1(NEW,w);
 PERFORM gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(NEW,false);
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

-- Native provider lanes cannot bypass the same accepted-storage owner that
-- manual/kernel/transport consumers use. Old established replays are returned
-- by their existing wrappers BEFORE these fresh first-entry checks.
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_positive_storage_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;
BEGIN
 result:=gridex_ediel_transport.mutate_before_positive_storage_v1(i);
 IF i->>'action' NOT IN('prepare','enter') OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(i->>'messageId')::uuid AND company_id=(i->>'companyId')::uuid AND environment=i->>'environment' AND direction='outbound' FOR SHARE;
 PERFORM gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(m,true);RETURN result;
END $$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_positive_storage_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;
BEGIN
 result:=gridex_outbound_dispatch.mutate_before_positive_storage_v1(i);
 IF i->>'action' NOT IN('prepare','enter') OR result->>'scoped' IS DISTINCT FROM 'true' OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(i->>'messageId')::uuid AND company_id=(i->>'companyId')::uuid AND environment=i->>'environment' AND direction='outbound' FOR SHARE;
 PERFORM gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(m,true);RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(public.ediel_messages,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_before_positive_storage_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_before_positive_storage_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) TO service_role;
COMMIT;
