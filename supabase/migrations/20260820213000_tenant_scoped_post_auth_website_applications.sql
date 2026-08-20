-- Tenant-scoped website application identity policy.
--
-- The API credential is the tenant authority. A website request never chooses
-- company_id. Each application is bound to the company derived from its
-- integration_api_client, and the database rejects cross-tenant references.
--
-- Portal identity remains part of the canonical customer lifecycle, but the
-- time at which it must exist is tenant configurable:
--   pre_auth_required  - verified portal UUID pair is required at submission.
--   post_auth_allowed  - anonymous checkout is allowed; portal auth is linked
--                        later inside the same tenant.
-- Existing tenants keep the previous pre-auth behaviour unless explicitly
-- configured otherwise.

begin;

alter table public.website_customer_applications
  add column if not exists portal_identity_submission_mode text;

update public.website_customer_applications
set portal_identity_submission_mode = case
  when coalesce(portal_identity_required, false) is true
   and nullif(btrim(coalesce(payload ->> 'auth_user_id', '')), '') is not null
   and nullif(btrim(coalesce(payload ->> 'customer_portal_user_id', '')), '') is not null
   and payload ->> 'auth_user_id' = payload ->> 'customer_portal_user_id'
    then 'pre_auth_required'
  else 'legacy'
end
where portal_identity_submission_mode is null;

alter table public.website_customer_applications
  alter column portal_identity_submission_mode set default 'pre_auth_required';

alter table public.website_customer_applications
  alter column portal_identity_submission_mode set not null;

alter table public.website_customer_applications
  drop constraint if exists website_customer_applications_portal_identity_submission_mode_check;

alter table public.website_customer_applications
  add constraint website_customer_applications_portal_identity_submission_mode_check
  check (portal_identity_submission_mode in ('pre_auth_required', 'post_auth_allowed', 'legacy'));

comment on column public.website_customer_applications.portal_identity_required is
  'True when the canonical customer lifecycle requires a portal identity. This does not imply that authentication must happen before checkout; portal_identity_submission_mode records that tenant-specific timing policy.';

comment on column public.website_customer_applications.portal_identity_submission_mode is
  'Immutable submission-time tenant policy: pre_auth_required, post_auth_allowed, or legacy for historical rows.';

create or replace function public.gridex_validate_website_application_portal_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id text;
  v_portal_user_id text;
  v_mode text;
begin
  if tg_op = 'INSERT' then
    -- Canonical website customers always participate in the portal identity
    -- lifecycle, but the tenant decides whether that identity is required now
    -- or may be linked after checkout.
    if coalesce(new.portal_identity_required, false) is not true then
      raise exception using
        errcode = '23514',
        message = 'portal_identity_lifecycle_required',
        detail = 'New website applications require portal_identity_required=true.';
    end if;

    select case lower(coalesce(c.metadata ->> 'website_portal_identity_mode', 'pre_auth_required'))
      when 'post_auth_allowed' then 'post_auth_allowed'
      else 'pre_auth_required'
    end
    into v_mode
    from public.companies c
    where c.id = new.company_id;

    if v_mode is null then
      raise exception using
        errcode = '23503',
        message = 'website_application_tenant_not_found',
        detail = 'The application company_id must identify an existing tenant.';
    end if;

    -- Freeze the policy that applied when the request was accepted so later
    -- tenant configuration changes cannot make historical rows un-updateable.
    new.portal_identity_submission_mode := v_mode;
  else
    if new.company_id is distinct from old.company_id then
      raise exception using
        errcode = '23514',
        message = 'website_application_tenant_change_forbidden',
        detail = 'A website application can never move between tenants.';
    end if;

    if coalesce(old.portal_identity_required, false) is true
       and coalesce(new.portal_identity_required, false) is not true then
      raise exception using
        errcode = '23514',
        message = 'portal_identity_lifecycle_downgrade_forbidden',
        detail = 'A canonical website application cannot disable portal identity lifecycle enforcement.';
    end if;

    if new.portal_identity_submission_mode is distinct from old.portal_identity_submission_mode then
      raise exception using
        errcode = '23514',
        message = 'portal_identity_submission_mode_immutable',
        detail = 'The submission-time portal identity policy is immutable.';
    end if;

    v_mode := old.portal_identity_submission_mode;
  end if;

  -- Historical rows created before this policy model remain operationally
  -- updateable. If a valid pair is later supplied, it is still validated below.
  if v_mode = 'legacy' then
    v_auth_user_id := nullif(btrim(coalesce(new.payload ->> 'auth_user_id', '')), '');
    v_portal_user_id := nullif(btrim(coalesce(new.payload ->> 'customer_portal_user_id', '')), '');
    if v_auth_user_id is null and v_portal_user_id is null then
      return new;
    end if;
  else
    v_auth_user_id := nullif(btrim(coalesce(new.payload ->> 'auth_user_id', '')), '');
    v_portal_user_id := nullif(btrim(coalesce(new.payload ->> 'customer_portal_user_id', '')), '');
  end if;

  -- Never accept a half-present identity. Optional means both absent, not one
  -- identifier without the other.
  if (v_auth_user_id is null) <> (v_portal_user_id is null) then
    raise exception using
      errcode = '23514',
      message = 'website_portal_identity_pair_required',
      detail = 'auth_user_id and customer_portal_user_id must either both be absent or both be present.';
  end if;

  if v_auth_user_id is null then
    if v_mode = 'pre_auth_required' then
      raise exception using
        errcode = '23514',
        message = 'portal_auth_identity_required',
        detail = 'This tenant requires auth_user_id and customer_portal_user_id before submission.';
    end if;
    return new;
  end if;

  if v_auth_user_id is distinct from v_portal_user_id
     or v_auth_user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '23514',
      message = 'portal_auth_identity_mismatch',
      detail = 'Portal identifiers must be the same valid UUID from one verified tenant server session.';
  end if;

  return new;
end;
$$;

revoke all on function public.gridex_validate_website_application_portal_identity()
  from public, anon, authenticated;
grant execute on function public.gridex_validate_website_application_portal_identity()
  to service_role;

-- Defense in depth: critical website/portal relationships are tenant-bound in
-- the database, not only by application query filters.
create unique index if not exists integration_api_clients_company_id_id_uidx
  on public.integration_api_clients(company_id, id);
create unique index if not exists customer_portal_identities_company_id_id_uidx
  on public.customer_portal_identities(company_id, id);
create unique index if not exists customer_portal_accounts_company_id_id_uidx
  on public.customer_portal_accounts(company_id, id);

alter table public.website_customer_applications
  drop constraint if exists website_customer_applications_company_api_client_fkey;
alter table public.website_customer_applications
  add constraint website_customer_applications_company_api_client_fkey
  foreign key (company_id, api_client_id)
  references public.integration_api_clients(company_id, id)
  on delete restrict
  not valid;
alter table public.website_customer_applications
  validate constraint website_customer_applications_company_api_client_fkey;

alter table public.website_customer_applications
  drop constraint if exists website_customer_applications_company_customer_fkey;
alter table public.website_customer_applications
  add constraint website_customer_applications_company_customer_fkey
  foreign key (company_id, customer_id)
  references public.customers(company_id, id)
  on delete restrict
  not valid;
alter table public.website_customer_applications
  validate constraint website_customer_applications_company_customer_fkey;

alter table public.website_customer_applications
  drop constraint if exists website_customer_applications_company_site_fkey;
alter table public.website_customer_applications
  add constraint website_customer_applications_company_site_fkey
  foreign key (company_id, customer_site_id)
  references public.customer_sites(company_id, id)
  on delete restrict
  not valid;
alter table public.website_customer_applications
  validate constraint website_customer_applications_company_site_fkey;

alter table public.website_customer_applications
  drop constraint if exists website_customer_applications_company_metering_point_fkey;
alter table public.website_customer_applications
  add constraint website_customer_applications_company_metering_point_fkey
  foreign key (company_id, metering_point_id)
  references public.metering_points(company_id, id)
  on delete restrict
  not valid;
alter table public.website_customer_applications
  validate constraint website_customer_applications_company_metering_point_fkey;

alter table public.website_customer_applications
  drop constraint if exists website_customer_applications_company_contract_fkey;
alter table public.website_customer_applications
  add constraint website_customer_applications_company_contract_fkey
  foreign key (company_id, contract_id)
  references public.customer_contracts(company_id, id)
  on delete restrict
  not valid;
alter table public.website_customer_applications
  validate constraint website_customer_applications_company_contract_fkey;

alter table public.customer_portal_identities
  drop constraint if exists customer_portal_identities_company_api_client_fkey;
alter table public.customer_portal_identities
  add constraint customer_portal_identities_company_api_client_fkey
  foreign key (company_id, api_client_id)
  references public.integration_api_clients(company_id, id)
  on delete restrict
  not valid;
alter table public.customer_portal_identities
  validate constraint customer_portal_identities_company_api_client_fkey;

alter table public.customer_portal_identities
  drop constraint if exists customer_portal_identities_company_customer_fkey;
alter table public.customer_portal_identities
  add constraint customer_portal_identities_company_customer_fkey
  foreign key (company_id, customer_id)
  references public.customers(company_id, id)
  on delete restrict
  not valid;
alter table public.customer_portal_identities
  validate constraint customer_portal_identities_company_customer_fkey;

alter table public.customer_portal_accounts
  drop constraint if exists customer_portal_accounts_company_customer_fkey;
alter table public.customer_portal_accounts
  add constraint customer_portal_accounts_company_customer_fkey
  foreign key (company_id, customer_id)
  references public.customers(company_id, id)
  on delete restrict
  not valid;
alter table public.customer_portal_accounts
  validate constraint customer_portal_accounts_company_customer_fkey;

commit;