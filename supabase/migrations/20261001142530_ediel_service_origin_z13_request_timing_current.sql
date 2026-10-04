-- Composed defect. 20261001043917 stores Z13 origin bases as the source
-- context plus the immutable request-timing proof (requestTiming). The
-- 20261001062832 origin-current check recomputes only the source context, so
-- every Z13 origin compared unequal and was held as stale; and the recovery
-- path never re-verified the timing proof. The check now recomputes the SAME
-- recorded timing proof (required, never minted at read time) with the same
-- predicates as current_request_timing_v1, minus its manual-actor gate, which
-- 062832 deliberately keeps at the origin rather than the historic editor.
BEGIN;
DO $timing$DECLARE f record;def text;BEGIN
 SELECT p.oid,p.proowner,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_service_permission.current_request_timing_v1(uuid,uuid,uuid,bigint,boolean)'::regprocedure;
 def:=f.definition;
 IF position('PERFORM gridex_service_administration.require_manual_actor_v1(c,actor);' IN def)=0
  OR position('gridex_service_permission.current_request_timing_v1(c uuid, aid uuid, actor uuid, expected_version bigint, require_recorded boolean)' IN def)=0
  OR position('actor' IN replace(replace(def,'PERFORM gridex_service_administration.require_manual_actor_v1(c,actor);',''),'actor uuid, ',''))>0
 THEN RAISE EXCEPTION 'service_origin_timing_source_predecessor_required';END IF;
 def:=replace(def,'PERFORM gridex_service_administration.require_manual_actor_v1(c,actor);','');
 def:=replace(def,'gridex_service_permission.current_request_timing_v1(c uuid, aid uuid, actor uuid, expected_version bigint, require_recorded boolean)','gridex_service_permission.request_timing_source_v1(c uuid, aid uuid, expected_version bigint, require_recorded boolean)');
 EXECUTE def;
 EXECUTE format('ALTER FUNCTION gridex_service_permission.request_timing_source_v1(uuid,uuid,bigint,boolean) OWNER TO %I',pg_get_userbyid(f.proowner));
END$timing$;
REVOKE ALL ON FUNCTION gridex_service_permission.request_timing_source_v1(uuid,uuid,bigint,boolean) FROM PUBLIC,anon,authenticated,service_role;
DO $current$DECLARE f record;body text;needle text;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_service_permission.require_original_source_current_v1(uuid,uuid)'::regprocedure;
 needle:='IF current_source IS DISTINCT FROM s OR b IS DISTINCT FROM s.basis OR b->>''status'' IS DISTINCT FROM ''authorized'' THEN';
 IF position(needle IN f.prosrc)=0 OR position('DECLARE s gridex_service_permission.origins%rowtype;' IN f.prosrc)=0 THEN RAISE EXCEPTION 'service_origin_current_timing_predecessor_required';END IF;
 body:=replace(f.prosrc,needle,
  'IF s.message_code=''Z13'' THEN timing:=gridex_service_permission.request_timing_source_v1(s.company_id,s.assignment_id,(s.basis->>''assignmentVersion'')::bigint,true);'||
  ' IF timing->>''status'' IS DISTINCT FROM ''authorized'' OR timing->>''permissionId'' IS DISTINCT FROM s.permission_id::text OR s.basis->''requestTiming'' IS DISTINCT FROM timing->''proof'' THEN RAISE EXCEPTION ''ediel_permission_origin_basis_stale'';END IF;'||
  ' b:=b||jsonb_build_object(''requestTiming'',timing->''proof'');END IF;'||chr(10)||' '||needle);
 body:=replace(body,'DECLARE s gridex_service_permission.origins%rowtype;','DECLARE timing jsonb;s gridex_service_permission.origins%rowtype;');
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'service_origin_current_timing_metadata_changed';END IF;
END$current$;
COMMIT;
