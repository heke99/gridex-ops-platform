CREATE FUNCTION gridex_ediel_inbound_receptions.guard_original_v1() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$BEGIN IF TG_OP='UPDATE' AND OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS NULL AND public.ediel_is_qualified_retention_transition_v1(OLD,NEW) THEN RETURN NEW;END IF;
 IF EXISTS(SELECT FROM gridex_ediel_inbound_receptions.receptions r WHERE r.source_message_id=OLD.id)
  AND (TG_OP='DELETE' OR
   (NEW.company_id,NEW.environment,NEW.direction,NEW.message_standard,NEW.message_family,NEW.message_code,NEW.raw_payload,NEW.sender_ediel_id,NEW.receiver_ediel_id,NEW.application_reference,NEW.interchange_reference,NEW.message_received_at,NEW.mailbox_message_id)
   IS DISTINCT FROM
   (OLD.company_id,OLD.environment,OLD.direction,OLD.message_standard,OLD.message_family,OLD.message_code,OLD.raw_payload,OLD.sender_ediel_id,OLD.receiver_ediel_id,OLD.application_reference,OLD.interchange_reference,OLD.message_received_at,OLD.mailbox_message_id))
 THEN RAISE EXCEPTION 'ediel_registered_reception_original_immutable';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
