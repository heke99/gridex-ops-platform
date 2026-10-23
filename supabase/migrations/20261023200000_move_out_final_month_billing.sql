-- FINDINGS H3b (H3 sidofynd 1), owner decision 2026-10-23 "Fakturera slutmånaden": a contract ended by a manual
-- move-out is billed for its final month up to its end date, under the same rule as after a Z05 supply end.
--
-- How a manual move-out ends the contract (installed bodies, 20261002213000 and the customer lifecycle close):
--   * gridex_end_customer_supply_v1(p_end_reason 'move_out') sets the period's end_date = actual_end_date = the
--     move-out date (the LAST supplied day, no market_end_at, status 'ended') and terminates the contract through
--     gridex_record_customer_contract_event_v1('terminated', {ends_at: p_end_date, termination_reason: 'move_out'});
--   * gridex_close_customer_lifecycle_v1 sets the open period's end_date = the move-out date (inclusive, status kept)
--     and terminates the signed/active contracts the same way with termination_reason 'move_out'.
--   gridex_record_customer_contract_event_v1 writes status 'terminated', termination_reason from the metadata and
--   ended_at = coalesce(metadata ended_at, metadata ends_at::timestamptz, ...) = the move-out date.
-- So a move-out contract is 'terminated' + 'move_out' with ended_at on exactly the period's end date: the same shape
-- as the supply-end follow-up's 'supply_end' contract. The billing gate (gridex_set_metering_billing_gate), the underlay
-- store (gridex_store_billing_underlay) and the H3 pricing/export readers (gridex_read_interval_pricing_snapshot_v1,
-- gridex_persist_pricing_run, billing_export_readiness_v; 20261023199000) accepted only 'supply_end', so the final
-- month after a manual move-out was never gated, stored, priced or exported.
--
-- Rule (one change, in the one status clause the five readers share verbatim): the terminated contract's
-- termination_reason may be 'supply_end' OR 'move_out'. Everything else is unchanged and still required: the contract
-- of the billed value's/underlay's own supply period, same tenant, customer and metering point, ended_at on that
-- period's end date (UTC or Stockholm date), a billed period status ('ending'/'ended' only with an end date), the billed
-- period not before civil midnight of the start date and not after the period's end instant (market_end_at for a
-- received end at the start of its date, otherwise civil midnight after the last supplied day = after the move-out
-- date). Not included: 'supplier_switch' (the manual end's switch-away reason), cancelled/expired contracts, any
-- other termination reason, and a move-out on another date than the period's end.
--
-- Exact-needle rewrites of the installed bodies; the migration refuses (move_out_final_month_rule_source_changed) unless
-- the installed H3 status clause is present exactly once in each function (and the gate's start/end clauses and the
-- H3 readers' 20261023199000 marker are present), and the normalized clause exactly once in the view. Owner, ACL,
-- security mode, volatility and configuration (proconfig) of the four functions and owner, ACL, options and columns
-- of the view are preserved and checked.
begin;

do $h3b$
declare
  old_status constant text := $c$NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner','ending','ended'),false)
   OR (sp.status IN ('ending','ended') AND coalesce(sp.actual_end_date,sp.end_date) IS NULL)
   -- H3: a contract ended by exactly this period's end still carries the period up to that end.
   OR NOT coalesce(ct.status IN ('signed','active') OR (ct.status='terminated' AND ct.termination_reason='supply_end' AND sp.end_date IS NOT NULL AND ct.ended_at IS NOT NULL
    AND ((ct.ended_at AT TIME ZONE 'UTC')::date=sp.end_date OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date=sp.end_date)),false)$c$;
  new_status constant text := $c$NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner','ending','ended'),false)
   OR (sp.status IN ('ending','ended') AND coalesce(sp.actual_end_date,sp.end_date) IS NULL)
   -- H3: a contract ended by exactly this period's end still carries the period up to that end.
   -- H3b (20261023200000): that end is a Z05 supply end ('supply_end') or a manual move-out on that date ('move_out').
   OR NOT coalesce(ct.status IN ('signed','active') OR (ct.status='terminated' AND ct.termination_reason IN ('supply_end','move_out') AND sp.end_date IS NOT NULL AND ct.ended_at IS NOT NULL
    AND ((ct.ended_at AT TIME ZONE 'UTC')::date=sp.end_date OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date=sp.end_date)),false)$c$;
  start_clause constant text := $c$sp.start_date IS NULL OR (sp.start_date::timestamp AT TIME ZONE 'Europe/Stockholm')>n.period_start$c$;
  end_clause constant text := $c$(coalesce(sp.actual_end_date,sp.end_date) IS NOT NULL AND (CASE
     -- H1: a received market end at the start of its date is exclusive (end_date = first day not supplied).
     -- F108 M5: it ends at the market instant itself (00:00 +0100, 23:00Z in summer), as the qualified supply basis.
     WHEN sp.market_end_at IS NOT NULL AND sp.market_end_at<=(coalesce(sp.actual_end_date,sp.end_date)::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '1 hour'
     THEN sp.market_end_at ELSE (coalesce(sp.actual_end_date,sp.end_date)+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<n.period_end)$c$;
  h3_marker constant text := 'H3 (20261023199000): a contract terminated by exactly this underlay''s supply end still carries its final period';
  view_old constant text := $n$((ct.status = 'terminated'::text) AND (ct.termination_reason = 'supply_end'::text) AND (sp.end_date IS NOT NULL) AND (ct.ended_at IS NOT NULL)$n$;
  view_new constant text := $n$((ct.status = 'terminated'::text) AND (ct.termination_reason = ANY (ARRAY['supply_end'::text, 'move_out'::text])) AND (sp.end_date IS NOT NULL) AND (ct.ended_at IS NOT NULL)$n$;
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
    -- The installed rule must be exactly the H3 rule (20261022150000, 20261023196000, 20261023199000), once.
    if (length(f.prosrc) - length(replace(f.prosrc, old_status, ''))) / length(old_status) <> 1
      or position(new_status in f.prosrc) <> 0
      or (f.proname = 'gridex_set_metering_billing_gate' and (position(start_clause in f.prosrc) = 0 or position(end_clause in f.prosrc) = 0))
      or (f.proname in ('gridex_read_interval_pricing_snapshot_v1', 'gridex_persist_pricing_run') and (position(h3_marker in f.prosrc) = 0
        or position(replace(start_clause, 'n.period_start', 'v_period_start') in f.prosrc) = 0
        or position(replace(end_clause, 'n.period_end', 'v_period_end') in f.prosrc) = 0))
      or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
      raise exception 'move_out_final_month_rule_source_changed:%', target using errcode = 'P0U01';
    end if;
    body := replace(f.prosrc, old_status, new_status);
    execute replace(f.definition, f.prosrc, body);
    if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
      or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
      raise exception 'move_out_final_month_metadata_changed:%', target using errcode = 'P0U01';
    end if;
  end loop;

  -- billing_export_readiness_v: the same clause, as pg_get_viewdef renders the 20261023199000 view.
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
    raise exception 'move_out_final_month_rule_source_changed:billing_export_readiness_v' using errcode = 'P0U01';
  end if;
  definition := regexp_replace(replace(v.definition, view_old, view_new), ';\s*$', '');
  execute format('create or replace view public.billing_export_readiness_v%s as %s',
    case when v.reloptions is null then '' else ' with (' || array_to_string(v.reloptions, ', ') || ')' end, definition);
  if (select row(c.relowner, c.relacl, c.reloptions) from pg_class c where c.oid = v.oid) is distinct from row(v.relowner, v.relacl, v.reloptions)
    or (select jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod)) order by a.attnum)
          from pg_attribute a where a.attrelid = v.oid and a.attnum > 0 and not a.attisdropped) is distinct from v.columns
    or position(view_new in pg_get_viewdef(v.oid)) = 0 then
    raise exception 'move_out_final_month_metadata_changed:billing_export_readiness_v' using errcode = 'P0U01';
  end if;
end
$h3b$;

commit;
