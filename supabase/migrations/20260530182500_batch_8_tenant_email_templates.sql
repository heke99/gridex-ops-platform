-- Batch 8 — tenant configurable email templates.
-- Templates are configured by platform admins per company. Secrets/passwords are not stored here.

begin;

create table if not exists public.tenant_email_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  template_key text not null,
  subject text not null,
  intro text not null,
  body text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_email_templates_key_check check (template_key in (
    'customer_created',
    'switch_confirmation',
    'withdrawal_received',
    'move_out_confirmation',
    'cancellation_sent'
  )),
  constraint tenant_email_templates_unique unique (company_id, template_key)
);

create index if not exists tenant_email_templates_company_active_idx
  on public.tenant_email_templates(company_id, is_active, template_key);

alter table public.tenant_email_templates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_email_templates'
      and policyname = 'tenant_email_templates_service_role_all'
  ) then
    create policy tenant_email_templates_service_role_all
      on public.tenant_email_templates
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

commit;
