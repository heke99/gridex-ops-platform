-- FINDINGS J1-02 (reality scenario J1), owner decision 36 (2026-10-28). A received normal Z04 (Z22/Z23) for a case we
-- never requested was held with the same reason as J1-01 (normal_z04_exact_sent_original_required) and never answered.
--
-- Rule (owner decision 36): "no own Z03" is its own hold reason, separate from J1-01. It is normally answered with
-- ERC 42 on field 226 (case reference), not also 209. ERC 40/105 is used when the facility cannot be identified
-- uniquely together with the grid area, and 40/107 when the actor has no relation to the facility; the causes are
-- kept apart. The own-Z03 requirement is not general: a Z04A (Z26) for a verified assignment never reaches this
-- function (apply_supply_before_h_v1 routes only Z22/Z23 here; Z26/Z70 go to other_supply_scope_effect_v1).
--
-- In gridex_received_sources.normal_switch_scope_effect_v1, after J1-01 (20261028100000), when no own switch request
-- of this tenant carries the object's case reference (field 226) at all:
--   normal_z04_object_not_identified (40/105): the tenant knows the facility id, but not exactly one facility with
--     that id in the object's grid area;
--   normal_z04_actor_not_related (40/107): exactly one facility with that id and grid area, but this supplier has no
--     signed/active contract and no open supply period on it;
--   normal_z04_own_z03_missing (42/226): otherwise (an unknown facility, or our own facility with an unknown case).
-- Nothing is written in this branch; every other refusal keeps its reason. The negative APERAK is produced by the
-- caller (lib/ediel/flows/normalZ04HoldResponse.ts).
--
-- Exact-needle rewrite of the installed body (after 20261028100000); the needle must occur exactly once and the
-- marker must be absent. Owner, ACL, security mode and configuration (proconfig) are preserved and checked.
begin;

do $j102$
declare
  needle constant text := $n$   IF coalesce(cardinality(ids),0)=1 THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_start_date_conflict');END IF;$n$;
  replacement constant text := $r$   IF coalesce(cardinality(ids),0)=1 THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_start_date_conflict');END IF;
   -- J1-02 (20261028101000), owner decision 36: no own switch request carries this case reference (field 226).
   IF NOT EXISTS(SELECT FROM public.supplier_switch_requests s WHERE s.company_id=m.company_id AND s.rff_li_reference=own->>'li') THEN
    IF EXISTS(SELECT FROM public.metering_points p WHERE p.company_id=m.company_id AND p.ediel_metering_point_id=own->>'point')
     AND (SELECT count(*) FROM public.metering_points p WHERE p.company_id=m.company_id AND p.ediel_metering_point_id=own->>'point' AND p.grid_area_code=own->>'gridArea')<>1
     THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_object_not_identified');END IF;
    IF EXISTS(SELECT FROM public.metering_points p WHERE p.company_id=m.company_id AND p.ediel_metering_point_id=own->>'point' AND p.grid_area_code=own->>'gridArea'
      AND NOT EXISTS(SELECT FROM public.customer_contracts k WHERE k.company_id=m.company_id AND k.metering_point_id=p.id AND k.status IN('signed','active'))
      AND NOT EXISTS(SELECT FROM public.customer_supply_periods q WHERE q.company_id=m.company_id AND q.metering_point_id=p.id AND q.status NOT IN('cancelled','ended')))
     THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_actor_not_related');END IF;
    RETURN jsonb_build_object('applied',false,'reason','normal_z04_own_z03_missing');
   END IF;$r$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'gridex_received_sources.normal_switch_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1
    or position('J1-01 (20261028100000)' in f.prosrc) = 0
    or position('J1-02 (20261028101000)' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'normal_z04_j1_02_predecessor_required' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, needle, replacement);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body
    or position('J1-02 (20261028101000)' in body) = 0 then
    raise exception 'normal_z04_j1_02_metadata_changed' using errcode = 'P0U01';
  end if;
end
$j102$;

commit;
