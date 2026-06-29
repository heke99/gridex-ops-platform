-- Website customer application: allow 'partial' and 'repaired' statuses.
--
-- A failure that happens after the application row already exists (for example a
-- power-of-attorney failure that occurs after the customer/site/contract were
-- provisioned) is a partial success, not a clean failure. The intake now marks
-- such rows 'partial' and the platform repair helper marks fixed rows
-- 'repaired'. This migration widens the status CHECK to permit those values.
--
-- Non-destructive: the constraint is dropped and recreated with the existing
-- values plus the two new ones. No data is changed.

alter table public.website_customer_applications drop constraint if exists website_customer_applications_status_check;
alter table public.website_customer_applications
  add constraint website_customer_applications_status_check check (
    status in (
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
