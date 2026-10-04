-- Standalone retention workspace: current GoTrue/own accepted memberships,
-- explicit native retention operation AND class grants. No operative/admin
-- company access or global allow is inferred from this read-only selector.
BEGIN;
INSERT INTO public.permissions(key,name,category,description,is_active) VALUES('ediel.retention.read','Read source-bound retention originals','ediel','Explicit own read grant and class authority, without submit/review/purge authority',true) ON CONFLICT(key) DO NOTHING;
-- Extend only the dedicated native record resolver with an exact read key. The
-- operative canonical tenant resolver and membership defaults remain untouched.
DO $$DECLARE body text;needle text:=' SELECT permission_key INTO wanted FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;';BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_ediel_retention.record_permission_v1(uuid,uuid,text)'::regprocedure;
 IF position(needle in body)=0 THEN RAISE EXCEPTION 'retention_read_resolver_requires_source_review';END IF;
 body:=replace(body,'user_status=''active''','user_status=''active'' AND disabled_at IS NULL');
 body:=replace(body,needle,' IF k=''__read_scope__'' THEN wanted:=''ediel.retention.read'';ELSE SELECT permission_key INTO wanted FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;END IF;');
 EXECUTE format('CREATE OR REPLACE FUNCTION gridex_ediel_retention.record_permission_v1(c uuid,actor uuid,k text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',body);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='public.ediel_current_retention_session_v1(uuid,uuid)'::regprocedure;
 body:=replace(body,'''ediel.retention.submit'',''ediel.retention.review'',''ediel.retention.purge''','''ediel.retention.read'',''ediel.retention.submit'',''ediel.retention.review'',''ediel.retention.purge''');
 needle:='SELECT retention_class INTO own_class FROM gridex_ediel_retention.record_class_catalog WHERE permission_key=wanted ORDER BY retention_class LIMIT 1;';
 IF position(needle in body)=0 THEN RAISE EXCEPTION 'retention_read_session_requires_source_review';END IF;
 body:=replace(body,needle,needle||'IF wanted=''ediel.retention.read'' THEN own_class:=''__read_scope__'';END IF;');
 EXECUTE format('CREATE OR REPLACE FUNCTION public.ediel_current_retention_session_v1(p_company_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',body);
END$$;
CREATE FUNCTION gridex_ediel_retention.record_read_actor_v1(c uuid,actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 PERFORM id FROM auth.users WHERE id=actor FOR SHARE;PERFORM id FROM public.user_profiles WHERE id=actor FOR SHARE;PERFORM id FROM public.companies WHERE id=c FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=c AND user_id=actor FOR SHARE;
 IF auth.uid() IS DISTINCT FROM actor OR gridex_ediel_retention.record_permission_v1(c,actor,'__read_scope__') IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_read_actor_required' USING ERRCODE='42501';END IF;
END$$;
ALTER FUNCTION gridex_ediel_retention.record_read_actor_v1(uuid,uuid) OWNER TO gridex_ediel_retention_owner;
REVOKE ALL ON FUNCTION gridex_ediel_retention.record_read_actor_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE body text;needle text:='PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,''ediel.retention.review'');';BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='public.ediel_read_customer_record_retention_v1(uuid,uuid,uuid)'::regprocedure;
 IF position(needle in body)=0 THEN RAISE EXCEPTION 'retention_read_original_requires_source_review';END IF;
 body:=replace(body,needle,'IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,''__read_scope__'') IS TRUE THEN PERFORM gridex_ediel_retention.record_read_actor_v1(p_company_id,p_actor_user_id);ELSE '||needle||'END IF;');
 EXECUTE format('CREATE OR REPLACE FUNCTION public.ediel_read_customer_record_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',body);
END$$;
CREATE FUNCTION public.ediel_current_retention_companies_v1() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();company record;session jsonb;rows jsonb:='[]'::jsonb;n integer:=0;BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'retention_current_session_actor_required' USING ERRCODE='42501';END IF;
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 PERFORM id FROM auth.users WHERE id=actor FOR SHARE;PERFORM id FROM public.user_profiles WHERE id=actor FOR SHARE;
 FOR company IN SELECT c.id,c.name,c.status FROM public.company_memberships m JOIN public.companies c ON c.id=m.company_id WHERE m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL AND c.status IN('active','archived','pending_deletion') ORDER BY c.id LIMIT 1001 LOOP
  n:=n+1;IF n>1000 THEN RAISE EXCEPTION 'retention_current_company_list_bound';END IF;
  BEGIN
   session:=public.ediel_current_retention_session_v1(company.id,actor);
   rows:=rows||jsonb_build_array(jsonb_build_object('companyId',company.id,'name',company.name,'status',company.status,'permissions',session->'permissions'));
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 END LOOP;
 RETURN rows;
END$$;
ALTER FUNCTION public.ediel_current_retention_companies_v1() OWNER TO gridex_ediel_retention_owner;
REVOKE ALL ON FUNCTION public.ediel_current_retention_companies_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_current_retention_companies_v1() TO authenticated;
COMMIT;
