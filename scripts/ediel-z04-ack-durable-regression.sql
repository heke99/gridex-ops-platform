\set ON_ERROR_STOP on
\pset pager off
-- Native, rolled-back relationship proof for the two ACKs produced by the
-- actual mixed-Z04 inbound consumer test. No transport is invoked.
BEGIN;
DO $$
DECLARE c uuid:=gen_random_uuid(); foreign_c uuid:=gen_random_uuid(); original uuid:=gen_random_uuid();
  contrl uuid:=gen_random_uuid(); aperak uuid:=gen_random_uuid(); route uuid:=gen_random_uuid(); profile uuid:=gen_random_uuid();
  p public.ediel_message_profiles%rowtype; pack public.ediel_rule_packs%rowtype; denied boolean:=false;
BEGIN
 INSERT INTO public.companies(id,name,status) VALUES(c,'Z04 ACK durable fixture','active'),(foreign_c,'Foreign ACK fixture','active');
 SELECT * INTO STRICT p FROM public.ediel_message_profiles WHERE profile_key='PRODAT:Z04:L:26.A:r3' AND is_enabled;
 SELECT * INTO STRICT pack FROM public.ediel_rule_packs WHERE id=p.rule_pack_id;
 INSERT INTO public.communication_routes(id,company_id,route_name,environment_type,is_active)
 VALUES(route,c,'Synthetic ACK route','bilateral_test',true);
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled)
 VALUES(profile,c,route,'Synthetic ACK profile','test','edifact','54321','12345','23-DDQ-PRODAT',true);
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,
  canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 VALUES(original,c,'test','inbound','edifact','PRODAT','Z04','validated','mixed Z04 original',clock_timestamp(),
  pack.id,p.profile_key,p.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,p.profile);
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,
  related_message_id,ack_outcome,communication_route_id,route_profile_id,application_reference,source_operation_id,
  canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 VALUES
 (contrl,c,'test','outbound','edifact','CONTRL','1','draft','CONTRL synthetic original-only ACK',original,'positive',route,profile,'23-DDQ-PRODAT','ediel_ack:'||original||':CONTRL:message',
  pack.id,p.profile_key,p.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,p.profile),
 (aperak,c,'test','outbound','edifact','APERAK','1','draft','FTX+AAO++213::260 RFF+Z07:735123456789012345',original,'negative',route,profile,'23-DDQ-PRODAT','ediel_ack:'||original||':APERAK:message',
  pack.id,p.profile_key,p.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,p.profile);
 INSERT INTO public.ediel_outbox(company_id,ediel_message_id,source_message_id,status,lock_key,environment,route_profile_id)
 VALUES(c,contrl,original,'queued',c||':test:'||original||':CONTRL:positive','test',profile),
       (c,aperak,original,'queued',c||':test:'||original||':APERAK:negative','test',profile);
 IF (SELECT count(*) FROM public.ediel_messages WHERE company_id=c AND related_message_id=original AND direction='outbound' AND
    ((id=contrl AND message_family='CONTRL' AND ack_outcome='positive') OR (id=aperak AND message_family='APERAK' AND ack_outcome='negative')))
    <>2 THEN RAISE EXCEPTION 'z04_ack_pair_missing'; END IF;
 IF (SELECT count(*) FROM public.ediel_outbox o JOIN public.ediel_messages m ON m.id=o.ediel_message_id
     WHERE o.company_id=c AND o.environment='test' AND o.source_message_id=original AND o.route_profile_id=profile
       AND m.company_id=o.company_id AND m.communication_route_id=route AND m.related_message_id=o.source_message_id
       AND o.status='queued' AND o.immutable_payload_hash=m.immutable_payload_hash)<>2 THEN
    RAISE EXCEPTION 'z04_ack_outbox_pair_unbound'; END IF;
 IF EXISTS(SELECT 1 FROM public.ediel_messages WHERE related_message_id=original AND ack_outcome='positive' AND message_family='APERAK') THEN
    RAISE EXCEPTION 'z04_positive_sibling_ack'; END IF;
 BEGIN
  INSERT INTO public.ediel_outbox(company_id,ediel_message_id,source_message_id,status,lock_key,environment)
  VALUES(foreign_c,aperak,original,'queued','wrong-tenant/'||aperak,'test');
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'z04_foreign_tenant_outbox_accepted'; END IF;
 RAISE NOTICE 'z04_durable_ack_pair PASS company/source/route/hash/negative-only/foreign-tenant';
END $$;
ROLLBACK;
