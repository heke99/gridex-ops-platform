-- The Supabase CLI records this migration in the same transaction as this block.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_migration$
BEGIN

DO $request_predecessor$
BEGIN
  IF to_regprocedure('public.gridex_sync_current_e66_request_v1(uuid,uuid,uuid,uuid,uuid[],jsonb)') IS NULL THEN
    RAISE EXCEPTION 'e66_request_retry_requires_current_metering_authority' USING ERRCODE = '55000';
  END IF;
END
$request_predecessor$;

CREATE SCHEMA gridex_e66_request_retry;
REVOKE ALL ON SCHEMA gridex_e66_request_retry FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE gridex_e66_request_retry.commands (
  source_id uuid PRIMARY KEY,
  reception_id uuid NOT NULL UNIQUE,
  company_id uuid NOT NULL,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  mailbox_id uuid NOT NULL,
  meter_ids uuid[] NOT NULL,
  response_patch jsonb,
  response_digest bytea NOT NULL,
  response_shape_digest bytea NOT NULL,
  last_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0,
  outcome jsonb,
  CHECK ((outcome IS NULL) = (response_patch IS NOT NULL))
);

-- This marker is owned by the deferred request worker. It is not an ACK receipt.
CREATE TABLE gridex_e66_request_retry.terminal_handoffs (
  source_id uuid PRIMARY KEY REFERENCES gridex_e66_request_retry.commands(source_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON gridex_e66_request_retry.terminal_handoffs FROM PUBLIC,anon,authenticated,service_role;

CREATE INDEX e66_pending_scope ON gridex_e66_request_retry.commands
  (company_id, environment, mailbox_id, actor_id, last_attempt_at, source_id)
  WHERE outcome IS NULL;

-- This is a local compatibility prototype. The receipt and parser stay read-only.
CREATE FUNCTION gridex_e66_request_retry.bound_reception(
  company uuid, environment text, mailbox uuid, source uuid, request_id uuid
) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT (
    SELECT r.id
    FROM gridex_ediel_inbound_receptions.receptions r
    JOIN public.ediel_messages s ON s.id = r.source_message_id
      AND s.company_id = r.company_id AND s.environment = r.environment
      AND s.inbound_email_message_id = r.inbound_email_message_id
    JOIN public.inbound_email_messages m ON m.id = r.inbound_email_message_id
    JOIN public.inbound_ediel_parse_results p ON p.id = r.parse_result_id
      AND p.inbound_email_message_id = m.id AND p.company_id = r.company_id
    JOIN public.ediel_mailboxes b ON b.id = m.mailbox_id AND b.environment = r.environment
      AND (b.company_id = r.company_id OR b.is_shared_platform_mailbox)
    WHERE r.company_id = $1 AND r.environment = $2 AND b.id = $3
      AND b.is_active AND r.source_message_id = $4 AND s.grid_owner_data_request_id = $5
      AND s.direction = 'inbound' AND s.message_family = 'UTILTS' AND s.message_code = 'E66'
      AND p.parse_status = 'parsed' AND p.message_family = 'UTILTS' AND p.message_code = 'E66'
      AND r.classification = 'first_reception'
      AND r.canonical_payload_hash = r.received_payload_hash
      AND r.transport_source_snapshot->>'mailboxId' = b.id::text
      AND r.canonical_payload_hash = encode(sha256(convert_to(nullif(s.raw_payload,''),'UTF8')),'hex')
      AND r.received_payload_hash = encode(sha256(convert_to(nullif(p.raw_payload,''),'UTF8')),'hex')
      AND (m.company_id IS NULL OR m.company_id = r.company_id)
      AND (m.environment IS NULL OR m.environment = r.environment)
      AND NOT EXISTS (
        SELECT FROM gridex_ediel_inbound_receptions.response_requests h WHERE h.reception_id = r.id
      )
      AND EXISTS (
        SELECT FROM public.inbound_processing_jobs j
        WHERE j.inbound_email_message_id = m.id AND j.mailbox_id = b.id
          AND (j.company_id IS NULL OR j.company_id = r.company_id)
          AND j.status = 'done' AND j.step = 'processed'
      )
  );
$$;

-- Caller must have locked the private command row first. A failure unwinds
-- the CAS savepoint. The enclosing transaction persists only its typed retry.
CREATE FUNCTION gridex_e66_request_retry.attempt(
  cmd gridex_e66_request_retry.commands, resumed boolean
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE result jsonb; body jsonb; scope_held boolean := false;
BEGIN
  -- Match the direct writer's storage-graph-before-source order. Lock both
  -- inputs before recomputing the body; do not wait behind a writer that
  -- already owns either row. Keep these row locks until CAS commit.
  BEGIN
    PERFORM gridex_utilts_binding.lock_storage_graph_v1();
    PERFORM s.id FROM public.ediel_messages s
      WHERE s.id=cmd.source_id AND s.company_id=cmd.company_id AND s.environment=cmd.environment
      FOR SHARE NOWAIT;
    PERFORM p.id
      FROM gridex_ediel_inbound_receptions.receptions r
      JOIN public.inbound_ediel_parse_results p ON p.id=r.parse_result_id
      WHERE r.id=cmd.reception_id AND r.company_id=cmd.company_id AND r.source_message_id=cmd.source_id
      FOR SHARE OF p NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    UPDATE gridex_e66_request_retry.commands
    SET attempts=attempts+1,last_attempt_at=clock_timestamp()
    WHERE source_id=cmd.source_id;
    RETURN jsonb_build_object('status','deferred','sourceId',cmd.source_id);
  END;

  SELECT cmd.response_patch || jsonb_build_object('parsedPayload',s.parsed_payload) INTO body
  FROM public.ediel_messages s WHERE s.id = cmd.source_id AND s.company_id = cmd.company_id;
  IF cmd.reception_id IS DISTINCT FROM gridex_e66_request_retry.bound_reception(
    cmd.company_id,cmd.environment,cmd.mailbox_id,cmd.source_id,cmd.request_id
  ) OR cmd.response_digest IS DISTINCT FROM sha256(convert_to(body::text,'UTF8')) THEN
    IF NOT resumed THEN
      RAISE EXCEPTION 'e66_request_retry_reception_required' USING ERRCODE = '23514';
    END IF;
    result := jsonb_build_object('status','held','reason','reception_changed');
  ELSE
    BEGIN
      result := public.gridex_sync_current_e66_request_v1(
        cmd.company_id,cmd.request_id,cmd.actor_id,cmd.source_id,cmd.meter_ids,body
      );
    EXCEPTION WHEN lock_not_available THEN
      UPDATE gridex_e66_request_retry.commands
      SET attempts = attempts + 1, last_attempt_at = clock_timestamp()
      WHERE source_id = cmd.source_id;
      RETURN jsonb_build_object('status','deferred','sourceId',cmd.source_id);
    WHEN check_violation THEN
      -- A deferred command can outlive the bound underlay's retained scope.
      -- Retain the small disposition, rather than starving later due work.
      IF NOT resumed THEN RAISE; END IF;
      IF SQLERRM IN ('e66_current_request_exact_receipt_required','e66_current_request_complete_receipt_set_required') THEN
        UPDATE gridex_e66_request_retry.commands
        SET attempts=attempts+1,last_attempt_at=clock_timestamp()
        WHERE source_id=cmd.source_id;
        RETURN jsonb_build_object('status','deferred','sourceId',cmd.source_id);
      END IF;
      IF SQLERRM NOT IN ('e66_current_request_underlay_scope_invalid','e66_current_request_receipt_set_changed') THEN RAISE; END IF;
      scope_held := true;
      result := jsonb_build_object('status','held','reason',CASE SQLERRM
        WHEN 'e66_current_request_underlay_scope_invalid' THEN 'underlay_scope_changed'
        ELSE 'receipt_set_changed' END);
    END;
    IF NOT scope_held AND (result->>'status' IN ('received','replaced','cancelled')) IS NOT TRUE THEN
      RAISE EXCEPTION 'e66_request_retry_unknown_outcome';
    END IF;
  END IF;

  UPDATE gridex_e66_request_retry.commands
  SET outcome = result, response_patch = NULL, attempts = attempts + 1,
      last_attempt_at = clock_timestamp()
  WHERE source_id = cmd.source_id;
  IF resumed AND result->>'status'='received' THEN
    INSERT INTO gridex_e66_request_retry.terminal_handoffs(source_id) VALUES(cmd.source_id);
  END IF;
  RETURN result || jsonb_build_object('sourceId',cmd.source_id);
END;
$$;

CREATE FUNCTION public.gridex_submit_e66_request_retry_v1(
  p_company uuid, p_environment text, p_mailbox uuid, p_source uuid, p_request uuid,
  p_actor uuid, p_meter_ids uuid[], p_response_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  cmd gridex_e66_request_retry.commands%ROWTYPE;
  reception uuid;
  digest bytea;
  shape_digest bytea;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'e66_request_retry_scope_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_response_patch) IS DISTINCT FROM 'object'
    OR p_response_patch->>'edielMessageId' IS DISTINCT FROM p_source::text
    OR jsonb_typeof(p_response_patch->'parsedPayload') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'e66_request_retry_command_invalid' USING ERRCODE = '22023';
  END IF;
  reception := gridex_e66_request_retry.bound_reception(p_company,p_environment,p_mailbox,p_source,p_request);
  IF reception IS NULL THEN
    RAISE EXCEPTION 'e66_request_retry_reception_required' USING ERRCODE = '23514';
  END IF;
  digest := sha256(convert_to(p_response_patch::text,'UTF8'));
  shape_digest := sha256(convert_to((p_response_patch - 'parsedPayload')::text,'UTF8'));
  INSERT INTO gridex_e66_request_retry.commands
    (source_id,reception_id,company_id,request_id,actor_id,environment,mailbox_id,meter_ids,response_patch,response_digest,response_shape_digest)
  VALUES (p_source,reception,p_company,p_request,p_actor,p_environment,p_mailbox,p_meter_ids,p_response_patch - 'parsedPayload',digest,shape_digest)
  ON CONFLICT (source_id) DO NOTHING;
  SELECT * INTO STRICT cmd FROM gridex_e66_request_retry.commands WHERE source_id = p_source FOR UPDATE;
  IF (cmd.reception_id,cmd.company_id,cmd.request_id,cmd.actor_id,cmd.environment,cmd.mailbox_id,cmd.meter_ids,cmd.response_shape_digest)
     IS DISTINCT FROM (reception,p_company,p_request,p_actor,p_environment,p_mailbox,p_meter_ids,shape_digest) THEN
    RAISE EXCEPTION 'e66_request_retry_command_conflict' USING ERRCODE = '23514';
  END IF;
  -- A terminal command only returns its receipt. The ordinary status
  -- projection can enrich parsedPayload after that command has committed.
  IF cmd.outcome IS NOT NULL THEN
    RETURN cmd.outcome || jsonb_build_object('sourceId',cmd.source_id);
  END IF;
  IF cmd.response_digest IS DISTINCT FROM digest THEN
    RAISE EXCEPTION 'e66_request_retry_command_conflict' USING ERRCODE = '23514';
  END IF;
  IF cmd.attempts > 0 THEN
    RETURN jsonb_build_object('status','deferred','sourceId',cmd.source_id);
  END IF;
  RETURN gridex_e66_request_retry.attempt(cmd,false);
END;
$$;

CREATE FUNCTION public.gridex_drain_e66_request_retry_v1(
  p_company uuid, p_environment text, p_mailbox uuid, p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE cmd gridex_e66_request_retry.commands%ROWTYPE;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'e66_request_retry_scope_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO cmd FROM gridex_e66_request_retry.commands
  WHERE company_id = p_company AND environment = p_environment AND mailbox_id = p_mailbox
    AND actor_id = p_actor AND outcome IS NULL
  ORDER BY last_attempt_at, source_id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN gridex_e66_request_retry.attempt(cmd,true);
END;
$$;

REVOKE ALL ON FUNCTION public.gridex_submit_e66_request_retry_v1(uuid,text,uuid,uuid,uuid,uuid,uuid[],jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gridex_drain_e66_request_retry_v1(uuid,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_submit_e66_request_retry_v1(uuid,text,uuid,uuid,uuid,uuid,uuid[],jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.gridex_drain_e66_request_retry_v1(uuid,text,uuid,uuid)
  TO service_role;
-- Read-only discovery; a later real worker must bind the protected ACK claim.
CREATE FUNCTION public.gridex_discover_e66_terminal_handoff_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE found_source uuid;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
   OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'e66_terminal_scope_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);
 SELECT c.source_id INTO found_source FROM gridex_e66_request_retry.terminal_handoffs h
 JOIN gridex_e66_request_retry.commands c ON c.source_id=h.source_id
 JOIN public.grid_owner_data_requests r ON r.company_id=c.company_id AND r.id=c.request_id
 WHERE c.company_id=p_company AND c.environment=p_environment AND c.mailbox_id=p_mailbox AND c.actor_id=p_actor
   AND c.outcome->>'status'='received' AND c.response_patch IS NULL
   AND r.status='received' AND r.response_payload->>'edielMessageId'=c.source_id::text
   AND c.reception_id=gridex_e66_request_retry.bound_reception(c.company_id,c.environment,c.mailbox_id,c.source_id,c.request_id)
 ORDER BY h.created_at,c.source_id LIMIT 1;
 RETURN found_source;
END $$;
REVOKE ALL ON FUNCTION public.gridex_discover_e66_terminal_handoff_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_discover_e66_terminal_handoff_v1(uuid,text,uuid,uuid) TO service_role;

ALTER TABLE gridex_e66_request_retry.terminal_handoffs
 ADD COLUMN lease_token uuid,
 ADD COLUMN lease_until timestamptz,
 ADD COLUMN ready_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ADD CONSTRAINT terminal_lease_pair CHECK ((lease_token IS NULL)=(lease_until IS NULL));

CREATE FUNCTION public.gridex_claim_e66_terminal_handoff_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h gridex_e66_request_retry.terminal_handoffs%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
   OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'e66_terminal_scope_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);
 SELECT work.* INTO h FROM gridex_e66_request_retry.terminal_handoffs work
 JOIN gridex_e66_request_retry.commands c ON c.source_id=work.source_id
 JOIN public.grid_owner_data_requests r ON r.company_id=c.company_id AND r.id=c.request_id
 WHERE c.company_id=p_company AND c.environment=p_environment AND c.mailbox_id=p_mailbox AND c.actor_id=p_actor
   AND c.outcome->>'status'='received' AND c.response_patch IS NULL
   AND r.status='received' AND r.response_payload->>'edielMessageId'=c.source_id::text
   AND c.reception_id=gridex_e66_request_retry.bound_reception(c.company_id,c.environment,c.mailbox_id,c.source_id,c.request_id)
   AND work.ready_at<=clock_timestamp() AND (work.lease_until IS NULL OR work.lease_until<=clock_timestamp())
 ORDER BY work.ready_at,c.source_id LIMIT 1 FOR UPDATE OF work SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE gridex_e66_request_retry.terminal_handoffs SET
   lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',ready_at=clock_timestamp()
 WHERE source_id=h.source_id RETURNING * INTO h;
 RETURN jsonb_build_object('sourceId',h.source_id,'leaseToken',h.lease_token,'leaseUntil',h.lease_until);
END $$;
REVOKE ALL ON FUNCTION public.gridex_claim_e66_terminal_handoff_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_claim_e66_terminal_handoff_v1(uuid,text,uuid,uuid) TO service_role;

-- Recheck generation and live exact source/scope at a future effect boundary.
CREATE FUNCTION gridex_e66_request_retry.require_terminal_lease(
 p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid,p_source uuid,p_lease uuid
) RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE h gridex_e66_request_retry.terminal_handoffs%rowtype; c gridex_e66_request_retry.commands%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_lease IS NULL
   OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'e66_terminal_scope_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);
 SELECT * INTO c FROM gridex_e66_request_retry.commands WHERE source_id=p_source AND company_id=p_company
   AND environment=p_environment AND mailbox_id=p_mailbox AND actor_id=p_actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'e66_terminal_lease_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM gridex_e66_request_retry.terminal_handoffs WHERE source_id=p_source FOR UPDATE;
 IF h.lease_token IS DISTINCT FROM p_lease OR h.lease_until<=clock_timestamp()
   OR c.outcome->>'status' IS DISTINCT FROM 'received'
   OR c.reception_id IS DISTINCT FROM gridex_e66_request_retry.bound_reception(p_company,p_environment,p_mailbox,p_source,c.request_id)
   OR NOT EXISTS(SELECT FROM public.grid_owner_data_requests r WHERE r.company_id=p_company
     AND r.id=c.request_id AND r.status='received' AND r.response_payload->>'edielMessageId'=p_source::text)
 THEN RAISE EXCEPTION 'e66_terminal_lease_unavailable' USING ERRCODE='42501'; END IF;
 RETURN c.source_id;
END $$;
REVOKE ALL ON FUNCTION gridex_e66_request_retry.require_terminal_lease(uuid,text,uuid,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Local continuation of the private command prototype.
CREATE INDEX e66_scheduled_pending ON gridex_e66_request_retry.commands
  (environment, actor_id, last_attempt_at, source_id)
  INCLUDE (company_id, mailbox_id)
  WHERE outcome IS NULL;

CREATE FUNCTION public.gridex_find_scheduled_e66_request_retry_v1(
  p_environment text, p_mailboxes uuid[], p_actor uuid, p_company uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE scope jsonb;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR p_actor IS NULL THEN
    RAISE EXCEPTION 'e66_scheduled_request_scope_required' USING ERRCODE = '42501';
  END IF;
  IF p_environment IS NULL OR p_environment NOT IN ('test','production')
    OR coalesce(cardinality(p_mailboxes),0) NOT BETWEEN 1 AND 100
    OR array_position(p_mailboxes,NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'e66_scheduled_request_input_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object('companyId',c.company_id,'mailboxId',c.mailbox_id)
  INTO scope
  FROM gridex_e66_request_retry.commands c
  JOIN public.ediel_mailboxes b
    ON b.id = c.mailbox_id AND b.is_active AND b.environment = c.environment
    AND (b.company_id = c.company_id OR b.is_shared_platform_mailbox)
  WHERE c.outcome IS NULL AND c.environment = p_environment AND c.actor_id = p_actor
    AND c.mailbox_id = ANY(p_mailboxes) AND (p_company IS NULL OR c.company_id = p_company)
    AND public.gridex_actor_has_company_permission(p_actor,c.company_id,'communication.send') IS TRUE
    AND EXISTS (
      SELECT FROM auth.users u WHERE u.id = p_actor AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until <= clock_timestamp())
    )
    AND EXISTS (
      SELECT FROM public.companies o WHERE o.id = c.company_id AND coalesce(o.is_active,true)
        AND coalesce(o.status,'active') NOT IN ('archived','suspended','pending_deletion','deleted')
    )
    AND EXISTS (SELECT FROM public.user_profiles u WHERE u.id = p_actor AND u.user_status = 'active')
    AND EXISTS (
      SELECT FROM public.company_memberships m WHERE m.company_id = c.company_id AND m.user_id = p_actor
        AND m.status = 'active' AND m.is_active AND m.accepted_at IS NOT NULL
    )
    AND gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c.company_id,p_actor,'metering.write') IS TRUE
  ORDER BY c.last_attempt_at,c.source_id LIMIT 1;
  RETURN scope;
END;
$$;

REVOKE ALL ON FUNCTION public.gridex_find_scheduled_e66_request_retry_v1(text,uuid[],uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_find_scheduled_e66_request_retry_v1(text,uuid[],uuid,uuid)
  TO service_role;

CREATE FUNCTION public.gridex_submit_polled_e66_request_retry_v1(
  p_company uuid, p_environment text, p_mailboxes uuid[], p_source uuid, p_request uuid,
  p_actor uuid, p_meter_ids uuid[], p_response_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_mailbox uuid;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'metering.write') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'e66_request_retry_scope_required' USING ERRCODE = '42501';
  END IF;

  SELECT b.id INTO v_mailbox
  FROM gridex_ediel_inbound_receptions.receptions r
  JOIN public.inbound_email_messages m ON m.id = r.inbound_email_message_id
  JOIN public.ediel_mailboxes b ON b.id = m.mailbox_id
  WHERE r.source_message_id = p_source
    AND r.company_id = p_company
    AND r.environment = p_environment
    AND r.classification = 'first_reception'
    AND b.id = ANY(p_mailboxes)
    AND b.environment = r.environment
    AND b.is_active
    AND (b.company_id = r.company_id OR b.is_shared_platform_mailbox);

  IF v_mailbox IS NULL THEN
    RAISE EXCEPTION 'e66_request_retry_poll_scope_mismatch' USING ERRCODE = '23514';
  END IF;

  RETURN public.gridex_submit_e66_request_retry_v1(
    p_company,p_environment,v_mailbox,p_source,p_request,p_actor,p_meter_ids,p_response_patch
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gridex_submit_polled_e66_request_retry_v1(uuid,text,uuid[],uuid,uuid,uuid,uuid[],jsonb)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_submit_polled_e66_request_retry_v1(uuid,text,uuid[],uuid,uuid,uuid,uuid[],jsonb)
 TO service_role;

END
$gridex_migration$;
RESET statement_timeout;
RESET lock_timeout;
