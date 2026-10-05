-- Preserve the linked switch tenant before the prospective E035 fact trigger runs.
BEGIN;

-- The earlier conditional case migration ran before outbound_requests existed
-- on clean installs. The actual case stop writer requires this column.
ALTER TABLE public.outbound_requests ADD COLUMN IF NOT EXISTS customer_case_id uuid;
CREATE INDEX IF NOT EXISTS outbound_requests_customer_case_idx
  ON public.outbound_requests(company_id, customer_case_id);

CREATE FUNCTION gridex_correction_process.bind_switch_event_owner_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner_id uuid;
BEGIN
 IF NEW.switch_request_id IS NULL THEN RETURN NEW; END IF;
 SELECT r.company_id INTO owner_id FROM public.supplier_switch_requests r
  WHERE r.id=NEW.switch_request_id;
 IF owner_id IS NULL THEN
  RAISE EXCEPTION 'switch_event_request_owner_missing' USING ERRCODE='23514';
 END IF;
 IF NEW.company_id IS NOT NULL AND NEW.company_id<>owner_id THEN
  RAISE EXCEPTION 'switch_event_company_mismatch' USING ERRCODE='23514';
 END IF;
 NEW.company_id:=owner_id;
 RETURN NEW;
END $$;

CREATE TRIGGER e035_bind_switch_event_owner BEFORE INSERT OR UPDATE
 ON public.supplier_switch_events FOR EACH ROW
 EXECUTE FUNCTION gridex_correction_process.bind_switch_event_owner_v1();
ALTER TABLE public.supplier_switch_events ENABLE ALWAYS TRIGGER e035_bind_switch_event_owner;
REVOKE ALL ON FUNCTION gridex_correction_process.bind_switch_event_owner_v1()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
