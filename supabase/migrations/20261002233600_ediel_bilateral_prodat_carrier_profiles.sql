-- Masterplan P16 bilateral PRODAT carriers (see
-- quality/audits/ediel-masterplan-v2/final-recovery-20260930/BILATERAL-PRODAT-PRODUCER-20261001.md):
-- normal_start_h = Z03/H + Z04/H, own_end_h = Z05/H, closure_request_lk =
-- Z08/LK + Z05/LK. 20261001013034 (gridex_bilateral_prodat.scope_v1) selects
-- these message profiles from the PRODAT 26.A r3 pack, but no migration
-- created Z03/H, Z04/H, Z05/H or Z08/LK, so every bilateral scope was held.
--
-- National PRODAT 26.A defines Z08/H (reason Z25, answered by Z05/L) and the
-- L/LK/C families; it defines no H start/end and no LK closure request. These
-- four profiles are therefore bilateral carriers only: their grammar is the
-- national sibling's (same message code and direction), they carry the
-- bilateral reason (H: Z25, LK: Z23) and are explicitly marked
-- bilateralCarrierOnly. They grant nothing by themselves: use still requires the
-- archived, issuer-signed and independently reviewed bilateral profile, the
-- scoped tenant agreement and source capability (20261001013034, 20261001020013).
--
-- scope_v1 also read ediel_field_rules.message_profile_id, a column that does
-- not exist (PRODAT 26.A field rules are per message code, subtype optional).
-- It now reads the profile's code-level field rules: same code, and either no
-- subtype or the profile's subtype. Its ACK grammar likewise required an exact
-- message code and missed the pack's PRODAT ACK rule, which applies to every
-- code (message_code '*'); a wildcard rule now counts. Nothing else changes.
--
-- The signed issuer receipt embeds this exact scope, which now carries the
-- complete grammar (about 240 KB base64 for normal_start_h). receipt_current_v1
-- capped payloadBase64 at 64 KiB, so no complete receipt could verify. The cap
-- is raised to 1 MiB; the HMAC signature, scope/source hash and every other
-- check are unchanged.
BEGIN;
DO $pre$DECLARE pack uuid;BEGIN
 SELECT id INTO pack FROM public.ediel_rule_packs WHERE family='PRODAT' AND guide_version='26.A' AND guide_revision='3' AND market='electricity' AND status IN('active','transition');
 IF pack IS NULL OR EXISTS(SELECT FROM public.ediel_message_profiles WHERE rule_pack_id=pack AND (message_code,transaction_subtype) IN(('Z03','H'),('Z04','H'),('Z05','H'),('Z08','LK')))
  OR (SELECT count(*) FROM public.ediel_message_profiles WHERE rule_pack_id=pack AND profile_key IN('PRODAT:Z03:L:26.A:r3','PRODAT:Z04:L:26.A:r3','PRODAT:Z05:L:26.A:r3','PRODAT:Z08:H:26.A:r3'))<>4
 THEN RAISE EXCEPTION 'bilateral_prodat_carrier_profiles_predecessor_required';END IF;
END$pre$;
INSERT INTO public.ediel_message_profiles(rule_pack_id,message_code,transaction_subtype,direction,business_process,phase,profile_key,profile,is_enabled)
SELECT s.rule_pack_id,c.code,c.subtype,s.direction,c.process,s.phase,'PRODAT:'||c.code||':'||c.subtype||':26.A:r3',
 s.profile||jsonb_build_object('transactionSubtype',c.subtype,'reasonForTransaction',c.reason,'businessProcess',c.process,'businessEvent',c.event,
  'semanticSource','Bilateral carrier (masterplan P16); grammar of national '||s.profile_key||'; not a national PRODAT 26.A meaning',
  'bilateralCarrierOnly',true,'bilateralKind',c.kind,'grammarSourceProfileKey',s.profile_key),true
FROM (VALUES
 ('Z03','H','PRODAT:Z03:L:26.A:r3','Z25','bilateral_supply_start_h','bilateral_supply_start_h_requested','normal_start_h'),
 ('Z04','H','PRODAT:Z04:L:26.A:r3','Z25','bilateral_supply_start_h_response','bilateral_supply_start_h_confirmed','normal_start_h'),
 ('Z05','H','PRODAT:Z05:L:26.A:r3','Z25','bilateral_supply_end_h','bilateral_supply_end_h_notified','own_end_h'),
 ('Z08','LK','PRODAT:Z08:H:26.A:r3','Z23','bilateral_closure_request_lk','bilateral_closure_lk_requested','closure_request_lk')
) c(code,subtype,source_key,reason,process,event,kind)
JOIN public.ediel_message_profiles s ON s.profile_key=c.source_key;
-- Runtime capabilities mirror each carrier's national sibling for its own
-- direction (builder only for the outbound carriers).
INSERT INTO public.ediel_runtime_capabilities(rule_pack_id,message_code,transaction_subtype,direction,parser_ready,builder_ready,validator_ready,ack_ready,state_machine_ready,route_required,certificate_required,verification)
SELECT p.rule_pack_id,p.message_code,p.transaction_subtype,p.direction,s.parser_ready,p.direction='outbound' AND s.builder_ready,s.validator_ready,s.ack_ready,s.state_machine_ready,s.route_required,s.certificate_required,
 s.verification||jsonb_build_object('source','bilateral-carrier-profile','grammarSourceProfileKey',p.profile->>'grammarSourceProfileKey','migration','20261002130000')
FROM public.ediel_message_profiles p
JOIN public.ediel_message_profiles g ON g.rule_pack_id=p.rule_pack_id AND g.profile_key=p.profile->>'grammarSourceProfileKey'
JOIN public.ediel_runtime_capabilities s ON s.rule_pack_id=g.rule_pack_id AND s.message_code=g.message_code AND s.transaction_subtype=g.transaction_subtype
WHERE p.profile->>'bilateralCarrierOnly'='true' AND p.profile_key IN('PRODAT:Z03:H:26.A:r3','PRODAT:Z04:H:26.A:r3','PRODAT:Z05:H:26.A:r3','PRODAT:Z08:LK:26.A:r3');
DO $cap$BEGIN IF (SELECT count(*) FROM public.ediel_runtime_capabilities c JOIN public.ediel_message_profiles p ON p.rule_pack_id=c.rule_pack_id AND p.message_code=c.message_code AND p.transaction_subtype=c.transaction_subtype AND p.direction=c.direction WHERE p.profile->>'bilateralCarrierOnly'='true')<>4
 THEN RAISE EXCEPTION 'bilateral_prodat_carrier_capabilities_incomplete';END IF;END$cap$;
DO $scope$DECLARE f record;
 needle CONSTANT text:=$n$FROM public.ediel_field_rules r WHERE r.message_profile_id IN(SELECT (p->>'id')::uuid FROM jsonb_array_elements(profiles) p)$n$;
 replacement CONSTANT text:=$n$FROM public.ediel_field_rules r WHERE r.message_family='PRODAT' AND coalesce(r.is_active,true) AND coalesce(r.enabled,true)
   AND EXISTS(SELECT FROM jsonb_array_elements(profiles) p WHERE p->>'message_code'=r.message_code AND (nullif(r.subtype,'') IS NULL OR r.subtype=p->>'transaction_subtype'))$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_bilateral_prodat.scope_v1(uuid,jsonb)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'bilateral_prodat_scope_field_rules_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'bilateral_prodat_scope_field_rules_metadata_changed';END IF;
END$scope$;
DO $acks$DECLARE f record;
 needle CONSTANT text:=$n$r.inbound_family='PRODAT' AND r.message_code IN(SELECT p->>'message_code' FROM jsonb_array_elements(profiles) p)$n$;
 replacement CONSTANT text:=$n$r.inbound_family='PRODAT' AND (r.message_code='*' OR r.message_code IN(SELECT p->>'message_code' FROM jsonb_array_elements(profiles) p))$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_bilateral_prodat.scope_v1(uuid,jsonb)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'bilateral_prodat_scope_ack_rules_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'bilateral_prodat_scope_ack_rules_metadata_changed';END IF;
END$acks$;
DO $receipt$DECLARE f record;
 needle CONSTANT text:=$n$length(coalesce(receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 65536$n$;
 replacement CONSTANT text:=$n$length(coalesce(receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 1048576$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_bilateral_prodat.receipt_current_v1(gridex_bilateral_prodat.artifacts)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'bilateral_prodat_receipt_size_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'bilateral_prodat_receipt_size_metadata_changed';END IF;
END$receipt$;
COMMIT;
