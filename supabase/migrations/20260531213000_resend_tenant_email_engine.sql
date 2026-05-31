-- Resend tenant email engine
-- Idempotent, additive, non-destructive.

create table if not exists public.company_email_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique,
  sender_name text,
  sender_email text,
  reply_to_email text,
  support_email text,
  domain text,
  provider text not null default 'resend',
  provider_domain_id text,
  verification_status text not null default 'not_started',
  verified_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_company_email_settings_company_id
on public.company_email_settings(company_id);

create index if not exists idx_company_email_settings_provider_domain_id
on public.company_email_settings(provider_domain_id);

create index if not exists idx_company_email_settings_verification_status
on public.company_email_settings(verification_status);

create table if not exists public.company_email_dns_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  email_setting_id uuid not null references public.company_email_settings(id) on delete cascade,
  record_type text not null,
  name text not null,
  value text not null,
  priority integer,
  status text not null default 'pending',
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_company_email_dns_records_company_id
on public.company_email_dns_records(company_id);

create index if not exists idx_company_email_dns_records_setting_id
on public.company_email_dns_records(email_setting_id);

create index if not exists idx_company_email_dns_records_status
on public.company_email_dns_records(status);

create table if not exists public.company_email_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  template_key text not null,
  name text not null,
  subject text not null,
  body_html text not null,
  body_text text,
  language text not null default 'sv',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, template_key, language)
);

create index if not exists idx_company_email_templates_company_id
on public.company_email_templates(company_id);

create index if not exists idx_company_email_templates_template_key
on public.company_email_templates(company_id, template_key);

create table if not exists public.email_event_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  event_key text not null,
  template_key text not null,
  enabled boolean not null default true,
  delay_minutes integer not null default 0,
  send_to_customer boolean not null default true,
  send_to_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, event_key, template_key)
);

create index if not exists idx_email_event_rules_company_id
on public.email_event_rules(company_id);

create index if not exists idx_email_event_rules_event_key
on public.email_event_rules(company_id, event_key);

create index if not exists idx_email_event_rules_enabled
on public.email_event_rules(company_id, enabled);

create table if not exists public.communication_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  channel text not null default 'email',
  event_key text,
  template_key text,
  recipient_email text not null,
  sender_email text,
  reply_to_email text,
  subject text,
  status text not null default 'queued',
  provider text,
  provider_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_communication_logs_company_id
on public.communication_logs(company_id);

create index if not exists idx_communication_logs_customer_id
on public.communication_logs(company_id, customer_id);

create index if not exists idx_communication_logs_status
on public.communication_logs(company_id, status);

create index if not exists idx_communication_logs_event_key
on public.communication_logs(company_id, event_key);

create index if not exists idx_communication_logs_created_at
on public.communication_logs(company_id, created_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_email_settings_verification_status_check') then
    alter table public.company_email_settings
      add constraint company_email_settings_verification_status_check
      check (verification_status in ('not_started', 'pending_dns', 'verified', 'failed', 'disabled'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'company_email_dns_records_status_check') then
    alter table public.company_email_dns_records
      add constraint company_email_dns_records_status_check
      check (status in ('pending', 'verified', 'failed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'communication_logs_status_check') then
    alter table public.communication_logs
      add constraint communication_logs_status_check
      check (status in ('queued', 'sent', 'delivered', 'bounced', 'failed', 'cancelled'));
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'company_email_settings',
    'company_email_dns_records',
    'company_email_templates',
    'email_event_rules',
    'communication_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_tenant', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_tenant', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_tenant', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_tenant', t);

    execute format(
      'create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))',
      t || '_select_tenant',
      t
    );
    execute format(
      'create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))',
      t || '_insert_tenant',
      t
    );
    execute format(
      'create policy %I on public.%I for update using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id)) with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))',
      t || '_update_tenant',
      t
    );
    execute format(
      'create policy %I on public.%I for delete using (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))',
      t || '_delete_tenant',
      t
    );
  end loop;
end $$;
