-- FINDINGS F68: 20261020120300 added the expression index
-- ediel_messages_inbound_envelope_uci_idx on
-- gridex_ediel_technical_ack.envelope(raw_payload). Postgres evaluates an
-- index expression with the privileges of the role that writes the row, but
-- envelope() and the tokenizer it calls were executable only by postgres, so
-- every inbound ediel_messages insert by the application failed with
-- "permission denied for function envelope": no inbound Ediel file could be
-- stored. Both functions are IMMUTABLE pure parsers of their text argument;
-- only EXECUTE on these two exact functions is granted (no schema usage).
BEGIN;
GRANT EXECUTE ON FUNCTION gridex_ediel_technical_ack.envelope(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION gridex_utilts_binding.wire_tokens_v1(text) TO service_role, authenticated;
COMMIT;
