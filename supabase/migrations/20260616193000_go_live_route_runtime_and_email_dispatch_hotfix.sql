-- Go-live route runtime + tenant email dispatch hotfix.
-- Keeps shared mailbox as transport, PRODAT S/MIME as route policy, and customer
-- application mail on the canonical "Ansökan mottagen" event/template.

create extension if not exists pgcrypto;

do $$
declare
  constraint_row record;
begin
  if to_regclass('public.communication_routes') is not null then
    for constraint_row in
      select conname
      from pg_constraint
      where conrelid = 'public.communication_routes'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%route_scope%'
    loop
      execute format('alter table public.communication_routes drop constraint if exists %I', constraint_row.conname);
    end loop;

    alter table public.communication_routes
      add constraint communication_routes_route_scope_check
      check (route_scope in ('supplier_switch', 'customer_masterdata', 'meter_values', 'metering_values', 'billing_underlay'))
      not valid;

    alter table public.communication_routes validate constraint communication_routes_route_scope_check;
  end if;

  if to_regclass('public.email_event_rules') is not null then
    alter table public.email_event_rules
      add column if not exists is_active boolean not null default true;
  end if;
end $$;

-- Canonical company email templates. These are safe defaults; tenants can edit
-- the template text later, but system-trigger selection stays deterministic.
insert into public.company_email_templates (
  company_id, template_key, name, subject, body_html, body_text, language, is_active, updated_at
)
select
  c.id,
  t.template_key,
  t.name,
  t.subject,
  t.body_html,
  t.body_text,
  'sv',
  true,
  now()
from public.companies c
cross join (values
  (
    'contract.application_received',
    'Ansökan mottagen',
    'Vi har tagit emot din ansökan hos {{company_name}}',
    '<p>Hej {{customer_name}},</p><p>Vi har tagit emot din ansökan om elavtal hos {{company_name}}.</p><p>Kundnummer: {{customer_number}}.</p><p>Vi kontrollerar uppgifterna och återkommer om något behöver kompletteras.</p><p>Har du frågor når du oss på {{support_email}}.</p>',
    'Hej {{customer_name}}, vi har tagit emot din ansökan om elavtal hos {{company_name}}. Kundnummer: {{customer_number}}. Vi återkommer om något behöver kompletteras.'
  ),
  (
    'contract.confirmation_sent',
    'Avtalsbekräftelse',
    'Din avtalsbekräftelse från {{company_name}}',
    '<p>Hej {{customer_name}},</p><p>Här kommer din avtalsbekräftelse för {{contract_name}} hos {{company_name}}.</p><p>Kundnummer: {{customer_number}}.</p><p>Startdatum: {{start_date}}.</p><p>Har du frågor når du oss på {{support_email}}.</p>',
    'Hej {{customer_name}}, här kommer din avtalsbekräftelse för {{contract_name}} hos {{company_name}}. Kundnummer: {{customer_number}}. Startdatum: {{start_date}}.'
  ),
  (
    'contract.cooling_off_sent',
    'Ångerrätt',
    'Information om ångerrätt från {{company_name}}',
    '<p>Hej {{customer_name}},</p><p>Här kommer information om din ångerrätt för avtalet hos {{company_name}}.</p><p>Ångerfristen gäller till {{cancellation_deadline}}.</p><p>Har du frågor når du oss på {{support_email}}.</p>',
    'Hej {{customer_name}}, här kommer information om din ångerrätt för avtalet hos {{company_name}}. Ångerfristen gäller till {{cancellation_deadline}}.'
  ),
  (
    'switch.started',
    'Leverantörsbyte startat',
    'Ditt leverantörsbyte är startat',
    '<p>Hej {{customer_name}},</p><p>Vi har startat leverantörsbytet till {{company_name}}.</p><p>Anläggning: {{facility_id}}. Mätpunkt: {{metering_point_id}}.</p><p>Vi kontaktar dig om någon uppgift behöver kompletteras.</p>',
    'Hej {{customer_name}}, vi har startat leverantörsbytet till {{company_name}}. Vi kontaktar dig om någon uppgift behöver kompletteras.'
  ),
  (
    'switch.confirmed',
    'Leverantörsbyte bekräftat',
    'Ditt leverantörsbyte är bekräftat',
    '<p>Hej {{customer_name}},</p><p>Leverantörsbytet är bekräftat och {{company_name}} startar leveransen {{start_date}}.</p><p>Anläggning: {{facility_id}}. Mätpunkt: {{metering_point_id}}.</p>',
    'Hej {{customer_name}}, leverantörsbytet är bekräftat och {{company_name}} startar leveransen {{start_date}}.'
  ),
  (
    'switch.action_required',
    'Leverantörsbyte kräver åtgärd',
    'Vi behöver komplettera ditt leverantörsbyte',
    '<p>Hej {{customer_name}},</p><p>Leverantörsbytet kunde inte slutföras automatiskt. Vi behöver kontrollera eller komplettera uppgifter innan bytet kan fortsätta.</p><p>Kontakta oss på {{support_email}} om du har frågor.</p>',
    'Hej {{customer_name}}, leverantörsbytet kunde inte slutföras automatiskt. Vi behöver kontrollera eller komplettera uppgifter innan bytet kan fortsätta.'
  ),
  (
    'customer.welcome_active',
    'Välkommen som aktiv kund',
    'Välkommen som kund hos {{company_name}}',
    '<p>Hej {{customer_name}},</p><p>Välkommen som aktiv kund hos {{company_name}}.</p><p>Ditt kundnummer är {{customer_number}}.</p><p>Du kan nå oss på {{support_email}}.</p>',
    'Hej {{customer_name}}, välkommen som aktiv kund hos {{company_name}}. Ditt kundnummer är {{customer_number}}.'
  )
) as t(template_key, name, subject, body_html, body_text)
on conflict (company_id, template_key, language) do update set
  name = excluded.name,
  subject = case when nullif(public.company_email_templates.subject, '') is null then excluded.subject else public.company_email_templates.subject end,
  body_html = case when nullif(public.company_email_templates.body_html, '') is null then excluded.body_html else public.company_email_templates.body_html end,
  body_text = coalesce(public.company_email_templates.body_text, excluded.body_text),
  is_active = case when public.company_email_templates.template_key = 'contract.application_received' then true else coalesce(public.company_email_templates.is_active, true) end,
  updated_at = now();

insert into public.email_event_rules (
  company_id, event_key, template_key, enabled, is_active, delay_minutes, send_to_customer, send_to_admin, updated_at
)
select
  c.id,
  r.event_key,
  r.template_key,
  true,
  true,
  0,
  true,
  false,
  now()
from public.companies c
cross join (values
  ('contract.application_received', 'contract.application_received'),
  ('contract.confirmation_sent', 'contract.confirmation_sent'),
  ('contract.cooling_off_sent', 'contract.cooling_off_sent'),
  ('switch.started', 'switch.started'),
  ('switch.confirmed', 'switch.confirmed'),
  ('switch.action_required', 'switch.action_required'),
  ('customer.welcome_active', 'customer.welcome_active')
) as r(event_key, template_key)
on conflict (company_id, event_key, template_key) do update set
  enabled = true,
  is_active = true,
  send_to_customer = true,
  updated_at = now();

-- Disable wrong/legacy pairings that previously made application_received point
-- to confirmation/cooling-off templates.
update public.email_event_rules e
set enabled = false,
    is_active = false,
    updated_at = now()
where (
    e.template_key in ('contract_confirmation', 'cancellation_right', 'cancellation_right_started')
    or (e.event_key = 'contract.application_received' and e.template_key <> 'contract.application_received')
    or (e.event_key = 'contract.confirmation_sent' and e.template_key <> 'contract.confirmation_sent')
    or (e.event_key = 'contract.cooling_off_sent' and e.template_key <> 'contract.cooling_off_sent')
  );

create or replace view public.gridex_tenant_email_dispatch_readiness_v as
with canonical_rules(event_key, template_key, event_label) as (
  values
    ('contract.application_received', 'contract.application_received', 'Ansökan mottagen'),
    ('contract.confirmation_sent', 'contract.confirmation_sent', 'Avtalsbekräftelse'),
    ('contract.cooling_off_sent', 'contract.cooling_off_sent', 'Ångerrätt'),
    ('switch.started', 'switch.started', 'Leverantörsbyte startat'),
    ('switch.confirmed', 'switch.confirmed', 'Leverantörsbyte bekräftat'),
    ('switch.action_required', 'switch.action_required', 'Komplettering behövs'),
    ('customer.welcome_active', 'customer.welcome_active', 'Välkommen som kund')
)
select
  c.id as company_id,
  c.name as company_name,
  cr.event_key,
  cr.template_key,
  coalesce(e.enabled, true) as enabled,
  t.id as template_id,
  coalesce(t.name, cr.event_label) as template_name,
  t.subject,
  coalesce(t.is_active, false) as template_active,
  s.sender_email,
  s.reply_to_email,
  s.domain,
  coalesce(s.verification_status, 'not_started') as domain_status,
  case
    when coalesce(e.enabled, true) is not true then false
    when t.id is null then false
    when t.is_active is not true then false
    when nullif(coalesce(t.subject, ''), '') is null then false
    when nullif(coalesce(t.body_html, t.body_text, ''), '') is null then false
    else true
  end as can_send,
  array_remove(array[
    case when coalesce(e.enabled, true) is not true then 'Utskicket är avstängt' end,
    case when t.id is null then 'Mailmall saknas' end,
    case when t.is_active is not true then 'Mailmallen är inaktiv' end,
    case when nullif(coalesce(t.subject, ''), '') is null then 'Ämnesrad saknas' end,
    case when nullif(coalesce(t.body_html, t.body_text, ''), '') is null then 'Mallinnehåll saknas' end,
    case when nullif(coalesce(s.sender_email, ''), '') is null then 'Tenant-avsändare saknas; platform fallback används om miljövariabel finns' end,
    case when coalesce(s.verification_status, 'not_started') not in ('verified','active','ready') then 'Domänen är inte verifierad; fallback kan krävas' end
  ], null) as issues,
  coalesce(e.updated_at, t.updated_at) as event_rule_updated_at,
  t.updated_at as template_updated_at
from public.companies c
cross join canonical_rules cr
left join public.email_event_rules e on e.company_id = c.id and e.event_key = cr.event_key and e.template_key = cr.template_key
left join public.company_email_templates t on t.company_id = c.id and t.template_key = cr.template_key and t.language = 'sv'
left join public.company_email_settings s on s.company_id = c.id;
