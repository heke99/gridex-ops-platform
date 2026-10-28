-- FINDINGS J1-01 (reality scenario J1), owner decision 35 (2026-10-28). A received normal Z04 (Z22/Z23) whose start
-- date differs from our own sent Z03 for the same case was held with the generic reason
-- normal_z04_exact_sent_original_required. The grid owner got no APERAK and the operator only learned of it from the
-- 30-minute watch.
--
-- Rule (owner decision 35): a start date in a Z04 that conflicts with our sent Z03 and with the customer's contracted
-- start never changes the contract and never activates supply. It is answered with a negative APERAK (ERC 42 on field
-- 210, Avtal, startdatum) and an operator case is opened for reconciliation. An agreed date change is a separate flow.
--
-- This migration only gives that case its own hold reason, normal_z04_start_date_conflict, in
-- gridex_received_sources.normal_switch_scope_effect_v1. It is chosen only when no exact own original qualifies AND
-- exactly one own current sent Z03 of the same tenant, environment and reversed parties matches the object in every
-- correlated fact (case reference 226, customer identity, transaction reason, facility and its agency) except the
-- start, AND the start is not the contracted start (customer_contracts.requested_start_date) of that switch's
-- contract. Nothing is written in this branch. Every other refusal keeps its reason; an exact match is unchanged.
-- The negative APERAK and the operator case are produced by the caller (lib/ediel/flows/normalZ04HoldResponse.ts).
--
-- Exact-needle rewrite of the installed body (20261019150000); the needle must occur exactly once and the marker must
-- be absent. Owner, ACL, security mode and configuration (proconfig) are preserved and checked.
begin;

do $j101$
declare
  needle constant text := $n$  IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_exact_sent_original_required');END IF;$n$;
  replacement constant text := $r$  -- J1-01 (20261028100000), owner decision 35: only the start differs from exactly one own sent Z03 of this case
  -- and the start is not the customer's contracted start. Held with its own reason; nothing is written here.
  IF coalesce(cardinality(ids),0)=0 THEN
   SELECT array_agg(s.id ORDER BY s.id) INTO ids FROM public.supplier_switch_requests s JOIN public.ediel_messages z ON z.id=s.outbound_z03_message_id AND z.company_id=s.company_id AND z.environment=m.environment
    LEFT JOIN public.customer_contracts k ON k.id=coalesce(s.contract_id,s.customer_contract_id) AND k.company_id=s.company_id
    WHERE s.company_id=m.company_id AND s.rff_li_reference=own->>'li' AND z.direction='outbound' AND z.message_family='PRODAT' AND z.message_code='Z03' AND gridex_received_sources.sent_source_is_current_v1(z)
     AND gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->>'sender'=wire->>'receiver' AND gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->>'receiver'=wire->>'sender'
     AND k.requested_start_date IS DISTINCT FROM gridex_received_sources.permission_date_v1(own->>'start')
     AND EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->'objects') o WHERE o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start' IS DISTINCT FROM own->>'start' AND o->>'reason'=own->>'reason' AND (o->>'point' IS NULL OR o->>'point'=own->>'point') AND(o->>'point' IS NULL OR o->>'identityAgency'=own->>'identityAgency'));
   IF coalesce(cardinality(ids),0)=1 THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_start_date_conflict');END IF;
  END IF;
  IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_exact_sent_original_required');END IF;$r$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'gridex_received_sources.normal_switch_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1
    or position('J1-01 (20261028100000)' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'normal_z04_j1_01_predecessor_required' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, needle, replacement);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body
    or position('J1-01 (20261028100000)' in body) = 0 then
    raise exception 'normal_z04_j1_01_metadata_changed' using errcode = 'P0U01';
  end if;
end
$j101$;

commit;
