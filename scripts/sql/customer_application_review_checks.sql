-- Customer application review checks after payload tests.
-- Uses recipient_email/sender_email, not old outbound address aliases.

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
  error_stage,
  error_code,
  error_message,
  created_at
from public.website_customer_applications
order by created_at desc
limit 20;

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

select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.customers'::regclass
  and conname = 'customers_intake_status_check';

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
