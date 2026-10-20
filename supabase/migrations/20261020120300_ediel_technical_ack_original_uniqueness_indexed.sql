-- CONTRL original uniqueness no longer scans every inbound message.
--
-- require_contrl_v1 proves that the CONTRL's first14 UCI projection names one
-- inbound original globally. Its candidate filter ran strpos(translate(...))
-- over the raw_payload of every inbound message of every tenant, on every
-- CONTRL write (trigger) and 4 times per gridex_read_outbound_acks_for_source_v2.
-- Measured (synthetic inbound history, 6.8 KB messages): 0.7 s at 348,
-- 1.25 s at 1,348, 2.5 s at 3,348 inbound messages per ACK read; the 8 s
-- statement timeout is reached at roughly 12k inbound messages platform-wide.
--
-- The counted rows are unchanged. The outer filter already requires
-- envelope(old.raw_payload)->>'uciReference' = R (R = evidence first14), and
-- that implies the old candidate filter: with a non-alphanumeric R or a
-- non-standard UNA the old filter passed every row; otherwise the decoded UNB
-- 0020 begins with alphanumeric R, so the payload without release characters
-- and line breaks contains '+'||R (followed by '+' or the terminator when R is
-- the whole reference). The candidates now come from an expression index on
-- exactly that envelope projection.
-- envelope and wire_tokens_v1 are IMMUTABLE and never raise; a later
-- incompatible change to either must REINDEX ediel_messages_inbound_envelope_uci_idx
-- in the same migration.
BEGIN;

CREATE INDEX IF NOT EXISTS ediel_messages_inbound_envelope_uci_idx ON public.ediel_messages
 ((gridex_ediel_technical_ack.envelope(raw_payload)->>'uciReference'))
 WHERE direction='inbound';

DO $fix$DECLARE f record;
 needle CONSTANT text:=$n$
   AND (coalesce(evidence#>>'{originalUNB,uciReference}','') !~ '^[A-Za-z0-9]+$'
   OR (left(o.raw_payload,3)='UNA' AND (substring(o.raw_payload,5,1)<>'+' OR substring(o.raw_payload,7,1)<>'?' OR substring(o.raw_payload,9,1)<>''''))
   OR CASE WHEN char_length(evidence#>>'{originalUNB,uciReference}')=14
    THEN strpos(translate(o.raw_payload,E'?\r\n',''),'+'||(evidence#>>'{originalUNB,uciReference}'))>0
    ELSE strpos(translate(o.raw_payload,E'?\r\n',''),'+'||(evidence#>>'{originalUNB,uciReference}')||'+')>0
     OR strpos(translate(o.raw_payload,E'?\r\n',''),'+'||(evidence#>>'{originalUNB,uciReference}')||'''')>0 END) OFFSET 0) old$n$;
 replacement CONSTANT text:=$r$
   AND gridex_ediel_technical_ack.envelope(o.raw_payload)->>'uciReference'=evidence#>>'{originalUNB,uciReference}' OFFSET 0) old$r$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f
  FROM pg_proc p WHERE p.oid='gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'technical_ack_original_uniqueness_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata THEN
  RAISE EXCEPTION 'technical_ack_original_uniqueness_metadata_changed';END IF;
END$fix$;

COMMIT;
