-- The inbound PRODAT policy for a bilateral H/LK or regulated A/D source needs
-- its source capability (lib/ediel/core/runtimeDecision.ts reads
-- ediel_read_prodat_bilateral_source_capability_v1 before deciding). The
-- capability owners gridex_bilateral_prodat.source_capability_v1 and
-- gridex_regulated_supply.source_capability_v1 required the source's captured
-- rule-pack receipt (gridex_ediel_source_rules.require_v1), but that receipt is
-- only captured after the canonical decision has been recorded
-- (lib/ediel/flows/inboundProcessing.ts). The first qualification of every
-- such source therefore failed with ediel_historical_rule_pack_basis_unavailable
-- and the source was never processed.
--
-- Both owners already bind the message's own rule-pack evidence, frozen at
-- insert by gridex_bind_inbound_ediel_rule_pack_evidence (canonical_rule_pack_id,
-- rule_profile_version_id, rule_pack_checksum), to the archived reviewed scope.
-- They now require the captured receipt only once it exists; before capture
-- the bound evidence must be complete. A captured receipt stays authoritative.
BEGIN;
DO $cap$DECLARE f record;t record;
BEGIN
 FOR t IN SELECT * FROM (VALUES
  ('gridex_bilateral_prodat.source_capability_v1(public.ediel_messages)',$n$pack:=gridex_ediel_source_rules.require_v1(m.company_id,m.id);$n$,
   $n$IF EXISTS(SELECT FROM gridex_ediel_source_rules.receipts WHERE source_message_id=m.id) THEN pack:=gridex_ediel_source_rules.require_v1(m.company_id,m.id);
  ELSIF m.canonical_rule_pack_id IS NULL OR m.rule_profile_version_id IS NULL OR nullif(m.rule_pack_checksum,'') IS NULL THEN RETURN NULL;END IF;$n$),
  ('gridex_regulated_supply.source_capability_v1(public.ediel_messages)',$n$PERFORM gridex_ediel_source_rules.require_v1(m.company_id,m.id);$n$,
   $n$IF EXISTS(SELECT FROM gridex_ediel_source_rules.receipts WHERE source_message_id=m.id) THEN PERFORM gridex_ediel_source_rules.require_v1(m.company_id,m.id);
  ELSIF m.canonical_rule_pack_id IS NULL OR m.rule_profile_version_id IS NULL OR nullif(m.rule_pack_checksum,'') IS NULL THEN RETURN NULL;END IF;$n$)
 ) v(target,needle,replacement) LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=t.target::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,t.needle,'')))/length(t.needle)<>1 THEN RAISE EXCEPTION 'capability_rule_receipt_predecessor_required:%',t.target;END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,t.needle,t.replacement));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'capability_rule_receipt_metadata_changed:%',t.target;END IF;
 END LOOP;
END$cap$;
COMMIT;
