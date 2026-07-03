-- Production consistency checks (spec §42).
-- Read-only diagnostics for DBAs. The same logic runs in the app via
-- lib/ops/reconciliation.ts and is surfaced on /admin/system-health.
-- Run each block separately; replace :company_id or remove the filter to scan all tenants.

-- 1) Active contracts without customer or site
select id, company_id, status, customer_id, coalesce(customer_site_id, site_id) as site_ref
from public.customer_contracts
where status in ('active', 'signed')
  and (customer_id is null or coalesce(customer_site_id, site_id) is null)
-- and company_id = :company_id
limit 100;

-- 2) Active contracts whose site is missing an SE price area
select c.id as contract_id, c.company_id, s.id as site_id, s.price_area_code
from public.customer_contracts c
join public.customer_sites s on s.id = coalesce(c.customer_site_id, c.site_id)
where c.status in ('active', 'signed')
  and (s.price_area_code is null or s.price_area_code not in ('SE1','SE2','SE3','SE4'))
-- and c.company_id = :company_id
limit 100;

-- 3) Active contracts without a contract price snapshot
select c.id as contract_id, c.company_id
from public.customer_contracts c
left join public.contract_price_snapshots snap on snap.contract_id = c.id and snap.company_id = c.company_id
where c.status in ('active', 'signed')
  and snap.id is null
-- and c.company_id = :company_id
limit 100;

-- 4) Open supplier switches whose site lacks metering point or grid owner
select ssr.id as switch_id, ssr.company_id, ssr.status,
       s.id as site_id, s.grid_owner_id,
       (select count(*) from public.metering_points mp where mp.site_id = s.id) as metering_points
from public.supplier_switch_requests ssr
left join public.customer_sites s on s.id = coalesce(ssr.customer_site_id, ssr.site_id)
where ssr.status in ('draft','ready','queued','sending','sent','pending','in_progress','awaiting_response')
  and (s.id is null
       or s.grid_owner_id is null
       or not exists (select 1 from public.metering_points mp where mp.site_id = s.id))
-- and ssr.company_id = :company_id
limit 100;

-- 5) Invoice export runs where the item counts do not match the run bookkeeping
select r.id as export_run_id, r.company_id, r.sent_items as recorded_sent,
       count(*) filter (where i.status in ('sent','credited')) as actual_sent,
       count(*) as total_items
from public.invoice_export_runs r
join public.invoice_export_items i on i.export_run_id = r.id and i.company_id = r.company_id
group by r.id, r.company_id, r.sent_items
having r.sent_items <> count(*) filter (where i.status in ('sent','credited'))
-- and r.company_id = :company_id
limit 100;

-- 6) Sent invoice export items without a provider invoice guid
select id, company_id, export_run_id, sent_at
from public.invoice_export_items
where status = 'sent' and provider_invoice_guid is null
-- and company_id = :company_id
limit 100;

-- 7) Duplicate billing underlays per contract (or metering point) and period
select company_id,
       coalesce(contract_id::text, 'mp:' || coalesce(metering_point_id::text, 'unknown')) as anchor,
       underlay_year, underlay_month, count(*) as underlays, array_agg(id) as ids
from public.billing_underlays
group by company_id, anchor, underlay_year, underlay_month
having count(*) > 1
-- and company_id = :company_id
limit 100;

-- 8) Duplicate active pricing runs per underlay (should be prevented by
--    pricing_runs_active_per_underlay_uidx after Migration B)
select company_id, billing_underlay_id, count(*) as active_runs, array_agg(id) as run_ids
from public.pricing_runs
where billing_underlay_id is not null and status in ('success', 'locked')
group by company_id, billing_underlay_id
having count(*) > 1
limit 100;

-- 9) Invoice export retry backlog (retry cron liveness)
select id, company_id, next_retry_at, attempt_count, error_code
from public.invoice_export_items
where status = 'failed_retryable' and next_retry_at < now() - interval '1 hour'
order by next_retry_at
limit 100;

-- 10) Provider events stuck unprocessed
select id, provider, event_type, status, received_at
from public.invoice_provider_events
where status in ('received', 'needs_review')
order by received_at
limit 100;
