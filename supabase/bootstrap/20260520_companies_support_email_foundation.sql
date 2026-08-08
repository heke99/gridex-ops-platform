-- Clean-replay prerequisite derived from 20260520_batch_6e_rbac_tenant_stats_whitelabel.sql.
-- Restore only the company contact fields required by later canonical tenant-mail and legal-profile flows.
alter table if exists public.companies
  add column if not exists support_email text null,
  add column if not exists billing_contact_email text null;
