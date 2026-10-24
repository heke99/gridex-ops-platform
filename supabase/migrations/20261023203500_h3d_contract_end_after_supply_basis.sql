-- FINDINGS H3d D8 (reports/h3d-move-out-notice.md), owner decisions 2026-10-23 B1 and 20: the qualified supply basis
-- the billing gate, the underlay store and the underlay binding read (gridex_received_sources.billing_supply_basis_v1 ->
-- supply_period_source_basis_v1, H3c 20261023201000) applies the same contract rule as 20261023203000: a terminated
-- contract carries its own period when termination_reason is 'supply_end', 'move_out', 'grid_contract_ended' or
-- 'customer_termination' and ended_at (UTC or Stockholm date) is ON OR AFTER the period's end date (the contract may run
-- on through its notice period after the supply ended). The basis interval stays bounded by the supply: the received
-- market end, or (H3c) civil midnight after the manual last supplied day.
-- The close's new manual-end marker planned_end_reason 'grid_contract_ended' (20261023205000) is accepted under exactly
-- the H3c shortening-only conditions of 'move_out'/'terminate'.
--
-- Exact-needle rewrite of the installed body; refuses (h3d_contract_end_after_supply_rule_source_changed) unless both
-- needles are present exactly once, the H3c marker is present and the H3d marker is absent. Owner, ACL, security
-- definer, volatility and configuration (proconfig) are preserved and checked.
begin;

do $h3d8b$
declare
  basis_old_contract constant text := $c$c.status='terminated' AND c.termination_reason IN('supply_end','move_out') AND p.end_date IS NOT NULL AND c.ended_at IS NOT NULL
   AND ((c.ended_at AT TIME ZONE 'UTC')::date=p.end_date OR (c.ended_at AT TIME ZONE 'Europe/Stockholm')::date=p.end_date))$c$;
  basis_new_contract constant text := $c$c.status='terminated' AND c.termination_reason IN('supply_end','move_out','grid_contract_ended','customer_termination') AND p.end_date IS NOT NULL AND c.ended_at IS NOT NULL
   -- H3d D8 (20261023203500): the contract may end on or after the supply end (notice period, owner decision B1).
   AND ((c.ended_at AT TIME ZONE 'UTC')::date>=p.end_date OR (c.ended_at AT TIME ZONE 'Europe/Stockholm')::date>=p.end_date))$c$;
  basis_old_marker constant text := $c$p.metadata->>'planned_end_reason' IN('move_out','terminate')$c$;
  basis_new_marker constant text := $c$p.metadata->>'planned_end_reason' IN('move_out','terminate','grid_contract_ended')$c$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p
  where p.oid = 'gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, basis_old_contract, ''))) / length(basis_old_contract) <> 1
    or (length(f.prosrc) - length(replace(f.prosrc, basis_old_marker, ''))) / length(basis_old_marker) <> 1
    or position('H3c (20261023201000)' in f.prosrc) = 0
    or position('H3d D8 (20261023203500)' in f.prosrc) <> 0
    or not (f.metadata->>'prosecdef')::boolean
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'h3d_contract_end_after_supply_rule_source_changed:supply_period_source_basis_v1' using errcode = 'P0U01';
  end if;
  body := replace(replace(f.prosrc, basis_old_contract, basis_new_contract), basis_old_marker, basis_new_marker);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'h3d_contract_end_after_supply_metadata_changed:supply_period_source_basis_v1' using errcode = 'P0U01';
  end if;
end
$h3d8b$;

commit;
