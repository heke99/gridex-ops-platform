-- Tenant Legal Defaults, Live/Test Separation & Intake Tracking
-- Safe/idempotent production hardening. Keeps live bolagskort clean and makes tenant legal defaults available.

-- 1. Platform default legal templates. These are the Gridex-provided fallback texts.
create table if not exists public.platform_default_legal_templates (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('terms','privacy_policy','withdrawal','power_of_attorney','price_terms')),
  version text not null,
  title text not null,
  body text not null,
  status text not null default 'published' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint platform_default_legal_templates_type_version_uidx unique(type, version)
);

create unique index if not exists platform_default_legal_templates_one_published_type_uidx
  on public.platform_default_legal_templates(type)
  where status = 'published';

alter table public.platform_default_legal_templates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_default_legal_templates' and policyname='platform_default_legal_templates_platform_read') then
    create policy platform_default_legal_templates_platform_read
      on public.platform_default_legal_templates for select
      using (public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_default_legal_templates' and policyname='platform_default_legal_templates_platform_write') then
    create policy platform_default_legal_templates_platform_write
      on public.platform_default_legal_templates for all
      using (public.gridex_user_is_platform_admin())
      with check (public.gridex_user_is_platform_admin());
  end if;
end $$;

insert into public.platform_default_legal_templates(type, version, title, body, status, published_at, metadata)
values
  ('terms', 'gridex-standard-2026-06', 'Allmänna villkor för elavtal', 'Standardvillkor från plattformen. Ersätt med bolagets egna villkor när tenantens juridiska texter har granskats och publicerats av platform admin.', 'published', now(), '{"source":"gridex_default","requires_platform_admin_review":true}'::jsonb),
  ('privacy_policy', 'gridex-standard-2026-06', 'Integritetspolicy', 'Standardintegritetspolicy från plattformen. Tenant kan ersätta denna med egen publicerad version via platform admin.', 'published', now(), '{"source":"gridex_default","requires_platform_admin_review":true}'::jsonb),
  ('withdrawal', 'gridex-standard-2026-06', 'Ångerrättsinformation', 'Standardinformation om ångerrätt. Tenant kan ersätta denna med egen publicerad version via platform admin.', 'published', now(), '{"source":"gridex_default","requires_platform_admin_review":true}'::jsonb),
  ('price_terms', 'gridex-standard-2026-06', 'Prisvillkor', 'Standardprisvillkor från plattformen. Exakt prisversion och prissnapshot sparas alltid vid kundens signering.', 'published', now(), '{"source":"gridex_default","requires_platform_admin_review":true}'::jsonb),
  ('power_of_attorney', 'gridex-standard-2026-06', 'Fullmaktstext', 'Standardfullmakt för att begära, ta emot och hantera anläggnings- och mätpunktsuppgifter från nätägare när avtalet eller flödet kräver fullmakt.', 'published', now(), '{"source":"gridex_default","requires_platform_admin_review":true}'::jsonb)
on conflict (type, version) do update
set title = excluded.title,
    body = excluded.body,
    status = 'published',
    published_at = coalesce(public.platform_default_legal_templates.published_at, now()),
    updated_at = now(),
    metadata = excluded.metadata;

-- 2. Seed/copy the Gridex default legal package into a tenant as published tenant versions.
create or replace function public.gridex_seed_default_legal_package_for_company(
  p_company_id uuid,
  p_actor_user_id uuid default null
)
returns table(inserted_count integer, existing_count integer, bundle_id uuid, missing_types text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template record;
  v_existing integer := 0;
  v_inserted integer := 0;
  v_bundle_id uuid;
  v_missing text[] := array[]::text[];
  v_text_id uuid;
  v_type text;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if to_regclass('public.companies') is null or not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Company not found';
  end if;

  foreach v_type in array array['terms','privacy_policy','withdrawal','price_terms','power_of_attorney'] loop
    select * into v_template
    from public.platform_default_legal_templates
    where type = v_type and status = 'published'
    order by published_at desc nulls last, created_at desc
    limit 1;

    if not found then
      v_missing := array_append(v_missing, v_type);
    else
      if exists (select 1 from public.legal_text_versions where company_id = p_company_id and type = v_type and status = 'published') then
        v_existing := v_existing + 1;
      else
        insert into public.legal_text_versions(company_id, type, version, title, body, status, published_at, created_by, updated_by, metadata)
        values (
          p_company_id,
          v_template.type,
          v_template.version,
          v_template.title,
          v_template.body,
          'published',
          now(),
          p_actor_user_id,
          p_actor_user_id,
          jsonb_build_object('source','gridex_default','copied_from_platform_default_id',v_template.id,'inherited_from_platform',true)
        )
        on conflict (company_id, type, version) do update
          set status = case when public.legal_text_versions.status = 'draft' then 'published' else public.legal_text_versions.status end,
              published_at = coalesce(public.legal_text_versions.published_at, now()),
              updated_at = now(),
              updated_by = p_actor_user_id,
              metadata = public.legal_text_versions.metadata || jsonb_build_object('source','gridex_default','inherited_from_platform',true);
        v_inserted := v_inserted + 1;
      end if;
    end if;
  end loop;

  if array_length(v_missing, 1) is null then
    select id into v_bundle_id
    from public.legal_bundles
    where company_id = p_company_id and status in ('published','active') and metadata->>'source' = 'gridex_default'
    order by updated_at desc nulls last
    limit 1;

    if v_bundle_id is null then
      insert into public.legal_bundles(company_id, name, status, metadata)
      values (p_company_id, 'Gridex standardjuridik', 'published', '{"source":"gridex_default","auto_created":true}'::jsonb)
      returning id into v_bundle_id;
    end if;

    foreach v_type in array array['terms','privacy_policy','withdrawal','price_terms','power_of_attorney'] loop
      select id into v_text_id
      from public.legal_text_versions
      where company_id = p_company_id and type = v_type and status = 'published'
      order by published_at desc nulls last, created_at desc
      limit 1;

      if v_text_id is not null and not exists (
        select 1 from public.legal_bundle_items where legal_bundle_id = v_bundle_id and type = v_type
      ) then
        insert into public.legal_bundle_items(legal_bundle_id, legal_text_version_id, type, sort_order)
        values (v_bundle_id, v_text_id, v_type,
          case v_type when 'terms' then 10 when 'privacy_policy' then 20 when 'withdrawal' then 30 when 'price_terms' then 40 else 50 end);
      end if;
    end loop;
  end if;

  inserted_count := v_inserted;
  existing_count := v_existing;
  bundle_id := v_bundle_id;
  missing_types := v_missing;
  return next;
end $$;

comment on function public.gridex_seed_default_legal_package_for_company(uuid, uuid) is 'Copies Gridex platform default legal templates into a tenant as published tenant versions and creates a legal bundle. Intended for onboarding and publication fallback.';

-- 3. Best-effort trigger for new companies. It does not block tenant creation if legal tables are unavailable.
create or replace function public.gridex_seed_default_legal_package_after_company_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform * from public.gridex_seed_default_legal_package_for_company(new.id, null);
  exception when others then
    raise notice 'Default legal package could not be seeded for company %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists companies_seed_default_legal_package on public.companies;
create trigger companies_seed_default_legal_package
  after insert on public.companies
  for each row execute function public.gridex_seed_default_legal_package_after_company_insert();

-- Backfill existing companies safely.
do $$
declare
  v_company record;
begin
  for v_company in select id from public.companies loop
    begin
      perform * from public.gridex_seed_default_legal_package_for_company(v_company.id, null);
    exception when others then
      raise notice 'Skipping default legal backfill for company %: %', v_company.id, sqlerrm;
    end;
  end loop;
end $$;

-- 4. Tenant testing registry separated from live production profile but linked to company card.
create table if not exists public.company_actor_test_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  test_area text not null default 'ediel',
  test_case_code text,
  test_case_name text,
  environment text not null default 'test',
  status text not null default 'planned' check (status in ('planned','running','passed','failed','blocked','skipped')),
  started_at timestamptz,
  completed_at timestamptz,
  last_message_id uuid,
  evidence jsonb not null default '{}'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists company_actor_test_runs_company_status_idx on public.company_actor_test_runs(company_id, environment, status, created_at desc);
alter table public.company_actor_test_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_actor_test_runs' and policyname='company_actor_test_runs_platform_all') then
    create policy company_actor_test_runs_platform_all on public.company_actor_test_runs for all using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_actor_test_runs' and policyname='company_actor_test_runs_company_read') then
    create policy company_actor_test_runs_company_read on public.company_actor_test_runs for select using (public.gridex_can_read_company(company_id));
  end if;
end $$;

create or replace view public.company_actor_testing_status_v as
select
  c.id as company_id,
  c.name as company_name,
  count(r.id) filter (where r.environment = 'test') as total_tests,
  count(r.id) filter (where r.status = 'passed') as passed_tests,
  count(r.id) filter (where r.status in ('failed','blocked')) as blocked_or_failed_tests,
  max(r.updated_at) as last_test_updated_at,
  case
    when count(r.id) = 0 then 'not_started'
    when count(r.id) filter (where r.status in ('failed','blocked')) > 0 then 'action_required'
    when count(r.id) filter (where r.status = 'passed') = count(r.id) then 'passed'
    else 'in_progress'
  end as testing_status
from public.companies c
left join public.company_actor_test_runs r on r.company_id = c.id
where to_regclass('public.companies') is not null
group by c.id, c.name;

-- 5. Plain-language intake tracking per tenant for dashboard cards.
create or replace view public.tenant_customer_intake_tracking_v as
with website as (
  select company_id, status, created_at, updated_at, customer_id, contract_id, grid_owner_id, resolution_status, blocking_reasons, next_step
  from public.website_customer_applications
  where to_regclass('public.website_customer_applications') is not null
), external_intakes as (
  select company_id, status, created_at, updated_at, created_customer_id as customer_id, created_contract_id as contract_id, null::uuid as grid_owner_id, null::text as resolution_status, issues as blocking_reasons, null::text as next_step
  from public.external_contract_intakes
  where to_regclass('public.external_contract_intakes') is not null
), combined as (
  select * from website
  union all
  select * from external_intakes
)
select
  c.id as company_id,
  c.name as company_name,
  count(combined.*) as total_applications,
  count(combined.*) filter (where combined.created_at >= date_trunc('month', now())) as applications_this_month,
  count(combined.*) filter (where lower(coalesce(combined.status,'')) in ('received','pending','pending_review','partially_created')) as pending_applications,
  count(combined.*) filter (where lower(coalesce(combined.status,'')) in ('customer_created','created','completed','accepted')) as completed_applications,
  count(combined.*) filter (where lower(coalesce(combined.status,'')) in ('failed','blocked','error') or jsonb_array_length(coalesce(combined.blocking_reasons::jsonb, '[]'::jsonb)) > 0) as applications_requiring_action,
  count(combined.*) filter (where combined.grid_owner_id is not null or lower(coalesce(combined.resolution_status,'')) in ('resolved','verified')) as grid_owner_resolved,
  max(combined.updated_at) as last_application_updated_at
from public.companies c
left join combined on combined.company_id = c.id
group by c.id, c.name;

comment on view public.tenant_customer_intake_tracking_v is 'Per-tenant website/customer-intake tracking for dashboard cards: pending, completed, action required and grid-owner resolved.';

-- 6. Event-mail readiness in plain language. Sender must be verified or explicitly fallback-approved.
create or replace view public.tenant_event_mail_readiness_v as
select
  c.id as company_id,
  c.name as company_name,
  coalesce(s.sender_email, c.primary_contact_email, c.support_email) as sender_email,
  coalesce(s.sender_name, c.name) as sender_name,
  coalesce(s.verification_status, 'not_started') as sender_verification_status,
  coalesce(s.is_active, false) as sender_is_active,
  coalesce(s.fallback_allowed, false) as fallback_allowed,
  count(t.id) filter (where t.is_active = true) as active_templates,
  count(r.id) filter (where r.enabled = true) as enabled_event_rules,
  case
    when coalesce(s.is_active, false) = true and lower(coalesce(s.verification_status,'')) = 'verified' then true
    when coalesce(s.is_active, false) = true and coalesce(s.fallback_allowed, false) = true then true
    else false
  end as can_send_customer_mail,
  array_remove(array[
    case when s.id is null then 'mail_sender_missing' end,
    case when s.id is not null and coalesce(s.is_active, false) = false then 'mail_sender_inactive' end,
    case when s.id is not null and lower(coalesce(s.verification_status,'')) <> 'verified' and coalesce(s.fallback_allowed, false) = false then 'mail_sender_not_verified' end,
    case when count(t.id) filter (where t.is_active = true) = 0 then 'mail_template_missing' end,
    case when count(r.id) filter (where r.enabled = true) = 0 then 'mail_event_rules_missing' end
  ], null) as blockers
from public.companies c
left join public.company_email_settings s on s.company_id = c.id
left join public.company_email_templates t on t.company_id = c.id
left join public.email_event_rules r on r.company_id = c.id
group by c.id, c.name, c.primary_contact_email, c.support_email, s.id, s.sender_email, s.sender_name, s.verification_status, s.is_active, s.fallback_allowed;

-- 7. Audit helper action categories are intentionally represented in data/views; UI maps these to plain Swedish labels.
