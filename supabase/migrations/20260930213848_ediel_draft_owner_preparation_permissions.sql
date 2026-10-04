-- Draft authority preserves the actual write/test preparation contract.
-- External provider authorization remains separate and unchanged here.
BEGIN;
CREATE FUNCTION gridex_ediel_outbound_owner.assert_preparation_v1(i jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid:=(i->>'companyId')::uuid;actor uuid:=(i->>'actorUserId')::uuid;
 env text:=i->>'environment';raw text:=i->>'rawPayload';positive uuid:=(i->>'sourceQualifiedPositiveFixtureWitnessId')::uuid;
 negative uuid:=(i->>'sourceQualifiedNegativeFixtureWitnessId')::uuid;q jsonb;
BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor FOR SHARE;
 IF c IS NULL OR actor IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
 THEN RAISE EXCEPTION 'ediel_outbound_owner_actor_scope_required' USING ERRCODE='42501';END IF;
 IF public.gridex_actor_has_company_permission(actor,c,'communication.write') IS TRUE THEN RETURN;END IF;
 IF env IS DISTINCT FROM 'test' OR public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write') IS NOT TRUE
  OR (positive IS NULL)=(negative IS NULL) THEN RAISE EXCEPTION 'ediel_outbound_owner_preparation_permission_required' USING ERRCODE='42501';END IF;
 -- Caller IDs are selectors only. The source owner rechecks actual registered
 -- original, run/role/case/revision/step/bytes, exact preparer and current scope.
 IF positive IS NOT NULL THEN q:=gridex_negative_fixtures.prepared_positive_fixture_v1(c,positive,raw,actor);
 ELSE q:=gridex_negative_fixtures.prepared_negative_fixture_v1(c,negative,raw,actor);END IF;
 IF q IS NULL OR q->>'companyId' IS DISTINCT FROM c::text OR q->'authorizesBusinessEffect' IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'ediel_outbound_owner_preparation_fixture_required';END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_outbound_owner.assert_preparation_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve every canonical source/legal/edition/positive-UTILTS/scope and time
-- constraint in the inner owner. The outer native ACK-guide wrapper stays live.
CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.prepare_before_native_ack_guide_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid;actor uuid;env text;raw text;related uuid;m public.ediel_messages%rowtype;context jsonb;tokens jsonb;
 p public.ediel_message_profiles%rowtype;r public.ediel_rule_packs%rowtype;named_sources jsonb;e jsonb;witness uuid;original public.ediel_messages%rowtype;observed timestamptz:=clock_timestamp();business_date date;
BEGIN
 business_date:=(observed AT TIME ZONE 'Europe/Stockholm')::date;
 c:=(i->>'companyId')::uuid;actor:=(i->>'actorUserId')::uuid;env:=i->>'environment';raw:=i->>'rawPayload';related:=(i->>'relatedMessageId')::uuid;e:=i->'rulePackEvidence';
 IF c IS NULL OR actor IS NULL OR env IS NULL OR env NOT IN('test','production') OR nullif(raw,'') IS NULL OR octet_length(raw)>8388608 OR jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_outbound_owner_witness_required';END IF;
 PERFORM gridex_ediel_outbound_owner.assert_preparation_v1(i);
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
REVOKE ALL ON FUNCTION gridex_ediel_outbound_owner.prepare_before_native_ack_guide_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) RENAME TO prepare_before_preparation_permission_v1;
REVOKE ALL ON FUNCTION gridex_ediel_outbound_owner.prepare_before_preparation_permission_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Qualify the executor before the preserved ACK/source/private history read.
 PERFORM gridex_ediel_outbound_owner.assert_preparation_v1(p_input);
 RETURN gridex_ediel_outbound_owner.prepare_before_preparation_permission_v1(p_input);
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) TO service_role;
COMMIT;
