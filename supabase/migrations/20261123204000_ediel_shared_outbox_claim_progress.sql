-- Each Ediel claim entry point uses the same invoker for queue updates.
-- Keep this SQL block atomic with the Supabase CLI migration ledger.
SET lock_timeout = '2s';
SET statement_timeout = '30s';
DO $ediel_claim_migration$
BEGIN
  IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex')
      FROM pg_catalog.pg_proc p
      WHERE p.oid = pg_catalog.to_regprocedure('public.claim_ediel_outbox_items(text,uuid,integer,text,interval)')
        AND NOT p.prosecdef)
      IS DISTINCT FROM '89aeedeab80eb29777d0d062d0f3ce98c628b1d0ad11f2f9d14f88da600c13af'
  THEN
    RAISE EXCEPTION 'ediel_shared_outbox_claim_predecessor_changed' USING ERRCODE = '55000';
  END IF;

  CREATE SCHEMA gridex_ediel_outbox_claim;
  REVOKE ALL ON SCHEMA gridex_ediel_outbox_claim FROM PUBLIC, anon, authenticated, service_role;
  -- The legacy public function is invoker and callable by PUBLIC. Keep its
  -- existing SQL-role ABI and RLS behavior through the private invoker.
  GRANT USAGE ON SCHEMA gridex_ediel_outbox_claim TO PUBLIC;

  -- The worker sees only whether a candidate has a reserved direct-test lane.
  CREATE FUNCTION gridex_ediel_outbox_claim.actorless_reserved_v1(p_outbox_item_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $reservation$
    SELECT CASE WHEN current_setting('role', true) = 'service_role'
      OR (current_setting('role', true) = 'none' AND session_user IN ('postgres', 'service_role'))
      THEN EXISTS (
        SELECT 1 FROM gridex_ediel_local_wait.policies_v1 p WHERE p.outbox_id = p_outbox_item_id
      )
      ELSE false
    END
  $reservation$;
  REVOKE ALL ON FUNCTION gridex_ediel_outbox_claim.actorless_reserved_v1(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
  -- The invoker's cached query resolves this function even when the CASE
  -- skips it. The private predicate itself limits data to the service role.
  GRANT EXECUTE ON FUNCTION gridex_ediel_outbox_claim.actorless_reserved_v1(uuid) TO PUBLIC;

  CREATE FUNCTION gridex_ediel_outbox_claim.claim_v1(
    p_environment text, p_company_id uuid, p_limit integer, p_worker_id text, p_stale_after interval
  ) RETURNS TABLE (items public.ediel_outbox[], stale_transition_count bigint)
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
  AS $owner$
  DECLARE
    stale record;
    final_status text;
    failure_message text;
    archive_error constant text := 'ediel_reconciliation_archive_binding_not_qualified';
    stale_threshold timestamptz := now() - p_stale_after;
  BEGIN
    stale_transition_count := 0;
    FOR stale IN
      SELECT o.id, o.company_id, o.environment, o.locked_at, o.locked_by, o.current_send_attempt_id
      FROM public.ediel_outbox o
      WHERE o.status = 'sending' AND o.locked_at < stale_threshold
        AND (p_environment IS NULL OR o.environment = p_environment)
        AND (p_company_id IS NULL OR o.company_id = p_company_id)
      ORDER BY o.updated_at, o.locked_at, o.id
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    LOOP
      BEGIN
        UPDATE public.ediel_outbox o
        SET status = 'delivery_uncertain',
            last_error = coalesce(o.last_error, 'stale_sending_lock_requires_transport_reconciliation'),
            blocked_reason = CASE WHEN o.blocked_reason = archive_error THEN NULL ELSE o.blocked_reason END,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = now()
        WHERE o.id = stale.id
          AND o.company_id IS NOT DISTINCT FROM stale.company_id
          AND o.environment = stale.environment
          AND o.status = 'sending'
          AND o.locked_at = stale.locked_at
          AND o.locked_by IS NOT DISTINCT FROM stale.locked_by
          AND o.current_send_attempt_id IS NOT DISTINCT FROM stale.current_send_attempt_id
        RETURNING o.status INTO final_status;
        IF final_status = 'delivery_uncertain' THEN
          stale_transition_count := stale_transition_count + 1;
        END IF;
      EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS failure_message = MESSAGE_TEXT;
        IF failure_message IS DISTINCT FROM archive_error THEN
          RAISE;
        END IF;

        -- Keep the old lease and attempt intact. Advancing the observation
        -- time keeps a held archive from starving independent stale work.
        UPDATE public.ediel_outbox o
        SET blocked_reason = coalesce(o.blocked_reason, archive_error),
            updated_at = clock_timestamp()
        WHERE o.id = stale.id
          AND o.company_id IS NOT DISTINCT FROM stale.company_id
          AND o.environment = stale.environment
          AND o.status = 'sending'
          AND o.locked_at = stale.locked_at
          AND o.locked_by IS NOT DISTINCT FROM stale.locked_by
          AND o.current_send_attempt_id IS NOT DISTINCT FROM stale.current_send_attempt_id;
      END;
    END LOOP;

    WITH candidates AS (
      SELECT o.id FROM public.ediel_outbox o
      WHERE o.status IN ('prepared', 'queued')
        AND (o.locked_at IS NULL OR o.locked_at < stale_threshold)
        AND (p_environment IS NULL OR o.environment = p_environment)
        AND (p_company_id IS NULL OR o.company_id = p_company_id)
        AND CASE WHEN current_user IN ('postgres', 'service_role')
          THEN NOT gridex_ediel_outbox_claim.actorless_reserved_v1(o.id)
          ELSE true
        END
      ORDER BY o.priority, o.created_at, o.id
      LIMIT greatest(1, least(coalesce(p_limit, 25), 100))
      FOR UPDATE SKIP LOCKED
    ), updated AS (
      UPDATE public.ediel_outbox o
      SET status = 'sending', locked_at = now(), locked_by = p_worker_id,
          attempts = coalesce(o.attempts, 0) + 1,
          send_attempt_count = coalesce(o.send_attempt_count, 0) + 1,
          current_send_attempt_id = gen_random_uuid(),
          updated_at = now()
      WHERE o.id IN (SELECT id FROM candidates)
      RETURNING o AS item
    )
    SELECT coalesce(array_agg(u.item ORDER BY (u.item).priority, (u.item).created_at, (u.item).id),
                    ARRAY[]::public.ediel_outbox[])
    INTO items FROM updated u;
    RETURN NEXT;
  END
  $owner$;
  GRANT EXECUTE ON FUNCTION gridex_ediel_outbox_claim.claim_v1(text, uuid, integer, text, interval) TO PUBLIC;

  CREATE OR REPLACE FUNCTION public.claim_ediel_outbox_items(
    p_environment text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid,
    p_limit integer DEFAULT 25, p_worker_id text DEFAULT 'ediel-outbox-engine'::text,
    p_stale_after interval DEFAULT '00:10:00'::interval
  ) RETURNS SETOF public.ediel_outbox
  LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
  AS $legacy$
  BEGIN
    RETURN QUERY
      SELECT r.* FROM gridex_ediel_outbox_claim.claim_v1(p_environment, p_company_id, p_limit, p_worker_id, p_stale_after) c
      CROSS JOIN LATERAL unnest(c.items) r;
  END
  $legacy$;

  CREATE FUNCTION public.gridex_claim_ediel_outbox_progress_v1(
    p_environment text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid,
    p_limit integer DEFAULT 25, p_worker_id text DEFAULT 'ediel-outbox-engine'::text,
    p_stale_after interval DEFAULT '00:10:00'::interval
  ) RETURNS jsonb
  LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog
  AS $progress$
    SELECT jsonb_build_object('items', c.items, 'staleTransitionCount', c.stale_transition_count)
    FROM gridex_ediel_outbox_claim.claim_v1(p_environment, p_company_id, p_limit, p_worker_id, p_stale_after) c
  $progress$;
  REVOKE ALL ON FUNCTION public.gridex_claim_ediel_outbox_progress_v1(text, uuid, integer, text, interval)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_claim_ediel_outbox_progress_v1(text, uuid, integer, text, interval) TO service_role;

-- Apply only when the exact #1049 local-wait fence is already installed.
DO $preimage$
BEGIN
  IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
        FROM pg_catalog.pg_proc
       WHERE oid=pg_catalog.to_regprocedure('gridex_ediel_local_wait.outbox_fence_v1()'))
     IS DISTINCT FROM '491ceb1213684ac2aa1ccb3e333f6f24a7d9a92c37e878d44ec3df3b362103c9' THEN
    RAISE EXCEPTION 'ediel_stale_outbox_local_wait_preimage_changed';
  END IF;
END $preimage$;

CREATE OR REPLACE FUNCTION gridex_ediel_local_wait.outbox_fence_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p gridex_ediel_local_wait.policies_v1%rowtype;w gridex_ediel_local_wait.waits_v1%rowtype;t timestamptz;
BEGIN
 SELECT * INTO p FROM gridex_ediel_local_wait.policies_v1 WHERE outbox_id=OLD.id;
 IF NOT FOUND THEN RETURN NEW;END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id
 OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.ediel_message_id IS DISTINCT FROM OLD.ediel_message_id
 OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
 OR NEW.attempts<OLD.attempts OR NEW.send_attempt_count<OLD.send_attempt_count
 THEN RAISE EXCEPTION 'local_wait_outbox_lineage_or_counter_change' USING ERRCODE='55000';END IF;
 -- Permit only the service worker's archive-hold observation. This neither
 -- releases the lease nor changes attempts or authorizes a new transport.
 IF current_setting('role',true)='service_role'
 AND OLD.environment='test' AND OLD.status='sending'
 AND OLD.locked_at < now()-interval '10 minutes' AND nullif(OLD.locked_by,'') IS NOT NULL AND OLD.current_send_attempt_id IS NOT NULL
 AND NEW.updated_at > OLD.updated_at AND NEW.updated_at <= clock_timestamp()
 AND NEW.blocked_reason IS NOT DISTINCT FROM coalesce(OLD.blocked_reason,'ediel_reconciliation_archive_binding_not_qualified')
 AND (to_jsonb(NEW)-ARRAY['blocked_reason','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['blocked_reason','updated_at'])
 THEN RETURN NEW; END IF;
 IF NEW.status='sending' THEN
  -- Broad actorless worker claims are not a LOCAL retry entry.
  IF NEW.updated_by IS NULL OR NEW.locked_by IS DISTINCT FROM 'ediel-outbox-direct-'||NEW.updated_by::text
  THEN RETURN NULL;END IF;
  SELECT * INTO w FROM gridex_ediel_local_wait.waits_v1 WHERE policy_id=p.id AND consumed_at IS NULL ORDER BY observed_at DESC LIMIT 1;
  -- Before due: suppress the row update itself, including lease and counters.
  t:=clock_timestamp();IF FOUND AND t<w.not_before THEN RETURN NULL;END IF;
  p:=gridex_ediel_local_wait.require_policy_v1(OLD.ediel_message_id,NEW.updated_by);
  IF NEW.attempts>p.attempt_limit OR NEW.send_attempt_count>p.attempt_limit THEN RAISE EXCEPTION 'local_wait_attempt_budget_exhausted' USING ERRCODE='55000';END IF;
  IF OLD.status<>'sending' AND (OLD.status NOT IN('prepared','queued') OR NEW.attempts<>OLD.attempts+1 OR NEW.send_attempt_count<>OLD.send_attempt_count+1)
  THEN RAISE EXCEPTION 'local_wait_claim_increment_invalid' USING ERRCODE='55000';END IF;
  IF OLD.status='sending' AND (NEW.attempts IS DISTINCT FROM OLD.attempts OR NEW.send_attempt_count IS DISTINCT FROM OLD.send_attempt_count
   OR NEW.current_send_attempt_id IS DISTINCT FROM OLD.current_send_attempt_id OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
   OR NEW.locked_at IS DISTINCT FROM OLD.locked_at) THEN
   RAISE EXCEPTION 'local_wait_claim_lease_immutable' USING ERRCODE='55000';END IF;
 ELSIF NEW.attempts<>OLD.attempts OR NEW.send_attempt_count<>OLD.send_attempt_count THEN
  RAISE EXCEPTION 'local_wait_unclaimed_attempt_increment' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

END
$ediel_claim_migration$;
RESET statement_timeout;
RESET lock_timeout;
