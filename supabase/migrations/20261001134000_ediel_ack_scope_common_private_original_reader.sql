-- CLI-created forward. Scope replay and atomic creation use the same private
-- original qualifier as business ACK reads. Public relation/outcome caches do
-- not select an owner. Preserve the installed functions and their privileges.
BEGIN;
DO $scope_read$ DECLARE definition text;body text;original text;needle text;BEGIN
 SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid='gridex_ediel_ack_replay.read_scope_v2(uuid,text,uuid,text,uuid,text,text)'::regprocedure;
 definition:=pg_get_functiondef('gridex_ediel_ack_replay.read_scope_v2(uuid,text,uuid,text,uuid,text,text)'::regprocedure);body:=original;
 needle:='gate:=gridex_ediel_ack_replay.read_exact_v2(c,env,source_id,actor,family,NULL);';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_scope_source_reader_shape_changed';END IF;
 body:=replace(body,needle,'gate:=gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source_id,actor,family,NULL,''prepare'');');
 needle:='qualified:=gridex_ediel_ack_replay.read_exact_v2(c,env,source.id,actor,family,candidate.id);';
 IF position(needle IN body)=0 OR position('is_duplicate_ack_v1(candidate.id)' IN body)=0
  OR position('ediel_prodat_ack_scope_conflicting_outcome' IN body)=0 OR position('ediel_prodat_ack_scope_partially_fixed' IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_scope_original_reader_shape_changed';END IF;
 body:=replace(body,needle,'qualified:=gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source.id,actor,family,candidate.id,''prepare'');');
 needle:='IF chosen IS NOT NULL THEN RETURN chosen;END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_scope_chosen_return_shape_changed';END IF;
 body:=replace(body,needle,'IF chosen IS NOT NULL THEN'||chr(10)||'  PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source.id,actor,family,(chosen#>>''{ackMessage,id}'')::uuid,''prepare'');'||chr(10)||'  RETURN chosen;END IF;');
 needle:='RETURN NULL;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_scope_absent_return_shape_changed';END IF;
 body:=replace(body,needle,'PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source.id,actor,family,NULL,''prepare'');'||chr(10)||' '||needle);
 IF position('gridex_ediel_ack_replay.read_exact_v2(' IN body)>0 THEN RAISE EXCEPTION 'ediel_ack_scope_legacy_reader_remaining';END IF;
 EXECUTE replace(definition,original,body);
END $scope_read$;
DO $scope_create$ DECLARE definition text;body text;original text;needle text;BEGIN
 SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid='gridex_ediel_ack_replay.create_scope_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)'::regprocedure;
 definition:=pg_get_functiondef('gridex_ediel_ack_replay.create_scope_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)'::regprocedure);body:=original;
 needle:='result:=gridex_ediel_ack_replay.read_exact_v2(c,env,s.id,actor,family,m.id);';
 IF position(needle IN body)=0 OR position('ediel_ack_atomic_postwrite_owner_mismatch' IN body)=0
  OR position('INSERT INTO gridex_ediel_ack_replay.creation_receipts' IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_scope_creation_reader_shape_changed';END IF;
 body:=replace(body,needle,'result:=gridex_ediel_duplicate_responses.read_business_original_v1(c,env,s.id,actor,family,m.id,''prepare'');');
 needle:='RETURN existing||jsonb_build_object(''replayed'',true);';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_scope_creation_replay_return_shape_changed';END IF;
 body:=replace(body,needle,'PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,s.id,actor,family,(existing#>>''{ackMessage,id}'')::uuid,''prepare'');'||chr(10)||'  '||needle);
 -- After audit and immutable birth receipt, repeat the actual own-original
 -- proof and current phase/source guards. A failure rolls back every effect.
 needle:='RETURN result||jsonb_build_object(''replayed'',false);';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_scope_creation_final_return_shape_changed';END IF;
 body:=replace(body,needle,'PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,s.id,actor,family,m.id,''prepare'');'||chr(10)||' '||needle);
 IF position('gridex_ediel_ack_replay.read_exact_v2(' IN body)>0 THEN RAISE EXCEPTION 'ediel_ack_scope_creation_legacy_reader_remaining';END IF;
 EXECUTE replace(definition,original,body);
END $scope_create$;
COMMIT;
