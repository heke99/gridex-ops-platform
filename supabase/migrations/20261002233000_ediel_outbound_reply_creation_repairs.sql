-- 20260930184410 (protected technical CONTRL) and 20260930205320 (PRODAT
-- common-header rejection) made two outbound reply kinds deliberately carry no
-- business rule pack: their authority is the protected original syntax owner
-- (gridex_ediel_technical_ack.require_contrl_v1) or the common-header negative
-- witness (gridex_ediel_common_header.witness_v1). The rule-pack snapshot
-- trigger was updated to enforce exactly that, but the older canonical contract
-- trigger (gridex_validate_ediel_message_contract) still demanded
-- canonical_rule_pack_id for every outbound canonical message. Every technical
-- CONTRL and common-header APERAK therefore failed with
-- canonical_ediel_rule_pack_required.
--
-- In addition gridex_ediel_ack_replay.create_v1/create_scope_v2 build the row
-- in a %rowtype record, where column defaults do not apply, and assign
-- rule_pack_snapshot/execution_context_snapshot only on the witness paths. The
-- INSERT then sent NULL into those NOT NULL columns (default '{}') for technical
-- CONTRL replies. Initialise both to the column default; the witness paths
-- still overwrite them.
--
-- Finally gridex_ediel_technical_ack.require_contrl_v1 proves the original
-- interchange identity unique by re-parsing every inbound message's raw bytes
-- with a character-level plpgsql envelope parser on each CONTRL reply: linear
-- in history and slow enough to hit statement_timeout. The UCI reference
-- (UNB 0020) of an alphanumeric original appears verbatim in its raw bytes, so
-- only rows containing it can match; they are still fully parsed and compared
-- exactly as before. A reference with any other character keeps the full scan.
--
-- And since 20260930231958 create_v1/create_scope_v2 re-read a freshly
-- inserted business ACK through read_v1, which requires the ACK's own
-- prescribed-reply rule-pack receipt (gridex_ediel_source_rules.receipts with
-- original_source_message_id). That receipt was written only by
-- gridex_ediel_source_rules.capture_v1 at send time, so every fresh business
-- APERAK/UTILTS_ERR failed with ediel_historical_rule_pack_basis_unavailable.
-- Capture it in the same transaction right after the INSERT through that
-- existing owner (its prescribed_outbound_ack branch). Technical CONTRL and
-- common-header replies keep their own authorities and are not captured here.
--
-- create_v1/create_scope_v2 also derive transaction_reference only from RFF+TN.
-- A UTILTS transaction APERAK names its transaction in RFF+ACW (the sequence
-- token), so the column stayed NULL and a source's second transaction ACK
-- collided with the first on ux_ediel_ack_related. Fall back to the RFF+ACW
-- whose value is exactly the supplied sequence token; nothing else changes.
--
-- Fix: the contract trigger accepts a NULL rule pack only for these two kinds,
-- and only after it has itself re-run the same protected authority checks the
-- snapshot trigger uses. Route, route profile, application reference, source
-- operation and payload sealing requirements stay unchanged for them too.
BEGIN;
DO $rewrite$DECLARE f record;
 needle CONSTANT text:=$n$      if new.canonical_rule_pack_id is null then raise exception 'canonical_ediel_rule_pack_required' using errcode='23502'; end if;$n$;
 replacement CONSTANT text:=$n$      if new.canonical_rule_pack_id is null then
        if new.message_family='CONTRL' then
          perform gridex_ediel_technical_ack.require_contrl_v1(new);
        elsif new.message_family='APERAK' and new.execution_context_snapshot ? 'prodatCommonHeaderNegativeWitnessId' then
          perform gridex_ediel_common_header.witness_v1(new);
        else
          raise exception 'canonical_ediel_rule_pack_required' using errcode='23502';
        end if;
      end if;$n$;
BEGIN
 IF to_regprocedure('gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)') IS NULL OR to_regprocedure('gridex_ediel_common_header.witness_v1(public.ediel_messages)') IS NULL
 THEN RAISE EXCEPTION 'contract_reply_basis_predecessor_required';END IF;
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_validate_ediel_message_contract()'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'contract_reply_basis_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'contract_reply_basis_metadata_changed';END IF;
END$rewrite$;
DO $rewrite_ack$DECLARE f record;
 needle CONSTANT text:=$n$ IF common THEN m.execution_context_snapshot:=$n$;
 replacement CONSTANT text:=$n$ m.rule_pack_snapshot:='{}'::jsonb;m.execution_context_snapshot:='{}'::jsonb;IF common THEN m.execution_context_snapshot:=$n$;
 target text;
BEGIN
 FOREACH target IN ARRAY ARRAY['gridex_ediel_ack_replay.create_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)','gridex_ediel_ack_replay.create_scope_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)'] LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=target::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'ack_reply_snapshot_predecessor_required:%',target;END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'ack_reply_snapshot_metadata_changed:%',target;END IF;
 END LOOP;
END$rewrite_ack$;
DO $prefilter$DECLARE f record;
 needle CONSTANT text:=$n$(SELECT count(*) FROM public.ediel_messages old CROSS JOIN LATERAL(SELECT gridex_ediel_technical_ack.envelope(old.raw_payload)e)p$n$;
 replacement CONSTANT text:=$n$(SELECT count(*) FROM (SELECT o.* FROM public.ediel_messages o WHERE o.direction='inbound'
   AND (coalesce(evidence#>>'{originalUNB,uciReference}','') !~ '^[A-Za-z0-9]+$' OR strpos(o.raw_payload,evidence#>>'{originalUNB,uciReference}')>0) OFFSET 0) old
  CROSS JOIN LATERAL(SELECT gridex_ediel_technical_ack.envelope(old.raw_payload)e)p$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'technical_ack_uniqueness_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'technical_ack_uniqueness_metadata_changed';END IF;
END$prefilter$;
DO $capture_ack$DECLARE f record;
 anchor CONSTANT text:=$n$before publishing effects/results.
 result:=$n$;
 replacement CONSTANT text:=$n$before publishing effects/results.
 IF family<>'CONTRL' AND NOT coalesce(common,false) THEN PERFORM gridex_ediel_source_rules.capture_v1(c,m.id);END IF;
 result:=$n$;
 target text;
BEGIN
 FOREACH target IN ARRAY ARRAY['gridex_ediel_ack_replay.create_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)','gridex_ediel_ack_replay.create_scope_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)'] LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=target::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,anchor,'')))/length(anchor)<>1 OR position('common:=' in f.prosrc)=0 THEN RAISE EXCEPTION 'ack_reply_capture_predecessor_required:%',target;END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,anchor,replacement));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'ack_reply_capture_metadata_changed:%',target;END IF;
 END LOOP;
END$capture_ack$;
DO $txref$DECLARE f record;
 needle CONSTANT text:=$n$ SELECT t#>>'{elements,1,1}' INTO m.transaction_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='TN' ORDER BY (t->>'index')::int LIMIT 1;$n$;
 replacement CONSTANT text:=$n$ SELECT t#>>'{elements,1,1}' INTO m.transaction_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='TN' ORDER BY (t->>'index')::int LIMIT 1;
 IF m.transaction_reference IS NULL AND nullif(sequence_value,'') IS NOT NULL THEN
  SELECT t#>>'{elements,1,1}' INTO m.transaction_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' AND t#>>'{elements,1,1}'=sequence_value ORDER BY (t->>'index')::int LIMIT 1;
 END IF;$n$;
 target text;
BEGIN
 FOREACH target IN ARRAY ARRAY['gridex_ediel_ack_replay.create_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)','gridex_ediel_ack_replay.create_scope_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)'] LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=target::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'ack_transaction_reference_predecessor_required:%',target;END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'ack_transaction_reference_metadata_changed:%',target;END IF;
 END LOOP;
END$txref$;
COMMIT;
