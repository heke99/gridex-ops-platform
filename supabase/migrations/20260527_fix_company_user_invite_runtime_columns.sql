-- Debug fix: company user invite/user-list runtime schema compatibility
-- Adds the columns that the invite and company user pages use, idempotently.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.roles') is not null then
    alter table public.roles add column if not exists key text;
    alter table public.roles add column if not exists description text;
    alter table public.roles add column if not exists scope text default 'company';
    alter table public.roles add column if not exists is_system boolean not null default false;
    alter table public.roles add column if not exists is_system_role boolean not null default false;
    alter table public.roles add column if not exists is_active boolean not null default true;
  end if;

  if to_regclass('public.company_memberships') is not null then
    alter table public.company_memberships add column if not exists role text;
    alter table public.company_memberships add column if not exists role_id uuid;
    alter table public.company_memberships add column if not exists membership_role text default 'member';
    alter table public.company_memberships add column if not exists role_key text;
    alter table public.company_memberships add column if not exists status text default 'active';
    alter table public.company_memberships add column if not exists is_active boolean default true;
    alter table public.company_memberships add column if not exists invited_email text;
    alter table public.company_memberships add column if not exists invited_by uuid;
    alter table public.company_memberships add column if not exists invited_at timestamptz;
    alter table public.company_memberships add column if not exists accepted_at timestamptz;
    alter table public.company_memberships add column if not exists joined_at timestamptz;
    alter table public.company_memberships add column if not exists disabled_at timestamptz;
    alter table public.company_memberships add column if not exists disabled_by uuid;
    alter table public.company_memberships add column if not exists removed_at timestamptz;
    alter table public.company_memberships add column if not exists removed_by uuid;
    alter table public.company_memberships add column if not exists status_reason text;
    alter table public.company_memberships add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.company_memberships add column if not exists created_at timestamptz default now();
    alter table public.company_memberships add column if not exists updated_at timestamptz default now();

    update public.company_memberships
       set membership_role = coalesce(nullif(membership_role, ''), nullif(role, ''), 'member'),
           role = coalesce(nullif(role, ''), nullif(membership_role, ''), 'member'),
           role_key = coalesce(
             nullif(role_key, ''),
             case
               when coalesce(nullif(membership_role, ''), nullif(role, ''), 'member') in ('owner', 'admin', 'company_admin') then 'company_admin'
               when coalesce(nullif(membership_role, ''), nullif(role, ''), 'member') = 'operations' then 'operations_manager'
               when coalesce(nullif(membership_role, ''), nullif(role, ''), 'member') = 'support' then 'customer_service_agent'
               when coalesce(nullif(membership_role, ''), nullif(role, ''), 'member') = 'viewer' then 'executive_readonly'
               else coalesce(nullif(membership_role, ''), nullif(role, ''), 'member')
             end
           ),
           status = coalesce(nullif(status, ''), 'active'),
           is_active = coalesce(is_active, true),
           invited_at = coalesce(invited_at, joined_at, created_at, now()),
           accepted_at = case when coalesce(status, 'active') = 'active' then coalesce(accepted_at, joined_at, created_at, now()) else accepted_at end,
           metadata = coalesce(metadata, '{}'::jsonb),
           updated_at = coalesce(updated_at, now());

    alter table public.company_memberships drop constraint if exists company_memberships_role_check;
    alter table public.company_memberships
      add constraint company_memberships_role_check
      check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));

    alter table public.company_memberships drop constraint if exists company_memberships_status_check;
    alter table public.company_memberships
      add constraint company_memberships_status_check
      check (status in ('active', 'invited', 'pending', 'suspended', 'disabled', 'removed', 'removed_from_company', 'invitation_revoked', 'locked_security', 'revoked'));

    create unique index if not exists company_memberships_company_user_uidx
      on public.company_memberships(company_id, user_id)
      where company_id is not null and user_id is not null;

    create index if not exists company_memberships_company_status_idx
      on public.company_memberships(company_id, status);
  end if;

  if to_regclass('public.company_invitations') is not null then
    alter table public.company_invitations add column if not exists email text;
    alter table public.company_invitations add column if not exists invited_email text;
    alter table public.company_invitations add column if not exists full_name text;
    alter table public.company_invitations add column if not exists role text;
    alter table public.company_invitations add column if not exists role_id uuid;
    alter table public.company_invitations add column if not exists membership_role text default 'member';
    alter table public.company_invitations add column if not exists role_key text;
    alter table public.company_invitations add column if not exists status text default 'pending';
    alter table public.company_invitations add column if not exists invited_by uuid;
    alter table public.company_invitations add column if not exists invited_user_id uuid;
    alter table public.company_invitations add column if not exists expires_at timestamptz;
    alter table public.company_invitations add column if not exists accepted_at timestamptz;
    alter table public.company_invitations add column if not exists revoked_at timestamptz;
    alter table public.company_invitations add column if not exists created_at timestamptz default now();
    alter table public.company_invitations add column if not exists updated_at timestamptz default now();
    alter table public.company_invitations add column if not exists metadata jsonb default '{}'::jsonb;

    update public.company_invitations
       set invited_email = coalesce(nullif(invited_email, ''), nullif(email, '')),
           email = coalesce(nullif(email, ''), nullif(invited_email, '')),
           membership_role = coalesce(nullif(membership_role, ''), nullif(role, ''), 'member'),
           role = coalesce(nullif(role, ''), nullif(membership_role, ''), 'member'),
           role_key = coalesce(nullif(role_key, ''), case when coalesce(nullif(membership_role, ''), nullif(role, ''), 'member') in ('owner','admin','company_admin') then 'company_admin' else coalesce(nullif(membership_role, ''), nullif(role, ''), 'member') end),
           status = coalesce(nullif(status, ''), 'pending'),
           metadata = coalesce(metadata, '{}'::jsonb),
           updated_at = coalesce(updated_at, now());

    alter table public.company_invitations drop constraint if exists company_invitations_membership_role_check;
    alter table public.company_invitations
      add constraint company_invitations_membership_role_check
      check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));

    alter table public.company_invitations drop constraint if exists company_invitations_status_check;
    alter table public.company_invitations
      add constraint company_invitations_status_check
      check (status in ('pending', 'accepted', 'revoked', 'expired', 'invitation_revoked', 'invited', 'sent', 'failed'));

    create index if not exists company_invitations_company_status_idx
      on public.company_invitations(company_id, status);
  end if;
end $$;

-- Ensure all tenant-safe role keys used by the invite UI exist.
do $$
declare
  r record;
begin
  if to_regclass('public.roles') is null then
    return;
  end if;

  for r in
    select * from (values
      ('company_admin', 'company_admin', 'Company admin access scoped to own tenant.', 'company'),
      ('admin', 'admin', 'Broad company admin access scoped to own tenant.', 'company'),
      ('operations_manager', 'operations_manager', 'Operations manager scoped to own tenant.', 'company'),
      ('operations_agent', 'operations_agent', 'Operations agent scoped to own tenant.', 'company'),
      ('customer_service_manager', 'customer_service_manager', 'Customer service manager scoped to own tenant.', 'company'),
      ('customer_service_agent', 'customer_service_agent', 'Customer service access scoped to own tenant.', 'company'),
      ('sales_manager', 'sales_manager', 'Sales and customer intake access scoped to own tenant.', 'company'),
      ('pricing_manager', 'pricing_manager', 'Pricing draft access scoped to own tenant.', 'company'),
      ('pricing_approver', 'pricing_approver', 'Pricing approval access scoped to own tenant.', 'company'),
      ('finance_readonly', 'finance_readonly', 'Finance read-only access scoped to own tenant.', 'company'),
      ('executive_readonly', 'executive_readonly', 'Executive read-only access scoped to own tenant.', 'company'),
      ('compliance_manager', 'compliance_manager', 'Compliance and audit access scoped to own tenant.', 'company'),
      ('partner_manager', 'partner_manager', 'Partner/export access scoped to own tenant.', 'company'),
      ('partner_api_user', 'partner_api_user', 'Technical partner/API access.', 'company')
    ) as v(key, name, description, scope)
  loop
    update public.roles
       set name = r.name,
           description = coalesce(public.roles.description, r.description),
           scope = coalesce(public.roles.scope, r.scope),
           is_system = true,
           is_system_role = true,
           is_active = true
     where key = r.key;

    if not found then
      insert into public.roles (key, name, description, scope, is_system, is_system_role, is_active)
      values (r.key, r.name, r.description, r.scope, true, true, true);
    end if;
  end loop;
end $$;
