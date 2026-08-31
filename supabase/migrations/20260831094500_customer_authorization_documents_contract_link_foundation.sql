-- Restore the canonical contract link used by signed agreement imports.
--
-- Production already has customer_contract_id on customer_authorization_documents,
-- but the clean migration history did not materialize that live-schema column.
-- The following 09:50 migration installs the signed-agreement finalization trigger
-- and therefore requires this column to exist on a database built from zero.
--
-- Keep this forward-only and idempotent. Tenant/customer/contract ownership is
-- enforced inside gridex_finalize_admin_imported_signed_agreement_v1 before any
-- contract evidence is finalized.

alter table if exists public.customer_authorization_documents
  add column if not exists customer_contract_id uuid;

create index if not exists customer_authorization_documents_contract_idx
  on public.customer_authorization_documents(customer_contract_id)
  where customer_contract_id is not null;

comment on column public.customer_authorization_documents.customer_contract_id is
  'Optional customer contract bound to an uploaded authorization/agreement document; canonical signed imports verify company/customer/contract ownership before finalization.';
