-- Actual CLI forward. Received ERR inherits the same protected original
-- witness as other prescribed responses; no current named-row reselection.
BEGIN;
DO $owner$ DECLARE definition text;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_received_sources.append_validation(uuid,text,uuid,text,text)'::regprocedure);
 needle:='IF actual_message.message_family IN (''APERAK'',''CONTRL'') THEN';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'received_err_original_witness_owner_contract_mismatch';END IF;
 EXECUTE replace(definition,needle,'IF actual_message.message_family IN (''APERAK'',''CONTRL'',''UTILTS_ERR'') THEN');
END $owner$;
COMMIT;
