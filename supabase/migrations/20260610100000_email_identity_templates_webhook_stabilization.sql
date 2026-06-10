-- Email identity, customer-mail template and webhook stabilization.
-- Idempotent/additive. Keeps tenant isolation and does not delete existing logs or templates.

create extension if not exists pgcrypto;

alter table if exists public.communication_logs
  add column if not exists sender_mode text,
  add column if not exists from_name text,
  add column if not exists domain_verified_at timestamptz,
  add column if not exists template_version text,
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by uuid references auth.users(id) on delete set null,
  add column if not exists handled_note text,
  add column if not exists customer_number text,
  add column if not exists external_customer_id text,
  add column if not exists contract_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists idempotency_key text;

create unique index if not exists communication_logs_company_idempotency_key_uidx
  on public.communication_logs(company_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists communication_logs_provider_message_idx
  on public.communication_logs(provider, provider_message_id)
  where provider_message_id is not null;

create index if not exists communication_logs_failed_bounced_company_idx
  on public.communication_logs(company_id, status, created_at desc)
  where status in ('failed','bounced','complained');

do $$
begin
  if to_regclass('public.communication_logs') is not null then
    alter table public.communication_logs drop constraint if exists communication_logs_status_check;
    alter table public.communication_logs
      add constraint communication_logs_status_check
      check (status in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'cancelled'));
  end if;
end $$;

alter table if exists public.company_email_settings
  add column if not exists sender_mode text not null default 'fallback_platform_sender',
  add column if not exists fallback_allowed boolean not null default true,
  add column if not exists block_legal_mail_when_unverified boolean not null default false,
  add column if not exists dkim_status text,
  add column if not exists spf_status text,
  add column if not exists dmarc_status text,
  add column if not exists last_verification_checked_at timestamptz,
  add column if not exists readiness_status text,
  add column if not exists readiness_notes jsonb not null default '[]'::jsonb;

do $$
begin
  if to_regclass('public.company_email_settings') is not null then
    alter table public.company_email_settings drop constraint if exists company_email_settings_sender_mode_check;
    alter table public.company_email_settings
      add constraint company_email_settings_sender_mode_check
      check (sender_mode in ('verified_domain','fallback_platform_sender','disabled'));
  end if;
end $$;

alter table if exists public.communication_log_events
  add column if not exists event_payload jsonb not null default '{}'::jsonb;

-- The six active customer-mail templates for the electricity product.
with templates(template_key, name, subject, body_html, body_text) as (
  values
  ('contract.application_received','Ansökan mottagen','Vi har tagit emot din ansökan hos {{company_name}}','<p>Hej {{customer_name}},</p><p>Vi har tagit emot din ansökan om elavtal hos {{company_name}}.</p><p>Kundnummer: {{customer_number}}.</p><p>Vi kontrollerar uppgifterna och återkommer om något behöver kompletteras.</p><p>Har du frågor når du oss på {{support_email}}.</p>','Hej {{customer_name}}, vi har tagit emot din ansökan om elavtal hos {{company_name}}. Kundnummer: {{customer_number}}.'),
  ('support.case_message','Supportmeddelande','{{company_name}}: {{case_subject}}','<p>Hej {{customer_name}},</p><p>{{case_message}}</p><p>Du kan svara på detta mail eller kontakta oss på {{support_email}}.</p>','Hej {{customer_name}}, {{case_message}} Du kan svara på detta mail eller kontakta oss på {{support_email}}.'),
  ('switch.started','Leverantörsbyte startat','Ditt leverantörsbyte är startat','<p>Hej {{customer_name}},</p><p>Vi har startat leverantörsbytet till {{company_name}}.</p><p>Anläggning: {{facility_id}}. Mätpunkt: {{metering_point_id}}.</p><p>Vi kontaktar dig om någon uppgift behöver kompletteras.</p>','Hej {{customer_name}}, vi har startat leverantörsbytet till {{company_name}}.'),
  ('switch.confirmed','Leverantörsbyte bekräftat','Ditt leverantörsbyte är bekräftat','<p>Hej {{customer_name}},</p><p>Leverantörsbytet är bekräftat och {{company_name}} startar leveransen {{start_date}}.</p><p>Anläggning: {{facility_id}}. Mätpunkt: {{metering_point_id}}.</p>','Hej {{customer_name}}, leverantörsbytet är bekräftat och {{company_name}} startar leveransen {{start_date}}.'),
  ('switch.action_required','Leverantörsbyte kräver åtgärd','Vi behöver komplettera ditt leverantörsbyte','<p>Hej {{customer_name}},</p><p>Leverantörsbytet kunde inte slutföras automatiskt. Vi behöver kontrollera eller komplettera uppgifter innan bytet kan fortsätta.</p><p>Kontakta oss på {{support_email}} om du har frågor.</p>','Hej {{customer_name}}, leverantörsbytet kunde inte slutföras automatiskt. Vi behöver kontrollera eller komplettera uppgifter innan bytet kan fortsätta.'),
  ('customer.welcome_active','Välkommen som aktiv kund','Välkommen som kund hos {{company_name}}','<p>Hej {{customer_name}},</p><p>Välkommen som aktiv kund hos {{company_name}}.</p><p>Ditt kundnummer är {{customer_number}}.</p><p>Du kan nå oss på {{support_email}}.</p>','Hej {{customer_name}}, välkommen som aktiv kund hos {{company_name}}. Ditt kundnummer är {{customer_number}}.')
)
insert into public.company_email_templates(company_id, template_key, name, subject, body_html, body_text, language, is_active, updated_at)
select c.id, t.template_key, t.name, t.subject, t.body_html, t.body_text, 'sv', true, now()
from public.companies c
cross join templates t
where to_regclass('public.company_email_templates') is not null
on conflict (company_id, template_key, language) do nothing;

with rules(event_key, template_key) as (
  values
  ('contract.application_received','contract.application_received'),
  ('support.case_message','support.case_message'),
  ('switch.started','switch.started'),
  ('switch.confirmed','switch.confirmed'),
  ('switch.action_required','switch.action_required'),
  ('customer.welcome_active','customer.welcome_active')
)
insert into public.email_event_rules(company_id, event_key, template_key, enabled, delay_minutes, send_to_customer, send_to_admin, updated_at)
select c.id, r.event_key, r.template_key, true, 0, true, false, now()
from public.companies c
cross join rules r
where to_regclass('public.email_event_rules') is not null
on conflict (company_id, event_key, template_key) do nothing;
