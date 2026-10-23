-- FINDINGS H3 downstream (F108 end side, sidofynd 1), owner decision 2026-10-22 (H2/H3): a supply ended by a Z05 is
-- still billed for its final month, and a contract the supply-end follow-up (gridex_supply_end_followup_v1) terminated
-- because exactly that supply ended stays billable for it. The value gate (gridex_set_metering_billing_gate,
-- 20261022150000) and the underlay store (gridex_store_billing_underlay, 20261023196000) accept that, but the pricing
-- and export readers below them accepted only 'signed'/'active' contracts:
--   * gridex_read_interval_pricing_snapshot_v1 and gridex_persist_pricing_run read the exact contract's price snapshot
--     and contract_type only for 'active'/'signed'. For the final underlay they fell back to the underlay snapshot and
--     'monthly', so an hourly/quarterly contract whose resolution comes from its contract type or snapshot was refused
--     with interval_pricing_snapshot_underlay_selector_mismatch, and persist skipped the interval receipt requirement.
--   * billing_export_readiness_v joined only a 'signed'/'active' contract, so a priced and locked final underlay was
--     blocked with exact_signed_contract_missing and never queued (gridex_queue_billing_export_run).
-- (The pricing engine's loadContract and the export center apply the same rule in TypeScript: contractCarriesUnderlay /
-- contractCarriesBilledPeriod.)
--
-- Rule (exactly the gate's and the store's; their text is reused verbatim and checked against the installed gate and
-- store below): the contract is 'signed'/'active', or it is the contract of the underlay's own supply period (same
-- tenant, customer and metering point) and
--   NOT <gate/store status clause>  -- billed period status; 'terminated' + 'supply_end' + ended_at on sp.end_date
--   AND NOT <gate start clause>     -- billed period starts at/after civil midnight of the supply start date
--   AND NOT <gate end clause>       -- billed period ends at/before the supply end (a received Z05 at market_end_at, M5)
-- with the gate's n.period_start/n.period_end read as the billed period: the underlay's exact period (v_period_start/
-- v_period_end, computed and validated by both functions before the contract read) and, in the export view, the
-- period of the underlay's locked pricing run (written from that same exact period by persist). Another tenant's
-- contract, a contract terminated for another reason or by another supply end, and a billed period after the supply
-- end stay refused.
--
-- Exact-needle rewrites of the installed bodies (the 20261013093922 persist/read bodies) and of the installed view
-- definition. Owner, ACL, security mode, volatility and configuration (proconfig) of both functions and the owner, ACL
-- and options (security_invoker) of the view are preserved and checked. Not applied to any world; manifest unchanged.
begin;

do $h3p$
declare
  status_clause constant text := $c$NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner','ending','ended'),false)
   OR (sp.status IN ('ending','ended') AND coalesce(sp.actual_end_date,sp.end_date) IS NULL)
   -- H3: a contract ended by exactly this period's end still carries the period up to that end.
   OR NOT coalesce(ct.status IN ('signed','active') OR (ct.status='terminated' AND ct.termination_reason='supply_end' AND sp.end_date IS NOT NULL AND ct.ended_at IS NOT NULL
    AND ((ct.ended_at AT TIME ZONE 'UTC')::date=sp.end_date OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date=sp.end_date)),false)$c$;
  start_clause constant text := $c$sp.start_date IS NULL OR (sp.start_date::timestamp AT TIME ZONE 'Europe/Stockholm')>n.period_start$c$;
  end_clause constant text := $c$(coalesce(sp.actual_end_date,sp.end_date) IS NOT NULL AND (CASE
     -- H1: a received market end at the start of its date is exclusive (end_date = first day not supplied).
     -- F108 M5: it ends at the market instant itself (00:00 +0100, 23:00Z in summer), as the qualified supply basis.
     WHEN sp.market_end_at IS NOT NULL AND sp.market_end_at<=(coalesce(sp.actual_end_date,sp.end_date)::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '1 hour'
     THEN sp.market_end_at ELSE (coalesce(sp.actual_end_date,sp.end_date)+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<n.period_end)$c$;
  fn_needle constant text := $n$where c.company_id=p_company_id and c.id=v_underlay.contract_id and c.status in ('active','signed');$n$;
  view_needle constant text := $n$(c.status = ANY (ARRAY['signed'::text, 'active'::text]))$n$;
  gate_src text;
  store_src text;
  fn_replacement text;
  view_replacement text;
  f record;
  v record;
  body text;
  definition text;
  target regprocedure;
begin
  -- The reused rule must be the installed gate's and store's own text (20261022150000, 20261023196000).
  select p.prosrc into strict gate_src from pg_proc p where p.oid = 'public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)'::regprocedure;
  select p.prosrc into strict store_src from pg_proc p where p.oid = 'public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure;
  if position(status_clause in gate_src) = 0 or position(status_clause in store_src) = 0
    or position(start_clause in gate_src) = 0 or position(end_clause in gate_src) = 0 then
    raise exception 'final_month_pricing_contract_rule_source_changed' using errcode = 'P0U01';
  end if;

  fn_replacement := $r$where c.company_id=p_company_id and c.id=v_underlay.contract_id and (c.status in ('active','signed')
    -- H3 (20261023199000): a contract terminated by exactly this underlay's supply end still carries its final period,
    -- by the rule of gridex_set_metering_billing_gate/gridex_store_billing_underlay (text-identical, n.period_* = v_period_*).
    or exists(select 1 from public.customer_supply_periods sp join public.customer_contracts ct on ct.id=c.id and ct.company_id=p_company_id
      where sp.id=v_underlay.supply_period_id and sp.company_id=p_company_id and sp.contract_id=ct.id
        and sp.customer_id=v_underlay.customer_id and sp.metering_point_id=v_underlay.metering_point_id
        and ct.customer_id=v_underlay.customer_id and ct.metering_point_id=v_underlay.metering_point_id
        and NOT (@status@)
        and NOT (@start@)
        and NOT @end@));$r$;
  fn_replacement := replace(replace(replace(fn_replacement, '@status@', status_clause),
    '@start@', replace(start_clause, 'n.period_start', 'v_period_start')),
    '@end@', replace(end_clause, 'n.period_end', 'v_period_end'));

  foreach target in array array[
    'public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,jsonb)'::regprocedure,
    'public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure]
  loop
    select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
    from pg_proc p where p.oid = target;
    if (length(f.prosrc) - length(replace(f.prosrc, fn_needle, ''))) / length(fn_needle) <> 1
      or position('Match engine.normalizePricingSnapshot and its interval-resolution fallback.' in f.prosrc) = 0
      or position('v_period_end' in f.prosrc) = 0
      or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
      raise exception 'final_month_pricing_contract_predecessor_required:%', target using errcode = 'P0U01';
    end if;
    body := replace(f.prosrc, fn_needle, fn_replacement);
    execute replace(f.definition, f.prosrc, body);
    if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
      or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
      raise exception 'final_month_pricing_contract_metadata_changed:%', target using errcode = 'P0U01';
    end if;
  end loop;

  -- billing_export_readiness_v: the billed period is the underlay's locked pricing run period.
  view_replacement := $r$((c.status = ANY (ARRAY['signed'::text, 'active'::text]))
    OR EXISTS (SELECT 1 FROM public.customer_supply_periods sp JOIN public.customer_contracts ct ON ct.id = c.id AND ct.company_id = b.company_id
      JOIN public.pricing_runs n ON n.company_id = b.company_id AND n.billing_underlay_id = b.id AND n.status = 'locked'
      WHERE sp.id = b.supply_period_id AND sp.company_id = b.company_id AND sp.contract_id = ct.id
        AND sp.customer_id = b.customer_id AND sp.metering_point_id = b.metering_point_id
        AND ct.customer_id = b.customer_id AND ct.metering_point_id = b.metering_point_id
        AND NOT (@status@)
        AND NOT (@start@)
        AND NOT @end@))$r$;
  view_replacement := replace(replace(replace(view_replacement, '@status@', status_clause),
    '@start@', replace(start_clause, 'n.period_start', 'n.billing_period_start')),
    '@end@', replace(end_clause, 'n.period_end', 'n.billing_period_end'));

  select c.oid, c.relowner, c.relacl, c.reloptions, pg_get_viewdef(c.oid) as definition,
    (select jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod)) order by a.attnum)
       from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns
    into strict v
  from pg_class c where c.oid = 'public.billing_export_readiness_v'::regclass and c.relkind = 'v';
  if (length(v.definition) - length(replace(v.definition, view_needle, ''))) / length(view_needle) <> 1
    or position('exact_signed_contract_missing' in v.definition) = 0
    or position('LEFT JOIN customer_contracts c ON' in v.definition) = 0 then
    raise exception 'final_month_pricing_contract_predecessor_required:billing_export_readiness_v' using errcode = 'P0U01';
  end if;
  definition := regexp_replace(replace(v.definition, view_needle, view_replacement), ';\s*$', '');
  execute format('create or replace view public.billing_export_readiness_v%s as %s',
    case when v.reloptions is null then '' else ' with (' || array_to_string(v.reloptions, ', ') || ')' end, definition);
  if (select row(c.relowner, c.relacl, c.reloptions) from pg_class c where c.oid = v.oid) is distinct from row(v.relowner, v.relacl, v.reloptions)
    or (select jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod)) order by a.attnum)
          from pg_attribute a where a.attrelid = v.oid and a.attnum > 0 and not a.attisdropped) is distinct from v.columns
    or position('supply_period_id' in pg_get_viewdef(v.oid)) = 0 then
    raise exception 'final_month_pricing_contract_metadata_changed:billing_export_readiness_v' using errcode = 'P0U01';
  end if;
end
$h3p$;

commit;
