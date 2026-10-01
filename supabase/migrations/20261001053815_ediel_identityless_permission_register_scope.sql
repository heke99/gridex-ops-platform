-- Forward-only physical scope support for the existing field209 omission
-- owner. Accepted register/application facets remain canonical-only; this
-- parser neither selects rules nor supplies business/party/point authority.
BEGIN;
CREATE FUNCTION gridex_received_sources.identity_omission_cases_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
-- BEGIN CANONICAL IDENTITY OMISSION PROJECTION
 SELECT '[{"messageCode":"Z14","transactionReason":"Z96"},{"messageCode":"Z13","transactionReason":"S17"},{"messageCode":"Z13","transactionReason":"S18"}]'::jsonb
-- END CANONICAL IDENTITY OMISSION PROJECTION
$$;
CREATE FUNCTION gridex_received_sources.identity_omission_scope_v1(raw text,object_scope jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb;lin jsonb;next_index integer;own jsonb;cci jsonb;cav jsonb;code text;reason text;idx integer;parent_index integer;
BEGIN
 IF object_scope->'objectId' IS DISTINCT FROM 'null'::jsonb OR object_scope->'identityAgency' IS DISTINCT FROM 'null'::jsonb
  OR object_scope->'messageIndex' IS DISTINCT FROM '0'::jsonb OR jsonb_array_length(object_scope->'registers') IS DISTINCT FROM 1
  OR object_scope#>'{registers,0,registerIndex}' IS DISTINCT FROM 'null'::jsonb OR object_scope#>'{registers,0,registerPosition}' IS DISTINCT FROM '1'::jsonb THEN RETURN false;END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(raw);IF tokens IS NULL THEN RETURN false;END IF;
 IF(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1
  OR(SELECT t#>>'{elements,2,0}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH') IS DISTINCT FROM 'PRODAT'
  OR(SELECT t#>>'{elements,1,0}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH') IS DISTINCT FROM object_scope->>'messageReference'
  OR(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')<>1 THEN RETURN false;END IF;
 SELECT t#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 SELECT t INTO lin FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN' AND t->'index'=object_scope#>'{registers,0,segmentIndex}';
 IF lin IS NULL OR jsonb_array_length(lin->'elements')>4 OR EXISTS(SELECT FROM jsonb_array_elements(coalesce(lin#>'{elements,3}','[]'))v WHERE v#>>'{}'<>'')
  OR lin#>>'{elements,1,0}'!~'^[0-9]{1,6}$' OR (lin#>>'{elements,1,0}')::integer<1 OR jsonb_array_length(lin#>'{elements,1}')<>1
  OR (lin#>>'{elements,1,0}')::integer IS DISTINCT FROM (object_scope#>>'{registers,0,lineIndex}')::integer+1
  OR lin#>>'{elements,1,0}' IS DISTINCT FROM object_scope#>>'{registers,0,lineNumber}'
  OR(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN' AND(t->>'index')::integer<(lin->>'index')::integer) IS DISTINCT FROM (object_scope#>>'{registers,0,lineIndex}')::integer THEN RETURN false;END IF;
 SELECT min((t->>'index')::integer) INTO next_index FROM jsonb_array_elements(tokens)t WHERE t->>'tag' IN('LIN','UNT','UNZ') AND(t->>'index')::integer>(lin->>'index')::integer;
 SELECT jsonb_agg(t ORDER BY(t->>'index')::integer) INTO own FROM jsonb_array_elements(tokens)t WHERE(t->>'index')::integer>=(lin->>'index')::integer AND(t->>'index')::integer<next_index;
 IF(SELECT count(*) FROM jsonb_array_elements(own)t WHERE t->>'tag'='CCI' AND t#>>'{elements,2,0}'='Z13')<>1 THEN RETURN false;END IF;
 SELECT t INTO cci FROM jsonb_array_elements(own)t WHERE t->>'tag'='CCI' AND t#>>'{elements,2,0}'='Z13';idx:=(cci->>'index')::integer;
 SELECT t INTO cav FROM jsonb_array_elements(own)t WHERE(t->>'index')::integer=idx+1 AND t->>'tag'='CAV';
 SELECT min((t->>'index')::integer) INTO parent_index FROM jsonb_array_elements(own)t WHERE t->>'tag' IN('RFF','NAD');
 IF cav IS NULL OR(parent_index IS NOT NULL AND idx>=parent_index) OR jsonb_array_length(cci->'elements')<>3
  OR EXISTS(SELECT FROM jsonb_array_elements(cci#>'{elements,1}')v WHERE v#>>'{}'<>'') OR jsonb_array_length(cci#>'{elements,2}')<>1
  OR jsonb_array_length(cav->'elements')<>2 OR jsonb_array_length(cav#>'{elements,1}')<>1
  OR EXISTS(SELECT FROM jsonb_array_elements(own)t WHERE(t->>'index')::integer=idx+2 AND t->>'tag'='CAV') THEN RETURN false;END IF;
 reason:=cav#>>'{elements,1,0}';
 RETURN EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.identity_omission_cases_v1())e WHERE e->>'messageCode'=code AND e->>'transactionReason'=reason);
EXCEPTION WHEN OTHERS THEN RETURN false;END$$;
DO $$DECLARE definition text;old text;replacement text;BEGIN
 old:=$old$IF obj->>'disposition'<>'unavailable' AND ((obj->>'messageIndex')::int<>0 OR jsonb_typeof(obj->'messageReference')<>'string'
        OR jsonb_typeof(obj->'objectId')<>'string' OR coalesce(obj->>'identityAgency','') NOT IN ('9','89')) THEN$old$;
 replacement:=$new$IF obj->>'disposition'<>'unavailable' AND ((obj->>'messageIndex')::int<>0 OR jsonb_typeof(obj->'messageReference')<>'string'
        OR ((jsonb_typeof(obj->'objectId')<>'string' OR coalesce(obj->>'identityAgency','') NOT IN ('9','89'))
          AND NOT (obj->>'disposition'='accepted' AND gridex_received_sources.identity_omission_scope_v1(src.raw_payload,obj)))) THEN$new$;
 definition:=pg_get_functiondef('gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text)'::regprocedure);
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'identity_omission_append_owner_changed';END IF;
 EXECUTE replace(definition,old,replacement);
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.identity_omission_cases_v1(),gridex_received_sources.identity_omission_scope_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
