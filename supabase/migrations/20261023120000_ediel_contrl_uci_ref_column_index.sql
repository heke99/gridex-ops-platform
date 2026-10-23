-- FINDINGS F99 (reality simulation 2026-10-23, scenario F run 21): the expression index
-- ediel_messages_contrl_uci_ref_idx from 20261020120200 evaluates gridex_ack_authority.wire_v1(raw_payload).
-- Index expressions run with the privileges of the writing role, and wire_v1 is deliberately executable only by
-- postgres. Every INSERT and every non-HOT UPDATE of an outbound CONTRL row by service_role (PostgREST) therefore
-- failed with 42501 "permission denied for function wire_v1"; after an accepted SMTP send the outbox post-send
-- update failed and the outbox row became delivery_uncertain (ediel_smtp_uncertain_cause:42501).
--
-- wire_v1 stays private. The UCI reference is now a stored, derived-only column:
--  * a SECURITY DEFINER BEFORE trigger, ordered first among the ediel_messages triggers, always overwrites
--    contrl_uci_ref with wire_v1(raw_payload)->>'uciRef' for outbound CONTRL rows (NULL otherwise) on INSERT and
--    on any UPDATE that names raw_payload, direction, message_family or contrl_uci_ref. A writer can never store
--    its own value; an UPDATE that names none of these columns keeps the value derived from the unchanged payload
--    (no BEFORE trigger on ediel_messages assigns raw_payload, direction or message_family).
--  * a qualified retention transition (raw_payload -> NULL, see ediel_is_qualified_retention_transition_v1, which
--    compares every other column) keeps the old value so the transition stays qualified for every guard. Such a
--    row has no payload, so retained_source_v1 and the read filter below never select it.
--  * the plain column index replaces the expression index; read_outbound_originals_v1 draws its fifth candidate
--    branch from the column and keeps the original predicate as the filter, so results are unchanged.
-- wire_v1 and wire_tokens_v1 are IMMUTABLE; a later incompatible change to either must re-derive contrl_uci_ref
-- (UPDATE ... SET contrl_uci_ref=NULL as below) in the same migration.
BEGIN;

ALTER TABLE public.ediel_messages ADD COLUMN IF NOT EXISTS contrl_uci_ref text;
COMMENT ON COLUMN public.ediel_messages.contrl_uci_ref IS
 'Derived only: UCI reference (wire_v1(raw_payload)->>''uciRef'') of an outbound CONTRL, maintained by trigger a_00_ediel_contrl_uci_ref_derive. Writes are overwritten.';

CREATE OR REPLACE FUNCTION gridex_ack_authority.derive_contrl_uci_ref_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS NULL THEN
  NEW.contrl_uci_ref:=OLD.contrl_uci_ref;
  IF public.ediel_is_qualified_retention_transition_v1(OLD,NEW) THEN RETURN NEW;END IF;
 END IF;
 NEW.contrl_uci_ref:=CASE WHEN NEW.direction='outbound' AND NEW.message_family='CONTRL' AND NEW.raw_payload IS NOT NULL
  THEN gridex_ack_authority.wire_v1(NEW.raw_payload)->>'uciRef' END;
 RETURN NEW;
END $function$;
ALTER FUNCTION gridex_ack_authority.derive_contrl_uci_ref_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION gridex_ack_authority.derive_contrl_uci_ref_v1() FROM PUBLIC,anon,authenticated,service_role;

-- 'a_00_' sorts before every existing ediel_messages trigger (first: a_gridex_bind_received_err_application_response),
-- so all later BEFORE triggers, guards and AFTER triggers see the derived value.
DROP TRIGGER IF EXISTS a_00_ediel_contrl_uci_ref_derive ON public.ediel_messages;
CREATE TRIGGER a_00_ediel_contrl_uci_ref_derive BEFORE INSERT OR UPDATE OF raw_payload,direction,message_family,contrl_uci_ref
 ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ack_authority.derive_contrl_uci_ref_v1();

-- Backfill through the trigger itself (no trigger is disabled): the UPDATE names only contrl_uci_ref, so the
-- column-scoped triggers stay silent and the unscoped immutability guards compare their own column sets, none of
-- which contains contrl_uci_ref. Only rows that actually carry a UCI reference are touched.
UPDATE public.ediel_messages SET contrl_uci_ref=NULL
 WHERE direction='outbound' AND message_family='CONTRL' AND raw_payload IS NOT NULL
   AND gridex_ack_authority.wire_v1(raw_payload)->>'uciRef' IS NOT NULL;

DO $verify$BEGIN
 IF EXISTS(SELECT FROM public.ediel_messages WHERE ((direction='outbound' AND message_family='CONTRL') OR contrl_uci_ref IS NOT NULL)
  AND contrl_uci_ref IS DISTINCT FROM CASE WHEN direction='outbound' AND message_family='CONTRL' AND raw_payload IS NOT NULL
   THEN gridex_ack_authority.wire_v1(raw_payload)->>'uciRef' END) THEN
  RAISE EXCEPTION 'contrl_uci_ref_backfill_incomplete';END IF;
END$verify$;

DROP INDEX IF EXISTS public.ediel_messages_contrl_uci_ref_idx;
CREATE INDEX IF NOT EXISTS ediel_messages_contrl_uci_ref_col_idx ON public.ediel_messages (company_id, environment, contrl_uci_ref)
 WHERE direction='outbound' AND message_family='CONTRL';

DO $fix$DECLARE f record;
 needle CONSTANT text:=$n$ AND x.company_id=company AND x.environment=source.environment AND gridex_ack_authority.wire_v1(x.raw_payload)->>'uciRef'=source_uci$n$;
 replacement CONSTANT text:=$r$ AND x.company_id=company AND x.environment=source.environment AND x.contrl_uci_ref=source_uci$r$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f
  FROM pg_proc p WHERE p.oid='gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'contrl_uci_ref_candidate_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata THEN
  RAISE EXCEPTION 'contrl_uci_ref_candidate_metadata_changed';END IF;
END$fix$;

COMMIT;
