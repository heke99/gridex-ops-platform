\set ON_ERROR_STOP on
\pset pager off
-- Disposable database only. No fixture survives this transaction.
BEGIN;
CREATE TEMP TABLE register_results(name text PRIMARY KEY,passed boolean NOT NULL,detail text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.register_case(label text, company uuid, source uuid, facts jsonb, reject boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
DECLARE blocked boolean:=false; unexpected text; before_count bigint; after_count bigint; receipt jsonb; exact_saved boolean:=false;
BEGIN
 SELECT count(*) INTO before_count FROM gridex_received_sources.validation_assessments WHERE source_message_id=source;
 BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  receipt:=public.gridex_record_source_validation_v1(company,'test',source,
   encode(sha256(convert_to('register fixture','UTF8')),'hex'),facts::text);
  EXECUTE 'RESET ROLE';
 EXCEPTION WHEN check_violation THEN blocked:=true;
 WHEN OTHERS THEN unexpected:=SQLSTATE||':'||SQLERRM;
 END;
 EXECUTE 'RESET ROLE';
 SELECT count(*) INTO after_count FROM gridex_received_sources.validation_assessments WHERE source_message_id=source;
 IF NOT reject AND receipt ? 'assessmentId' THEN
  SELECT EXISTS (
   SELECT 1 FROM gridex_received_sources.validation_assessments a
   JOIN gridex_received_sources.sources s ON s.source_message_id=a.source_message_id
   WHERE a.id=(receipt->>'assessmentId')::uuid AND a.source_message_id=source
    AND a.company_id=company AND a.environment='test' AND a.source_payload_hash=s.payload_hash
    AND a.facts_text=facts::text
    AND a.facts_hash=encode(sha256(convert_to(facts::text,'UTF8')),'hex')
  ) INTO exact_saved;
 END IF;
 INSERT INTO register_results VALUES(label,unexpected IS NULL AND blocked=reject
  AND after_count=before_count+CASE WHEN reject THEN 0 ELSE 1 END
  AND (reject OR (exact_saved AND receipt->>'sourceDisposition'='not_established')),
  coalesce(unexpected,CASE WHEN blocked THEN 'rejected' WHEN exact_saved THEN 'exact source-bound assessment' ELSE 'missing or altered assessment' END));
END $$;
DO $$
DECLARE company uuid:=gen_random_uuid(); source uuid:=gen_random_uuid(); profile public.ediel_message_profiles%rowtype;
 pack public.ediel_rule_packs%rowtype; facts jsonb; facet jsonb; altered jsonb; key text; bad jsonb;
BEGIN
 INSERT INTO public.companies(id,name,status) VALUES(company,'Register validation fixture','active');
 SELECT * INTO STRICT profile FROM public.ediel_message_profiles WHERE profile_key='PRODAT:Z04:L:26.A:r3' AND is_enabled;
 SELECT * INTO STRICT pack FROM public.ediel_rule_packs WHERE id=profile.rule_pack_id;
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,
  canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 VALUES(source,company,'test','inbound','edifact','PRODAT','Z04','received','register fixture',clock_timestamp(),
  pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile);
 facts:=jsonb_build_object('version',1,'owner','canonical-runtime-with-registry-v1','sourceDisposition','not_established',
  'objectDisposition','not_checked','partyDisposition','not_checked','coverage','canonical_runtime_only','originalTenantMatch','matched',
  'syntaxDecision','accepted','applicationDecision','accepted','functionalDecision','accepted','messageReference','MSG',
  'reasonCodes','[]'::jsonb,'rulePackEvidence',jsonb_build_object('profileKey',profile.profile_key,'messageProfileId',profile.id,'rulePackId',pack.id,'sourceHash',pack.source_hash));
 facet:='{"version":1,"owner":"validateProdatRegisterPolicy","coverage":"canonical_register_only","objects":[{"messageIndex":0,"messageReference":"MSG","objectId":"MP-A","identityAgency":"9","disposition":"accepted","registers":[{"lineIndex":0,"lineNumber":"1","registerIndex":null,"registerPosition":1,"segmentIndex":3}],"reasons":[]},{"messageIndex":0,"messageReference":"MSG","objectId":"MP-B","identityAgency":"89","disposition":"rejected","registers":[{"lineIndex":1,"lineNumber":"2","registerIndex":null,"registerPosition":1,"segmentIndex":4}],"reasons":["PRODAT_REGISTER_INVALID"]}]}'::jsonb;
 PERFORM pg_temp.register_case('legacy-facts-preserved',company,source,facts,false);
 facts:=facts||jsonb_build_object('registerValidation',facet);
 PERFORM pg_temp.register_case('mixed-object-facets-stored-not-approved',company,source,facts,false);
 altered:=jsonb_set(facts,'{registerValidation,objects,0,disposition}','"unavailable"');
 altered:=jsonb_set(altered,'{registerValidation,objects,0,reasons}','["REGISTER_SCOPE_UNAVAILABLE"]');
 altered:=jsonb_set(altered,'{registerValidation,objects,0,objectId}','null');
 PERFORM pg_temp.register_case('explicit-unavailable-identity-stored',company,source,altered,false);
 FOR bad IN SELECT value FROM jsonb_array_elements('[null,[],true,0,"invalid",{}]'::jsonb) LOOP
  PERFORM pg_temp.register_case('invalid-facet-'||bad::text,company,source,jsonb_set(facts,'{registerValidation}',bad));
 END LOOP;
 FOREACH key IN ARRAY ARRAY['version','owner','coverage','objects'] LOOP
  PERFORM pg_temp.register_case('missing-facet-'||key,company,source,jsonb_set(facts,'{registerValidation}',facet-key));
 END LOOP;
 FOREACH key IN ARRAY ARRAY['messageIndex','messageReference','objectId','identityAgency','disposition','registers','reasons'] LOOP
  PERFORM pg_temp.register_case('missing-object-'||key,company,source,jsonb_set(facts,'{registerValidation,objects,0}',(facet#>'{objects,0}')-key));
 END LOOP;
 FOREACH key IN ARRAY ARRAY['lineIndex','lineNumber','registerIndex','registerPosition','segmentIndex'] LOOP
  PERFORM pg_temp.register_case('missing-register-'||key,company,source,jsonb_set(facts,'{registerValidation,objects,0,registers,0}',(facet#>'{objects,0,registers,0}')-key));
 END LOOP;
 FOR key,bad IN SELECT * FROM (VALUES
  ('messageIndex','null'::jsonb),('messageIndex','"0"'::jsonb),('messageIndex','1'::jsonb),('messageIndex','0.5'::jsonb),('messageReference','null'::jsonb),
  ('objectId','null'::jsonb),('objectId','""'::jsonb),('identityAgency','9'::jsonb),('identityAgency','"99"'::jsonb),
  ('disposition','"approved"'::jsonb),('registers','[]'::jsonb),('registers','null'::jsonb),
  ('reasons','["CONTRADICTION"]'::jsonb),('reasons','null'::jsonb)) AS cases(k,v) LOOP
  PERFORM pg_temp.register_case('invalid-object-'||key||bad::text,company,source,jsonb_set(facts,ARRAY['registerValidation','objects','0',key],bad));
 END LOOP;
 FOR key,bad IN SELECT * FROM (VALUES
  ('lineIndex','null'::jsonb),('segmentIndex','null'::jsonb),('registerPosition','null'::jsonb),('lineIndex','-1'::jsonb),('lineIndex','"0"'::jsonb),('segmentIndex','0.5'::jsonb),('segmentIndex','8192'::jsonb),
  ('registerPosition','0'::jsonb),('lineNumber','1'::jsonb),('registerIndex','1'::jsonb)) AS cases(k,v) LOOP
  PERFORM pg_temp.register_case('invalid-register-'||key||bad::text,company,source,jsonb_set(facts,ARRAY['registerValidation','objects','0','registers','0',key],bad));
 END LOOP;
 PERFORM pg_temp.register_case('rejection-needs-reason',company,source,jsonb_set(facts,'{registerValidation,objects,1,reasons}','[]'));
 PERFORM pg_temp.register_case('unsafe-reason',company,source,jsonb_set(facts,'{registerValidation,objects,1,reasons}','["private details"]'));
 PERFORM pg_temp.register_case('duplicate-object',company,source,jsonb_set(facts,'{registerValidation,objects}',(facet->'objects')||jsonb_build_array(facet#>'{objects,0}')));
 PERFORM pg_temp.register_case('duplicate-physical-line',company,source,jsonb_set(facts,'{registerValidation,objects,1,registers,0,lineIndex}','0'));
 PERFORM pg_temp.register_case('duplicate-physical-segment',company,source,jsonb_set(facts,'{registerValidation,objects,1,registers,0,segmentIndex}','3'));
 -- LIN indexes restart inside each UNH; segment indexes remain interchange-wide.
 altered:=jsonb_set(facts,'{registerValidation,objects,0,disposition}','"unavailable"');
 altered:=jsonb_set(altered,'{registerValidation,objects,0,reasons}','["REGISTER_SCOPE_UNAVAILABLE"]');
 altered:=jsonb_set(altered,'{registerValidation,objects,1,disposition}','"unavailable"');
 altered:=jsonb_set(altered,'{registerValidation,objects,1,reasons}','["REGISTER_SCOPE_UNAVAILABLE"]');
 altered:=jsonb_set(altered,'{registerValidation,objects,1,messageIndex}','1');
 altered:=jsonb_set(altered,'{registerValidation,objects,1,messageReference}','"MSG2"');
 altered:=jsonb_set(altered,'{registerValidation,objects,1,registers,0,lineIndex}','0');
 altered:=jsonb_set(altered,'{registerValidation,objects,1,registers,0,lineNumber}','"1"');
 PERFORM pg_temp.register_case('two-unh-local-line-zero-stored-unavailable',company,source,altered,false);
 PERFORM pg_temp.register_case('unavailable-same-message-duplicate-line-rejected',company,source,
  jsonb_set(jsonb_set(altered,'{registerValidation,objects,1,messageIndex}','0'),'{registerValidation,objects,1,messageReference}','"MSG"'));
 PERFORM pg_temp.register_case('two-unh-global-duplicate-segment-rejected',company,source,
  jsonb_set(altered,'{registerValidation,objects,1,registers,0,segmentIndex}','3'));
 PERFORM pg_temp.register_case('facet-not-approval',company,source,jsonb_set(facts,'{sourceDisposition}','"accepted"'));
 PERFORM pg_temp.register_case('facet-injected-approval',company,source,jsonb_set(facts,'{registerValidation}',facet||'{"sourceApproved":true}'));
 PERFORM pg_temp.register_case('rule-version-required',company,source,jsonb_set(jsonb_set(facts,'{applicationDecision}','"rejected"'),'{rulePackEvidence}','null'));
 PERFORM pg_temp.register_case('foreign-company',gen_random_uuid(),source,facts);
END $$;
TABLE register_results;
DO $$ DECLARE failures text; BEGIN
 SELECT string_agg(name||':'||coalesce(detail,''),', ') INTO failures FROM register_results WHERE NOT passed;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'register_validation_regressions_failed: %',failures; END IF;
END $$;
ROLLBACK;
