-- FINDINGS J1-03 (reality scenario J1), owner decision 37 (2026-10-28), masterplan ACK-09. Duplicates:
--   * an internal rerun of the same stored reception reuses the earlier decision and reply (unchanged: the stored
--     supply transition/partition and the protected ACK replay already do this);
--   * a NEW received protocol duplicate with the same message id gets ERC 40, national code 103;
--   * a case duplicate with a new message id gets ERC 40/104 when the case-duplicate criteria hold;
--   * the original and its links are kept; no new supply period, invoice or other business effect is created.
--
-- 1. gridex_received_sources.normal_switch_scope_effect_v1: a Z04 (new document) for a switch that an earlier received
--    Z04 of the same grid owner already confirmed (a normal_switch_confirmations row for that Z04 and switch), with the
--    same message name (Z04), facility and agency, end-user identity, supplier (reversed parties), transaction reason
--    and case reference (field 226, P26.A p92 code 104), was held as normal_z04_locked_original_scope_required and never
--    answered. It now gets its own hold reason, normal_z04_case_duplicate; nothing is written. The caller answers it
--    with ERC 40/104 (lib/ediel/flows/normalZ04HoldResponse.ts). Every other refusal is unchanged.
--
-- Not in this migration (FINDINGS J1-03, open for the ACK-09 owner): the 40/103 for a NEW protocol duplicate of a Z04
-- is still held by the native 103 owner, first by the strict single-reference wire shape of
-- gridex_ediel_duplicate_responses.require_wire_v1 (a Z04 carries both Z07 and LI), and, with that shape relaxed in a
-- rolled-back proof, next by the unique index ux_ediel_ack_related (one APERAK per related message and empty
-- transaction reference: the original already has its own APERAK). Both are protected ACK-09 design and need a
-- bounded decision of their own.
--
-- Exact-needle rewrite of the installed body (after 20261028101000); the needle must occur exactly once and the marker
-- must be absent.
-- Owner, ACL, security mode and configuration (proconfig) are preserved and checked.
begin;

do $j103$
declare
  needle constant text := $n$  oldwire:=gridex_received_sources.normal_switch_wire_v1(original.raw_payload);$n$;
  replacement constant text := $r$  oldwire:=gridex_received_sources.normal_switch_wire_v1(original.raw_payload);
  -- J1-03 (20261028102000), owner decision 37 / ACK-09: the same case was already confirmed by another received Z04.
  IF sw.inbound_z04_message_id IS NOT NULL AND sw.inbound_z04_message_id<>m.id AND sw.status IN('accepted','active','completed')
   AND EXISTS(SELECT FROM public.ediel_messages c CROSS JOIN LATERAL (SELECT gridex_received_sources.normal_switch_wire_v1(c.raw_payload) w) cw
    WHERE c.id=sw.inbound_z04_message_id AND c.company_id=m.company_id AND c.environment=m.environment AND c.direction='inbound' AND c.message_standard='edifact' AND c.message_family='PRODAT' AND c.message_code='Z04'
     AND EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations nc WHERE nc.source_message_id=c.id AND nc.company_id=m.company_id AND nc.switch_id=sw.id)
     AND cw.w->>'sender'=wire->>'sender' AND cw.w->>'receiver'=wire->>'receiver'
     AND EXISTS(SELECT FROM jsonb_array_elements(cw.w->'objects') o WHERE o->>'li'=own->>'li' AND o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'reason'=own->>'reason'))
  THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_case_duplicate');END IF;$r$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'gridex_received_sources.normal_switch_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1
    or position('J1-03 (20261028102000)' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'normal_z04_j1_03_predecessor_required' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, needle, replacement);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body
    or position('J1-03 (20261028102000)' in body) = 0 then
    raise exception 'normal_z04_j1_03_metadata_changed' using errcode = 'P0U01';
  end if;
end
$j103$;

commit;
