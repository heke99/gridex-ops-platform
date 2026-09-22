-- CLI-created forward correction. Existing migration bytes are unchanged.
-- Keep evidence serialization and typed owner comparisons independent
-- of the caller session. Explicit market time remains Etc/GMT-1.
BEGIN;
ALTER FUNCTION gridex_received_sources.owner_rows_match(text,jsonb,uuid,text,uuid) SET timezone = 'UTC';
ALTER FUNCTION gridex_received_sources.object_owner_proof_consistent(jsonb,jsonb,timestamptz) SET timezone = 'UTC';
ALTER FUNCTION gridex_received_sources.append_object_assessment(uuid,text,uuid,text,uuid,text) SET timezone = 'UTC';
COMMIT;
