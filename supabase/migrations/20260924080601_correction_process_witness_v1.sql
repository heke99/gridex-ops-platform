-- A process fact becomes visible to a second committed transaction before it
-- can be witnessed. This records visibility, not complete history or authority.
BEGIN;
CREATE TABLE gridex_correction_process.witnesses (
 fact_id bigint PRIMARY KEY REFERENCES gridex_correction_process.facts(id),
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 facts_hash text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 visibility_snapshot text NOT NULL DEFAULT pg_current_snapshot()::text,
 created_xid xid8 NOT NULL DEFAULT pg_current_xact_id()
);
ALTER TABLE gridex_correction_process.witnesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_correction_process.witnesses FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_correction_process.witnesses FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_correction_process.witnesses
 FOR EACH ROW EXECUTE FUNCTION gridex_correction_process.immutable_v1();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON gridex_correction_process.witnesses
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_correction_process.immutable_v1();

CREATE FUNCTION gridex_correction_process.witness_v1(
 p_company_id uuid,p_fact_id bigint,p_facts_hash text,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE f gridex_correction_process.facts%rowtype; w gridex_correction_process.witnesses%rowtype;
BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL
 OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'customers.read'),false)
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor_user_id AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id AND user_id=p_actor_user_id
  AND is_active AND status='active' AND accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.companies WHERE id=p_company_id AND coalesce(is_active,true)
  AND coalesce(status,'active') NOT IN ('archived','suspended','pending_deletion','deleted','deleted_test_only','inactive','paused','closed'))
 THEN RAISE EXCEPTION 'process_actor_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM gridex_correction_process.facts
 WHERE id=p_fact_id AND company_id=p_company_id AND facts_hash=p_facts_hash;
 IF f.id IS NULL OR EXISTS(SELECT FROM gridex_correction_process.gaps WHERE fact_id=f.id)
 THEN RAISE EXCEPTION 'process_fact_unavailable' USING ERRCODE='42501'; END IF;
 IF f.created_xid=pg_current_xact_id()
 THEN RAISE EXCEPTION 'process_fact_not_committed' USING ERRCODE='23514'; END IF;
 INSERT INTO gridex_correction_process.witnesses(fact_id,company_id,facts_hash)
 VALUES(f.id,p_company_id,f.facts_hash) ON CONFLICT(fact_id) DO NOTHING;
 SELECT * INTO STRICT w FROM gridex_correction_process.witnesses WHERE fact_id=f.id;
 RETURN jsonb_build_object('factId',f.id,'factsHash',f.facts_hash,'witnessId',w.id,
  'availableAt',w.observed_at,'coverage','incomplete','authority','none');
END $$;
REVOKE ALL ON FUNCTION gridex_correction_process.witness_v1(uuid,bigint,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gridex_correction_process TO service_role;
GRANT EXECUTE ON FUNCTION gridex_correction_process.witness_v1(uuid,bigint,text,uuid) TO service_role;

CREATE FUNCTION public.gridex_witness_correction_process_fact_v1(
 p_company_id uuid,p_fact_id bigint,p_facts_hash text,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 RETURN gridex_correction_process.witness_v1(p_company_id,p_fact_id,p_facts_hash,p_actor_user_id);
END $$;
REVOKE ALL ON FUNCTION public.gridex_witness_correction_process_fact_v1(uuid,bigint,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_witness_correction_process_fact_v1(uuid,bigint,text,uuid) TO service_role;
COMMIT;
