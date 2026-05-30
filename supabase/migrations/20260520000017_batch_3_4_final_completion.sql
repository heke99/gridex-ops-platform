-- Batch 3+4 Final Completion: automatic inbound PRODAT links, metering permission matching, export files and tenant usage support.
-- Idempotent and SaaS-safe. Does not alter approved Ediel payload rules.

create index if not exists metering_permission_sites_company_status_facility_idx
  on public.metering_permission_sites(company_id, status, facility_id, grid_area_code);

create index if not exists customer_info_requests_company_customer_status_idx
  on public.customer_info_requests(company_id, customer_id, status, created_at desc);

create index if not exists billing_export_run_items_company_run_status_idx
  on public.billing_export_run_items(company_id, billing_export_run_id, status);

create index if not exists partner_exports_company_batch_idx
  on public.partner_exports(company_id, export_batch_key, status, created_at desc);

do $$
begin
  if to_regclass('public.billing_export_runs') is not null then
    alter table public.billing_export_runs add column if not exists metadata jsonb not null default '{}'::jsonb;
    alter table public.billing_export_runs add column if not exists updated_at timestamptz not null default now();
  end if;
end $$;
