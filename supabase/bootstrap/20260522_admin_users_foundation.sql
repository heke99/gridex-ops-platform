-- GRIDEX-AUD-003 derived bootstrap: restore the historical platform admin projection.
-- Source provenance is corroborated by immutable DB1/RBAC migrations; column shape is recovered
-- from gridex-ops-dev on 2026-08-07. No administrator rows are seeded by this bootstrap.

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role text not null default 'admin',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create unique index if not exists ux_admin_users_user_id
  on public.admin_users(user_id)
  where user_id is not null;

create index if not exists idx_admin_users_active_role
  on public.admin_users(user_id, role, is_active);

alter table public.admin_users enable row level security;
