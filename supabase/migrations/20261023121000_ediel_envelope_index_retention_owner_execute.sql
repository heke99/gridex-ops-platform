-- F99 variant of F68: gridex_ediel_retention_owner writes public.ediel_messages but could not
-- evaluate the inbound UCI expression index (ediel_messages_inbound_envelope_uci_idx), so its
-- non-HOT UPDATEs of inbound rows failed with 42501. Only EXECUTE on the two exact IMMUTABLE pure
-- parsers already granted to service_role/authenticated in 20261020280000 (no schema usage).
BEGIN;
GRANT EXECUTE ON FUNCTION gridex_ediel_technical_ack.envelope(text) TO gridex_ediel_retention_owner;
GRANT EXECUTE ON FUNCTION gridex_utilts_binding.wire_tokens_v1(text) TO gridex_ediel_retention_owner;
COMMIT;
