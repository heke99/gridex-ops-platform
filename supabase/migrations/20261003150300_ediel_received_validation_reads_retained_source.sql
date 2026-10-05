-- The accepted-syntax guide checks added in 20261001044856 (message reference
-- profile) and 20261001053253 (unused UNH elements) re-read the original bytes
-- from public.ediel_messages with STRICT. The source ledger deliberately
-- retains received originals after the operational message row is deleted or
-- re-attributed, so validating that retained history failed with
-- no_data_found. Both checks now read the exact tenant-, environment- and
-- hash-bound bytes from gridex_received_sources.sources, which the protected
-- delegate has already verified. Purged bytes still fail closed.
BEGIN;
DO $fix$DECLARE f record;n integer;
 needle CONSTANT text:=$n$SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_source_message_id AND (company_id=p_company_id OR company_id IS NULL) AND environment=p_environment AND direction='inbound'
   AND encode(sha256(convert_to(raw_payload,'UTF8')),'hex')=p_source_payload_hash FOR SHARE;$n$;
 replacement CONSTANT text:=$r$SELECT s.raw_payload INTO STRICT m.raw_payload FROM gridex_received_sources.sources s WHERE s.source_message_id=p_source_message_id AND s.company_id=p_company_id AND s.environment=p_environment
   AND s.raw_payload IS NOT NULL AND s.payload_hash=p_source_payload_hash AND encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex')=p_source_payload_hash;$r$;
BEGIN
 n:=0;
 FOR f IN SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition FROM pg_proc p
  WHERE p.oid IN('gridex_received_sources.append_validation(uuid,text,uuid,text,text)'::regprocedure,
                 'gridex_received_sources.append_validation_before_unused_unh_v1(uuid,text,uuid,text,text)'::regprocedure)
 LOOP
  IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'received_validation_retained_source_predecessor_required';END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'received_validation_retained_source_metadata_changed';END IF;
  n:=n+1;
 END LOOP;
 IF n<>2 THEN RAISE EXCEPTION 'received_validation_retained_source_predecessor_required';END IF;
END$fix$;
COMMIT;
