-- User-initiated source intake uses the actual authenticated session. Native
-- prepare/send/replay/domain execution retains its separate service contract.
-- Preserve each installed public OID and complete legal/source/custody body.
BEGIN;
CREATE FUNCTION gridex_supply_rescission.require_intake_session_v1(c uuid,actor uuid,phase text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF actor IS NULL OR auth.uid() IS DISTINCT FROM actor OR current_setting('role',true) IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION 'supply_rescission_authenticated_session_required' USING ERRCODE='42501';
 END IF;
 IF phase NOT IN('read','archive','review') OR gridex_supply_rescission.actor_v1(c,actor,phase) IS NOT TRUE THEN
  RAISE EXCEPTION 'supply_rescission_current_intake_actor_forbidden' USING ERRCODE='42501';
 END IF;
END$$;
REVOKE ALL ON FUNCTION gridex_supply_rescission.require_intake_session_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

DO $$DECLARE item record;p record;after_p record;body text;definition text;guard text;begin_at integer;returns integer;BEGIN
 FOR item IN SELECT * FROM(VALUES
  ('public.ediel_supply_rescission_scope_v1(uuid,uuid,jsonb)','read',2),
  ('public.ediel_archive_supply_rescission_v1(uuid,uuid,jsonb)','archive',2),
  ('public.ediel_review_supply_rescission_v1(uuid,uuid,uuid,jsonb)','review',3),
  ('public.ediel_read_supply_rescission_artifact_v1(uuid,uuid,uuid,boolean)','read',1)
 ) v(signature,phase,expected_returns) LOOP
  SELECT pr.*,l.lanname INTO p FROM pg_proc pr JOIN pg_language l ON l.oid=pr.prolang WHERE pr.oid=to_regprocedure(item.signature);
  IF p.oid IS NULL OR p.lanname<>'plpgsql' OR p.prosecdef IS NOT TRUE OR position('gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,' IN p.prosrc)=0 OR position('require_intake_session_v1' IN p.prosrc)>0 THEN
   RAISE EXCEPTION 'supply_rescission_intake_forward_owner_shape_changed: %',item.signature;
  END IF;
  SELECT count(*) INTO returns FROM regexp_matches(p.prosrc,'\mRETURN\M','g');
  begin_at:=position('BEGIN' IN p.prosrc);
  IF begin_at=0 OR returns<>item.expected_returns THEN RAISE EXCEPTION 'supply_rescission_intake_forward_return_shape_changed: %',item.signature;END IF;
  guard:=format('PERFORM gridex_supply_rescission.require_intake_session_v1(p_company_id,p_actor_user_id,%L);',item.phase);
  -- All original returns are outer PL/pgSQL returns. Assert their bounded count
  -- above, then guard held, rejected, idempotent and final successful returns.
  body:=regexp_replace(p.prosrc,'\mRETURN\M',guard||' RETURN','g');
  body:=overlay(body PLACING 'BEGIN '||guard FROM begin_at FOR 5);
  definition:=pg_get_functiondef(p.oid);
  IF position(p.prosrc IN definition)=0 THEN RAISE EXCEPTION 'supply_rescission_intake_forward_definition_changed: %',item.signature;END IF;
  EXECUTE replace(definition,p.prosrc,body);
  SELECT * INTO after_p FROM pg_proc WHERE oid=to_regprocedure(item.signature);
  IF after_p.oid<>p.oid OR after_p.proowner<>p.proowner OR after_p.proconfig IS DISTINCT FROM p.proconfig OR after_p.prosecdef IS DISTINCT FROM p.prosecdef OR after_p.provolatile<>p.provolatile OR after_p.proargtypes<>p.proargtypes OR after_p.prorettype<>p.prorettype OR after_p.proargnames IS DISTINCT FROM p.proargnames OR after_p.proargdefaults IS DISTINCT FROM p.proargdefaults OR after_p.proacl IS DISTINCT FROM p.proacl THEN
   RAISE EXCEPTION 'supply_rescission_intake_forward_catalog_changed: %',item.signature;
  END IF;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',item.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',item.signature);
 END LOOP;
END$$;
COMMIT;
