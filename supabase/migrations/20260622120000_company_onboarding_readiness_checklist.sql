-- Tenant onboarding readiness checklist.
-- Safe/idempotent. Persists a per-company checklist so onboarding has an explicit
-- readiness path (test/production Ediel, BRP, transport, certificates, routes,
-- legal, API scopes, website integration, customer automation) instead of only
-- computed-at-read-time views. Does not invent Ediel IDs/routes/approvals — it
-- only tracks task state until real data is entered and verified.

create table if not exists public.company_onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_key text not null,
  title text not null,
  category text not null,
  environment text null,
  status text not null default 'pending',
  blocker_reason text null,
  next_required_action text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists company_onboarding_tasks_company_key_uidx
  on public.company_onboarding_tasks(company_id, task_key);

create index if not exists company_onboarding_tasks_company_status_idx
  on public.company_onboarding_tasks(company_id, status);

alter table if exists public.company_onboarding_tasks
  add column if not exists next_required_action text,
  add column if not exists blocker_reason text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Seed the standard onboarding checklist for a company. Idempotent: existing
-- task rows are never overwritten (status/notes are preserved on conflict).
create or replace function public.gridex_seed_company_onboarding_tasks(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_company_id is null then
    return;
  end if;

  insert into public.company_onboarding_tasks (company_id, task_key, title, category, environment, next_required_action)
  values
    (p_company_id, 'test_ediel_actor_settings', 'Test: Ediel-aktörsinställningar', 'ediel', 'test', 'Lägg in test-Ediel-aktör (Ediel-ID, roll, subadress).'),
    (p_company_id, 'production_ediel_actor_settings', 'Produktion: Ediel-aktörsinställningar', 'ediel', 'production', 'Lägg in produktions-Ediel-aktör och verifiera.'),
    (p_company_id, 'brp_settings', 'BRP / balansansvarig', 'brp', null, 'Konfigurera balansansvarig (BRP) för bolaget.'),
    (p_company_id, 'shared_mailbox_transport', 'Delad mailbox / transport', 'transport', null, 'Koppla delad mailbox och transport för Ediel.'),
    (p_company_id, 'production_certificate', 'Produktion: certifikat/säkerhet', 'certificate', 'production', 'Lägg in och verifiera produktionscertifikat där det krävs.'),
    (p_company_id, 'test_route_readiness', 'Test: operativa routes', 'route', 'test', 'Materialisera operativa test-routes för nätägare.'),
    (p_company_id, 'production_route_readiness', 'Produktion: operativa routes', 'route', 'production', 'Materialisera operativa produktions-routes för nätägare.'),
    (p_company_id, 'legal_default_package', 'Juridik / standardpaket', 'legal', null, 'Publicera juridiska standardtexter eller skapa arbetsuppgift.'),
    (p_company_id, 'api_client_scopes', 'API-klient & scopes', 'api', null, 'Skapa API-klient med rätt scopes för integrationer.'),
    (p_company_id, 'website_portal_integration', 'Webbplats / kundportal-integration', 'website', null, 'Koppla webbplats/kundportal-integration.'),
    (p_company_id, 'customer_automation_readiness', 'Kundautomation redo', 'automation', null, 'Kräver produktions-route och produktionsgodkännande innan automation.')
  on conflict (company_id, task_key) do nothing;
end;
$$;
