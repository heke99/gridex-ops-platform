-- masterplan: P-08 (on valid receipt update the right production relation)
-- Owner decision 2026-10-04: a valid receipt is the grid owner's positive
-- APERAK on our own bound Z09D. It confirms exactly the production-contract
-- event that produced the message. A negative APERAK, a CONTRL alone, an
-- unbound message or a revoked event confirms nothing. No existing period,
-- origin or event row is changed.
BEGIN;
CREATE TABLE gridex_received_sources.production_contract_confirmations (
 event_id uuid PRIMARY KEY REFERENCES gridex_received_sources.production_contract_events(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN ('test','production')),
 message_id uuid NOT NULL UNIQUE REFERENCES public.ediel_messages(id),
 confirmed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE gridex_received_sources.production_contract_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.production_contract_confirmations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER production_contract_confirmations_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.production_contract_confirmations
 FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER production_contract_confirmations_no_truncate BEFORE TRUNCATE ON gridex_received_sources.production_contract_confirmations
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();

CREATE FUNCTION gridex_received_sources.confirm_production_contract_on_ack_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_received_sources.production_contract_origins%rowtype;e gridex_received_sources.production_contract_events%rowtype;
BEGIN
 IF NEW.aperak_status IS DISTINCT FROM 'accepted' OR OLD.aperak_status IS NOT DISTINCT FROM NEW.aperak_status
 OR NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_family IS DISTINCT FROM 'PRODAT' OR NEW.message_code IS DISTINCT FROM 'Z09' THEN RETURN NEW;END IF;
 SELECT * INTO o FROM gridex_received_sources.production_contract_origins WHERE message_id=NEW.id;
 IF NOT FOUND THEN RETURN NEW;END IF;
 SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=o.event_id FOR SHARE;
 IF e.company_id IS DISTINCT FROM NEW.company_id OR e.environment IS DISTINCT FROM NEW.environment
 OR EXISTS(SELECT FROM gridex_received_sources.production_contract_revocations r WHERE r.event_id=e.id) THEN RETURN NEW;END IF;
 INSERT INTO gridex_received_sources.production_contract_confirmations(event_id,company_id,environment,message_id)
  VALUES(e.id,e.company_id,e.environment,NEW.id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.confirm_production_contract_on_ack_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER confirm_production_contract_on_ack AFTER UPDATE OF aperak_status ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.confirm_production_contract_on_ack_v1();
COMMIT;
