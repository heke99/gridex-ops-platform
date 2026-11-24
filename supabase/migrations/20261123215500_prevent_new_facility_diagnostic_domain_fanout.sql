DO $migration$
BEGIN
  CREATE FUNCTION gridex_facility_diagnostics.sanitize_new_domain_event()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $sanitize$
  DECLARE
    request_id uuid;
    source_request public.grid_owner_information_requests%ROWTYPE;
  BEGIN
    IF NOT (NEW.payload ?| ARRAY['technicalMessage','details']) THEN RETURN NEW; END IF;
    IF jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object'
      OR coalesce(NEW.payload->>'request_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'facility_diagnostics_domain_source_invalid' USING ERRCODE='23514';
    END IF;
    request_id := (NEW.payload->>'request_id')::uuid;
    SELECT r.* INTO source_request
    FROM public.grid_owner_information_requests r
    WHERE r.id=request_id AND r.company_id=NEW.company_id AND r.customer_id=NEW.subject_customer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'facility_diagnostics_domain_source_unavailable' USING ERRCODE='23514';
    END IF;
    -- Older workers already persist the same diagnosis through the scoped
    -- request owner before emitting the operational event. It is safe to drop
    -- the duplicate, but never trust a caller-supplied source.
    IF NOT gridex_correction_process.customer_retention_tombstoned_v1(NEW.company_id,NEW.subject_customer_id)
      AND NOT EXISTS (
        SELECT FROM gridex_facility_diagnostics.request_diagnostics d
        WHERE d.request_id=source_request.id AND d.company_id=source_request.company_id
          AND d.customer_id=source_request.customer_id
          AND (NOT (NEW.payload ? 'technicalMessage')
            OR NEW.payload->>'technicalMessage' IS NOT DISTINCT FROM d.dispatch_error_message
            OR NEW.payload->>'technicalMessage' IS NOT DISTINCT FROM d.dispatch_payload->>'message')
          AND (NOT (NEW.payload ? 'details') OR NEW.payload->'details' IS NOT DISTINCT FROM d.dispatch_payload->'details')
      ) THEN
      RAISE EXCEPTION 'facility_diagnostics_domain_duplicate_unproven' USING ERRCODE='23514';
    END IF;
    NEW.payload := NEW.payload - ARRAY['technicalMessage','details'];
    RETURN NEW;
  END;
  $sanitize$;
  REVOKE ALL ON FUNCTION gridex_facility_diagnostics.sanitize_new_domain_event() FROM PUBLIC,anon,authenticated,service_role;

  -- Existing domain-event bytes may still be bound by a submitted retention
  -- decision. This transition intentionally touches future inserts only.
  CREATE TRIGGER zzy_facility_domain_diagnostic_insert
  BEFORE INSERT ON public.domain_events FOR EACH ROW
  WHEN (NEW.source='facility_lookup_edifact_dispatch' AND NEW.event_type='facility_lookup.edifact_blocked')
  EXECUTE FUNCTION gridex_facility_diagnostics.sanitize_new_domain_event();
END
$migration$;
