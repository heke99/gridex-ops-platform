-- Additive actual incoming ACK owner. Preserve all historic immutable receipts
-- and original OIDs. Physical scope is not a fabricated protocol LI.
BEGIN;
CREATE TABLE gridex_ack_authority.prodat_physical_receipts(
 ack_message_id uuid PRIMARY KEY REFERENCES gridex_ack_authority.source_correlations(ack_message_id) ON DELETE RESTRICT,
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL,environment text NOT NULL,ack_payload_hash text NOT NULL,source_payload_hash text NOT NULL,
 scopes jsonb NOT NULL CHECK(jsonb_typeof(scopes)='array'),source_projection_version jsonb NOT NULL CHECK(jsonb_typeof(source_projection_version)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE gridex_ack_authority.prodat_physical_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ack_authority.prodat_physical_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ack_authority.prodat_physical_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_ack_authority.prodat_physical_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ack_authority.prodat_physical_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_ack_authority.prodat_physical_scope_key_v1(source_id uuid,line_index int,li text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(li,'@prodat-physical-source:'||source_id::text||':lin:'||line_index::text)
$$;
-- Bounded wire-ownership projection of the existing canonical register owner.
-- It grants no national/source/actor/business acceptance. Invalid sibling chains
-- retain separate physical scopes and cannot gain omission/inheritance rights.
CREATE FUNCTION gridex_ack_authority.prodat_physical_source_projection_version_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT '{"lib/ediel/prodat/prodatRegisterGroups.ts":"142e9e441e6a94708841dec9aaddb9656b091aa04536c00ec358a6b59bcfe291","lib/ediel/prodat/prodatRegisterFields.ts":"1d171216b8fd8be093a4b6d5e0d9e04cf969468ba342dfcde4771b46fe5df09c","lib/ediel/prodat/prodat26AFieldMatrix.ts":"a96b7dcddb564aad04d3be6ee7aef1117601eccd893b47869a8ddc60b3794382","lib/ediel/rulebook/prodatRegisterPolicy.ts":"72ab4f6836154c74a4dcd8e3fefec92fc31bb5da6800318707b591f51f44bf0e"}'::jsonb$$;
CREATE FUNCTION gridex_ack_authority.prodat_physical_source_objects_v1(raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(raw);source jsonb:=gridex_ack_authority.wire_v1(raw);lines jsonb:='[]';lin jsonb;own jsonb;siblings jsonb;result jsonb:='[]';e jsonb;stop int;li text;ordinal int:=0;multi boolean;valid boolean;count_li int;BEGIN
 IF tokens IS NULL OR source->>'family' IS DISTINCT FROM 'PRODAT' THEN RAISE EXCEPTION 'ack_prodat_physical_source_required';END IF;
 FOR lin IN SELECT x FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='LIN' ORDER BY(x->>'index')::int LOOP
  e:=lin->'elements';ordinal:=ordinal+1;
  SELECT min((x->>'index')::int) INTO stop FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::int>(lin->>'index')::int AND x->>'tag' IN('NAD','LIN','UNT');
  SELECT count(*),min(nullif(x#>>'{elements,1,1}','')) INTO count_li,li FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI' AND(x->>'index')::int>(lin->>'index')::int AND(x->>'index')::int<stop;
  IF count_li>1 THEN RAISE EXCEPTION 'ediel_prodat_ack_physical_scope_required';END IF;
  lines:=lines||jsonb_build_array(jsonb_build_object('lineIndex',(lin->>'index')::int,'id',nullif(e#>>'{3,0}',''),'identityAgency',nullif(e#>>'{3,3}',''),'li',li,
   'sequenceValid',coalesce(jsonb_array_length(e->1)=1 AND CASE WHEN(e#>>'{1,0}')~'^[0-9]{1,6}$' THEN(e#>>'{1,0}')::int=ordinal ELSE false END,false),
   'identityValid',coalesce(jsonb_array_length(e->3)=4 AND length(e#>>'{3,0}') BETWEEN 1 AND 25 AND e#>>'{3,1}'='' AND e#>>'{3,2}'='' AND e#>>'{3,3}' IN('9','89'),false),
   'hasRegister',jsonb_array_length(e)>=5,'registerIndex',nullif(e#>>'{4,1}',''),
   'registerShapeValid',coalesce(jsonb_array_length(e)=5 AND jsonb_array_length(e->4)=2 AND e#>>'{4,0}'='1' AND CASE WHEN(e#>>'{4,1}')~'^[0-9]{1,6}$' THEN(e#>>'{4,1}')::int>0 ELSE false END,false)));
 END LOOP;
 FOR own IN SELECT x FROM jsonb_array_elements(lines)x LOOP
  SELECT jsonb_agg(x ORDER BY(x->>'lineIndex')::int) INTO siblings FROM jsonb_array_elements(lines)x WHERE CASE WHEN own->>'id' IS NULL THEN x->'lineIndex'=own->'lineIndex' ELSE x->'id'=own->'id' AND x->'identityAgency' IS NOT DISTINCT FROM own->'identityAgency' END;
  multi:=jsonb_array_length(siblings)>1;
  valid:=NOT EXISTS(SELECT FROM jsonb_array_elements(siblings) WITH ORDINALITY v(x,pos) WHERE x->>'sequenceValid'<>'true'
   OR(x->>'hasRegister'='true' AND x->>'registerShapeValid'<>'true')
   OR(x->>'hasRegister'='true' AND(NOT multi OR coalesce(source->>'code','') NOT IN('Z04','Z06','Z10')))
   OR(multi AND(coalesce(source->>'code','') NOT IN('Z04','Z06','Z10') OR x->>'hasRegister'<>'true' OR CASE WHEN(x->>'registerIndex')~'^[0-9]{1,6}$' THEN(x->>'registerIndex')::int<>pos ELSE true END))
   OR((multi OR x->>'hasRegister'='true') AND x->>'identityValid'<>'true'));
  IF valid AND multi AND own->'lineIndex' IS DISTINCT FROM siblings#>'{0,lineIndex}' THEN CONTINUE;END IF;
  result:=result||jsonb_build_array(jsonb_build_object('lineIndex',own->'lineIndex','id',own->'id','identityAgency',own->'identityAgency','li',own->'li','validRegisterChain',valid,
   'registerLineIndices',CASE WHEN valid THEN(SELECT jsonb_agg(x->'lineIndex' ORDER BY pos) FROM jsonb_array_elements(siblings) WITH ORDINALITY v(x,pos)) ELSE jsonb_build_array(own->'lineIndex') END));
 END LOOP;
 RETURN result;
END$$;
-- Reuse the existing pure outcome matcher; only its source-object projection
-- becomes this shared first-register projection. Original outbound OID unchanged.
DO $scope_projection$DECLARE definition text;start_at int;end_at int;BEGIN
 SELECT pg_get_functiondef('gridex_ediel_ack_guide.prodat_outcomes_v1(text,text)'::regprocedure) INTO definition;
 start_at:=position($start$ SELECT coalesce(jsonb_agg(object),'[]') INTO source_objects FROM ($start$ IN definition);
 end_at:=position($end$ IF EXISTS(SELECT FROM jsonb_array_elements(original)lin WHERE lin->>'tag'='LIN'$end$ IN definition);
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'ack_prodat_pure_outcome_projection_owner_required';END IF;
 definition:=left(definition,start_at-1)||' source_objects:=gridex_ack_authority.prodat_physical_source_objects_v1(source_raw);'||E'\n'||substr(definition,end_at);
 definition:=replace(definition,'gridex_ediel_ack_guide.prodat_outcomes_v1','gridex_ack_authority.prodat_physical_scoped_outcomes_v1');
 EXECUTE definition;
END$scope_projection$;
CREATE FUNCTION gridex_ack_authority.prodat_physical_outcomes_v1(raw text,source_raw text,source_id uuid) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE scopes jsonb;scope jsonb;tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(source_raw);lin jsonb;result jsonb:='[]';li text;BEGIN
 -- Reuse the actual native raw-scope projection, after the incoming owner has
 -- qualified canonical acceptance, retained ingress and unique sent original.
 scopes:=gridex_ack_authority.prodat_physical_scoped_outcomes_v1(raw,source_raw);
 FOR scope IN SELECT x FROM jsonb_array_elements(scopes)x LOOP
  IF scope->>'scope' IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ack_prodat_physical_object_scope_required';END IF;
  SELECT x INTO STRICT lin FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='LIN' AND x->>'index'=scope#>>'{physicalReference,lineIndex}';
  li:=nullif(scope#>>'{physicalReference,li}','');
  IF li IS NULL AND scope->>'outcome'<>'negative' THEN RAISE EXCEPTION 'ack_prodat_missing_li_positive_forbidden';END IF;
  result:=result||jsonb_build_array(jsonb_build_object('reference',gridex_ack_authority.prodat_physical_scope_key_v1(source_id,(lin->>'index')::int,li),'outcome',scope->>'outcome',
   'physicalReference',jsonb_build_object('firstLineIndex',(lin->>'index')::int,'objectId',nullif(lin#>>'{elements,3,0}',''),'identityAgency',nullif(lin#>>'{elements,3,3}',''),'lineItemReference',li)));
 END LOOP;
 RETURN result;
END$$;
CREATE FUNCTION gridex_ack_authority.prodat_expected_physical_scope_keys_v1(raw text,source_id uuid) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE own jsonb;result jsonb:='[]';BEGIN
 FOR own IN SELECT x FROM jsonb_array_elements(gridex_ack_authority.prodat_physical_source_objects_v1(raw))x LOOP
  result:=result||jsonb_build_array(gridex_ack_authority.prodat_physical_scope_key_v1(source_id,(own->>'lineIndex')::int,own->>'li'));
 END LOOP;RETURN result;
END$$;
-- Compose only the P34 branch of the actual deepest incoming native owner.
-- Every existing retention, canonical/source/actor/global original guard stays.
DO $physical_port$DECLARE definition text;old text;replacement text;before record;after record;BEGIN
 SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile,pg_get_functiondef(oid) definition INTO STRICT before FROM pg_proc WHERE oid='gridex_ack_authority.apply_before_committed_replay_v1(uuid,text,uuid,uuid,uuid)'::regprocedure;
 definition:=before.definition;
 old:=$old$scope:=CASE WHEN jsonb_array_length(refs)>0 AND a->>'function'='34' THEN 'object' ELSE 'message' END;$old$;
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'ack_prodat_actual_incoming_scope_owner_required';END IF;
 definition:=replace(definition,old,$new$scope:=CASE WHEN a->>'function'='34' THEN 'object' ELSE 'message' END;$new$);
 old:=$old$(scope IN ('transaction','object') AND jsonb_array_length(coalesce(refs,'[]'))=0)$old$;
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'ack_prodat_actual_incoming_reference_guard_required';END IF;
 definition:=replace(definition,old,$new$(scope IN ('transaction','object') AND jsonb_array_length(coalesce(refs,'[]'))=0 AND NOT(family='APERAK' AND a#>>'{type,2}'='96A' AND a->>'function'='34'))$new$);
 old:=$old$IF scope='object' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('reference',x->>'reference','outcome',x->>'outcome')),'[]') INTO results
   FROM jsonb_array_elements(coalesce(a->'scopeResults','[]')) x WHERE x->>'qualifier'='LI';
  IF EXISTS(SELECT FROM jsonb_array_elements_text(refs) ref WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(results) x WHERE x->>'reference'=ref)) THEN RAISE EXCEPTION 'ack_object_outcome_scope_unavailable'; END IF;$old$;
 replacement:=$new$IF scope='object' THEN
  results:=gridex_ack_authority.prodat_physical_outcomes_v1(ack.raw_payload,source.raw_payload,source.id);
  IF EXISTS(SELECT FROM jsonb_array_elements_text(refs) ref WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(results) x WHERE x->>'reference'=ref)) THEN RAISE EXCEPTION 'ack_object_outcome_scope_unavailable'; END IF;$new$;
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'ack_prodat_actual_incoming_result_owner_required';END IF;
 definition:=replace(definition,old,replacement);
 old:=$old$expected:=CASE WHEN s->>'family'='UTILTS' THEN coalesce(s->'ide','[]') ELSE coalesce(s#>'{refs,LI}','[]') END;$old$;
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'ack_prodat_actual_incoming_completion_owner_required';END IF;
 definition:=replace(definition,old,$new$expected:=CASE WHEN s->>'family'='UTILTS' THEN coalesce(s->'ide','[]') ELSE gridex_ack_authority.prodat_expected_physical_scope_keys_v1(source.raw_payload,source.id) END;$new$);
 EXECUTE definition;
 SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile INTO STRICT after FROM pg_proc WHERE oid=before.oid;
 IF to_jsonb(before)-'definition' IS DISTINCT FROM to_jsonb(after) THEN RAISE EXCEPTION 'ack_prodat_incoming_owner_identity_changed';END IF;
END$physical_port$;
-- Current active company/user is shared by fresh execution and every read,
-- including NULL receipt. Existing canonical permission semantics are retained.
CREATE FUNCTION gridex_ack_authority.require_physical_actor_v1(c uuid,actor uuid,write_required boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF c IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'ack_execution_scope_required' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT FROM public.companies WHERE id=c AND is_active AND status='active') THEN RAISE EXCEPTION 'ack_execution_actor_unqualified' USING ERRCODE='42501';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active' FOR SHARE;
 IF NOT FOUND OR NOT(coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.write'),false) OR(NOT write_required AND coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.read'),false))) THEN RAISE EXCEPTION 'ack_execution_actor_unqualified' USING ERRCODE='42501';END IF;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ack_execution_actor_unqualified' USING ERRCODE='42501';END IF;
END$$;
-- The actual current whole owner remains the caller, including unused-UNH/ERR
-- and immutable accepted replay. Capture new physical receipts in the SAME TX.
ALTER FUNCTION gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) RENAME TO apply_before_physical_outcomes_v1;
CREATE FUNCTION gridex_ack_authority.apply_v1(c uuid,env text,ack_id uuid,source_id uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;prior boolean;a jsonb;ack public.ediel_messages%rowtype;source public.ediel_messages%rowtype;correlation gridex_ack_authority.source_correlations%rowtype;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 prior:=EXISTS(SELECT FROM gridex_ack_authority.source_correlations WHERE ack_message_id=ack_id);
 PERFORM gridex_ack_authority.require_physical_actor_v1(c,actor,NOT prior);
 result:=gridex_ack_authority.apply_before_physical_outcomes_v1(c,env,ack_id,source_id,actor);
 IF NOT prior THEN
  SELECT * INTO STRICT ack FROM public.ediel_messages WHERE id=ack_id AND company_id=c AND environment=env;
  a:=gridex_ack_authority.wire_v1(ack.raw_payload);
  IF ack.message_family='APERAK' AND a#>>'{type,2}'='96A' AND a#>>'{type,4}'='E2SE6A' AND a->>'function'='34' THEN
   SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=source_id AND company_id=c AND environment=env;
   SELECT * INTO STRICT correlation FROM gridex_ack_authority.source_correlations WHERE ack_message_id=ack_id AND source_message_id=source_id AND company_id=c AND environment=env;
   INSERT INTO gridex_ack_authority.prodat_physical_receipts(ack_message_id,source_message_id,company_id,environment,ack_payload_hash,source_payload_hash,scopes,source_projection_version)
    VALUES(ack_id,source_id,c,env,correlation.ack_payload_hash,correlation.source_payload_hash,gridex_ack_authority.prodat_physical_outcomes_v1(ack.raw_payload,source.raw_payload,source_id),gridex_ack_authority.prodat_physical_source_projection_version_v1());
  END IF;
 END IF;
 IF prior THEN PERFORM gridex_ack_authority.read_committed_v1(c,env,ack_id,actor);END IF;
 PERFORM gridex_ack_authority.require_physical_actor_v1(c,actor,NOT prior);
 RETURN result;
END$$;
CREATE FUNCTION gridex_ack_authority.prodat_physical_receipt_v1(c uuid,env text,ack_id uuid,source_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r gridex_ack_authority.prodat_physical_receipts%rowtype;correlation gridex_ack_authority.source_correlations%rowtype;ack public.ediel_messages%rowtype;source public.ediel_messages%rowtype;BEGIN
 SELECT * INTO r FROM gridex_ack_authority.prodat_physical_receipts WHERE ack_message_id=ack_id FOR SHARE;
 IF r.ack_message_id IS NULL THEN RETURN NULL;END IF;
 IF r.source_projection_version IS DISTINCT FROM gridex_ack_authority.prodat_physical_source_projection_version_v1() THEN RAISE EXCEPTION 'ack_prodat_physical_projection_version_unavailable';END IF;
 SELECT * INTO correlation FROM gridex_ack_authority.source_correlations WHERE ack_message_id=ack_id FOR SHARE;
 SELECT * INTO source FROM public.ediel_messages WHERE id=source_id FOR SHARE;
 SELECT * INTO ack FROM public.ediel_messages WHERE id=ack_id FOR SHARE;
 IF r.company_id IS DISTINCT FROM c OR r.environment IS DISTINCT FROM env OR r.source_message_id IS DISTINCT FROM source_id
  OR correlation.source_message_id IS DISTINCT FROM source_id OR correlation.company_id IS DISTINCT FROM c OR correlation.environment IS DISTINCT FROM env OR correlation.ack_scope IS DISTINCT FROM 'object'
  OR correlation.ack_payload_hash IS DISTINCT FROM r.ack_payload_hash OR correlation.source_payload_hash IS DISTINCT FROM r.source_payload_hash OR correlation.scope_outcomes IS DISTINCT FROM r.scopes
  OR ack.company_id IS DISTINCT FROM c OR ack.environment IS DISTINCT FROM env OR ack.direction IS DISTINCT FROM 'inbound' OR ack.message_family IS DISTINCT FROM 'APERAK'
  OR source.company_id IS DISTINCT FROM c OR source.environment IS DISTINCT FROM env OR source.direction IS DISTINCT FROM 'outbound' OR source.message_family IS DISTINCT FROM 'PRODAT'
  OR source.message_sent_at IS NULL OR source.immutable_payload_hash IS DISTINCT FROM r.source_payload_hash
  OR r.ack_payload_hash IS DISTINCT FROM encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex') OR r.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
  OR NOT EXISTS(SELECT FROM gridex_ack_authority.applied_receipts a WHERE a.ack_message_id=ack_id AND a.result->'scopeOutcomes'=r.scopes)
  OR r.scopes IS DISTINCT FROM gridex_ack_authority.prodat_physical_outcomes_v1(ack.raw_payload,source.raw_payload,source_id) THEN RAISE EXCEPTION 'ack_prodat_physical_receipt_changed';END IF;
 RETURN jsonb_build_object('version',1,'companyId',c,'environment',env,'ackMessageId',ack_id,'sourceMessageId',source_id,'ackPayloadHash',r.ack_payload_hash,'sourcePayloadHash',r.source_payload_hash,'sourceProjectionVersion',r.source_projection_version,'physicalOutcomes',r.scopes);
END$$;
-- Exact existing correction field decoder plus raw physical index, before its
-- canonical object sorting. Every business field remains its actual own value.
DO $physical_recovery$DECLARE definition text;old text;BEGIN
 SELECT pg_get_functiondef('gridex_received_sources.prodat_recovery_wire_v1(text)'::regprocedure) INTO definition;
 old:=$old$obj:=jsonb_build_object('point',nullif(e#>>'{3,0}', ''),'identityAgency',e#>>'{3,3}');$old$;
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'ack_prodat_actual_recovery_projection_required';END IF;
 definition:=replace(definition,old,$new$obj:=jsonb_build_object('point',nullif(e#>>'{3,0}', ''),'identityAgency',e#>>'{3,3}','physicalLineIndex',(t->>'index')::int);$new$);
 definition:=replace(definition,'gridex_received_sources.prodat_recovery_wire_v1','gridex_ack_authority.prodat_physical_recovery_wire_v1');
 EXECUTE definition;
END$physical_recovery$;
CREATE FUNCTION gridex_ack_authority.prodat_correction_objects_v1(c uuid,env text,ack_id uuid,source_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt jsonb;source public.ediel_messages%rowtype;objects jsonb;scopes jsonb;scope jsonb;own jsonb;lin jsonb;obj jsonb;result jsonb:='[]';tokens jsonb;BEGIN
 receipt:=gridex_ack_authority.prodat_physical_receipt_v1(c,env,ack_id,source_id);IF receipt IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=source_id;
 objects:=gridex_ack_authority.prodat_physical_recovery_wire_v1(source.raw_payload)->'objects';tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 scopes:=gridex_ack_authority.prodat_physical_source_objects_v1(source.raw_payload);
 FOR scope IN SELECT x FROM jsonb_array_elements(receipt->'physicalOutcomes')x WHERE x->>'outcome'='negative' LOOP
  SELECT x INTO STRICT own FROM jsonb_array_elements(scopes)x WHERE x->'lineIndex'=scope#>'{physicalReference,firstLineIndex}' AND x->>'id' IS NOT DISTINCT FROM scope#>>'{physicalReference,objectId}' AND x->>'identityAgency' IS NOT DISTINCT FROM scope#>>'{physicalReference,identityAgency}' AND x->>'li' IS NOT DISTINCT FROM scope#>>'{physicalReference,lineItemReference}';
  FOR lin IN SELECT x FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='LIN' AND own->'registerLineIndices' @> jsonb_build_array(x->'index') ORDER BY(x->>'index')::int LOOP
   SELECT x INTO STRICT obj FROM jsonb_array_elements(objects)x WHERE x->'physicalLineIndex'=lin->'index';
   IF obj IS NULL OR obj->>'point' IS DISTINCT FROM nullif(lin#>>'{elements,3,0}','') OR obj->>'identityAgency' IS DISTINCT FROM lin#>>'{elements,3,3}' THEN RAISE EXCEPTION 'ack_prodat_negative_correction_scope_ambiguous';END IF;
   result:=result||jsonb_build_array(obj-'physicalLineIndex');
  END LOOP;
 END LOOP;
 SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') INTO result FROM jsonb_array_elements(result)x;RETURN result;
END$$;
CREATE FUNCTION public.ediel_read_inbound_prodat_physical_outcomes_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
 PERFORM gridex_prodat_object_batch.require_service_v1();PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM gridex_ack_authority.require_physical_actor_v1(p_company_id,p_actor_user_id,false);
 PERFORM gridex_ack_authority.read_committed_v1(p_company_id,p_environment,p_ack_message_id,p_actor_user_id);
 result:=gridex_ack_authority.prodat_physical_receipt_v1(p_company_id,p_environment,p_ack_message_id,p_source_message_id);
 PERFORM gridex_ack_authority.read_committed_v1(p_company_id,p_environment,p_ack_message_id,p_actor_user_id);
 PERFORM gridex_ack_authority.require_physical_actor_v1(p_company_id,p_actor_user_id,false);
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION gridex_ack_authority.apply_before_physical_outcomes_v1(uuid,text,uuid,uuid,uuid),gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid),gridex_ack_authority.prodat_physical_scope_key_v1(uuid,int,text),gridex_ack_authority.prodat_physical_source_objects_v1(text),gridex_ack_authority.prodat_physical_source_projection_version_v1(),gridex_ack_authority.prodat_physical_scoped_outcomes_v1(text,text),gridex_ack_authority.prodat_physical_outcomes_v1(text,text,uuid),gridex_ack_authority.prodat_expected_physical_scope_keys_v1(text,uuid),gridex_ack_authority.prodat_physical_receipt_v1(uuid,text,uuid,uuid),gridex_ack_authority.prodat_physical_recovery_wire_v1(text),gridex_ack_authority.prodat_correction_objects_v1(uuid,text,uuid,uuid),gridex_ack_authority.require_physical_actor_v1(uuid,uuid,boolean),public.ediel_read_inbound_prodat_physical_outcomes_v1(uuid,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid),public.ediel_read_inbound_prodat_physical_outcomes_v1(uuid,text,uuid,uuid,uuid) TO service_role;
COMMIT;
