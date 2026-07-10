-- Website customer application idempotency hardening and supplier context.
--
-- 1. Reserve an idempotency key before side effects by allowing the transient
--    processing status.
-- 2. Persist the incoming current supplier Ediel identifier on customer_sites.
-- 3. Keep payload_hash available for strict same-key/same-payload enforcement.

alter table public.website_customer_applications
  add column if not exists payload_hash text null,
  add column if not exists business_key_hash text null;

alter table public.customer_sites
  add column if not exists current_supplier_ediel_id text null;

alter table public.supplier_switch_requests
  add column if not exists current_supplier_ediel_id text null;

comment on column public.website_customer_applications.payload_hash is
  'SHA-256 of the normalized website application payload. The same Idempotency-Key may only be replayed with the same hash.';

comment on column public.website_customer_applications.business_key_hash is
  'SHA-256 of external customer + site identity + offer + requested start date. Prevents parallel applications for the same business event under new idempotency keys.';

comment on column public.customer_sites.current_supplier_ediel_id is
  'Ediel identifier for the customer current electricity supplier when supplied by an external website or tenant.';

comment on column public.supplier_switch_requests.current_supplier_ediel_id is
  'Snapshot of the current supplier Ediel identifier used when the supplier switch request was created or reconciled.';

alter table public.website_customer_applications
  drop constraint if exists website_customer_applications_status_check;

alter table public.website_customer_applications
  add constraint website_customer_applications_status_check check (
    status in (
      'processing',
      'received','customer_created','customer_matched','contract_created','confirmation_pending','confirmation_sent',
      'cooling_off_sent','webhook_pending','completed','application_received','linked_existing_customer',
      'needs_address_resolution','address_resolved','grid_area_resolved','needs_facility_data',
      'information_request_ready','information_request_sent','waiting_grid_owner_response','facility_data_received',
      'needs_information','pending_validation','ready_for_switch','switch_requested','switch_confirmed','switch_rejected',
      'active','pending_review','manual_review','rejected','failed','cancelled',
      'facility_data_invalid','customer_information_mismatch','grid_owner_rejected_request','negative_aperak_received',
      'z02_rejected','needs_customer_correction','needs_grid_owner_followup','protected_identity',
      'duplicate_facility_id','cross_tenant_facility_conflict',
      'partial','repaired'
    )
  );

create index if not exists idx_website_customer_applications_payload_hash
  on public.website_customer_applications(company_id, external_customer_id, payload_hash, created_at desc)
  where payload_hash is not null;

create index if not exists idx_website_customer_applications_business_key_hash
  on public.website_customer_applications(company_id, business_key_hash, created_at desc)
  where business_key_hash is not null;

create unique index if not exists website_customer_applications_company_business_event_uidx
  on public.website_customer_applications(company_id, business_key_hash)
  where business_key_hash is not null
    and status in (
      'processing','received','application_received','customer_created','customer_matched','contract_created',
      'confirmation_pending','confirmation_sent','cooling_off_sent','webhook_pending','completed',
      'linked_existing_customer','needs_address_resolution','address_resolved','grid_area_resolved',
      'needs_facility_data','information_request_ready','information_request_sent','waiting_grid_owner_response',
      'facility_data_received','needs_information','pending_validation','pending_review','manual_review',
      'ready_for_switch','switch_requested','switch_confirmed','active','repaired'
    );
