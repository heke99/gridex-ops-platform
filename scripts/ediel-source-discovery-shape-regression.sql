\set ON_ERROR_STOP on
\pset pager off
-- E035 PR370 review regression. Run only in disposable local replay.
-- Every source, read set, successful or rejected attempt rolls back together.
BEGIN;
CREATE TEMP TABLE source_shape_results(name text PRIMARY KEY,passed boolean NOT NULL,detail text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.shape_source(payload text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE company uuid:=gen_random_uuid(); source_id uuid:=gen_random_uuid(); snap jsonb;
BEGIN
 INSERT INTO public.companies(id,name,status) VALUES(company,'Rollback E035 shape probe','active');
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,
   canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT source_id,company,'test','inbound','edifact','PRODAT','Z04','received',payload,'2026-06-20T09:00:00.123456Z',
   pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,coalesce(profile.profile,'{}'::jsonb)
 FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
 WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'shape_fixture_profile_missing'; END IF;
 EXECUTE 'SET LOCAL ROLE service_role';
 snap:=public.gridex_received_source_snapshot_v1(company,'test',clock_timestamp());
 EXECUTE 'RESET ROLE';
 IF snap->>'sourceCount'<>'1' THEN RAISE EXCEPTION 'shape_fixture_snapshot_mismatch'; END IF;
 RETURN snap;
END $$;
CREATE FUNCTION pg_temp.shape_inventory(snap jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('version',1,'universe','durable_received_sources','historyCoverage','before_ledger_unknown',
  'authorityStatus','not_established','selection','not_performed','status','enumerated','issues','[]'::jsonb,
  'sources',jsonb_build_array(jsonb_build_object('sourceMessageId',snap->'sources'->0->'sourceMessageId',
    'sourcePayloadHash',snap->'sources'->0->'payloadHash','sourceReceivedAt',snap->'sources'->0->'sourceReceivedAt',
    'capturedAt',snap->'sources'->0->'capturedAt','receiptStatus','recorded','disposition','not_checked',
    'status','enumerated','issues','[]'::jsonb,
    'occurrences','[{"ordinal":1,"segmentIndex":3,"messageIndex":0,"lineNumber":"1","objectId":"MP-A","identityAgency":"9","identityStatus":"observed"},{"ordinal":2,"segmentIndex":4,"messageIndex":0,"lineNumber":"2","objectId":"MP-B","identityAgency":"89","identityStatus":"observed"}]'::jsonb,
    'objects','[{"messageIndex":0,"objectId":"MP-A","identityAgency":"9","occurrenceOrdinals":[1]},{"messageIndex":0,"objectId":"MP-B","identityAgency":"89","occurrenceOrdinals":[2]}]'::jsonb)))
$$;
CREATE FUNCTION pg_temp.shape_case(label text,snap jsonb,inventory jsonb,should_reject boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
DECLARE blocked boolean:=false; unexpected text; receipt jsonb; before_count bigint; after_count bigint;
BEGIN
 SELECT count(*) INTO before_count FROM gridex_received_sources.discovery_attempts WHERE snapshot_id=(snap->>'snapshotId')::uuid;
 BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  receipt:=public.gridex_record_source_discovery_v1((snap->>'companyId')::uuid,'test',(snap->>'snapshotId')::uuid,
    snap->>'snapshotHash','physical-lin-inventory-v1',inventory::text);
  EXECUTE 'RESET ROLE';
 EXCEPTION WHEN check_violation THEN blocked:=true;
 WHEN OTHERS THEN unexpected:=SQLSTATE||':'||SQLERRM;
 END;
 EXECUTE 'RESET ROLE';
 SELECT count(*) INTO after_count FROM gridex_received_sources.discovery_attempts WHERE snapshot_id=(snap->>'snapshotId')::uuid;
 INSERT INTO source_shape_results VALUES(label,
   unexpected IS NULL AND blocked=should_reject AND after_count=before_count+CASE WHEN should_reject THEN 0 ELSE 1 END
   AND (should_reject OR (receipt->>'inventoryHash'=encode(sha256(convert_to(inventory::text,'UTF8')),'hex') AND receipt->>'snapshotHash'=snap->>'snapshotHash')),
   CASE WHEN unexpected IS NOT NULL THEN unexpected WHEN blocked THEN '23514, no inserted attempt' ELSE 'stored receipt' END);
END $$;
DO $$
DECLARE snap jsonb; inv jsonb; altered jsonb; key text; bad jsonb; mode text; null_snap jsonb; null_inv jsonb;
BEGIN
 snap:=pg_temp.shape_source('UNB+UNOC:3+111:14+222:14+260620:0900+REF''UNH+MSG+PRODAT:D:96B:UN''BGM+Z04+DOC+9''LIN+1++MP-A:::9''LIN+2++MP-B:::89''UNT+5+MSG''UNZ+1+REF''');
 inv:=pg_temp.shape_inventory(snap);
 PERFORM pg_temp.shape_case('valid/full-typed-inventory',snap,inv,false);
 altered:=jsonb_set(jsonb_set(inv,'{sources,0,occurrences}','[{"identityStatus":"observed"}]'),'{sources,0,objects}','[{}]');
 PERFORM pg_temp.shape_case('reject/reviewer-minimal-occurrence-and-object',snap,altered);
 FOREACH key IN ARRAY ARRAY['ordinal','segmentIndex','messageIndex','lineNumber','objectId','identityAgency','identityStatus'] LOOP
  altered:=jsonb_set(inv,'{sources,0,occurrences,0}',(inv#>'{sources,0,occurrences,0}')-key);
  PERFORM pg_temp.shape_case('reject/occurrence/missing-'||key,snap,altered);
 END LOOP;
 FOR key,bad IN SELECT * FROM (VALUES
  ('ordinal','"1"'::jsonb),('ordinal','null'::jsonb),('ordinal','0'::jsonb),('ordinal','1.5'::jsonb),
  ('segmentIndex','"3"'::jsonb),('segmentIndex','null'::jsonb),('segmentIndex','-1'::jsonb),('segmentIndex','3.5'::jsonb),('segmentIndex','8192'::jsonb),
  ('messageIndex','"0"'::jsonb),('messageIndex','null'::jsonb),('messageIndex','-1'::jsonb),('messageIndex','0.5'::jsonb),
  ('lineNumber','1'::jsonb),('lineNumber','[]'::jsonb),('objectId','null'::jsonb),('objectId','{}'::jsonb),('objectId','""'::jsonb),
  ('identityAgency','9'::jsonb),('identityAgency','null'::jsonb),('identityAgency','"99"'::jsonb),('identityStatus','true'::jsonb)
 ) AS cases(k,v) LOOP
  altered:=jsonb_set(inv,ARRAY['sources','0','occurrences','0',key],bad);
  PERFORM pg_temp.shape_case('reject/occurrence/'||key||'='||bad::text,snap,altered);
 END LOOP;
 altered:=jsonb_set(inv,'{sources,0,occurrences,1,ordinal}','1');
 PERFORM pg_temp.shape_case('reject/duplicate-physical-ordinal',snap,altered);
 altered:=jsonb_set(inv,'{sources,0,occurrences,1,segmentIndex}','3');
 PERFORM pg_temp.shape_case('reject/duplicate-physical-segment',snap,altered);
 altered:=jsonb_set(inv,'{sources,0,occurrences,1,segmentIndex}','2');
 PERFORM pg_temp.shape_case('reject/reversed-physical-segments',snap,altered);
 FOREACH key IN ARRAY ARRAY['messageIndex','objectId','identityAgency','occurrenceOrdinals'] LOOP
  altered:=jsonb_set(inv,'{sources,0,objects,0}',(inv#>'{sources,0,objects,0}')-key);
  PERFORM pg_temp.shape_case('reject/object/missing-'||key,snap,altered);
 END LOOP;
 FOR key,bad IN SELECT * FROM (VALUES
  ('messageIndex','"0"'::jsonb),('messageIndex','null'::jsonb),('messageIndex','1'::jsonb),
  ('objectId','null'::jsonb),('objectId','{}'::jsonb),('objectId','"OTHER"'::jsonb),
  ('identityAgency','9'::jsonb),('identityAgency','"89"'::jsonb),
  ('occurrenceOrdinals','null'::jsonb),('occurrenceOrdinals','{}'::jsonb),('occurrenceOrdinals','[]'::jsonb),
  ('occurrenceOrdinals','["1"]'::jsonb),('occurrenceOrdinals','[1,1]'::jsonb),('occurrenceOrdinals','[3]'::jsonb),('occurrenceOrdinals','[2]'::jsonb)
 ) AS cases(k,v) LOOP
  altered:=jsonb_set(inv,ARRAY['sources','0','objects','0',key],bad);
  PERFORM pg_temp.shape_case('reject/object/'||key||'='||bad::text,snap,altered);
 END LOOP;
 altered:=jsonb_set(inv,'{sources,0,objects}',jsonb_build_array(inv#>'{sources,0,objects,0}'));
 PERFORM pg_temp.shape_case('reject/observed-occurrence-omitted-from-memberships',snap,altered);
 altered:=jsonb_set(inv,'{sources,0,objects}',(inv#>'{sources,0,objects}')||jsonb_build_array(inv#>'{sources,0,objects,0}'));
 PERFORM pg_temp.shape_case('reject/duplicate-object-membership',snap,altered);
 -- An incomplete observation still has to be typed; it cannot bypass schema.
 altered:=jsonb_set(jsonb_set(inv,'{status}','"incomplete"'),'{sources,0,status}','"incomplete"');
 altered:=jsonb_set(altered,'{sources,0,occurrences}','[{"identityStatus":"observed"}]');
 PERFORM pg_temp.shape_case('reject/incomplete-does-not-waive-occurrence-fields',snap,altered);
 altered:=jsonb_set(jsonb_set(inv,'{status}','"incomplete"'),'{sources,0,status}','"incomplete"');
 altered:=jsonb_set(altered,'{sources,0,objects}','[{}]');
 PERFORM pg_temp.shape_case('reject/incomplete-does-not-waive-object-fields',snap,altered);
 -- Typed unresolved observations remain saveable without claiming completeness.
 altered:=jsonb_set(jsonb_set(inv,'{status}','"incomplete"'),'{sources,0,status}','"incomplete"');
 altered:=jsonb_set(altered,'{sources,0,occurrences}','[{"ordinal":1,"segmentIndex":3,"messageIndex":0,"lineNumber":"1","objectId":null,"identityAgency":null,"identityStatus":"unresolved"}]');
 altered:=jsonb_set(jsonb_set(altered,'{sources,0,objects}','[]'),'{sources,0,issues}','["source_object_identity_unresolved"]');
 PERFORM pg_temp.shape_case('valid/typed-unresolved-incomplete',snap,altered,false);
 altered:=jsonb_set(altered,'{sources,0,occurrences,0,messageIndex}','null');
 PERFORM pg_temp.shape_case('valid/typed-orphan-incomplete',snap,altered,false);
 altered:=jsonb_set(jsonb_set(jsonb_set(altered,'{status}','"enumerated"'),'{sources,0,status}','"enumerated"'),'{sources,0,issues}','[]');
 -- Keep one valid observed membership beside the unresolved occurrence; this
 -- avoids the old non-empty array guard hiding the unresolved status defect.
 altered:=jsonb_set(altered,'{sources,0,occurrences}',(inv#>'{sources,0,occurrences}')||'[{"ordinal":3,"segmentIndex":5,"messageIndex":null,"lineNumber":"3","objectId":null,"identityAgency":null,"identityStatus":"unresolved"}]');
 altered:=jsonb_set(altered,'{sources,0,objects}',inv#>'{sources,0,objects}');
 PERFORM pg_temp.shape_case('reject/unresolved-cannot-be-enumerated',snap,altered);
 -- Positive shape fixtures use matching physical wires. Expected tuples
 -- were separately checked against the unchanged production tokenizer/reader.
 null_snap:=pg_temp.shape_source('UNB+UNOC:3+111:14+222:14+260620:0900+REF''UNH+MSG+PRODAT:D:96B:UN''BGM+Z04+DOC+9''LIN+1++MP-A:::9''LIN+2++MP-A:::9''UNT+5+MSG''UNZ+1+REF''');
 altered:=pg_temp.shape_inventory(null_snap);
 altered:=jsonb_set(jsonb_set(altered,'{sources,0,occurrences}','[{"ordinal":1,"segmentIndex":3,"messageIndex":0,"lineNumber":"1","objectId":"MP-A","identityAgency":"9","identityStatus":"observed"},{"ordinal":2,"segmentIndex":4,"messageIndex":0,"lineNumber":"2","objectId":"MP-A","identityAgency":"9","identityStatus":"observed"}]'),'{sources,0,objects}','[{"messageIndex":0,"objectId":"MP-A","identityAgency":"9","occurrenceOrdinals":[1,2]}]');
 PERFORM pg_temp.shape_case('valid/typed-register-repetitions',null_snap,altered,false);
 null_snap:=pg_temp.shape_source('UNB+UNOC:3+111:14+222:14+260620:0900+REF''UNH+MSG+PRODAT:D:96B:UN''BGM+Z04+DOC+9''LIN+1++MP-A:::9''UNT+4+MSG''UNH+MSG2+PRODAT:D:96B:UN''BGM+Z04+DOC2+9''LIN+2++MP-A:::9''UNT+4+MSG2''UNZ+2+REF''');
 altered:=pg_temp.shape_inventory(null_snap);
 altered:=jsonb_set(jsonb_set(altered,'{sources,0,occurrences}','[{"ordinal":1,"segmentIndex":3,"messageIndex":0,"lineNumber":"1","objectId":"MP-A","identityAgency":"9","identityStatus":"observed"},{"ordinal":2,"segmentIndex":7,"messageIndex":1,"lineNumber":"2","objectId":"MP-A","identityAgency":"9","identityStatus":"observed"}]'),'{sources,0,objects}','[{"messageIndex":0,"objectId":"MP-A","identityAgency":"9","occurrenceOrdinals":[1]},{"messageIndex":1,"objectId":"MP-A","identityAgency":"9","occurrenceOrdinals":[2]}]');
 PERFORM pg_temp.shape_case('valid/typed-distinct-message-tuples',null_snap,altered,false);
 -- The original sealer leaves a real null-payload source without a context.
 -- Existing binding should already reject attempts to label it enumerated.
 null_snap:=pg_temp.shape_source(null); null_inv:=pg_temp.shape_inventory(null_snap);
 PERFORM pg_temp.shape_case('retained/null-payload-enumerated-rejected-by-original-binding',null_snap,null_inv);
 null_inv:=jsonb_set(jsonb_set(jsonb_set(null_inv,'{status}','"incomplete"'),'{sources,0,status}','"incomplete"'),'{sources,0,receiptStatus}','"unavailable"');
 null_inv:=jsonb_set(jsonb_set(jsonb_set(null_inv,'{sources,0,objects}','[]'),'{sources,0,occurrences}','[]'),'{sources,0,issues}','["source_integrity_unavailable"]');
 PERFORM pg_temp.shape_case('valid/null-payload-remains-incomplete',null_snap,null_inv,false);
END $$;
TABLE source_shape_results;
DO $$ DECLARE total integer; failures integer; names text; BEGIN
 SELECT count(*),count(*) FILTER(WHERE NOT passed),string_agg(name,', ' ORDER BY name) FILTER(WHERE NOT passed)
 INTO total,failures,names FROM source_shape_results;
 RAISE NOTICE 'E035_DISCOVERY_SHAPE: % total, % failed',total,failures;
 IF failures<>0 THEN RAISE EXCEPTION 'E035_DISCOVERY_SHAPE_FAILURE: %',names; END IF;
END $$;
ROLLBACK;
