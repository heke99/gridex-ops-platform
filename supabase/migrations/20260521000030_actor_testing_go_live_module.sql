-- Actor testing & controlled production go-live for SaaS electricity suppliers.
-- Idempotent and additive. Does not change approved Ediel generators/validators.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- White-label platform foundation.
-- -----------------------------------------------------------------------------
create table if not exists public.white_label_platforms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  status text not null default 'active',
  support_email text null,
  billing_email text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint white_label_platforms_status_check check (status in ('active', 'paused', 'suspended', 'archived'))
);

create index if not exists white_label_platforms_status_idx
  on public.white_label_platforms(status, created_at desc);

create table if not exists public.white_label_platform_memberships (
  id uuid primary key default gen_random_uuid(),
  white_label_platform_id uuid not null references public.white_label_platforms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_role text not null default 'admin',
  status text not null default 'active',
  invited_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint white_label_platform_memberships_role_check check (membership_role in ('owner', 'admin', 'viewer')),
  constraint white_label_platform_memberships_status_check check (status in ('active', 'invited', 'disabled', 'removed')),
  constraint white_label_platform_memberships_user_key unique (white_label_platform_id, user_id)
);

create index if not exists white_label_platform_memberships_user_idx
  on public.white_label_platform_memberships(user_id, status);

create index if not exists white_label_platform_memberships_platform_idx
  on public.white_label_platform_memberships(white_label_platform_id, status);

-- -----------------------------------------------------------------------------
-- Company actor profile, BRP/eSett and test/production separation fields.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.companies') is not null then
    alter table public.companies add column if not exists white_label_platform_id uuid null references public.white_label_platforms(id) on delete set null;
    alter table public.companies add column if not exists market_role text null;
    alter table public.companies add column if not exists technical_contact_name text null;
    alter table public.companies add column if not exists technical_contact_email text null;
    alter table public.companies add column if not exists brp_name text null;
    alter table public.companies add column if not exists brp_ediel_id text null;
    alter table public.companies add column if not exists brp_status text null default 'missing';
    alter table public.companies add column if not exists esett_status text null default 'missing';
    alter table public.companies add column if not exists production_status text null default 'not_ready';
    alter table public.companies add column if not exists live_ediel_enabled boolean not null default false;
    alter table public.companies add column if not exists live_approved_by uuid null references auth.users(id) on delete set null;
    alter table public.companies add column if not exists live_approved_at timestamptz null;
    alter table public.companies add column if not exists live_blocked_reason text null;

    alter table public.companies add column if not exists test_ediel_id text null;
    alter table public.companies add column if not exists production_ediel_id text null;
    alter table public.companies add column if not exists test_sender_sub_address text null;
    alter table public.companies add column if not exists production_sender_sub_address text null;
    alter table public.companies add column if not exists test_mailbox text null;
    alter table public.companies add column if not exists production_mailbox text null;
    alter table public.companies add column if not exists test_application_reference text null;
    alter table public.companies add column if not exists production_application_reference text null;
    alter table public.companies add column if not exists test_counterparty_ediel_id text null;
    alter table public.companies add column if not exists production_counterparty_ediel_id text null;

    update public.companies
       set test_ediel_id = coalesce(test_ediel_id, ediel_id),
           production_ediel_id = coalesce(production_ediel_id, ediel_id),
           test_sender_sub_address = coalesce(test_sender_sub_address, sender_sub_address),
           test_mailbox = coalesce(test_mailbox, ediel_mailbox),
           production_mailbox = coalesce(production_mailbox, ediel_mailbox),
           market_role = coalesce(market_role, actor_role),
           technical_contact_email = coalesce(technical_contact_email, primary_contact_email),
           production_status = coalesce(production_status, 'not_ready'),
           brp_status = coalesce(brp_status, 'missing'),
           esett_status = coalesce(esett_status, 'missing')
     where test_ediel_id is null
        or production_ediel_id is null
        or test_sender_sub_address is null
        or test_mailbox is null
        or production_mailbox is null
        or market_role is null
        or technical_contact_email is null
        or production_status is null
        or brp_status is null
        or esett_status is null;

    create index if not exists companies_white_label_platform_idx on public.companies(white_label_platform_id);
    create index if not exists companies_production_status_idx on public.companies(production_status, live_ediel_enabled);
    create index if not exists companies_brp_status_idx on public.companies(brp_status);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Actor test result ledger. This is separate from raw Ediel messages so approval
-- evidence remains tenant-specific and easy to audit.
-- -----------------------------------------------------------------------------
create table if not exists public.actor_test_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  test_key text not null,
  test_name text null,
  test_id text null,
  package_key text null,
  message_family text null,
  message_code text null,
  direction text null,
  status text not null default 'not_started',
  latest_run_at timestamptz null,
  passed_at timestamptz null,
  failure_reason text null,
  portal_status text null,
  raw_payload text null,
  contrl_message_id uuid null,
  aperak_message_id uuid null,
  utilts_err_message_id uuid null,
  ediel_test_run_id uuid null,
  evidence jsonb not null default '{}'::jsonb,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint actor_test_results_status_check check (status in ('not_started', 'running', 'passed', 'failed', 'blocked', 'manual_verified')),
  constraint actor_test_results_direction_check check (direction is null or direction in ('actor_to_portal', 'portal_to_actor')),
  constraint actor_test_results_company_test_key unique (company_id, test_key)
);

create index if not exists actor_test_results_company_status_idx
  on public.actor_test_results(company_id, status, latest_run_at desc);

create index if not exists actor_test_results_package_idx
  on public.actor_test_results(company_id, package_key, status);

create table if not exists public.company_go_live_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'not_ready',
  blocker_summary jsonb not null default '[]'::jsonb,
  reviewed_by uuid null references auth.users(id) on delete set null,
  approved_by uuid null references auth.users(id) on delete set null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint company_go_live_reviews_status_check check (status in ('not_ready', 'blocked', 'production_prepared', 'live'))
);

create index if not exists company_go_live_reviews_company_created_idx
  on public.company_go_live_reviews(company_id, created_at desc);

-- Existing AGT/test-run tables may already exist in the project DB. Create a
-- guarded base if they are missing, then ensure company scope exists.
create table if not exists public.ediel_test_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  approval_version text null,
  role_code text not null,
  test_suite text not null,
  test_case_code text not null,
  title text null,
  status text not null default 'draft',
  customer_id uuid null,
  site_id uuid null,
  metering_point_id uuid null,
  grid_owner_id uuid null,
  started_at timestamptz null,
  completed_at timestamptz null,
  failure_reason text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null
);

alter table public.ediel_test_runs add column if not exists company_id uuid null references public.companies(id) on delete cascade;
create index if not exists ediel_test_runs_company_suite_case_status_idx
  on public.ediel_test_runs(company_id, test_suite, role_code, test_case_code, status, created_at desc);

create table if not exists public.ediel_test_run_messages (
  id uuid primary key default gen_random_uuid(),
  test_run_id uuid not null references public.ediel_test_runs(id) on delete cascade,
  ediel_message_id uuid not null,
  step_no integer null,
  expected_direction text null,
  expected_family text null,
  expected_code text null,
  created_at timestamptz not null default now()
);

create unique index if not exists ediel_test_run_messages_unique_step_message_idx
  on public.ediel_test_run_messages(test_run_id, ediel_message_id, coalesce(step_no, -1));

-- -----------------------------------------------------------------------------
-- Permissions and role seed for white-label admins.
-- -----------------------------------------------------------------------------
do $$
declare
  v_role_id uuid;
  v_permission_keys text[] := array[
    'whitelabel.read',
    'whitelabel.write',
    'tenants.read',
    'tenants.invite',
    'users.read',
    'users.write',
    'communication.read',
    'communication.send',
    'audit.read',
    'reports.read'
  ];
begin
  if to_regclass('public.permissions') is not null then
    insert into public.permissions(key, name, description)
    values
      ('whitelabel.read', 'Läsa white-label-scope', 'Kan se bolag, användare, aktörstest och produktionsstatus inom egen white-label-plattform.'),
      ('whitelabel.write', 'Ändra white-label-scope', 'Kan hantera egna white-label-bolag, aktörstester och produktionsförberedelser.')
    on conflict (key) do update
      set name = excluded.name,
          description = excluded.description;
  end if;

  if to_regclass('public.roles') is null then
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'roles' and column_name = 'is_system'
  ) then
    insert into public.roles(key, name, description, is_system)
    values ('white_label_platform_admin', 'White-label platform admin', 'Administrerar egna white-label-bolag och aktörstester.', true)
    on conflict (key) do update
      set name = excluded.name,
          description = excluded.description,
          is_system = true;
  else
    insert into public.roles(key, name, description)
    values ('white_label_platform_admin', 'White-label platform admin', 'Administrerar egna white-label-bolag och aktörstester.')
    on conflict (key) do update
      set name = excluded.name,
          description = excluded.description;
  end if;

  if to_regclass('public.role_permissions') is null or to_regclass('public.permissions') is null then
    return;
  end if;

  select id into v_role_id from public.roles where key = 'white_label_platform_admin';
  if v_role_id is not null then
    insert into public.role_permissions(role_id, permission_id)
    select v_role_id, p.id
    from public.permissions p
    where p.key = any(v_permission_keys)
    on conflict do nothing;
  end if;

  insert into public.role_permissions(role_id, permission_id)
  select r.id, p.id
  from public.roles r
  join public.permissions p on p.key in ('whitelabel.read', 'whitelabel.write')
  where r.key in ('super_admin', 'platform_admin')
  on conflict do nothing;
end $$;

-- -----------------------------------------------------------------------------
-- RLS policies.
-- -----------------------------------------------------------------------------
do $$
begin
  alter table public.white_label_platforms enable row level security;
  alter table public.white_label_platform_memberships enable row level security;
  alter table public.actor_test_results enable row level security;
  alter table public.company_go_live_reviews enable row level security;

  drop policy if exists white_label_platforms_read on public.white_label_platforms;
  create policy white_label_platforms_read on public.white_label_platforms
    for select using (
      public.gridex_user_is_platform_admin()
      or exists (
        select 1 from public.white_label_platform_memberships wlm
        where wlm.white_label_platform_id = white_label_platforms.id
          and wlm.user_id = auth.uid()
          and wlm.status = 'active'
      )
    );

  drop policy if exists white_label_platforms_write on public.white_label_platforms;
  create policy white_label_platforms_write on public.white_label_platforms
    for all using (public.gridex_user_is_platform_admin())
    with check (public.gridex_user_is_platform_admin());

  drop policy if exists white_label_platform_memberships_read on public.white_label_platform_memberships;
  create policy white_label_platform_memberships_read on public.white_label_platform_memberships
    for select using (
      public.gridex_user_is_platform_admin()
      or user_id = auth.uid()
      or exists (
        select 1 from public.white_label_platform_memberships self
        where self.white_label_platform_id = white_label_platform_memberships.white_label_platform_id
          and self.user_id = auth.uid()
          and self.status = 'active'
          and self.membership_role in ('owner', 'admin')
      )
    );

  drop policy if exists white_label_platform_memberships_write on public.white_label_platform_memberships;
  create policy white_label_platform_memberships_write on public.white_label_platform_memberships
    for all using (public.gridex_user_is_platform_admin())
    with check (public.gridex_user_is_platform_admin());

  drop policy if exists actor_test_results_read on public.actor_test_results;
  create policy actor_test_results_read on public.actor_test_results
    for select using (
      public.gridex_can_read_company(company_id)
      or exists (
        select 1
        from public.companies c
        join public.white_label_platform_memberships wlm on wlm.white_label_platform_id = c.white_label_platform_id
        where c.id = actor_test_results.company_id
          and wlm.user_id = auth.uid()
          and wlm.status = 'active'
      )
    );

  drop policy if exists actor_test_results_write on public.actor_test_results;
  create policy actor_test_results_write on public.actor_test_results
    for all using (
      public.gridex_user_is_platform_admin()
      or exists (
        select 1
        from public.companies c
        join public.white_label_platform_memberships wlm on wlm.white_label_platform_id = c.white_label_platform_id
        where c.id = actor_test_results.company_id
          and wlm.user_id = auth.uid()
          and wlm.status = 'active'
          and wlm.membership_role in ('owner', 'admin')
      )
    )
    with check (
      public.gridex_user_is_platform_admin()
      or exists (
        select 1
        from public.companies c
        join public.white_label_platform_memberships wlm on wlm.white_label_platform_id = c.white_label_platform_id
        where c.id = actor_test_results.company_id
          and wlm.user_id = auth.uid()
          and wlm.status = 'active'
          and wlm.membership_role in ('owner', 'admin')
      )
    );

  drop policy if exists company_go_live_reviews_read on public.company_go_live_reviews;
  create policy company_go_live_reviews_read on public.company_go_live_reviews
    for select using (public.gridex_can_read_company(company_id));

  drop policy if exists company_go_live_reviews_write on public.company_go_live_reviews;
  create policy company_go_live_reviews_write on public.company_go_live_reviews
    for all using (public.gridex_user_is_platform_admin())
    with check (public.gridex_user_is_platform_admin());
exception when undefined_function then
  -- Older local databases may not have the helper functions yet. The service-role
  -- server code still scopes writes explicitly, and later SaaS migrations define them.
  null;
end $$;
