-- Forward-only terminal current authority for signed-BRP declaration intake (contract intake: 20261001142500).
-- Every original public port body, source predicate, issuer/review/custody
-- rule and error precedence is kept unchanged in a private body copy. The
-- public OID, ACL, owner, config and defaults are kept: only the public body
-- is replaced so the exact jsonb result is materialized first, then the
-- caller's current actor authority is checked as the final step. No native
-- wait follows that check. A denied actor raises 42501 and the statement rolls
-- back atomically, including any review/audit rows the body inserted.
BEGIN;
-- The shared scoped resolver used by both intake actors still evaluated
-- override validity against transaction start (now()). A deny becoming current
-- during a long statement was invisible to the terminal check. Same canonical
-- predicates; current wall clock only (as 20261001125000 for the company resolver).
DO $clock$DECLARE f record;body text;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_requested_changes.scoped_permission_v1(uuid,uuid,text)'::regprocedure;
 IF position('public.user_permission_overrides d' IN f.prosrc)=0 OR position('d.valid_from<=now()' IN f.prosrc)=0 OR position('now()<d.valid_to' IN f.prosrc)=0 THEN RAISE EXCEPTION 'scoped_permission_clock_predecessor_required';END IF;
 body:=replace(replace(f.prosrc,'d.valid_from<=now()','d.valid_from<=clock_timestamp()'),'now()<d.valid_to','clock_timestamp()<d.valid_to');
 IF position('now()' IN body)>0 THEN RAISE EXCEPTION 'scoped_permission_clock_unexpected_now';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'scoped_permission_clock_metadata_changed';END IF;
END$clock$;
DO $$DECLARE f record;copy text;port record;body text;BEGIN
 FOR port IN SELECT * FROM (VALUES
  ('public.ediel_signed_brp_declaration_scope_v1(uuid,uuid,jsonb)','gridex_brp_declaration_intake.terminal_scope_body_v1',
   'IF gridex_brp_declaration_intake.actor_v1(p_company_id,p_actor_user_id,''read'') IS NOT TRUE THEN RAISE EXCEPTION ''signed_brp_terminal_actor_revoked'' USING ERRCODE=''42501'';END IF;'),
  ('public.ediel_archive_signed_brp_declaration_v1(uuid,uuid,jsonb)','gridex_brp_declaration_intake.terminal_archive_body_v1',
   'IF gridex_brp_declaration_intake.actor_v1(p_company_id,p_actor_user_id,''archive'') IS NOT TRUE THEN RAISE EXCEPTION ''signed_brp_terminal_actor_revoked'' USING ERRCODE=''42501'';END IF;'),
  ('public.ediel_read_signed_brp_declaration_v1(uuid,uuid,uuid,boolean)','gridex_brp_declaration_intake.terminal_read_body_v1',
   'IF gridex_brp_declaration_intake.actor_v1(p_company_id,p_actor_user_id,''read'') IS NOT TRUE THEN RAISE EXCEPTION ''signed_brp_terminal_actor_revoked'' USING ERRCODE=''42501'';END IF;'),
  ('public.ediel_review_signed_brp_declaration_v1(uuid,uuid,uuid,jsonb)','gridex_brp_declaration_intake.terminal_review_body_v1',
   'IF gridex_brp_declaration_intake.actor_v1(p_company_id,p_actor_user_id,''review'') IS NOT TRUE THEN RAISE EXCEPTION ''signed_brp_terminal_actor_revoked'' USING ERRCODE=''42501'';END IF;'),
  ('public.ediel_revoke_signed_brp_declaration_v1(uuid,uuid,uuid,text)','gridex_brp_declaration_intake.terminal_revoke_body_v1',
   'IF gridex_brp_declaration_intake.actor_v1(p_company_id,p_actor_user_id,''revoke'') IS NOT TRUE THEN RAISE EXCEPTION ''signed_brp_terminal_actor_revoked'' USING ERRCODE=''42501'';END IF;')
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

 -- Private success edge: the final reviewer authority follows the last
 -- receipt read; the materialized result is returned unchanged.
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_brp_declaration_intake.origin_current_v1(uuid,uuid)'::regprocedure;
 body:=replace(f.prosrc,' RETURN claims=a.claims AND gridex_brp_declaration_intake.receipt_current_v1(a) IS TRUE AND gridex_brp_declaration_intake.actor_v1(c,r.reviewer_user_id,''review'',false) IS TRUE AND gridex_brp_declaration_intake.receipt_current_v1(a) IS TRUE;',
  ' terminal_current:=claims=a.claims AND gridex_brp_declaration_intake.receipt_current_v1(a) IS TRUE AND gridex_brp_declaration_intake.actor_v1(c,r.reviewer_user_id,''review'',false) IS TRUE AND gridex_brp_declaration_intake.receipt_current_v1(a) IS TRUE;'||
  ' RETURN terminal_current IS TRUE AND gridex_brp_declaration_intake.actor_v1(c,r.reviewer_user_id,''review'',false) IS TRUE;');
 IF body=f.prosrc OR position('claims jsonb;BEGIN' IN body)=0 THEN RAISE EXCEPTION 'brp_origin_current_terminal_predecessor_required';END IF;
 body:=replace(body,'claims jsonb;BEGIN','claims jsonb;terminal_current boolean;BEGIN');
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'brp_origin_current_terminal_metadata_changed';END IF;
END$$;
COMMIT;
