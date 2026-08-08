-- Clean-replay prerequisite derived from 20260519_final_saas_hardening.sql.
-- Restore only the company contact field required by later canonical tenant-mail views.
alter table if exists public.companies
  add column if not exists primary_contact_email text;
