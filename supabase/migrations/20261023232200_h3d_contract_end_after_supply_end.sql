-- FINDINGS H3d D8 (reports/h3d-move-out-notice.md), owner decisions 2026-10-23 B1, B3 and 20 (OWNER-DECISIONS.md rows
-- 16, 18 and 20): at a move-out the CONTRACT ends by its notice period, while the SUPPLY (and all energy and fixed-fee
-- billing) ends at the actual supply end (the move-out day, an ended grid contract, the grid owner's end). The contract
-- end may therefore lie AFTER the supply end. Nothing is ever billed after the supply end.
--
-- Defect: the shared H3/H3b rule (gridex_set_metering_billing_gate, gridex_store_billing_underlay,
-- gridex_read_interval_pricing_snapshot_v1, gridex_persist_pricing_run, billing_export_readiness_v; 20261023199000,
-- 20261023200000) required the terminated contract's ended_at to fall ON the period's end date (as does the H3c qualified
-- supply basis, changed by 20261023203500). A contract that runs on through its notice period after the move-out
-- (ended_at > end_date) was refused for the whole final month, also for the supplied days. The manual close's 'terminate' mode wrote 'move_out' (D9); the H3d termination slice
-- (20261023205000) writes the actual reason instead: 'customer_termination' (a termination without ongoing supply) and
-- 'grid_contract_ended' (the customer's grid contract ended, so there is no supply although the notice runs on).
--
-- Rule (one change in the status clause the five readers share verbatim):
--   a terminated contract carries its own supply period when termination_reason is 'supply_end', 'move_out',
--   'grid_contract_ended' or 'customer_termination' and ended_at (UTC or Stockholm date) is ON OR AFTER the period's end
--   date. Everything else is unchanged and still required: the contract of the billed period's own supply period (same
--   tenant, customer and metering point), a billed period status, and the billed period inside the supplied window
--   (not before civil midnight of the start date, not after the period's end instant: the received market end, or civil
--   midnight after the last supplied day). So the supplied days are billed and nothing after the supply end, however
--   long the notice runs. Still refused: 'supplier_switch', 'customer_request', any other or no reason, a contract
--   ended BEFORE its period's end date, cancelled/expired contracts, another tenant/contract, and an open period (the
--   rule requires an end date).
-- The same rule in the qualified supply basis is 20261023203500.
--
-- Exact-needle rewrites; the migration refuses (h3d_contract_end_after_supply_rule_source_changed) unless every needle
-- is present exactly once and the replacement is absent. Owner, ACL, security mode, volatility and configuration
-- (proconfig) of the four functions and the owner, ACL, options and columns of the view are preserved and checked.
begin;

do $h3d8$
declare
  old_status constant text := $c$NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner','ending','ended'),false)
   OR (sp.status IN ('ending','ended') AND coalesce(sp.actual_end_date,sp.end_date) IS NULL)
   -- H3: a contract ended by exactly this period's end still carries the period up to that end.
   -- H3b (20261023200000): that end is a Z05 supply end ('supply_end') or a manual move-out on that date ('move_out').
   OR NOT coalesce(ct.status IN ('signed','active') OR (ct.status='terminated' AND ct.termination_reason IN ('supply_end','move_out') AND sp.end_date IS NOT NULL AND ct.ended_at IS NOT NULL
    AND ((ct.ended_at AT TIME ZONE 'UTC')::date=sp.end_date OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date=sp.end_date)),false)$c$;
  new_status constant text := $c$NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner','ending','ended'),false)
   OR (sp.status IN ('ending','ended') AND coalesce(sp.actual_end_date,sp.end_date) IS NULL)
   -- H3: a contract ended by exactly this period's end still carries the period up to that end.
   -- H3b (20261023200000): that end is a Z05 supply end ('supply_end') or a manual move-out on that date ('move_out').
   -- H3d D8 (20261023203000): the contract may end on or AFTER the supply end (its notice period runs on, owner decision
   -- B1); it carries only the supplied days (the end clause bounds the billed period by the supply end). Manual ends:
   -- 'move_out', 'grid_contract_ended' and 'customer_termination' (a termination without ongoing supply).
   OR NOT coalesce(ct.status IN ('signed','active') OR (ct.status='terminated' AND ct.termination_reason IN ('supply_end','move_out','grid_contract_ended','customer_termination') AND sp.end_date IS NOT NULL AND ct.ended_at IS NOT NULL
    AND ((ct.ended_at AT TIME ZONE 'UTC')::date>=sp.end_date OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date>=sp.end_date)),false)$c$;
  start_clause constant text := $c$sp.start_date IS NULL OR (sp.start_date::timestamp AT TIME ZONE 'Europe/Stockholm')>n.period_start$c$;
  end_clause constant text := $c$(coalesce(sp.actual_end_date,sp.end_date) IS NOT NULL AND (CASE
     -- H1: a received market end at the start of its date is exclusive (end_date = first day not supplied).
     -- F108 M5: it ends at the market instant itself (00:00 +0100, 23:00Z in summer), as the qualified supply basis.
     WHEN sp.market_end_at IS NOT NULL AND sp.market_end_at<=(coalesce(sp.actual_end_date,sp.end_date)::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '1 hour'
     THEN sp.market_end_at ELSE (coalesce(sp.actual_end_date,sp.end_date)+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<n.period_end)$c$;
  h3_marker constant text := 'H3 (20261023199000): a contract terminated by exactly this underlay''s supply end still carries its final period';
  view_old constant text := $n$((ct.status = 'terminated'::text) AND (ct.termination_reason = ANY (ARRAY['supply_end'::text, 'move_out'::text])) AND (sp.end_date IS NOT NULL) AND (ct.ended_at IS NOT NULL) AND ((((ct.ended_at AT TIME ZONE 'UTC'::text))::date = sp.end_date) OR (((ct.ended_at AT TIME ZONE 'Europe/Stockholm'::text))::date = sp.end_date)))$n$;
  view_new constant text := $n$((ct.status = 'terminated'::text) AND (ct.termination_reason = ANY (ARRAY['supply_end'::text, 'move_out'::text, 'grid_contract_ended'::text, 'customer_termination'::text])) AND (sp.end_date IS NOT NULL) AND (ct.ended_at IS NOT NULL) AND ((((ct.ended_at AT TIME ZONE 'UTC'::text))::date >= sp.end_date) OR (((ct.ended_at AT TIME ZONE 'Europe/Stockholm'::text))::date >= sp.end_date)))$n$;
  f record;
  v record;
  body text;
  definition text;
  target regprocedure;
begin
  foreach target in array array[
    'public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)'::regprocedure,
    'public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure,
    'public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,jsonb)'::regprocedure,
    'public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure]
  loop
    select p.oid, p.proname, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
    from pg_proc p where p.oid = target;
    -- The installed rule must be exactly the H3b rule (20261023200000), once.
    if (length(f.prosrc) - length(replace(f.prosrc, old_status, ''))) / length(old_status) <> 1
      or position(new_status in f.prosrc) <> 0
      or position('H3d D8 (20261023203000)' in f.prosrc) <> 0
      or (f.proname = 'gridex_set_metering_billing_gate' and (position(start_clause in f.prosrc) = 0 or position(end_clause in f.prosrc) = 0))
      or (f.proname in ('gridex_read_interval_pricing_snapshot_v1', 'gridex_persist_pricing_run') and (position(h3_marker in f.prosrc) = 0
        or position(replace(start_clause, 'n.period_start', 'v_period_start') in f.prosrc) = 0
        or position(replace(end_clause, 'n.period_end', 'v_period_end') in f.prosrc) = 0))
      or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
      raise exception 'h3d_contract_end_after_supply_rule_source_changed:%', target using errcode = 'P0U01';
    end if;
    body := replace(f.prosrc, old_status, new_status);
    execute replace(f.definition, f.prosrc, body);
    if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
      or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
      raise exception 'h3d_contract_end_after_supply_metadata_changed:%', target using errcode = 'P0U01';
    end if;
  end loop;

  -- billing_export_readiness_v: the same clause, as pg_get_viewdef renders the 20261023200000 view.
  select c.oid, c.relowner, c.relacl, c.reloptions, pg_get_viewdef(c.oid) as definition,
    (select jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod)) order by a.attnum)
       from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns
    into strict v
  from pg_class c where c.oid = 'public.billing_export_readiness_v'::regclass and c.relkind = 'v';
  if (length(v.definition) - length(replace(v.definition, view_old, ''))) / length(view_old) <> 1
    or position(view_new in v.definition) <> 0
    or position('exact_signed_contract_missing' in v.definition) = 0
    or position('JOIN pricing_runs n ON' in v.definition) = 0
    or position('LEFT JOIN customer_contracts c ON' in v.definition) = 0 then
    raise exception 'h3d_contract_end_after_supply_rule_source_changed:billing_export_readiness_v' using errcode = 'P0U01';
  end if;
  definition := regexp_replace(replace(v.definition, view_old, view_new), ';\s*$', '');
  execute format('create or replace view public.billing_export_readiness_v%s as %s',
    case when v.reloptions is null then '' else ' with (' || array_to_string(v.reloptions, ', ') || ')' end, definition);
  if (select row(c.relowner, c.relacl, c.reloptions) from pg_class c where c.oid = v.oid) is distinct from row(v.relowner, v.relacl, v.reloptions)
    or (select jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod)) order by a.attnum)
          from pg_attribute a where a.attrelid = v.oid and a.attnum > 0 and not a.attisdropped) is distinct from v.columns
    or position(view_new in pg_get_viewdef(v.oid)) = 0 then
    raise exception 'h3d_contract_end_after_supply_metadata_changed:billing_export_readiness_v' using errcode = 'P0U01';
  end if;
end
$h3d8$;

commit;
