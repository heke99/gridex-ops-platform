-- Clean-replay prerequisite derived from 20260520_batch_6e_rbac_tenant_stats_whitelabel.sql.
-- Restore only the company support field required by later canonical tenant-mail views.
alter table if exists public.companies
  add column if not exists support_email text null;
