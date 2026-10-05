-- Exact function definitions from genuine0c capture37237701675/schema SHA
-- ee1daf18f58b5535f1d14bc9cd8a25eb6325ebf7b186d3be76e5a14d4bc8a41e.
-- Upstream public row/private receipt/tombstone inputs in the harness are finite.

CREATE FUNCTION gridex_received_sources.switch_original_message_immutable_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
BEGIN IF TG_OP='UPDATE' AND OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS NULL AND public.ediel_is_qualified_retention_transition_v1(OLD,NEW) THEN RETURN NEW;END IF;
 IF EXISTS(SELECT FROM gridex_received_sources.switch_originals o WHERE o.message_id=OLD.id) AND
 ROW(NEW.id,NEW.company_id,NEW.environment,NEW.direction,NEW.message_standard,NEW.message_family,NEW.message_code,NEW.intent_id,NEW.outbound_request_id,NEW.source_operation_id,NEW.switch_request_id,NEW.customer_id,NEW.site_id,NEW.metering_point_id,NEW.raw_payload,NEW.immutable_payload_hash,NEW.immutable_rendered_at,NEW.original_message_id)
 IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.environment,OLD.direction,OLD.message_standard,OLD.message_family,OLD.message_code,OLD.intent_id,OLD.outbound_request_id,OLD.source_operation_id,OLD.switch_request_id,OLD.customer_id,OLD.site_id,OLD.metering_point_id,OLD.raw_payload,OLD.immutable_payload_hash,OLD.immutable_rendered_at,OLD.original_message_id)
 THEN RAISE EXCEPTION 'switch_original_bound_message_immutable';END IF;RETURN NEW;
END $$;

CREATE FUNCTION gridex_ediel_retention.public_content_v1(m public.ediel_messages) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$ SELECT jsonb_build_object('raw',m.raw_payload,'parsed',m.parsed_payload,'validation',m.validation_report,'metadata',m.metadata) $$;

CREATE FUNCTION public.ediel_is_qualified_retention_transition_v1(oldrow public.ediel_messages, newrow public.ediel_messages) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
 SELECT oldrow.raw_payload IS NOT NULL AND newrow.raw_payload IS NULL AND newrow.parsed_payload='{}'::jsonb AND newrow.validation_report='{}'::jsonb AND coalesce(newrow.metadata,'{}')='{}'::jsonb
 AND (to_jsonb(oldrow)-ARRAY['raw_payload','parsed_payload','validation_report','metadata','updated_at']) IS NOT DISTINCT FROM (to_jsonb(newrow)-ARRAY['raw_payload','parsed_payload','validation_report','metadata','updated_at'])
 AND EXISTS(SELECT FROM gridex_ediel_retention.blob_tombstones t WHERE t.retention_class='received_ediel_message_content' AND t.target_id=oldrow.id AND t.company_id=oldrow.company_id AND t.source_hash=encode(sha256(convert_to(oldrow.raw_payload,'UTF8')),'hex') AND t.public_content_hash=encode(sha256(convert_to(gridex_ediel_retention.public_content_v1(oldrow)::text,'UTF8')),'hex'))
$$;
