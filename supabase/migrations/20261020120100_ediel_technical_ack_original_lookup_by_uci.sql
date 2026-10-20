-- Technical ACK original lookup no longer scales with the tenant's history.
--
-- read_outbound_originals_v1 evaluated the fallback
-- retained_source_v1(m,false)=source.id for every outbound CONTRL of the
-- tenant that was not linked directly. From about ten received interchanges
-- per tenant every further CONTRL hit the 8 s statement timeout and the
-- inbound file stayed parsed. retained_source_v1 itself is narrowed by
-- 20261019043000; here the fallback is skipped where it cannot match:
--  * read_outbound_originals_v1: wire_v1(m.raw_payload)->>'uciRef' must equal
--    the source envelope's uciReference. may_reference_uci_v1 applies the
--    wire_tokens_v1 rules (UNA advice, CR/LF removal, release character): a
--    decoded component without release characters is a substring of the
--    normalised body. Any release character keeps the full check.
-- Only rows that cannot satisfy the unchanged match are skipped, so every
-- result, ambiguity error and qualification is identical.
--
-- gridex_read_outbound_acks_for_source_v2 took the source row FOR SHARE (and,
-- through the originals read, more source rows) before read_business_original_v1
-- took LOCK TABLE public.ediel_messages IN SHARE MODE. A concurrent UPDATE held
-- ROW EXCLUSIVE and waited for those row locks, which deadlocked under the
-- inbound worker's default concurrency. The table lock, held to the end of the
-- same transaction anyway, is now taken first, in read_business_original_v1's
-- own order (graph, source receipts, messages).
BEGIN;

CREATE OR REPLACE FUNCTION gridex_ediel_technical_ack.may_reference_uci_v1(p_raw text,p_uci text)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'pg_catalog'
AS $f$
 SELECT p_raw IS NOT NULL AND p_uci IS NOT NULL AND (strpos(b.body,b.release_char)>0 OR strpos(b.body,p_uci)>0)
 FROM (SELECT CASE WHEN left(p_raw,3)='UNA' AND char_length(p_raw)>=9 THEN substr(p_raw,7,1) ELSE '?' END release_char,
   replace(replace(CASE WHEN left(p_raw,3)='UNA' THEN substr(p_raw,10) ELSE p_raw END,E'\r\n',''),E'\n','') body) b
$f$;
REVOKE ALL ON FUNCTION gridex_ediel_technical_ack.may_reference_uci_v1(text,text) FROM PUBLIC;
COMMENT ON FUNCTION gridex_ediel_technical_ack.may_reference_uci_v1(text,text) IS
 'Necessary condition for wire_v1(p_raw)->>''uciRef'' = p_uci under wire_tokens_v1 rules; false only when equality is impossible.';

DO $fix$DECLARE f record;
 patches CONSTANT jsonb:=jsonb_build_array(
  jsonb_build_array('gridex_ack_authority.read_outbound_originals_v1(uuid,text)',
   $n$DECLARE source public.ediel_messages%rowtype;$n$,
   $r$DECLARE source_uci text;source public.ediel_messages%rowtype;$r$),
  jsonb_build_array('gridex_ack_authority.read_outbound_originals_v1(uuid,text)',
   $n$ FOR ack IN SELECT m.* FROM public.ediel_messages m WHERE$n$,
   $r$ IF p_family='CONTRL' THEN source_uci:=gridex_ediel_technical_ack.envelope(source.raw_payload)->>'uciReference';END IF;
 FOR ack IN SELECT m.* FROM public.ediel_messages m WHERE$r$),
  jsonb_build_array('gridex_ack_authority.read_outbound_originals_v1(uuid,text)',
   $n$OR (p_family='CONTRL' AND gridex_ediel_technical_ack.retained_source_v1(m,false)=source.id))$n$,
   $r$OR (p_family='CONTRL' AND gridex_ediel_technical_ack.may_reference_uci_v1(m.raw_payload,source_uci) AND gridex_ediel_technical_ack.retained_source_v1(m,false)=source.id))$r$),
  jsonb_build_array('public.gridex_read_outbound_acks_for_source_v2(uuid,text,uuid,text)',
   $n$PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 SELECT * INTO s FROM public.ediel_messages WHERE id=p_source_message_id AND direction='inbound' FOR SHARE;$n$,
   $r$PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 LOCK TABLE public.ediel_messages IN SHARE MODE;
 SELECT * INTO s FROM public.ediel_messages WHERE id=p_source_message_id AND direction='inbound' FOR SHARE;$r$));
 p jsonb;needle text;
BEGIN
 FOR p IN SELECT x FROM jsonb_array_elements(patches) x LOOP
  SELECT pr.oid,to_jsonb(pr)-'prosrc' metadata,pr.prosrc,pg_get_functiondef(pr.oid) definition INTO STRICT f
   FROM pg_proc pr WHERE pr.oid=(p->>0)::regprocedure;
  needle:=p->>1;
  IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN
   RAISE EXCEPTION 'technical_ack_original_lookup_predecessor_required: %',p->>0;END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,p->>2));
  IF (SELECT to_jsonb(pr)-'prosrc' FROM pg_proc pr WHERE pr.oid=f.oid) IS DISTINCT FROM f.metadata THEN
   RAISE EXCEPTION 'technical_ack_original_lookup_metadata_changed: %',p->>0;END IF;
 END LOOP;
END$fix$;

COMMIT;
