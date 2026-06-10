-- Customer application review checks after payload tests.
-- Uses live Gridex table/column names: grid_owners and communication_logs.recipient_email.

-- 1) Latest customer applications and repair state.
select
  id,
  external_customer_id,
  customer_number,
  status,
  missing_fields,
  blocking_reasons,
  next_step,
  requested_start_date,
  confirmed_start_date,
  actual_start_date,
  customer_id,
  customer_site_id,
  metering_point_id,
  contract_id,
  error_stage,
  error_code,
  error_message,
  created_at
from public.website_customer_applications
order by created_at desc
limit 20;

-- 2) Communication logs. First customer intake may send contract.application_received only.
select
  event_key,
  template_key,
  status,
  recipient_email,
  sender_email,
  provider_message_id,
  error_message,
  created_at
from public.communication_logs
order by created_at desc
limit 20;

-- 3) Customer intake status constraint must not include website application lifecycle values.
select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.customers'::regclass
  and conname = 'customers_intake_status_check';

-- 4) Contract source_type constraint must accept website_application.
select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.customer_contracts'::regclass
  and conname = 'customer_contracts_source_type_check';

-- 5) Latest website-created customer contracts.
select
  id,
  company_id,
  customer_id,
  customer_site_id,
  site_id,
  metering_point_id,
  source_type,
  agreement_channel,
  status,
  contract_name,
  contract_type,
  starts_at,
  requested_start_date,
  confirmed_start_date,
  actual_start_date,
  created_at
from public.customer_contracts
where source_type in ('website_application','website_application_review')
order by created_at desc
limit 20;

-- 6) Customer intake flags.
select
  id,
  customer_number,
  intake_status,
  intake_missing_fields,
  intake_quality_score,
  intake_warnings,
  updated_at
from public.customers
order by updated_at desc nulls last
limit 20;

-- 7) Verified grid owners to use in payload tests.
select
  id,
  name,
  ediel_id,
  owner_code,
  is_active
from public.grid_owners
order by name
limit 20;

-- 8) Active price plans to use in payload tests.
select
  id,
  name,
  status
from public.price_plans
where status = 'active'
order by created_at desc nulls last
limit 20;
