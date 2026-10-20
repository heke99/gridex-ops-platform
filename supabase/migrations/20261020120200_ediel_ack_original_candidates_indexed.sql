-- ACK original reads stay bounded as a tenant's ACK history grows.
--
-- After 20261020120100, read_outbound_originals_v1 still visited every
-- outbound ACK of the tenant to evaluate its five-way OR (direct relation,
-- owner witness, negative witness, creation receipt, retained CONTRL source),
-- and the witness/receipt subqueries had no index on their source columns.
-- Measured on synthetic history: 40 ms at 130, 240 ms at 10,030 CONTRLs per
-- tenant (~23 us each); with 3-4 reads per ACK creation the 8 s statement
-- timeout returns at roughly 100k ACKs per tenant.
--
-- The rows are now drawn from five indexed candidate branches and the original
-- predicate is kept unchanged as the filter. Each OR branch implies its
-- candidate branch, so the result is identical:
--  1. related_message_id = source            -> ux_ediel_ack_related
--  2. owner consumption whose witness relates -> witnesses(related_message_id)
--  3. negative consumption of the source      -> negative_witnesses(source_message_id)
--  4. creation receipt of the source          -> creation_receipts(source_message_id)
--  5. retained_source_v1(m,false) = source requires
--     wire_v1(m.raw_payload)->>'uciRef' = envelope(source)->>'uciReference'
--     (the comparison retained_source_v1 itself makes) -> expression index.
-- wire_v1 and wire_tokens_v1 are IMMUTABLE; a later incompatible change to
-- either must REINDEX ediel_messages_contrl_uci_ref_idx in the same migration.
BEGIN;

CREATE INDEX IF NOT EXISTS witnesses_related_message_id_idx ON gridex_ediel_outbound_owner.witnesses (related_message_id);
CREATE INDEX IF NOT EXISTS negative_witnesses_source_message_id_idx ON gridex_ediel_common_header.negative_witnesses (source_message_id);
CREATE INDEX IF NOT EXISTS creation_receipts_source_message_id_idx ON gridex_ediel_ack_replay.creation_receipts (source_message_id);
CREATE INDEX IF NOT EXISTS ediel_messages_contrl_uci_ref_idx ON public.ediel_messages
 (company_id, environment, (gridex_ack_authority.wire_v1(raw_payload)->>'uciRef'))
 WHERE direction='outbound' AND message_family='CONTRL';

DO $fix$DECLARE f record;
 needle CONSTANT text:=$n$ FOR ack IN SELECT m.* FROM public.ediel_messages m WHERE$n$;
 replacement CONSTANT text:=$r$ FOR ack IN SELECT m.* FROM (
   SELECT x.id FROM public.ediel_messages x WHERE x.company_id=company AND x.related_message_id=source.id AND x.message_family=p_family
    AND x.related_message_id IS NOT NULL AND x.message_family IN('APERAK','CONTRL','UTILTS_ERR')
   UNION SELECT c.source_message_id FROM gridex_ediel_outbound_owner.witnesses w JOIN gridex_ediel_outbound_owner.consumptions c ON c.witness_id=w.id WHERE w.related_message_id=source.id
   UNION SELECT c.ack_message_id FROM gridex_ediel_common_header.negative_witnesses w JOIN gridex_ediel_common_header.negative_consumptions c ON c.witness_id=w.id WHERE w.source_message_id=source.id
   UNION SELECT r.ack_message_id FROM gridex_ediel_ack_replay.creation_receipts r WHERE r.source_message_id=source.id
   UNION SELECT x.id FROM public.ediel_messages x WHERE p_family='CONTRL' AND source_uci IS NOT NULL AND x.direction='outbound' AND x.message_family='CONTRL'
    AND x.company_id=company AND x.environment=source.environment AND gridex_ack_authority.wire_v1(x.raw_payload)->>'uciRef'=source_uci
  ) candidate JOIN public.ediel_messages m ON m.id=candidate.id WHERE$r$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f
  FROM pg_proc p WHERE p.oid='gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 OR strpos(f.prosrc,'source_uci:=')=0 THEN
  RAISE EXCEPTION 'ack_original_candidates_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata THEN
  RAISE EXCEPTION 'ack_original_candidates_metadata_changed';END IF;
END$fix$;

COMMIT;
