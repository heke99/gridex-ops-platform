-- Tenant email outbox dispatcher hardening.
-- Unifies customer/tenant email around the existing tenant_email_outbox schema,
-- links rows to communication_logs, adds safe processing state/retry indexes and
-- makes dispatch readiness match the backend sender policy.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.tenant_email_outbox') is not null then
    alter table public.tenant_email_outbox add column if not exists communication_log_id uuid null;
    alter table public.tenant_email_outbox add column if not exists attempts integer not null default 0;
    alter table public.tenant_email_outbox add column if not exists max_attempts integer not null default 5;
    alter table public.tenant_email_outbox add column if not exists next_attempt_at timestamptz null;
    alter table public.tenant_email_outbox add column if not exists dead_letter_at timestamptz null;
    alter table public.tenant_email_outbox add column if not exists last_error text null;
    alter table public.tenant_email_outbox add column if not exists request_id text null;
    alter table public.tenant_email_outbox add column if not exists trace_id text null;

    alter table public.tenant_email_outbox drop constraint if exists tenant_email_outbox_status_check;
    alter table public.tenant_email_outbox
      add constraint tenant_email_outbox_status_check
      check (status in ('queued', 'processing', 'sent', 'failed', 'cancelled'));

    update public.tenant_email_outbox
    set next_attempt_at = coalesce(next_attempt_at, created_at, now()),
        attempts = coalesce(attempts, 0),
        max_attempts = greatest(coalesce(max_attempts, 5), 1),
        updated_at = now()
    where status = 'queued'
      and (next_attempt_at is null or attempts is null or max_attempts is null);

    if to_regclass('public.communication_logs') is not null and not exists (
      select 1 from pg_constraint where conname = 'tenant_email_outbox_communication_log_id_fkey'
    ) then
      alter table public.tenant_email_outbox
        add constraint tenant_email_outbox_communication_log_id_fkey
        foreign key (communication_log_id) references public.communication_logs(id) on delete set null;
    end if;
  end if;
end $$;

create index if not exists tenant_email_outbox_due_idx
  on public.tenant_email_outbox(status, next_attempt_at, created_at)
  where status in ('queued', 'processing');

create index if not exists tenant_email_outbox_communication_log_idx
  on public.tenant_email_outbox(communication_log_id)
  where communication_log_id is not null;

create or replace view public.tenant_event_mail_readiness_v as
with base as (
  select
    c.id as company_id,
    c.name as company_name,
    coalesce(s.sender_email, c.primary_contact_email, c.support_email) as sender_email,
    coalesce(s.sender_name, c.name) as sender_name,
    coalesce(s.verification_status, 'not_started') as sender_verification_status,
    coalesce(s.is_active, true) as sender_is_active,
    coalesce(s.fallback_allowed, s.id is null) as fallback_allowed,
    count(distinct t.id) filter (where t.is_active = true) as active_templates,
    count(distinct r.id) filter (where r.enabled = true and coalesce(r.is_active, true) = true) as enabled_event_rules,
    (
      coalesce(s.is_active, true) = true
      and lower(coalesce(s.verification_status, '')) in ('verified', 'active', 'ready')
      and nullif(coalesce(s.sender_email, ''), '') is not null
      and nullif(coalesce(s.sender_name, c.name, ''), '') is not null
    ) as has_verified_sender,
    (
      coalesce(s.is_active, true) = true
      and coalesce(s.fallback_allowed, s.id is null) = true
    ) as fallback_permitted,
    s.id as settings_id
  from public.companies c
  left join public.company_email_settings s on s.company_id = c.id
  left join public.company_email_templates t on t.company_id = c.id
  left join public.email_event_rules r on r.company_id = c.id
  group by c.id, c.name, c.primary_contact_email, c.support_email, s.id, s.sender_email, s.sender_name, s.verification_status, s.is_active, s.fallback_allowed
)
select
  company_id,
  company_name,
  sender_email,
  sender_name,
  sender_verification_status,
  sender_is_active,
  fallback_allowed,
  active_templates,
  enabled_event_rules,
  (
    active_templates > 0
    and enabled_event_rules > 0
    and sender_is_active = true
    and (has_verified_sender = true or fallback_permitted = true)
  ) as can_send_customer_mail,
  array_remove(array[
    case when settings_id is not null and sender_is_active = false then 'mail_sender_inactive' end,
    case when has_verified_sender = false and fallback_permitted = false then 'mail_sender_not_verified_or_fallback_disabled' end,
    case when has_verified_sender = false and fallback_permitted = true then 'platform_fallback_sender_required' end,
    case when active_templates = 0 then 'mail_template_missing' end,
    case when enabled_event_rules = 0 then 'mail_event_rules_missing' end
  ], null) as blockers
from base;

create or replace view public.gridex_tenant_email_dispatch_readiness_v as
with canonical_rules(event_key, template_key, event_label, legal_or_critical) as (
  values
    ('contract.application_received', 'contract.application_received', 'Ansökan mottagen', false),
    ('contract.confirmation_sent', 'contract.confirmation_sent', 'Avtalsbekräftelse', true),
    ('contract.cooling_off_sent', 'contract.cooling_off_sent', 'Ångerrätt', true),
    ('switch.started', 'switch.started', 'Leverantörsbyte startat', true),
    ('switch.confirmed', 'switch.confirmed', 'Leverantörsbyte bekräftat', true),
    ('switch.action_required', 'switch.action_required', 'Komplettering behövs', true),
    ('customer.welcome_active', 'customer.welcome_active', 'Välkommen som kund', true)
), raw as (
  select
    c.id as company_id,
    c.name as company_name,
    cr.event_key,
    cr.template_key,
    cr.event_label,
    cr.legal_or_critical,
    coalesce(e.enabled, true) as enabled,
    coalesce(e.is_active, e.enabled, true) as rule_active,
    t.id as template_id,
    coalesce(t.name, cr.event_label) as template_name,
    t.subject,
    t.body_html,
    t.body_text,
    coalesce(t.is_active, false) as template_active,
    s.id as settings_id,
    s.sender_name,
    s.sender_email,
    s.reply_to_email,
    s.domain,
    coalesce(s.verification_status, 'not_started') as domain_status,
    coalesce(s.is_active, true) as sender_is_active,
    coalesce(s.fallback_allowed, s.id is null) as fallback_allowed,
    coalesce(s.sender_mode, 'fallback_platform_sender') as sender_mode,
    coalesce(s.block_legal_mail_when_unverified, true) as block_legal_mail_when_unverified,
    coalesce(e.updated_at, t.updated_at) as event_rule_updated_at,
    t.updated_at as template_updated_at
  from public.companies c
  cross join canonical_rules cr
  left join public.email_event_rules e on e.company_id = c.id and e.event_key = cr.event_key and e.template_key = cr.template_key
  left join public.company_email_templates t on t.company_id = c.id and t.template_key = cr.template_key and t.language = 'sv'
  left join public.company_email_settings s on s.company_id = c.id
), evaluated as (
  select
    raw.*,
    (
      sender_is_active = true
      and lower(coalesce(domain_status, '')) in ('verified', 'active', 'ready')
      and nullif(coalesce(sender_email, ''), '') is not null
      and nullif(coalesce(sender_name, ''), '') is not null
    ) as has_verified_sender,
    (
      sender_is_active = true
      and fallback_allowed = true
      and sender_mode <> 'disabled'
    ) as fallback_permitted
  from raw
)
select
  company_id,
  company_name,
  event_key,
  template_key,
  enabled,
  template_id,
  template_name,
  subject,
  template_active,
  sender_email,
  reply_to_email,
  domain,
  domain_status,
  case
    when enabled is not true or rule_active is not true then false
    when template_id is null then false
    when template_active is not true then false
    when nullif(coalesce(subject, ''), '') is null then false
    when nullif(coalesce(body_html, body_text, ''), '') is null then false
    when sender_is_active is not true then false
    when legal_or_critical = true then has_verified_sender
    when has_verified_sender = true then true
    when fallback_permitted = true then true
    else false
  end as can_send,
  array_remove(array[
    case when enabled is not true or rule_active is not true then 'Utskicket är avstängt' end,
    case when template_id is null then 'Mailmall saknas' end,
    case when template_active is not true then 'Mailmallen är inaktiv' end,
    case when nullif(coalesce(subject, ''), '') is null then 'Ämnesrad saknas' end,
    case when nullif(coalesce(body_html, body_text, ''), '') is null then 'Mallinnehåll saknas' end,
    case when sender_is_active is not true then 'Avsändaren är avstängd' end,
    case when legal_or_critical = true and has_verified_sender is not true then 'Juridiska eller kritiska mail kräver verifierad bolagsdomän och avsändare' end,
    case when legal_or_critical = false and has_verified_sender is not true and fallback_permitted = true then 'Skickas via plattformens fallback-avsändare' end,
    case when legal_or_critical = false and has_verified_sender is not true and fallback_permitted is not true then 'Verifierad avsändare saknas och fallback är avstängd' end,
    case when has_verified_sender is not true and nullif(coalesce(sender_email, ''), '') is null then 'Bolagets verifierade avsändarmail saknas' end,
    case when has_verified_sender is not true and nullif(coalesce(sender_name, ''), '') is null then 'Avsändarnamn saknas' end
  ], null) as issues,
  event_rule_updated_at,
  template_updated_at,
  sender_mode,
  fallback_allowed,
  legal_or_critical,
  (legal_or_critical = false and has_verified_sender is not true and fallback_permitted = true) as requires_platform_fallback
from evaluated;
