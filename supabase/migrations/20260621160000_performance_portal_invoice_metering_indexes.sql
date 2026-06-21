-- Performance: tenant-scoped composite indexes for the customer portal bundle.
--
-- Scope: add ONLY the two indexes that an audit found are missing for real,
-- hot portal-bundle queries. Every other portal/list/queue query is already
-- covered by existing indexes (see audit report), so no duplicates are added.
--
-- Queries supported:
--   1) lib/customer-portal/apiData.ts :: listPortalInvoices
--        from('customer_invoices')
--          .eq('company_id', ...).eq('customer_id', ...)
--          .order('period_start', { ascending: false }).limit(100)
--      -> public.customer_invoices(company_id, customer_id, period_start desc)
--
--   2) lib/customer-portal/apiData.ts :: listPortalMeteringValues
--        from('normalized_metering_values')
--          .eq('company_id', ...).eq('customer_id', ...)
--          .order('period_start', { ascending: false }).limit(500)
--      The existing normalized_metering_values_company_customer_month_idx is
--      (company_id, customer_id, metering_point_id, period_start) — the
--      metering_point_id column between the equality keys and the sort key
--      prevents an index-ordered scan for this per-customer query. A dedicated
--      (company_id, customer_id, period_start desc) index serves it directly.
--      -> public.normalized_metering_values(company_id, customer_id, period_start desc)
--
-- Migration style note: this project applies migrations transactionally, so
-- CREATE INDEX CONCURRENTLY (which cannot run inside a transaction block) is
-- intentionally NOT used here, consistent with all existing migrations. Each
-- index is created idempotently and guarded by table/column existence checks so
-- it is safe across schema variants.

set statement_timeout = '120s';
set lock_timeout = '5s';

do $$
begin
  if to_regclass('public.customer_invoices') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'customer_invoices' and column_name = 'company_id'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'customer_invoices' and column_name = 'customer_id'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'customer_invoices' and column_name = 'period_start'
     )
  then
    execute 'create index if not exists customer_invoices_company_customer_period_perf_idx '
         || 'on public.customer_invoices(company_id, customer_id, period_start desc)';
  end if;
end $$;

do $$
begin
  if to_regclass('public.normalized_metering_values') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'normalized_metering_values' and column_name = 'company_id'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'normalized_metering_values' and column_name = 'customer_id'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'normalized_metering_values' and column_name = 'period_start'
     )
  then
    execute 'create index if not exists normalized_metering_values_company_customer_period_perf_idx '
         || 'on public.normalized_metering_values(company_id, customer_id, period_start desc)';
  end if;
end $$;
