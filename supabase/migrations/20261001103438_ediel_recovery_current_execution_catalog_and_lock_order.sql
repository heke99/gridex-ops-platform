-- TR-05/TR-10, TEN-01, CALL-03: current executor is distinct from immutable
-- creator provenance. Preparation and sending retain separate catalog grants.
-- Compose onto installed recovery lineage without recreating its source owner.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_received_sources.require_recovery_execution_actor_v1(c uuid,actor uuid,phase text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE observed timestamptz;wanted text;
BEGIN
 IF c IS NULL OR actor IS NULL OR (phase IN('prepare','send')) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_recovery_execution_scope_required';END IF;
 wanted:=CASE phase WHEN 'prepare' THEN 'communication.write' ELSE 'communication.send' END;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM 1 FROM auth.users u WHERE u.id=actor FOR SHARE;
 PERFORM 1 FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM 1 FROM public.companies x WHERE x.id=c FOR SHARE;
 PERFORM 1 FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor FOR SHARE;
 observed:=clock_timestamp();
 IF NOT EXISTS(SELECT FROM auth.users u WHERE u.id=actor AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=observed))
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active' AND u.disabled_at IS NULL)
  OR NOT EXISTS(SELECT FROM public.companies x WHERE x.id=c AND x.status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.permissions p WHERE p.key=wanted AND p.is_active)
  OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,wanted),false)
 THEN RAISE EXCEPTION 'prodat_recovery_execution_actor_forbidden' USING ERRCODE='42501';END IF;
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.require_recovery_execution_actor_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve all published signatures, owner, ACL, argument names/defaults,
-- volatility, security and other catalog metadata. Change only source bodies.
-- The phase owner already owns current source/hash/object/ACK qualification;
-- this delta only establishes the shared graph -> source cohort lock prefix.
DO $compose$
DECLARE f record;body text;definition text;actual jsonb;target text;
 prefix text:=E'BEGIN\n PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();\n LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;\n';
BEGIN
 FOREACH target IN ARRAY ARRAY[
  'gridex_service_permission.recovery_operation_before_current_service_v1',
  'public.ediel_require_prodat_recovery_current_v1',
  'public.ediel_require_service_permission_origin_current_v1',
  'public.ediel_prepare_prodat_recovery_v1',
  'public.ediel_queue_prodat_retry_v1',
  'public.ediel_prodat_retry_outbox_basis_v1',
  'public.ediel_consume_prodat_retry_authorization_v1',
  'gridex_customer_life_events.recovery_basis_v1',
  'gridex_ediel_transport.mutate_v1'
 ] LOOP
  SELECT * INTO STRICT f FROM pg_catalog.pg_proc WHERE oid=target::regproc;
  IF f.prosecdef IS NOT TRUE OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prosrc NOT LIKE '%'||E'BEGIN\n'||'%' THEN RAISE EXCEPTION 'prodat_recovery_installed_owner_review_required: %',target;END IF;
  body:=overlay(f.prosrc placing prefix from strpos(f.prosrc,E'BEGIN\n') for length(E'BEGIN\n'));
  -- No source rule, source creator, established operation, reservation,
  -- effect/retry or ACK branch is removed or rebound by the lock prefix.
  definition:=pg_get_functiondef(f.oid);
  EXECUTE replace(definition,f.prosrc,body);
  SELECT to_jsonb(p)-'prosrc' INTO actual FROM pg_proc p WHERE p.oid=f.oid;
  IF actual IS DISTINCT FROM to_jsonb(f)-'prosrc' THEN RAISE EXCEPTION 'prodat_recovery_existing_authority_changed: %',target;END IF;
 END LOOP;
END$compose$;
COMMIT;
