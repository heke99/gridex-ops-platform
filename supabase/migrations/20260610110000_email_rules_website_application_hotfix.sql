-- Hotfix: prevent legacy customer onboarding mail rules from sending duplicate emails.
-- Gridex is the source of truth for the six scoped customer mail templates.

insert into public.email_event_rules (
  company_id,
  event_key,
  template_key,
  enabled,
  delay_minutes,
  send_to_customer,
  send_to_admin,
  updated_at
)
select
  ces.company_id,
  rule.event_key,
  rule.template_key,
  true,
  0,
  true,
  false,
  now()
from public.company_email_settings ces
cross join (values
  ('contract.application_received', 'contract.application_received'),
  ('support.case_message', 'support.case_message'),
  ('switch.started', 'switch.started'),
  ('switch.confirmed', 'switch.confirmed'),
  ('switch.action_required', 'switch.action_required'),
  ('customer.welcome_active', 'customer.welcome_active')
) as rule(event_key, template_key)
on conflict (company_id, event_key, template_key) do update set
  enabled = true,
  send_to_customer = true,
  updated_at = now();

update public.email_event_rules
set
  enabled = false,
  updated_at = now()
where template_key in ('contract_confirmation', 'cancellation_right', 'cancellation_right_started')
  and event_key in (
    'contract.application_received',
    'contract.confirmation_sent',
    'contract.cooling_off_sent',
    'cancellation_right_started'
  );

-- Safety: old event aliases must not have active customer sends in the limited customer-mail scope.
update public.email_event_rules
set
  enabled = false,
  updated_at = now()
where event_key in ('contract.confirmation_sent', 'contract.cooling_off_sent')
  and template_key not in (
    'contract.application_received',
    'support.case_message',
    'switch.started',
    'switch.confirmed',
    'switch.action_required',
    'customer.welcome_active'
  );
