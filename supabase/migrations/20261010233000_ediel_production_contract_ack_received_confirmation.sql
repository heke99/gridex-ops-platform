-- masterplan: P-08, AT-P-08 (on valid receipt update the right production relation)
-- Forward repair of 20261005020000 (that file is not edited). The installed ACK
-- authority never writes aperak_status='accepted': it writes 'received' plus
-- immutable gridex_ack_authority.scope_outcomes, and sets status='acknowledged'
-- only when the final acknowledgement is reached, every APERAK scope is
-- positive and no scope outcome is negative. A valid receipt is therefore that
-- acknowledged transition of our own bound outbound PRODAT Z09 with at least
-- one positive APERAK scope outcome. It confirms exactly the producing event of
-- the same tenant and environment, never a revoked one. CONTRL alone, a
-- negative APERAK, an unbound message or a revoked event confirms nothing.
-- Existing periods, origins, events and confirmations are not changed.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_received_sources.confirm_production_contract_on_ack_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_received_sources.production_contract_origins%rowtype;e gridex_received_sources.production_contract_events%rowtype;
BEGIN
 IF NEW.status IS DISTINCT FROM 'acknowledged' OR OLD.status IS NOT DISTINCT FROM 'acknowledged'
 OR NEW.aperak_status IS DISTINCT FROM 'received'
 OR NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_family IS DISTINCT FROM 'PRODAT' OR NEW.message_code IS DISTINCT FROM 'Z09' THEN RETURN NEW;END IF;
 IF NOT EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=NEW.id AND x.ack_family='APERAK' AND x.outcome='positive')
 OR EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=NEW.id AND x.outcome='negative') THEN RETURN NEW;END IF;
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
COMMENT ON FUNCTION gridex_received_sources.confirm_production_contract_on_ack_v1() IS
 'P-08: confirms the producing production-contract event once its own bound outbound PRODAT Z09 reaches acknowledged with a positive APERAK scope outcome and no negative scope outcome.';
DROP TRIGGER confirm_production_contract_on_ack ON public.ediel_messages;
CREATE TRIGGER confirm_production_contract_on_ack AFTER UPDATE OF status,aperak_status ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.confirm_production_contract_on_ack_v1();
COMMIT;
