-- Serialize the cancellation decision with the actual transport receipt.
-- Keep trigger creation and the Supabase migration receipt atomic.
SET lock_timeout = '2s';
SET statement_timeout = '30s';
DO $ediel_aperak_cancellation_migration$
BEGIN

DO $preflight$
BEGIN
  IF (
    SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid=to_regprocedure('gridex_ediel_transport.mutate_before_service_origin_v1(jsonb)')
  ) IS DISTINCT FROM 'c629c87f39c3b8589fe0bf4b814cfc2fb87d37b4805ec3d76b7f97f33baa5e7d'
  OR (
    SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid=to_regprocedure('gridex_ediel_transport.mutate_before_original_basis_v1(jsonb)')
  ) IS DISTINCT FROM 'eb9fdfd87d2e5bc8779bc6274aec1aac7a617a5c6f857c7d15eeb48df0960c12'
  THEN
    RAISE EXCEPTION 'ediel_aperak_cancellation_requires_qualified_transport_fence';
  END IF;
END
$preflight$;

CREATE FUNCTION gridex_ediel_transport.guard_aperak_cancellation_v1()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  -- The generic APERAK entrance locks the message before writing its journal.
  -- This trigger evaluates the committed journal after competing row locks.
  -- Snapshot isolation could otherwise hide the concurrent journal commit.
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'ediel_aperak_cancellation_read_committed_required' USING ERRCODE='25000';
  END IF;
  IF OLD.message_sent_at IS NOT NULL
    OR OLD.status IN ('provider_accepted','sent','delivered','acknowledged','validated','delivery_uncertain')
    OR EXISTS (
      SELECT 1
      FROM gridex_ediel_transport.attempts a
      WHERE a.message_id=OLD.id AND a.company_id=OLD.company_id AND a.environment=OLD.environment
        AND (a.entered_at IS NOT NULL OR a.observed_at IS NOT NULL)
    )
    OR EXISTS (
      SELECT 1
      FROM gridex_outbound_dispatch.events e
      WHERE e.message_id=OLD.id AND e.company_id=OLD.company_id AND e.environment=OLD.environment
        AND e.kind IN ('provider_call_entered','provider_result')
    )
  THEN
    RAISE EXCEPTION 'ediel_aperak_cancellation_transport_started' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION gridex_ediel_transport.guard_aperak_cancellation_v1() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_aperak_cancellation_transport
BEFORE UPDATE OF status ON public.ediel_messages
FOR EACH ROW
WHEN (OLD.direction='outbound' AND OLD.message_family='APERAK'
      AND OLD.status IS DISTINCT FROM 'cancelled' AND NEW.status='cancelled')
EXECUTE FUNCTION gridex_ediel_transport.guard_aperak_cancellation_v1();

END
$ediel_aperak_cancellation_migration$;
RESET statement_timeout;
RESET lock_timeout;
