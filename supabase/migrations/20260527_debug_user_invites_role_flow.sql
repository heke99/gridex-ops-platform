-- Debug: user invite flow roles and reflection
-- Ensures all tenant-safe role keys used by the invite UI exist in public.roles.

do $$
declare
  r record;
begin
  if to_regclass('public.roles') is null then
    return;
  end if;

  alter table public.roles add column if not exists key text;
  alter table public.roles add column if not exists scope text default 'company';
  alter table public.roles add column if not exists is_system boolean not null default false;

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
           is_system = true
     where key = r.key;

    if not found then
      insert into public.roles (key, name, description, scope, is_system)
      values (r.key, r.name, r.description, r.scope, true);
    end if;
  end loop;
end $$;

-- Make the invite/member tables tolerant of all tenant membership states that the UI uses.
do $$
begin
  if to_regclass('public.company_memberships') is not null then
    alter table public.company_memberships add column if not exists role_key text;
    alter table public.company_memberships add column if not exists metadata jsonb default '{}'::jsonb;

    alter table public.company_memberships drop constraint if exists company_memberships_role_check;
    alter table public.company_memberships
      add constraint company_memberships_role_check
      check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));

    alter table public.company_memberships drop constraint if exists company_memberships_status_check;
    alter table public.company_memberships
      add constraint company_memberships_status_check
      check (status in ('active', 'invited', 'pending', 'suspended', 'disabled', 'removed', 'removed_from_company', 'invitation_revoked', 'locked_security', 'revoked'));
  end if;

  if to_regclass('public.company_invitations') is not null then
    alter table public.company_invitations add column if not exists role_key text;
    alter table public.company_invitations add column if not exists metadata jsonb default '{}'::jsonb;

    alter table public.company_invitations drop constraint if exists company_invitations_membership_role_check;
    alter table public.company_invitations
      add constraint company_invitations_membership_role_check
      check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));

    alter table public.company_invitations drop constraint if exists company_invitations_status_check;
    alter table public.company_invitations
      add constraint company_invitations_status_check
      check (status in ('pending', 'accepted', 'revoked', 'expired', 'invitation_revoked', 'invited', 'sent', 'failed'));
  end if;
end $$;
