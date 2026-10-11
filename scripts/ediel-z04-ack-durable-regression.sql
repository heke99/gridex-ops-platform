\set ON_ERROR_STOP on
\pset pager off
-- Local disposable-CI fixture only. Synthetic source/actor setup and the
-- actual canonical syntax facet commit before the ACK proof; no ACK, outbox
-- or business effect commits. The final ACK transaction rolls back. Committed
-- immutable setup survives only until the disposable replay stack is removed.
-- No transport is invoked; the actual mixed-Z04 consumer proof remains separate.
-- The named registry snapshot below is evidence-only. This transaction cannot
-- supply the committed canonical assessment required for delivery authority.
-- BEGIN Z04_FIXTURE_SETUP
CREATE TEMP TABLE gridex_z04_ack_fixture(company_id uuid,foreign_company_id uuid,source_message_id uuid,contrl_id uuid,aperak_id uuid,route_id uuid,profile_id uuid,actor_id uuid);
BEGIN;
DO $$
DECLARE c uuid:=gen_random_uuid(); actor_user uuid:=gen_random_uuid(); foreign_c uuid:=gen_random_uuid(); original uuid:=gen_random_uuid();
  contrl uuid:=gen_random_uuid(); aperak uuid:=gen_random_uuid(); route uuid:=gen_random_uuid(); profile uuid:=gen_random_uuid();
  actor uuid:=gen_random_uuid(); received_at timestamptz:=clock_timestamp();
  own_ediel_id text; source_unb text:='S'||left(replace(original::text,'-',''),13);
  source_unh text:='M'||left(replace(original::text,'-',''),13); source_bgm text:='D'||replace(original::text,'-','');
  source_wire text; guide_snapshot jsonb; original_row public.ediel_messages%rowtype;
  p public.ediel_message_profiles%rowtype; pack public.ediel_rule_packs%rowtype;
BEGIN
 INSERT INTO public.companies(id,name,status) VALUES(c,'Z04 ACK durable fixture','active'),(foreign_c,'Foreign ACK fixture','active');
 -- Technical syntax ports require a current tenant actor and phase (142520).
 INSERT INTO auth.users(instance_id,confirmation_token,recovery_token,email_change_token_new,email_change,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES('00000000-0000-0000-0000-000000000000','','','','',actor_user,'authenticated','authenticated',actor_user||'@example.invalid',now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(actor_user,actor_user||'@example.invalid','Z04 ACK durable actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(c,actor_user,'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT actor_user,c,id,key FROM public.permissions WHERE key IN('communication.read','communication.write','communication.send');
 SELECT * INTO STRICT p FROM public.ediel_message_profiles WHERE profile_key='PRODAT:Z04:L:26.A:r3' AND is_enabled
   AND message_code='Z04' AND transaction_subtype='L' AND direction IN('inbound','both');
 SELECT * INTO STRICT pack FROM public.ediel_rule_packs WHERE id=p.rule_pack_id AND family='PRODAT'
   AND status IN('active','transition') AND valid_from<=received_at::date AND (valid_to IS NULL OR valid_to>=received_at::date);
 guide_snapshot:=jsonb_build_object('profileKey',p.profile_key,'profileVersionId',p.id,
   'version',pack.guide_version||':r'||pack.guide_revision,'checksum',pack.source_hash,
   'rulePack',to_jsonb(pack),'messageProfile',to_jsonb(p),'guideSources',
   (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=pack.id),
   'databaseRole','evidence_only');
 -- A fresh local recipient and role are observed at this invocation; neither
 -- the old document date nor a public snapshot manufactures an ingress basis.
 SELECT n::text INTO STRICT own_ediel_id FROM generate_series(54000,54999) n
   WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.environment='test' AND i.identifier_type='EdielId' AND i.identifier_value=n::text)
   ORDER BY n LIMIT 1;
 INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled) VALUES(c,'test','electricity',true);
 INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value) VALUES(c,'test',actor,'EdielId',own_ediel_id);
 INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code) VALUES(c,'test',actor,'electricity_supplier');
 INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active)
 VALUES(route,c,'Synthetic ACK route','ediel_ack','bilateral_test',true);
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled)
 VALUES(profile,c,route,'Synthetic ACK profile','test','edifact',own_ediel_id,'12345','23-DDQ-PRODAT',true);
 -- Same physically scoped source as mixedZ04Parts: only LIN2 lacks its own
 -- QTY31/field213. P26.A r3 pp47,54,114–116; source dates remain unchanged.
 source_wire:='UNA:+.? '''||array_to_string(ARRAY[
   format('UNB+UNOC:3+12345:14+%s:14+260917:1200+%s++23-DDQ-PRODAT++1++1',own_ediel_id,source_unb),
   format('UNH+%s+PRODAT:D:97A:UN:E2SE6A',source_unh),format('BGM+Z04+%s+9+AB',source_bgm),
   'DTM+137:202609171200:203','DTM+ZZZ:1:805','NAD+FR+12345:160:SVK+++++++SE',format('NAD+DO+%s:160:SVK+++++++SE',own_ediel_id),
   'LIN+1++735123456789012345:::89','DTM+92:202610010000:203','DTM+354:15:806',
   -- Field 213 (QTY+31) deliberately absent: the source owner rejects it and the
   -- negative APERAK below answers exactly that application error.
   'CCI++Z13','CAV+Z22','CCI++Z04','CAV+Z03','CCI++Z07','CAV+Z12','CCI++Z12','CAV+:::W','CCI++Z15','CAV+D','CCI++Z14','CAV+:::L917:8716867000030',
   'RFF+MG:METER-735123456789012345','RFF+Z05:TES','RFF+LI:CASE-735123456789012345',
   'NAD+UD+CUSTOMER-735123456789012345::89++A+Street+City++12345+SE','NAD+IT+735123456789012345::89+++Street+City++12345+SE',format('NAD+Z02+%s:160:SVK',own_ediel_id),
   format('UNT+28+%s',source_unh),format('UNZ+1+%s',source_unb)],'''')||'''';
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,
  message_version,sender_ediel_id,receiver_ediel_id,application_reference,interchange_reference,message_reference,bgm_reference,
  canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,metadata,parsed_payload)
 VALUES(original,c,'test','inbound','edifact','PRODAT','Z04','received',source_wire,received_at,
  'E2SE6A','12345',own_ediel_id,'23-DDQ-PRODAT',source_unb,source_unh,source_bgm,
  pack.id,p.profile_key,p.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,guide_snapshot,
  jsonb_build_object('nativeFixture','ediel-z04-ack-durable-v1'),
  -- Parsed source facts as the production parser records them for these objects.
  '{"subtype":"L","prodatDependentFacts":{"market":"electricity","meterReadingsSentInUtilts":false}}'::jsonb)
 RETURNING * INTO original_row;
 PERFORM public.ediel_require_inbound_legal_context_v1(c,original);
 INSERT INTO pg_temp.gridex_z04_ack_fixture VALUES(c,foreign_c,original,contrl,aperak,route,profile,actor_user);
END $$;
COMMIT;
-- END Z04_FIXTURE_SETUP

-- The producer reads these exact committed bytes, executes the actual canonical
-- syntax validator, then records its result through the genuine service-role
-- command in a separate committed transaction. Missing/failed evidence makes
-- capture below fail; a snapshot or an uncommitted facet cannot supply it.
SELECT company_id AS z04_fixture_company_id,source_message_id AS z04_fixture_source_id,actor_id AS z04_fixture_actor_id FROM pg_temp.gridex_z04_ack_fixture \gset
\pset format unaligned
\pset tuples_only on
SELECT to_jsonb(m) FROM public.ediel_messages m JOIN pg_temp.gridex_z04_ack_fixture f ON f.source_message_id=m.id AND f.company_id=m.company_id \g | node scripts/ediel-z04-ack-durable-embedded-check.mjs --record-native-syntax-facet
\if :SHELL_ERROR
DO $$ BEGIN RAISE EXCEPTION 'z04_actual_syntax_producer_failed'; END $$;
\endif
-- Production receive order: the producer above recorded the canonical owner's
-- validation (with its PRODAT response facet) in its own committed transaction;
-- the immutable source rule receipt reads only that earlier commit.
SELECT gridex_ediel_source_rules.capture_v1(company_id,source_message_id) IS NOT NULL AS z04_source_rule_receipt FROM pg_temp.gridex_z04_ack_fixture \g
\pset tuples_only off
\pset format aligned

-- BEGIN Z04_ACK_PROOF
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.ediel_capture_technical_syntax_ack_basis_v2(:'z04_fixture_company_id'::uuid,:'z04_fixture_source_id'::uuid,:'z04_fixture_actor_id'::uuid,'prepare');
RESET ROLE;
DO $$
DECLARE c uuid;foreign_c uuid;original uuid;contrl uuid;aperak uuid;route uuid;profile uuid;actor_user uuid;aperak_witness jsonb;
 received_at timestamptz;rendered_at timestamptz;own_ediel_id text;source_unb text;source_unh text;source_bgm text;
 contrl_unb text;aperak_unb text;contrl_wire text;aperak_wire text;original_row public.ediel_messages%rowtype;
 denied boolean:=false;before_retry jsonb;after_retry jsonb;collision_error text;endpoint_error text;
BEGIN
 SELECT company_id,foreign_company_id,source_message_id,contrl_id,aperak_id,route_id,profile_id,actor_id
 INTO STRICT c,foreign_c,original,contrl,aperak,route,profile,actor_user FROM pg_temp.gridex_z04_ack_fixture;
 SELECT * INTO STRICT original_row FROM public.ediel_messages WHERE id=original AND company_id=c;
 received_at:=original_row.message_received_at;own_ediel_id:=original_row.receiver_ediel_id;
 source_unb:=original_row.interchange_reference;source_unh:=original_row.message_reference;source_bgm:=original_row.bgm_reference;
 contrl_unb:='C'||left(replace(contrl::text,'-',''),13);aperak_unb:='A'||left(replace(aperak::text,'-',''),13);
 rendered_at:=clock_timestamp();
 contrl_wire:=format($wire$UNA:+.? 'UNB+UNOC:3+%s:14+12345:14+%s+%s++23-DDQ-PRODAT++++1'UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+%s+12345:14+%s:14+1'UNT+3+1'UNZ+1+%s'$wire$,
   own_ediel_id,to_char(rendered_at AT TIME ZONE 'Europe/Stockholm','YYMMDD:HH24MI'),contrl_unb,source_unb,own_ediel_id,contrl_unb);
 -- ACK-10: no invented P-APERAK BGM1004. ACW/UCI copy actual source
 -- references. Optional A901 records this actual receipt, not its UNB date.
 aperak_wire:=format($wire$UNA:+.? 'UNB+UNOC:3+%s:14+12345:14+%s+%s++23-DDQ-PRODAT++++1'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++34'DTM+137:%s:203'DTM+178:%s:203'RFF+ACW:%s'NAD+FR+%s:160:SVK+++++++SE'NAD+DO+12345:160:SVK+++++++SE'ERC+41::260'FTX+AAO++213::260+Uppskattad årsenergi saknas'RFF+Z07:735123456789012345'RFF+LI:CASE-735123456789012345'UNT+12+1'UNZ+1+%s'$wire$,
   own_ediel_id,to_char(rendered_at AT TIME ZONE 'Europe/Stockholm','YYMMDD:HH24MI'),aperak_unb,
   to_char(rendered_at AT TIME ZONE 'Europe/Stockholm','YYYYMMDDHH24MI'),to_char(received_at AT TIME ZONE 'Europe/Stockholm','YYYYMMDDHH24MI'),source_bgm,own_ediel_id,aperak_unb);
 -- A PRODAT reply needs its frozen outbound owner witness (043602), prepared
 -- by the current actor from the original's own rule evidence.
 aperak_witness:=gridex_ediel_outbound_owner.prepare_v1(jsonb_build_object('companyId',c,'actorUserId',actor_user,'environment','test',
  'rawPayload',aperak_wire,'relatedMessageId',original,'rulePackEvidence',gridex_ediel_source_rules.require_v1(c,original)));
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,
  related_message_id,ack_outcome,communication_route_id,route_profile_id,application_reference,source_operation_id,
  canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,execution_context_snapshot)
 VALUES
 (contrl,c,'test','outbound','edifact','CONTRL','CONTRL','draft',contrl_wire,original,'positive',route,profile,'23-DDQ-PRODAT','ediel_ack:'||original||':CONTRL:message',
  original_row.canonical_rule_pack_id,original_row.rule_profile_key,original_row.rule_profile_version_id,original_row.rule_profile_version,original_row.rule_pack_checksum,original_row.rule_pack_snapshot,DEFAULT),
 (aperak,c,'test','outbound','edifact','APERAK','APERAK','draft',aperak_wire,original,'negative',route,profile,'23-DDQ-PRODAT','ediel_ack:'||original||':APERAK:message',
  original_row.canonical_rule_pack_id,original_row.rule_profile_key,original_row.rule_profile_version_id,original_row.rule_profile_version,original_row.rule_pack_checksum,original_row.rule_pack_snapshot,
  jsonb_build_object('outboundOwnerWitnessId',aperak_witness->>'witnessId'));
 PERFORM public.ediel_require_inbound_legal_context_v1(c,contrl);
 PERFORM public.ediel_require_inbound_legal_context_v1(c,aperak);
 INSERT INTO public.ediel_outbox(company_id,ediel_message_id,source_message_id,status,lock_key,environment,route_profile_id)
 VALUES(c,contrl,original,'queued',c||':test:'||original||':CONTRL:positive','test',profile),
       (c,aperak,original,'queued',c||':test:'||original||':APERAK:negative','test',profile);
 IF (SELECT count(*) FROM public.ediel_messages WHERE company_id=c AND related_message_id=original AND direction='outbound' AND
    ((id=contrl AND message_family='CONTRL' AND ack_outcome='positive') OR (id=aperak AND message_family='APERAK' AND ack_outcome='negative')))
    <>2 THEN RAISE EXCEPTION 'z04_ack_pair_missing'; END IF;
 IF (SELECT count(*) FROM public.ediel_outbox o JOIN public.ediel_messages m ON m.id=o.ediel_message_id
     WHERE o.company_id=c AND o.environment='test' AND o.source_message_id=original AND o.route_profile_id=profile
       AND m.company_id=o.company_id AND m.communication_route_id=route AND m.related_message_id=o.source_message_id
       AND o.status='queued' AND o.immutable_payload_hash=m.immutable_payload_hash
       AND o.rule_profile_version_id=original_row.rule_profile_version_id AND o.rule_pack_checksum=original_row.rule_pack_checksum
       AND o.rule_pack_snapshot=original_row.rule_pack_snapshot)<>2 THEN
    RAISE EXCEPTION 'z04_ack_outbox_pair_unbound'; END IF;
 IF EXISTS(SELECT 1 FROM public.ediel_messages WHERE related_message_id=original AND ack_outcome='positive' AND message_family='APERAK') THEN
    RAISE EXCEPTION 'z04_positive_sibling_ack'; END IF;
 BEGIN
  INSERT INTO public.ediel_outbox(company_id,ediel_message_id,source_message_id,status,lock_key,environment)
  VALUES(foreign_c,aperak,original,'queued','wrong-tenant/'||aperak,'test');
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'z04_foreign_tenant_outbox_accepted'; END IF;
 -- The namespace retry owner must retain every message/outbox field and the
 -- original reservation/identity receipt, including their actual timestamps.
 SELECT jsonb_build_object(
  'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.ediel_messages m WHERE m.id IN(original,contrl,aperak)),
  'outbox',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.ediel_outbox o WHERE o.source_message_id=original),
  'reservations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.reference_kind,r.wire_reference) FROM gridex_ediel_wire_namespace.reservations r WHERE r.source_message_id IN(contrl,aperak)),
  'coverage',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id) FROM gridex_ediel_wire_namespace.coverage r WHERE r.source_message_id IN(contrl,aperak)),
  'identifiers',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.tenant_actor_identifiers i WHERE i.company_id=c),
  'identity',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id) FROM gridex_ediel_inbound_context.receipts r WHERE r.source_message_id IN(original,contrl,aperak))) INTO before_retry;
 PERFORM public.ediel_reserve_wire_reference_namespace_v1(c,contrl);
 PERFORM public.ediel_reserve_wire_reference_namespace_v1(c,aperak);
 PERFORM public.ediel_require_inbound_legal_context_v1(c,contrl);
 PERFORM public.ediel_require_inbound_legal_context_v1(c,aperak);
 -- The actual current public guard must refuse a now-expired technical
 -- endpoint even with a genuine committed syntax facet. Its subtransaction
 -- restores the identifier and the original ACK on that exact refusal.
 BEGIN
  UPDATE public.tenant_actor_identifiers SET valid_to=clock_timestamp() WHERE company_id=c AND environment='test';
  UPDATE public.ediel_messages SET rule_pack_snapshot=rule_pack_snapshot WHERE id=contrl AND company_id=c;
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS endpoint_error=MESSAGE_TEXT;
 END;
 IF endpoint_error IS DISTINCT FROM 'ediel_technical_endpoint_unqualified' THEN
  RAISE EXCEPTION 'z04_ack_expired_endpoint_not_refused: %',endpoint_error;
 END IF;
 -- A distinct row may not own the already reserved physical ACK. The failed
 -- INSERT must leave neither a message nor partial namespace reservations.
 BEGIN
  INSERT INTO public.ediel_messages
  SELECT (jsonb_populate_record(NULL::public.ediel_messages,to_jsonb(m)||
   jsonb_build_object('id',gen_random_uuid(),'source_operation_id','duplicate/'||aperak))).*
  FROM public.ediel_messages m WHERE m.id=aperak;
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS collision_error=MESSAGE_TEXT;
 END;
 IF collision_error IS DISTINCT FROM 'ediel_wire_reference_namespace_collision' THEN
  RAISE EXCEPTION 'z04_ack_wire_collision_not_refused: %',collision_error;
 END IF;
 SELECT jsonb_build_object(
  'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.ediel_messages m WHERE m.id IN(original,contrl,aperak)),
  'outbox',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.ediel_outbox o WHERE o.source_message_id=original),
  'reservations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.reference_kind,r.wire_reference) FROM gridex_ediel_wire_namespace.reservations r WHERE r.company_id=c),
  'coverage',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id) FROM gridex_ediel_wire_namespace.coverage r WHERE r.company_id=c),
  'identifiers',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.tenant_actor_identifiers i WHERE i.company_id=c),
  'identity',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id) FROM gridex_ediel_inbound_context.receipts r WHERE r.company_id=c)) INTO after_retry;
 IF after_retry IS DISTINCT FROM before_retry OR
  (SELECT count(*) FROM public.ediel_messages WHERE company_id=c AND related_message_id=original)<>2 THEN
  RAISE EXCEPTION 'z04_ack_retry_or_collision_changed_durable_rows';
 END IF;
 RAISE NOTICE 'z04_durable_ack_pair PASS company/source/route/hash/negative-only/foreign-tenant/current-endpoint/full-row-retry/atomic-wire-collision';
END $$;
ROLLBACK;
DROP TABLE pg_temp.gridex_z04_ack_fixture;
