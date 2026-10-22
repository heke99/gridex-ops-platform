-- FINDINGS F78 (follow-up to F68): the expression index
-- ediel_messages_inbound_envelope_uci_idx evaluates
-- gridex_ediel_technical_ack.envelope(raw_payload) with the privileges of the
-- writing role. envelope() is plpgsql, so its call to
-- gridex_utilts_binding.wire_tokens_v1 is resolved at run time and needs
-- USAGE on that schema. service_role and authenticated had EXECUTE (F68) but
-- no schema USAGE, so every inbound ediel_messages insert or update that
-- reached the UNB/UNH branch failed with "permission denied for schema
-- gridex_utilts_binding" (e.g. a UTILTS correction stayed at received).
--
-- USAGE only allows name resolution. The schema's tables carry no grants to
-- these roles and wire_tokens_v1 (a pure parser) is the only function they may
-- execute; future functions in the schema no longer default to PUBLIC EXECUTE.
BEGIN;
GRANT USAGE ON SCHEMA gridex_utilts_binding TO service_role, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA gridex_utilts_binding REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
