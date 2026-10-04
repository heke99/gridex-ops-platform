-- TR05/P-APERAK34: real repair of field226 after committed ERC41/226.
-- The physical outcome getter stays unchanged. A protected native producer
-- allocates a NEW technical LI for only the failed object's first register.
-- The private allocation receipt stores hashes and technical reference metadata;
-- it retains no additional raw message/customer original copy.
BEGIN;
CREATE TABLE gridex_received_sources.prodat_recovery_li_preparations(
 operation_id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,
 original_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),ack_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),
 original_payload_hash text NOT NULL,ack_payload_hash text NOT NULL,input_payload_hash text NOT NULL,corrected_payload_hash text NOT NULL,
 missing_scopes jsonb NOT NULL,allocations jsonb NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),prepared_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE gridex_received_sources.prodat_recovery_li_preparations ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_sources.prodat_recovery_li_preparations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.prodat_recovery_li_preparations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER recovery_li_preparation_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_recovery_li_preparations FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER recovery_li_preparation_no_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_recovery_li_preparations FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_received_sources.missing_li_repair_scopes_v1(c uuid,env text,ack_id uuid,source_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE receipt jsonb;ack public.ediel_messages%rowtype;source public.ediel_messages%rowtype;tokens jsonb;erc jsonb;physical jsonb;scope jsonb;next_erc int;point text;count_groups int;result jsonb:='[]';
BEGIN
 receipt:=gridex_ack_authority.prodat_physical_receipt_v1(c,env,ack_id,source_id);IF receipt IS NULL THEN RETURN '[]';END IF;
 SELECT * INTO STRICT ack FROM public.ediel_messages WHERE id=ack_id AND company_id=c AND environment=env;
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=source_id AND company_id=c AND environment=env;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(ack.raw_payload);physical:=gridex_ack_authority.prodat_physical_source_objects_v1(source.raw_payload);
 FOR scope IN SELECT x FROM jsonb_array_elements(receipt->'physicalOutcomes')x WHERE x->>'outcome'='negative' AND x#>>'{physicalReference,lineItemReference}' IS NULL LOOP
  count_groups:=0;
  FOR erc IN SELECT x FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='ERC' LOOP
   SELECT min((x->>'index')::int) INTO next_erc FROM jsonb_array_elements(tokens)x WHERE (x->>'index')::int>(erc->>'index')::int AND x->>'tag' IN('ERC','UNT','UNZ');
   IF erc#>>'{elements,1,0}'='41' AND erc#>>'{elements,1,2}'='260'
    AND EXISTS(SELECT FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='FTX' AND x#>>'{elements,1,0}'='AAO' AND x#>>'{elements,3,0}'='226' AND x#>>'{elements,3,2}'='260' AND (x->>'index')::int>(erc->>'index')::int AND (x->>'index')::int<next_erc)
    AND EXISTS(SELECT FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='Z07' AND x#>>'{elements,1,1}'=scope#>>'{physicalReference,objectId}' AND (x->>'index')::int>(erc->>'index')::int AND (x->>'index')::int<next_erc)
    AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI' AND (x->>'index')::int>(erc->>'index')::int AND (x->>'index')::int<next_erc) THEN count_groups:=count_groups+1;END IF;
  END LOOP;
  IF count_groups<>1 THEN CONTINUE;END IF;
  SELECT x INTO STRICT physical FROM jsonb_array_elements(gridex_ack_authority.prodat_physical_source_objects_v1(source.raw_payload))x WHERE x->'lineIndex'=scope#>'{physicalReference,firstLineIndex}' AND x->>'id'=scope#>>'{physicalReference,objectId}' AND x->>'identityAgency'=scope#>>'{physicalReference,identityAgency}' AND x->>'li' IS NULL;
  result:=result||jsonb_build_array(physical);
 END LOOP;
 SELECT coalesce(jsonb_agg(x ORDER BY(x->>'lineIndex')::int),'[]') INTO result FROM jsonb_array_elements(result)x;RETURN result;
END$$;
-- Lossless framing splice. The EXISTING tokenizer owns every business token
-- and source index; this bounded scanner only preserves byte-for-byte segment
-- text while inserting allocated LI/removing a caller LI and recounting UNT.
CREATE FUNCTION gridex_received_sources.recovery_reference_wire_data_v1(value text,component text,sep text,release_char text,term text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE out text:='';ch text;pos int;
BEGIN FOR pos IN 1..char_length(value) LOOP ch:=substr(value,pos,1);out:=out||CASE WHEN ch IN(component,sep,release_char,term) THEN release_char ELSE '' END||ch;END LOOP;RETURN out;END$$;
CREATE FUNCTION gridex_received_sources.render_owned_li_repair_v1(raw text,allocations jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);sep text:='+';component text:=':';release_char text:='?';term text:='''';prefix text:='';start_pos int:=1;pos int;ch text;escaped boolean:=false;seg text;normalized text;token jsonb;idx int:=0;out text:='';allocation jsonb;remove_this boolean;first_sep int;second_sep int;new_count int;unh_index int;unt_index int;remove_count int;part_pos int;part_char text;part_released boolean;
BEGIN
 IF tokens IS NULL OR jsonb_typeof(allocations) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'prodat_recovery_li_wire_required';END IF;
 IF upper(left(raw,3))='UNA' THEN prefix:=left(raw,9);start_pos:=10;component:=substr(raw,4,1);sep:=substr(raw,5,1);release_char:=substr(raw,7,1);term:=substr(raw,9,1);END IF;
 SELECT(x->>'index')::int INTO STRICT unh_index FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH';SELECT(x->>'index')::int INTO STRICT unt_index FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNT';
 SELECT count(*) INTO remove_count FROM jsonb_array_elements(allocations)x WHERE x->>'inputLiIndex' IS NOT NULL;
 new_count:=unt_index-unh_index+1+jsonb_array_length(allocations)-remove_count;
 FOR pos IN start_pos..char_length(raw) LOOP
  ch:=substr(raw,pos,1);IF ch IN(E'\r',E'\n') THEN CONTINUE;END IF;IF escaped THEN escaped:=false;CONTINUE;ELSIF ch=release_char THEN escaped:=true;CONTINUE;END IF;
  IF ch<>term THEN CONTINUE;END IF;
  seg:=substr(raw,start_pos,pos-start_pos+1);start_pos:=pos+1;normalized:=replace(replace(left(seg,char_length(seg)-1),E'\r\n',''),E'\n','');
  IF btrim(normalized,E' \t')='' THEN out:=out||seg;CONTINUE;END IF;
  SELECT x INTO STRICT token FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::int=idx;
  remove_this:=EXISTS(SELECT FROM jsonb_array_elements(allocations)a WHERE(a->>'inputLiIndex')::int=idx);
  IF remove_this AND(token->>'tag' IS DISTINCT FROM 'RFF' OR token#>>'{elements,1,0}' IS DISTINCT FROM 'LI') THEN RAISE EXCEPTION 'prodat_recovery_li_splice_scope_changed';END IF;
  IF NOT remove_this THEN
   IF token->>'tag'='UNT' THEN
    first_sep:=0;second_sep:=0;part_released:=false;
    FOR part_pos IN 1..char_length(seg) LOOP
     part_char:=substr(seg,part_pos,1);IF part_char IN(E'\r',E'\n') THEN CONTINUE;END IF;
     IF part_released THEN part_released:=false;CONTINUE;ELSIF part_char=release_char THEN part_released:=true;CONTINUE;END IF;
     IF part_char=sep THEN IF first_sep=0 THEN first_sep:=part_pos;ELSE second_sep:=part_pos;EXIT;END IF;END IF;
    END LOOP;
    IF first_sep=0 OR second_sep<=first_sep THEN RAISE EXCEPTION 'prodat_recovery_li_unt_required';END IF;
    seg:=left(seg,first_sep)||gridex_received_sources.recovery_reference_wire_data_v1(new_count::text,component,sep,release_char,term)||substr(seg,second_sep);
   END IF;
   out:=out||seg;
   SELECT a INTO allocation FROM jsonb_array_elements(allocations)a WHERE(a->>'inputFirstLineIndex')::int=idx;
   IF allocation IS NOT NULL THEN IF token->>'tag' IS DISTINCT FROM 'LIN' OR allocation->>'reference' !~ '^[A-Z0-9]{35}$' THEN RAISE EXCEPTION 'prodat_recovery_li_splice_scope_changed';END IF;
    out:=out||gridex_received_sources.recovery_reference_wire_data_v1('RFF',component,sep,release_char,term)||sep||gridex_received_sources.recovery_reference_wire_data_v1('LI',component,sep,release_char,term)||component||gridex_received_sources.recovery_reference_wire_data_v1(allocation->>'reference',component,sep,release_char,term)||term;
   END IF;
  END IF;
  idx:=idx+1;
 END LOOP;
 IF idx<>jsonb_array_length(tokens) OR btrim(substr(raw,start_pos),E' \t\r\n')<>'' OR escaped THEN RAISE EXCEPTION 'prodat_recovery_li_splice_framing_changed';END IF;
 RETURN prefix||out||substr(raw,start_pos);
END$$;
CREATE FUNCTION gridex_received_sources.apply_owned_li_repair_v1(c uuid,op_id uuid,source_id uuid,ack_id uuid,raw text,allowed jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE p gridex_received_sources.prodat_recovery_li_preparations%rowtype;source public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;scopes jsonb;current_objects jsonb;objects jsonb;scope jsonb;obj jsonb;a jsonb;out jsonb:='[]';negative_lines jsonb:='[]';
BEGIN
 SELECT * INTO p FROM gridex_received_sources.prodat_recovery_li_preparations WHERE operation_id=op_id FOR SHARE;IF NOT FOUND THEN
  SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=source_id AND company_id=c;
  IF jsonb_array_length(gridex_received_sources.missing_li_repair_scopes_v1(c,source.environment,ack_id,source_id))>0 THEN RAISE EXCEPTION 'prodat_recovery_owned_li_preparation_required';END IF;
  RETURN allowed;END IF;
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=source_id AND company_id=c;
 SELECT * INTO STRICT ack FROM public.ediel_messages WHERE id=ack_id AND company_id=c AND environment=source.environment;
 scopes:=gridex_received_sources.missing_li_repair_scopes_v1(c,source.environment,ack_id,source_id);
 current_objects:=gridex_ack_authority.prodat_correction_objects_v1(c,source.environment,ack_id,source_id);
 IF p.company_id IS DISTINCT FROM c OR p.environment IS DISTINCT FROM source.environment OR p.original_message_id IS DISTINCT FROM source_id OR p.ack_message_id IS DISTINCT FROM ack_id
  OR p.original_payload_hash IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') OR p.ack_payload_hash IS DISTINCT FROM encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex')
  OR p.missing_scopes IS DISTINCT FROM scopes OR current_objects IS DISTINCT FROM allowed OR p.corrected_payload_hash IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_recovery_li_preparation_changed';END IF;
 objects:=gridex_ack_authority.prodat_physical_recovery_wire_v1(source.raw_payload)->'objects';
 FOR scope IN SELECT x FROM jsonb_array_elements(gridex_ack_authority.prodat_physical_receipt_v1(c,source.environment,ack_id,source_id)->'physicalOutcomes')x WHERE x->>'outcome'='negative' LOOP
  SELECT x INTO STRICT a FROM jsonb_array_elements(gridex_ack_authority.prodat_physical_source_objects_v1(source.raw_payload))x WHERE x->'lineIndex'=scope#>'{physicalReference,firstLineIndex}';negative_lines:=negative_lines||(a->'registerLineIndices');
 END LOOP;
 FOR obj IN SELECT x FROM jsonb_array_elements(objects)x WHERE negative_lines @> jsonb_build_array(x->'physicalLineIndex') LOOP
  SELECT x INTO a FROM jsonb_array_elements(p.allocations)x WHERE x->'sourceFirstLineIndex'=obj->'physicalLineIndex';
  IF a IS NOT NULL THEN IF obj->>'li' IS NOT NULL THEN RAISE EXCEPTION 'prodat_recovery_existing_li_replacement_forbidden';END IF;obj:=obj||jsonb_build_object('li',a->>'reference');END IF;
  out:=out||jsonb_build_array(obj-'physicalLineIndex');
 END LOOP;
 SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') INTO out FROM jsonb_array_elements(out)x;RETURN out;
END$$;
CREATE FUNCTION public.ediel_prepare_prodat_recovery_references_v1(p_company_id uuid,p_original_message_id uuid,p_source_ack_message_id uuid,p_operation_id uuid,p_actor_user_id uuid,p_corrected_raw_payload text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE source public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;p gridex_received_sources.prodat_recovery_li_preparations%rowtype;scopes jsonb;scope jsonb;input_groups jsonb;input_group jsonb;allocation jsonb;allocations jsonb:='[]';tokens jsonb;li_index int;next_line int;normalized text;q jsonb;original_wire jsonb;corrected_wire jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'prodat_recovery_references_service_required' USING ERRCODE='42501';END IF;
 IF p_operation_id IS NULL OR p_corrected_raw_payload IS NULL OR p_corrected_raw_payload='' OR octet_length(p_corrected_raw_payload)>262144 THEN RAISE EXCEPTION 'prodat_recovery_references_scope_required';END IF;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'prepare');PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM gridex_received_sources.prelock_recovery_candidate_v1(p_company_id,p_original_message_id,p_source_ack_message_id);
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'prepare');
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=p_original_message_id AND company_id=p_company_id AND direction='outbound' AND message_family='PRODAT';
 SELECT * INTO STRICT ack FROM public.ediel_messages WHERE id=p_source_ack_message_id AND company_id=p_company_id AND environment=source.environment AND direction='inbound';
 scopes:=gridex_received_sources.missing_li_repair_scopes_v1(p_company_id,source.environment,ack.id,source.id);
 IF jsonb_array_length(scopes)=0 THEN RETURN jsonb_build_object('companyId',p_company_id,'operationId',p_operation_id,'actorUserId',p_actor_user_id,'originalMessageId',source.id,'ackMessageId',ack.id,'inputPayloadHash',encode(sha256(convert_to(p_corrected_raw_payload,'UTF8')),'hex'),'correctedRawPayload',p_corrected_raw_payload,'correctedPayloadHash',encode(sha256(convert_to(p_corrected_raw_payload,'UTF8')),'hex'),'allocations','[]'::jsonb);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('prodat-recovery-li:'||p_company_id::text||':'||p_operation_id::text,0));
 SELECT * INTO p FROM gridex_received_sources.prodat_recovery_li_preparations WHERE operation_id=p_operation_id FOR SHARE;
 IF p.operation_id IS NOT NULL THEN
  IF p.company_id IS DISTINCT FROM p_company_id OR p.original_message_id IS DISTINCT FROM source.id OR p.ack_message_id IS DISTINCT FROM ack.id OR p.environment IS DISTINCT FROM source.environment OR p.missing_scopes IS DISTINCT FROM scopes OR p.original_payload_hash IS DISTINCT FROM source.immutable_payload_hash OR p.ack_payload_hash IS DISTINCT FROM encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex')
   OR encode(sha256(convert_to(p_corrected_raw_payload,'UTF8')),'hex') NOT IN(p.input_payload_hash,p.corrected_payload_hash) THEN RAISE EXCEPTION 'prodat_recovery_references_operation_conflict';END IF;
  allocations:=p.allocations;normalized:=CASE WHEN encode(sha256(convert_to(p_corrected_raw_payload,'UTF8')),'hex')=p.corrected_payload_hash THEN p_corrected_raw_payload ELSE gridex_received_sources.render_owned_li_repair_v1(p_corrected_raw_payload,allocations) END;
  IF encode(sha256(convert_to(normalized,'UTF8')),'hex') IS DISTINCT FROM p.corrected_payload_hash THEN RAISE EXCEPTION 'prodat_recovery_references_operation_conflict';END IF;
 ELSE
  input_groups:=gridex_ack_authority.prodat_physical_source_objects_v1(p_corrected_raw_payload);tokens:=gridex_received_sources.closure_wire_tokens_v2(p_corrected_raw_payload);
  FOR scope IN SELECT x FROM jsonb_array_elements(scopes)x LOOP
   SELECT x INTO STRICT input_group FROM jsonb_array_elements(input_groups)x WHERE x->>'id'=scope->>'id' AND x->>'identityAgency'=scope->>'identityAgency';
   SELECT min((x->>'index')::int) INTO next_line FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::int>(input_group->>'lineIndex')::int AND x->>'tag' IN('LIN','UNT');
   SELECT(x->>'index')::int INTO li_index FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI' AND(x->>'index')::int>(input_group->>'lineIndex')::int AND(x->>'index')::int<next_line;
   allocation:=jsonb_build_object('sourceFirstLineIndex',scope->'lineIndex','inputFirstLineIndex',input_group->'lineIndex','inputLiIndex',li_index,'point',scope->>'id','identityAgency',scope->>'identityAgency','reference',coalesce(source.message_code,'PRO')||upper(replace(gen_random_uuid()::text,'-','')));
   allocations:=allocations||jsonb_build_array(allocation);
  END LOOP;
  normalized:=gridex_received_sources.render_owned_li_repair_v1(p_corrected_raw_payload,allocations);
  INSERT INTO gridex_received_sources.prodat_recovery_li_preparations(operation_id,company_id,environment,original_message_id,ack_message_id,original_payload_hash,ack_payload_hash,input_payload_hash,corrected_payload_hash,missing_scopes,allocations,actor_user_id)
   VALUES(p_operation_id,p_company_id,source.environment,source.id,ack.id,source.immutable_payload_hash,encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex'),encode(sha256(convert_to(p_corrected_raw_payload,'UTF8')),'hex'),encode(sha256(convert_to(normalized,'UTF8')),'hex'),scopes,allocations,p_actor_user_id);
 END IF;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'prepare');
 q:=gridex_received_sources.assess_recovery_source_v1(p_company_id,source.id,p_actor_user_id,p_operation_id,ack.id,NULL,normalized);
 IF q->>'status' IS DISTINCT FROM 'qualified' THEN RAISE EXCEPTION 'prodat_recovery_references_source_held:%',q->>'reason';END IF;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'prepare');
 RETURN jsonb_build_object('companyId',p_company_id,'operationId',p_operation_id,'actorUserId',p_actor_user_id,'originalMessageId',source.id,'ackMessageId',ack.id,'inputPayloadHash',encode(sha256(convert_to(p_corrected_raw_payload,'UTF8')),'hex'),'correctedRawPayload',normalized,'correctedPayloadHash',encode(sha256(convert_to(normalized,'UTF8')),'hex'),'allocations',allocations);
END$$;
DO $patch$DECLARE body text;needle text:='  IF corrected->''objects'' IS DISTINCT FROM allowed_objects THEN';BEGIN
 body:=pg_get_functiondef('gridex_received_sources.assess_recovery_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure);
 IF strpos(body,needle)=0 OR strpos(body,'prodat_correction_objects_v1')=0 THEN RAISE EXCEPTION 'prodat_recovery_owned_reference_source_shape_changed';END IF;
 EXECUTE replace(body,needle,'  allowed_objects:=gridex_received_sources.apply_owned_li_repair_v1(p_company_id,p_operation_id,m.id,ack.id,p_corrected_raw_payload,allowed_objects);'||E'\n'||needle);
END$patch$;
REVOKE ALL ON FUNCTION gridex_received_sources.missing_li_repair_scopes_v1(uuid,text,uuid,uuid),gridex_received_sources.recovery_reference_wire_data_v1(text,text,text,text,text),gridex_received_sources.render_owned_li_repair_v1(text,jsonb),gridex_received_sources.apply_owned_li_repair_v1(uuid,uuid,uuid,uuid,text,jsonb),public.ediel_prepare_prodat_recovery_references_v1(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_prepare_prodat_recovery_references_v1(uuid,uuid,uuid,uuid,uuid,text) TO service_role;
COMMIT;
