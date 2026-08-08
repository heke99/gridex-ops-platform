-- Clean-replay prerequisite derived from 20260519_final_saas_hardening.sql.
-- Restore only the source-defined company contact fields required by later canonical
-- tenant-mail and legal-profile flows.
alter table if exists public.companies
  add column if not exists primary_contact_email text,
  add column if not exists primary_contact_name text,
  add column if not exists phone text,
  add column if not exists website text;
