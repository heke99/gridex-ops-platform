-- Forward-only terminal current authority for contract original intake (signed-BRP intake: 20261001142510).
-- Every original public port body, source predicate, issuer/review/custody
-- rule and error precedence is kept unchanged in a private body copy. The
-- public OID, ACL, owner, config and defaults are kept: only the public body
-- is replaced so the exact jsonb result is materialized first, then the
-- caller's current actor authority is checked as the final step. No native
-- wait follows that check. A denied actor raises 42501 and the statement rolls
-- back atomically, including any review/audit rows the body inserted.
BEGIN;
DO $$DECLARE f record;copy text;port record;body text;BEGIN
 FOR port IN SELECT * FROM (VALUES
  ('public.ediel_contract_intake_scope_v1(uuid,uuid,uuid,text,text)','gridex_contract_source_intake.terminal_scope_body_v1',
   'PERFORM gridex_contract_source_intake.actor_v1(p_company_id,p_actor_user_id,''archive'',p_kind);'),
  ('public.ediel_archive_contract_original_source_v1(uuid,uuid,uuid,text,text,jsonb)','gridex_contract_source_intake.terminal_archive_body_v1',
   'PERFORM gridex_contract_source_intake.actor_v1(p_company_id,p_actor_user_id,''archive'',p_kind);'),
  ('public.ediel_review_contract_original_source_v1(uuid,uuid,uuid,jsonb)','gridex_contract_source_intake.terminal_review_body_v1',
   'SELECT kind INTO STRICT terminal_kind FROM gridex_contract_source_intake.artifacts WHERE id=p_artifact_id AND company_id=p_company_id;PERFORM gridex_contract_source_intake.actor_v1(p_company_id,p_actor_user_id,''review'',terminal_kind);'),
  ('public.ediel_read_contract_original_source_v1(uuid,uuid,uuid)','gridex_contract_source_intake.terminal_read_body_v1',
   'SELECT kind INTO STRICT terminal_kind FROM gridex_contract_source_intake.artifacts WHERE id=p_artifact_id AND company_id=p_company_id;PERFORM gridex_contract_source_intake.actor_v1(p_company_id,p_actor_user_id,''read'',terminal_kind);'),
  ('public.ediel_list_contract_original_sources_v1(uuid,uuid,uuid)','gridex_contract_source_intake.terminal_list_body_v1',
   'PERFORM gridex_contract_source_intake.actor_v1(p_company_id,p_actor_user_id,''read'',''masterdata_declaration'');')
 ) v(target,copy_name,terminal) LOOP
  SELECT p.oid,p.proowner,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition,oidvectortypes(p.proargtypes) args
   INTO STRICT f FROM pg_proc p WHERE p.oid=port.target::regprocedure;
  IF f.metadata->>'prorettype' IS DISTINCT FROM 'jsonb'::regtype::oid::text OR position('terminal_result' IN f.prosrc)>0 OR to_regprocedure(port.copy_name||'('||f.args||')') IS NOT NULL THEN RAISE EXCEPTION 'intake_terminal_authority_predecessor_required: %',port.target;END IF;
  copy:=replace(f.definition,'FUNCTION '||split_part(port.target,'(',1)||'(','FUNCTION '||port.copy_name||'(');
  IF copy=f.definition THEN RAISE EXCEPTION 'intake_terminal_authority_exact_header_required: %',port.target;END IF;
  EXECUTE copy;
  EXECUTE format('ALTER FUNCTION %s(%s) OWNER TO %I',port.copy_name,f.args,pg_get_userbyid(f.proowner));
  EXECUTE format('REVOKE ALL ON FUNCTION %s(%s) FROM PUBLIC,anon,authenticated,service_role',port.copy_name,f.args);
  -- Arguments are passed positionally by their declared names.
  body:=E'\nDECLARE terminal_result jsonb;terminal_kind text;\nBEGIN\n terminal_result:='||port.copy_name||'('||
   (SELECT string_agg(quote_ident(n),',' ORDER BY o) FROM jsonb_array_elements_text(f.metadata->'proargnames') WITH ORDINALITY x(n,o))||
   E');\n '||port.terminal||E'\n RETURN terminal_result;\nEND';
  EXECUTE replace(f.definition,f.prosrc,body);
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'intake_terminal_authority_metadata_changed: %',port.target;END IF;
 END LOOP;

 -- Private success edges: the final reviewer authority follows the last
 -- selected source-row wait; the materialized result is returned unchanged.
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_contract_source_intake.current_v1(uuid,text,uuid)'::regprocedure;
 body:=replace(f.prosrc,' RETURN source IS NOT NULL AND encode(sha256(convert_to(source::text,''UTF8'')),''hex'')=q.row_hash;',
  ' terminal_current:=source IS NOT NULL AND encode(sha256(convert_to(source::text,''UTF8'')),''hex'')=q.row_hash;'||
  ' IF terminal_current THEN BEGIN PERFORM gridex_contract_source_intake.actor_v1(c,r.actor_user_id,''review'',k,false); EXCEPTION WHEN insufficient_privilege OR raise_exception THEN RETURN false;END;END IF;'||
  ' RETURN terminal_current;');
 IF body=f.prosrc OR position('DECLARE a gridex_contract_source_intake.artifacts%rowtype;' IN body)=0 THEN RAISE EXCEPTION 'contract_current_terminal_predecessor_required';END IF;
 body:=replace(body,'DECLARE a gridex_contract_source_intake.artifacts%rowtype;','DECLARE terminal_current boolean;a gridex_contract_source_intake.artifacts%rowtype;');
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'contract_current_terminal_metadata_changed';END IF;

END$$;
COMMIT;
