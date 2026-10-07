-- AT-Z14V-ESCO: use the actual immutable stage-command recorded_at clock.
-- Only the frozen private reader token changes; no historical migration edit.
BEGIN;
DO $clock_guard$
DECLARE
 signature CONSTANT text:='gridex_received_sources.received_z14_reporting_source_basis_v1(uuid,uuid)';
 wrapper_signature CONSTANT text:='public.gridex_ediel_received_z14_reporting_source_basis_v1(uuid,uuid)';
 old_hash CONSTANT text:='aa595b1798a1d6ab9e99d5025dd8e112e20f73dc9085736fffe6a6419ad70036';
 new_hash CONSTANT text:='c6f0ed4c0d94de0a1e828bf1cbd4aea536fceb4b950272c69595d946628efca2';
 needle CONSTANT text:='stage.created_at<=v.reviewed_at';
 replacement CONSTANT text:='stage.recorded_at<=v.reviewed_at';
 f record;body text;body_hash text;wrapper_before jsonb;
BEGIN
 IF to_regprocedure(signature) IS NULL OR to_regprocedure(wrapper_signature) IS NULL THEN RAISE EXCEPTION 'received_reporting_command_clock_predecessor_unrecognized';END IF;
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=to_regprocedure(signature);
 SELECT to_jsonb(p) INTO STRICT wrapper_before FROM pg_proc p WHERE oid=to_regprocedure(wrapper_signature);
 body_hash:=encode(sha256(convert_to(f.prosrc,'UTF8')),'hex');
 IF body_hash=new_hash THEN RETURN;END IF;
 IF body_hash<>old_hash OR (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1
 OR (length(f.definition)-length(replace(f.definition,f.prosrc,'')))/length(f.prosrc)<>1 THEN RAISE EXCEPTION 'received_reporting_command_clock_predecessor_unrecognized';END IF;
 body:=replace(f.prosrc,needle,replacement);
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>new_hash THEN RAISE EXCEPTION 'received_reporting_command_clock_body_unrecognized';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=f.oid) IS DISTINCT FROM new_hash
 OR (SELECT to_jsonb(p) FROM pg_proc p WHERE oid=to_regprocedure(wrapper_signature)) IS DISTINCT FROM wrapper_before THEN RAISE EXCEPTION 'received_reporting_command_clock_metadata_changed';END IF;
END
$clock_guard$;
COMMIT;
