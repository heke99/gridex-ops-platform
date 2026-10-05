-- A business APERAK/UTILTS_ERR created by gridex_ediel_ack_replay.create_v1 /
-- create_scope_v2 copies the outbound owner witness's rule-pack snapshot
-- verbatim. That snapshot describes the inbound original, so the reply row did
-- not say that its rule basis is inherited, from which source message, or under
-- which authority. The application kernel (lib/ediel/core/kernel.ts
-- canonical ACK input) and the native contract record exactly that on every
-- ACK: inheritedFromSourceMessage=true, sourceMessageId=<original id> and
-- authority='resolveCanonicalEdielPolicy'.
--
-- Overlay those three keys on the witness snapshot. profileKey,
-- profileVersionId, version and checksum stay the witness's values, so the
-- snapshot and receipt checks that compare them are unaffected.
BEGIN;
DO $inherit$DECLARE f record;
 needle CONSTANT text:=$n$m.rule_pack_snapshot:=w.evidence->'snapshot';$n$;
 replacement CONSTANT text:=$n$m.rule_pack_snapshot:=(w.evidence->'snapshot')||jsonb_build_object('inheritedFromSourceMessage',true,'sourceMessageId',s.id,'authority','resolveCanonicalEdielPolicy');$n$;
 target text;
BEGIN
 FOREACH target IN ARRAY ARRAY['gridex_ediel_ack_replay.create_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)','gridex_ediel_ack_replay.create_scope_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)'] LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=target::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 OR position('s public.ediel_messages%rowtype' in f.prosrc)=0 THEN RAISE EXCEPTION 'ack_snapshot_inheritance_predecessor_required:%',target;END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'ack_snapshot_inheritance_metadata_changed:%',target;END IF;
 END LOOP;
END$inherit$;
COMMIT;
