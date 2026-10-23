-- FINDINGS F108 (reality world 2026-10-23), owner decision 2026-10-23: the billing month of a supply that rests on
-- received Ediel market messages (customer_supply_periods.market_start_at/market_end_at) is the Ediel month, from
-- 00:00 fixed Swedish normal time (UTC+1, ENV-08) on the 1st to 00:00 +0100 on the next 1st. September 2026 is
-- [2026-08-31T23:00Z, 2026-09-30T23:00Z). Manual/legacy dates without an Ediel instant stay Swedish civil midnight.
-- The billing code (lib/billing/billingMonth.ts, underlayEngine.ts, billingGate.ts) now builds such segments; the
-- database billing boundary must accept exactly them:
--
--   M5  gridex_set_metering_billing_gate ended a received exclusive Z05 end at civil midnight of its end date
--       (22:00Z in summer), so the last hour 22:00Z-23:00Z before a Z05 end on the 1st was refused, although the
--       qualified supply basis (billing_supply_basis_v1: value end <= market_end_at) holds it. The exclusive received
--       end now ends at market_end_at itself. A manual end and a market end during the day are unchanged.
--   H2/H3 variant  gridex_store_billing_underlay still accepted only 'active'/'confirmed_by_grid_owner' periods and
--       'signed'/'active' contracts. 20261022150000 opened the value gate for 'ending'/'ended' periods and for a
--       contract terminated by exactly this supply end (owner decision 2026-10-22), but a ready underlay of such a
--       period (every final month after a Z05) was refused here with 23514, which is not the finalized-correction
--       refusal, so the tenant's whole monthly underlay batch failed. The store now applies the same rule as the gate
--       (identical text); the qualified supply basis below it is unchanged and still decides.
--   Ediel month end of business dates  A contract end (ends_at/end_date) or a price snapshot's valid_to that ends a
--       billing month ended at civil midnight (22:00Z in summer), i.e. one hour before the Ediel month an
--       Ediel-qualified period is billed for; a ready September underlay with a price valid to 30 September would
--       again fail the whole batch. For an Ediel-qualified period such a date now ends at the later of civil
--       midnight and 00:00 +0100. Never earlier than before; periods without a market instant are unchanged.
--
-- Not changed (M7, established 2026-10-23): the five received-source functions that read 'Etc/GMT-1'
-- (confirm_closure_end_v1, confirm_h_end_v1, apply_supply_before_legal_context_v1, other_supply_scope_effect_v1,
-- supply_rescission.confirm_end_v1) convert (a) the receipt instant of an Ediel message to its Ediel business date
-- for registry validity and (b) a start_date that equals the received PRODAT start (permission_date_v1) to its
-- market instant; both are Ediel sources, so fixed normal time is correct per ENV-08.
--
-- Exact-needle body rewrites of the installed bodies (the gate is the 20261022150000 body); tenant scope,
-- service-role requirement, source bases, identity checks, owner, ACL, security mode and configuration are preserved
-- and checked.
begin;

do $f108$
declare
  f record;
  body text;
  target record;
begin
  for target in
    select * from (values
      (1, 'public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)'::regprocedure,
       $n$(coalesce(sp.actual_end_date,sp.end_date) IS NOT NULL AND ((CASE
     -- H1: a received market end at the start of its date is exclusive (end_date = first day not supplied).
     WHEN sp.market_end_at IS NOT NULL AND sp.market_end_at<=(coalesce(sp.actual_end_date,sp.end_date)::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '1 hour'
     THEN coalesce(sp.actual_end_date,sp.end_date) ELSE coalesce(sp.actual_end_date,sp.end_date)+1 END)::timestamp AT TIME ZONE 'Europe/Stockholm')<n.period_end)$n$,
       $r$(coalesce(sp.actual_end_date,sp.end_date) IS NOT NULL AND (CASE
     -- H1: a received market end at the start of its date is exclusive (end_date = first day not supplied).
     -- F108 M5: it ends at the market instant itself (00:00 +0100, 23:00Z in summer), as the qualified supply basis.
     WHEN sp.market_end_at IS NOT NULL AND sp.market_end_at<=(coalesce(sp.actual_end_date,sp.end_date)::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '1 hour'
     THEN sp.market_end_at ELSE (coalesce(sp.actual_end_date,sp.end_date)+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<n.period_end)$r$,
       'H3: a contract ended by exactly this period''s end'),
      (2, 'public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)'::regprocedure,
       $n$(nullif(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),'') IS NOT NULL AND ((left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm')<n.period_end)$n$,
       $r$(nullif(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),'') IS NOT NULL AND (CASE WHEN sp.market_start_at IS NOT NULL OR sp.market_end_at IS NOT NULL
     -- F108: on an Ediel-qualified supply the contract's last day also covers the end of its Ediel month.
     THEN GREATEST((left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm',(left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Etc/GMT-1')
     ELSE (left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<n.period_end)$r$,
       'F108 M5: it ends at the market instant itself'),
      (3, 'public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure,
       $n$NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner'),false) OR NOT coalesce(ct.status IN ('signed','active'),false)$n$,
       $r$NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner','ending','ended'),false)
   OR (sp.status IN ('ending','ended') AND coalesce(sp.actual_end_date,sp.end_date) IS NULL)
   -- H3: a contract ended by exactly this period's end still carries the period up to that end.
   OR NOT coalesce(ct.status IN ('signed','active') OR (ct.status='terminated' AND ct.termination_reason='supply_end' AND sp.end_date IS NOT NULL AND ct.ended_at IS NOT NULL
    AND ((ct.ended_at AT TIME ZONE 'UTC')::date=sp.end_date OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date=sp.end_date)),false)$r$,
       'billing_underlay_qualified_supply_source_required'),
      (4, 'public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure,
       $n$(price.valid_to IS NOT NULL AND ((price.valid_to+1)::timestamp AT TIME ZONE 'Europe/Stockholm')<end_at)$n$,
       $r$(price.valid_to IS NOT NULL AND (CASE WHEN sp.market_start_at IS NOT NULL OR sp.market_end_at IS NOT NULL
     -- F108: on an Ediel-qualified supply the price's last day also covers the end of its Ediel month.
     THEN GREATEST((price.valid_to+1)::timestamp AT TIME ZONE 'Europe/Stockholm',(price.valid_to+1)::timestamp AT TIME ZONE 'Etc/GMT-1')
     ELSE (price.valid_to+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<end_at)$r$,
       'H3: a contract ended by exactly this period''s end'),
      (5, 'public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure,
       $n$(nullif(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),'') IS NOT NULL AND ((left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm')<end_at)$n$,
       $r$(nullif(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),'') IS NOT NULL AND (CASE WHEN sp.market_start_at IS NOT NULL OR sp.market_end_at IS NOT NULL
     -- F108: on an Ediel-qualified supply the contract's last day also covers the end of its Ediel month.
     THEN GREATEST((left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm',(left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Etc/GMT-1')
     ELSE (left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<end_at)$r$,
       'F108: on an Ediel-qualified supply the price''s last day')
    ) as t(step, signature, needle, replacement, marker)
    order by step
  loop
    select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
    from pg_proc p where p.oid = target.signature;
    if (length(f.prosrc) - length(replace(f.prosrc, target.needle, ''))) / length(target.needle) <> 1
      or position(target.marker in f.prosrc) = 0
      or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
      raise exception 'f108_ediel_billing_month_predecessor_required:%:%', target.step, target.signature using errcode = 'P0U01';
    end if;
    body := replace(f.prosrc, target.needle, target.replacement);
    execute replace(f.definition, f.prosrc, body);
    if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
      or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
      raise exception 'f108_ediel_billing_month_metadata_changed:%:%', target.step, target.signature using errcode = 'P0U01';
    end if;
  end loop;
end
$f108$;

commit;
