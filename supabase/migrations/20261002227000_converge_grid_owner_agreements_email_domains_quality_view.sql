-- Converge three objects that only legacy 8-digit migrations created into the
-- canonical schema: grid_owner_access_agreements, tenant_email_domains and the
-- customer_data_quality_open_issues view. Without them a fresh environment
-- crashes the grid-owner agreements page and the data-quality page reports
-- "no issues" because its checks cannot run.
--
-- Idempotent: matches the hosted definitions. Also removes a hosted-only
-- "authenticated select true" policy on grid_owner_access_agreements that let
-- any signed-in user read every tenant's agreements, and makes the view
-- security_invoker and service-role only (it exposes personnummer).

set local client_min_messages = warning;

create table if not exists public.grid_owner_access_agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  grid_owner_id uuid,
  agreement_type text not null default 'metering_access',
  agreement_scope text not null default 'metering_access',
  status text not null default 'draft',
  agreement_reference text,
  external_agreement_number text,
  valid_from date,
  valid_to date,
  signed_at timestamptz,
  document_id uuid,
  document_path text,
  requires_customer_authorization boolean not null default true,
  requires_metering_point_id boolean not null default true,
  requires_facility_id boolean not null default false,
  requires_customer_personal_number boolean not null default false,
  requires_report_period boolean not null default false,
  preferred_application_reference text,
  preferred_message_version text,
  preferred_receiver_ediel_id text,
  preferred_receiver_sub_address text,
  preferred_route_id uuid,
  reference_requirements jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_grid_owner_access_agreements_company_scope
  on public.grid_owner_access_agreements (company_id, grid_owner_id, agreement_scope, status);
create index if not exists idx_grid_owner_access_agreements_active_metering
  on public.grid_owner_access_agreements (company_id, grid_owner_id, agreement_type, status, valid_from, valid_to);
alter table public.grid_owner_access_agreements alter column company_id set not null;
alter table public.grid_owner_access_agreements enable row level security;
drop policy if exists gridex_perf_authenticated_select_v on public.grid_owner_access_agreements;

create table if not exists public.tenant_email_domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  domain text not null,
  provider text not null default 'smtp',
  provider_domain_id text,
  status text not null default 'pending_dns'
    constraint tenant_email_domains_status_check
    check (status = any (array['pending_dns','verifying','verified','failed','disabled'])),
  spf_status text not null default 'pending',
  dkim_status text not null default 'pending',
  dmarc_status text not null default 'pending',
  bounce_status text not null default 'pending',
  last_checked_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_email_domains_unique unique (company_id, domain)
);
create index if not exists tenant_email_domains_company_status_idx
  on public.tenant_email_domains (company_id, status, created_at desc);
alter table public.tenant_email_domains enable row level security;

do $$
declare t text;
begin
  foreach t in array array['grid_owner_access_agreements','tenant_email_domains'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='tenant_lifecycle_select_guard') then
      execute format('create policy tenant_lifecycle_select_guard on public.%I for select to authenticated using ((select public.gridex_is_current_session_allowed()) and ((select public.gridex_user_is_platform_admin()) or company_id in (select public.gridex_user_company_ids())))', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='tenant_lifecycle_insert_guard') then
      execute format('create policy tenant_lifecycle_insert_guard on public.%I for insert to authenticated with check (public.gridex_can_write_company(company_id))', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='tenant_lifecycle_update_guard') then
      execute format('create policy tenant_lifecycle_update_guard on public.%I for update to authenticated using (public.gridex_can_write_company(company_id)) with check (public.gridex_can_write_company(company_id))', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='tenant_lifecycle_delete_guard') then
      execute format('create policy tenant_lifecycle_delete_guard on public.%I for delete to authenticated using (public.gridex_can_write_company(company_id))', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
  end loop;
end $$;

create or replace view public.customer_data_quality_open_issues
with (security_invoker = true) as
select c.company_id, c.id::text as entity_id, c.id as customer_id, 'customer'::text as entity_type,
       issue.issue_key, issue.severity, issue.message, issue.evidence
from public.customers c
cross join lateral (values
  (case when c.personal_number is not null and regexp_replace(c.personal_number, '\D', '', 'g') !~ '^\d{10}$|^\d{12}$' then 'invalid_personal_number' end,
   'critical', 'Personnummer har ogiltigt format.', jsonb_build_object('personal_number', c.personal_number)),
  (case when c.org_number is not null and regexp_replace(c.org_number, '\D', '', 'g') !~ '^\d{10}$|^\d{12}$' then 'invalid_org_number' end,
   'critical', 'Organisationsnummer har ogiltigt format.', jsonb_build_object('org_number', c.org_number)),
  (case when c.email is not null and c.email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'invalid_email' end,
   'warning', 'E-post har ogiltigt format.', jsonb_build_object('email', c.email))
) as issue(issue_key, severity, message, evidence)
where issue.issue_key is not null
union all
select a.company_id, a.id::text, a.customer_id, 'customer_address', 'invalid_postal_code', 'warning',
       'Postnummer ska anges som 12345 eller 123 45.', jsonb_build_object('postal_code', a.postal_code)
from public.customer_addresses a
where a.postal_code is not null and a.postal_code !~ '^\d{3}\s?\d{2}$'
union all
select c.company_id, c.id::text, c.id, 'customer', 'missing_signed_power_of_attorney', 'warning',
       'Kunden saknar signerad fullmakt.', '{}'::jsonb
from public.customers c
where not exists (select 1 from public.powers_of_attorney p
                  where p.customer_id = c.id and p.company_id = c.company_id and p.status = 'signed');

revoke all on public.customer_data_quality_open_issues from anon, authenticated, public;
grant select on public.customer_data_quality_open_issues to service_role;

insert into public.platform_table_classification (table_name, kind, rationale, null_company_meaning, classified_by)
values
  ('grid_owner_access_agreements', 'tenant',
   'Grid-owner access agreements owned by one tenant; company_id is NOT NULL.',
   null, 'migration'),
  ('tenant_email_domains', 'tenant',
   'Sender e-mail domains owned by one tenant; company_id is NOT NULL.',
   null, 'migration')
on conflict (table_name) do nothing;
