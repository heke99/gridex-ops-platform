DO $migration$
DECLARE
  migration_role CONSTANT name := current_user;
BEGIN
  CREATE SCHEMA gridex_facility_diagnostics;
  REVOKE ALL ON SCHEMA gridex_facility_diagnostics FROM PUBLIC, anon, authenticated, service_role;

  CREATE TABLE gridex_facility_diagnostics.request_diagnostics (
    request_id uuid PRIMARY KEY REFERENCES public.grid_owner_information_requests(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    company_id uuid NOT NULL,
    customer_id uuid,
    dispatch_error_message text,
    dispatch_error_code text,
    last_error_message text,
    last_error_code text,
    dispatch_payload jsonb NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE TABLE gridex_facility_diagnostics.timeline_diagnostics (
    event_id uuid PRIMARY KEY REFERENCES public.customer_operation_events(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    company_id uuid NOT NULL,
    customer_id uuid,
    payload jsonb NOT NULL
  );

  CREATE INDEX request_diagnostic_customer_idx
    ON gridex_facility_diagnostics.request_diagnostics(company_id,customer_id);
  CREATE INDEX timeline_diagnostic_customer_idx
    ON gridex_facility_diagnostics.timeline_diagnostics(company_id,customer_id);

  ALTER TABLE gridex_facility_diagnostics.request_diagnostics ENABLE ROW LEVEL SECURITY;
  ALTER TABLE gridex_facility_diagnostics.timeline_diagnostics ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE gridex_facility_diagnostics.request_diagnostics,
    gridex_facility_diagnostics.timeline_diagnostics FROM PUBLIC, anon, authenticated, service_role;

  CREATE FUNCTION gridex_facility_diagnostics.scope_lock_key(p_company_id uuid,p_customer_id uuid)
  RETURNS bigint
  LANGUAGE sql IMMUTABLE STRICT
  SET search_path = pg_catalog
  AS $lock$
    SELECT hashtextextended('gridex-facility-diagnostics:'||p_company_id::text||':'||p_customer_id::text,0)
  $lock$;
  REVOKE ALL ON FUNCTION gridex_facility_diagnostics.scope_lock_key(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

  CREATE FUNCTION gridex_facility_diagnostics.can_keep(p_company_id uuid,p_customer_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $scope$
  BEGIN
    IF p_customer_id IS NULL THEN RETURN true; END IF;
    IF NOT pg_try_advisory_xact_lock(gridex_facility_diagnostics.scope_lock_key(p_company_id,p_customer_id)) THEN
      RAISE EXCEPTION 'facility_diagnostics_customer_busy' USING ERRCODE='55P03';
    END IF;
    RETURN NOT gridex_correction_process.customer_retention_tombstoned_v1(p_company_id,p_customer_id);
  END;
  $scope$;
  REVOKE ALL ON FUNCTION gridex_facility_diagnostics.can_keep(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

  CREATE FUNCTION gridex_facility_diagnostics.capture_request()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $capture$
  DECLARE
    prior gridex_facility_diagnostics.request_diagnostics%ROWTYPE;
    raw_dispatch text := NEW.dispatch_error_message;
    raw_last text;
    raw_payload jsonb;
    duplicate_last boolean;
  BEGIN
    SELECT * INTO prior FROM gridex_facility_diagnostics.request_diagnostics
    WHERE request_id = NEW.id AND company_id = NEW.company_id;

    IF jsonb_typeof(NEW.metadata->'facility_lookup_edifact_dispatch') = 'object' THEN
      SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO raw_payload
      FROM jsonb_each(NEW.metadata->'facility_lookup_edifact_dispatch')
      WHERE key IN ('message','details');
    END IF;
    raw_payload := coalesce(raw_payload,'{}'::jsonb);

    duplicate_last := NEW.last_error_message IS NOT NULL
      AND (NEW.metadata#>>'{counterparty_reply,requires_review}') IS DISTINCT FROM 'true'
      AND (NEW.last_error_message = raw_dispatch OR NEW.last_error_message = prior.dispatch_error_message
        OR NEW.last_error_message = (raw_payload->>'message') OR NEW.last_error_message = (prior.dispatch_payload->>'message'));
    IF duplicate_last THEN raw_last := NEW.last_error_message; END IF;

    IF raw_dispatch IS NOT NULL OR raw_last IS NOT NULL OR raw_payload <> '{}'::jsonb THEN
      IF current_setting('role', true) IN ('anon','authenticated')
        AND NOT public.gridex_user_is_platform_admin() THEN
        RAISE EXCEPTION 'facility_request_diagnostics_writer_required' USING ERRCODE='42501';
      END IF;
      IF gridex_facility_diagnostics.can_keep(NEW.company_id,NEW.customer_id) THEN
        INSERT INTO gridex_facility_diagnostics.request_diagnostics
          (request_id,company_id,customer_id,dispatch_error_message,dispatch_error_code,last_error_message,last_error_code,dispatch_payload)
        VALUES(NEW.id,NEW.company_id,NEW.customer_id,raw_dispatch,NEW.dispatch_error_code,raw_last,NEW.last_error_code,raw_payload)
        ON CONFLICT (request_id) DO UPDATE SET
          dispatch_error_message = coalesce(EXCLUDED.dispatch_error_message,request_diagnostics.dispatch_error_message),
          dispatch_error_code = CASE WHEN EXCLUDED.dispatch_error_message IS NOT NULL THEN EXCLUDED.dispatch_error_code ELSE request_diagnostics.dispatch_error_code END,
          last_error_message = coalesce(EXCLUDED.last_error_message,request_diagnostics.last_error_message),
          last_error_code = CASE WHEN EXCLUDED.last_error_message IS NOT NULL THEN EXCLUDED.last_error_code ELSE request_diagnostics.last_error_code END,
          dispatch_payload = request_diagnostics.dispatch_payload||EXCLUDED.dispatch_payload
        WHERE request_diagnostics.company_id=EXCLUDED.company_id
          AND request_diagnostics.customer_id IS NOT DISTINCT FROM EXCLUDED.customer_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'facility_request_diagnostics_scope_changed' USING ERRCODE='23514';
        END IF;
      END IF;
      NEW.dispatch_error_message := NULL;
      IF duplicate_last THEN NEW.last_error_message := NULL; END IF;
      IF raw_payload <> '{}'::jsonb THEN
        NEW.metadata := NEW.metadata #- '{facility_lookup_edifact_dispatch,message}'
                                     #- '{facility_lookup_edifact_dispatch,details}';
      END IF;
    END IF;

    RETURN NEW;
  END;
  $capture$;
  REVOKE ALL ON FUNCTION gridex_facility_diagnostics.capture_request() FROM PUBLIC, anon, authenticated, service_role;

  CREATE FUNCTION gridex_facility_diagnostics.capture_timeline()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $capture$
  DECLARE raw_payload jsonb;
  BEGIN
    SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO raw_payload
    FROM jsonb_each(CASE WHEN jsonb_typeof(NEW.payload)='object' THEN NEW.payload ELSE '{}'::jsonb END)
    WHERE key IN ('technicalMessage','details');
    IF raw_payload <> '{}'::jsonb THEN
      IF current_setting('role', true) IN ('anon','authenticated')
        AND NOT public.gridex_user_is_platform_admin() THEN
        RAISE EXCEPTION 'facility_timeline_diagnostics_writer_required' USING ERRCODE='42501';
      END IF;
      IF gridex_facility_diagnostics.can_keep(NEW.company_id,NEW.customer_id) THEN
        INSERT INTO gridex_facility_diagnostics.timeline_diagnostics(event_id,company_id,customer_id,payload)
        VALUES(NEW.id,NEW.company_id,NEW.customer_id,raw_payload)
        ON CONFLICT (event_id) DO UPDATE SET payload=timeline_diagnostics.payload||EXCLUDED.payload
        WHERE timeline_diagnostics.company_id=EXCLUDED.company_id
          AND timeline_diagnostics.customer_id IS NOT DISTINCT FROM EXCLUDED.customer_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'facility_timeline_diagnostics_scope_changed' USING ERRCODE='23514';
        END IF;
      END IF;
    END IF;
    IF jsonb_typeof(NEW.payload)='object' THEN
      NEW.payload := NEW.payload - ARRAY['technicalMessage','details'];
    END IF;
    RETURN NEW;
  END;
  $capture$;
  REVOKE ALL ON FUNCTION gridex_facility_diagnostics.capture_timeline() FROM PUBLIC, anon, authenticated, service_role;

  CREATE TRIGGER zzy_facility_request_diagnostic_capture
  BEFORE INSERT OR UPDATE OF dispatch_error_message,last_error_message,metadata
  ON public.grid_owner_information_requests
  FOR EACH ROW EXECUTE FUNCTION gridex_facility_diagnostics.capture_request();

  CREATE TRIGGER zzy_facility_timeline_diagnostic_capture
  BEFORE INSERT OR UPDATE OF payload ON public.customer_operation_events
  FOR EACH ROW WHEN (
    NEW.source='facility_lookup_edifact_dispatch' AND NEW.event_code='facility_lookup.edifact_blocked')
  EXECUTE FUNCTION gridex_facility_diagnostics.capture_timeline();

  CREATE FUNCTION gridex_facility_diagnostics.purge_customer()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $purge$
  BEGIN
    PERFORM pg_advisory_xact_lock(gridex_facility_diagnostics.scope_lock_key(NEW.company_id,NEW.customer_id));
    DELETE FROM gridex_facility_diagnostics.request_diagnostics
      WHERE company_id=NEW.company_id AND customer_id=NEW.customer_id;
    DELETE FROM gridex_facility_diagnostics.timeline_diagnostics
      WHERE company_id=NEW.company_id AND customer_id=NEW.customer_id;
    RETURN NEW;
  END;
  $purge$;
  REVOKE ALL ON FUNCTION gridex_facility_diagnostics.purge_customer() FROM PUBLIC,anon,authenticated,service_role;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class tombstones
    JOIN pg_catalog.pg_roles retention_owner ON retention_owner.oid = tombstones.relowner
    WHERE tombstones.oid = 'gridex_ediel_retention.customer_tombstones'::regclass
      AND retention_owner.rolname = 'gridex_ediel_retention_owner'
      AND NOT retention_owner.rolcanlogin
      AND pg_catalog.pg_has_role(migration_role, retention_owner.oid, 'SET')
  ) THEN
    RAISE EXCEPTION 'facility_diagnostics_retention_owner_required' USING ERRCODE='42501';
  END IF;

  -- The established retention owner installs the hook on its own table.
  -- The helper runs as the diagnostics owner after these installation grants expire.
  GRANT USAGE ON SCHEMA gridex_facility_diagnostics TO gridex_ediel_retention_owner;
  GRANT EXECUTE ON FUNCTION gridex_facility_diagnostics.purge_customer() TO gridex_ediel_retention_owner;
  SET LOCAL ROLE gridex_ediel_retention_owner;

  CREATE TRIGGER facility_diagnostic_retention_purge
  AFTER INSERT ON gridex_ediel_retention.customer_tombstones
  FOR EACH ROW EXECUTE FUNCTION gridex_facility_diagnostics.purge_customer();

  EXECUTE pg_catalog.format('SET LOCAL ROLE %I', migration_role);
  REVOKE EXECUTE ON FUNCTION gridex_facility_diagnostics.purge_customer() FROM gridex_ediel_retention_owner;
  REVOKE USAGE ON SCHEMA gridex_facility_diagnostics FROM gridex_ediel_retention_owner;

  UPDATE public.grid_owner_information_requests r
  SET dispatch_error_message=r.dispatch_error_message
  WHERE r.dispatch_error_message IS NOT NULL
    OR (r.metadata->'facility_lookup_edifact_dispatch') ?| ARRAY['message','details'];

  UPDATE public.customer_operation_events e
  SET payload=e.payload
  WHERE e.source='facility_lookup_edifact_dispatch' AND e.event_code='facility_lookup.edifact_blocked'
    AND e.payload ?| ARRAY['technicalMessage','details'];

  ALTER TABLE public.grid_owner_information_requests
  ADD CONSTRAINT facility_request_diagnostic_public_projection CHECK (
    dispatch_error_message IS NULL AND NOT coalesce(
      (metadata->'facility_lookup_edifact_dispatch') ?| ARRAY['message','details'],false));

  ALTER TABLE public.customer_operation_events
  ADD CONSTRAINT facility_timeline_diagnostic_public_projection CHECK (
    (source,event_code) IS DISTINCT FROM ('facility_lookup_edifact_dispatch','facility_lookup.edifact_blocked')
    OR NOT (payload ?| ARRAY['technicalMessage','details']));

  CREATE FUNCTION public.gridex_read_facility_request_diagnostics_v1(p_request_ids uuid[])
  RETURNS TABLE(request_id uuid,dispatch_error_message text,last_error_message text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $reader$
  BEGIN
    IF NOT public.gridex_user_is_platform_admin() THEN
      RAISE EXCEPTION 'facility_request_diagnostics_platform_required' USING ERRCODE='42501';
    END IF;
    IF coalesce(cardinality(p_request_ids),0)>100 THEN
      RAISE EXCEPTION 'facility_request_diagnostics_invalid_limit' USING ERRCODE='22023';
    END IF;
    RETURN QUERY
    SELECT d.request_id,
      CASE WHEN r.dispatch_error_code IS NOT DISTINCT FROM d.dispatch_error_code
        AND (r.dispatch_error_code IS NOT NULL OR r.dispatch_status='failed') THEN d.dispatch_error_message END,
      CASE WHEN r.last_error_code IS NOT NULL AND r.last_error_code IS NOT DISTINCT FROM d.last_error_code THEN d.last_error_message END
    FROM gridex_facility_diagnostics.request_diagnostics d
    JOIN public.grid_owner_information_requests r ON r.id=d.request_id AND r.company_id=d.company_id
    WHERE d.request_id=ANY(p_request_ids) AND r.customer_id IS NOT DISTINCT FROM d.customer_id
      AND NOT gridex_correction_process.customer_retention_tombstoned_v1(r.company_id,r.customer_id);
  END;
  $reader$;
  REVOKE ALL ON FUNCTION public.gridex_read_facility_request_diagnostics_v1(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_read_facility_request_diagnostics_v1(uuid[]) TO authenticated;
  CREATE FUNCTION public.gridex_read_facility_diagnostics_support_v1(
    p_company_id uuid,p_customer_id uuid,p_request_ids uuid[],p_event_ids uuid[])
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $support$
  BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' OR current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'facility_diagnostics_support_service_required' USING ERRCODE='42501';
    END IF;
    IF p_company_id IS NULL OR p_customer_id IS NULL
      OR coalesce(cardinality(p_request_ids),0)>100 OR coalesce(cardinality(p_event_ids),0)>100 THEN
      RAISE EXCEPTION 'facility_diagnostics_support_scope_invalid' USING ERRCODE='22023';
    END IF;
    IF gridex_correction_process.customer_retention_tombstoned_v1(p_company_id,p_customer_id) THEN
      RETURN '{"requests":[],"events":[]}'::jsonb;
    END IF;
    RETURN jsonb_build_object(
      'requests',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id',d.request_id,
          'dispatch_error_message',CASE WHEN r.dispatch_error_code IS NOT DISTINCT FROM d.dispatch_error_code THEN d.dispatch_error_message END,
          'last_error_message',CASE WHEN r.last_error_code IS NOT DISTINCT FROM d.last_error_code THEN d.last_error_message END,
          'dispatch_payload',d.dispatch_payload) ORDER BY d.request_id)
        FROM gridex_facility_diagnostics.request_diagnostics d
        JOIN public.grid_owner_information_requests r ON r.id=d.request_id AND r.company_id=d.company_id AND r.customer_id=d.customer_id
        WHERE d.company_id=p_company_id AND d.customer_id=p_customer_id AND d.request_id=ANY(p_request_ids)),
      '[]'::jsonb),
      'events',coalesce((
        SELECT jsonb_agg(jsonb_build_object('id',d.event_id,'payload',d.payload) ORDER BY d.event_id)
        FROM gridex_facility_diagnostics.timeline_diagnostics d
        JOIN public.customer_operation_events e ON e.id=d.event_id AND e.company_id=d.company_id AND e.customer_id=d.customer_id
        WHERE d.company_id=p_company_id AND d.customer_id=p_customer_id AND d.event_id=ANY(p_event_ids)),
      '[]'::jsonb));
  END;
  $support$;
  REVOKE ALL ON FUNCTION public.gridex_read_facility_diagnostics_support_v1(uuid,uuid,uuid[],uuid[])
    FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_read_facility_diagnostics_support_v1(uuid,uuid,uuid[],uuid[]) TO service_role;
END
$migration$;
