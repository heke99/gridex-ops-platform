-- A retained, deliberately unqualified source under the genuinely old schema.
-- No actor, issuer, acceptance, transport, or metering authority is invented.
INSERT INTO public.companies(id,name,status) VALUES
 ('00000000-0000-4000-8000-00000000d080','Upgrade continuity owner','active'),
 ('00000000-0000-4000-8000-00000000d081','Upgrade continuity other tenant','active');
INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,
 raw_payload,parsed_payload,validation_report,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,
 canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
SELECT '00000000-0000-4000-8000-00000000d082','00000000-0000-4000-8000-00000000d080','test','inbound','edifact','PRODAT','Z04','received',
 'synthetic unqualified retained upgrade original','{}'::jsonb,'{}'::jsonb,'2026-06-20T09:00:00Z',
 '23-DDQ-PRODAT','12345','54321',pack.id,profile.profile_key,profile.id,
 pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled;
DO $assert$
BEGIN
 IF (SELECT count(*) FROM public.ediel_messages WHERE id='00000000-0000-4000-8000-00000000d082')<>1 THEN
  RAISE EXCEPTION 'upgrade_retained_original_fixture_missing';
 END IF;
END $assert$;
