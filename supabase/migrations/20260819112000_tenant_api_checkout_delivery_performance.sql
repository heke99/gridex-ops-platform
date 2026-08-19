-- Tenant website/API checkout and delivery performance hardening.
-- Forward-only and additive: no public data contract is removed here.

create index if not exists tenant_website_installation_receipts_auth_ready_idx
  on public.tenant_website_installation_receipts
  (api_client_id, company_id, profile_key, state)
  include (id, completed_at, receipt_sha256)
  where profile_key = 'tenant_website' and state = 'completed';

create index if not exists tenant_email_outbox_company_communication_log_idx
  on public.tenant_email_outbox
  (company_id, communication_log_id)
  include (status, attempts, max_attempts, next_attempt_at, sent_at, failed_at, updated_at)
  where communication_log_id is not null;

-- The status endpoint resolves one application by tenant + public application number.
-- Keep this explicit even if an earlier migration already materialized the same
-- lookup shape; IF NOT EXISTS makes the migration safe across reconstructed DBs.
create unique index if not exists website_customer_applications_company_application_number_uidx
  on public.website_customer_applications(company_id, application_number)
  where application_number is not null;

comment on index public.tenant_website_installation_receipts_auth_ready_idx is
  'Hot-path support for authenticate_integration_request_v1 tenant website launch receipt validation.';

comment on index public.tenant_email_outbox_company_communication_log_idx is
  'Hot-path support for tenant website application status and confirmation-email delivery projection.';
