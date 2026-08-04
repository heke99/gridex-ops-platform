-- Align the human API guide, runtime contract and database invariant:
-- every new website customer application is authenticated before submission.
-- Historical legacy rows that predate the mandatory portal identity contract
-- remain updateable for operational status reconciliation.

begin;

alter table if exists public.website_customer_applications
  alter column portal_identity_required set default true;

create or replace function public.gridex_validate_website_application_portal_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id text;
  v_portal_user_id text;
begin
  -- Every newly inserted website application must opt into and satisfy the
  -- canonical pre-authenticated portal identity contract. The flag is stored
  -- for auditability, but it is not a client-controlled bypass.
  if tg_op = 'INSERT' and coalesce(new.portal_identity_required, false) is not true then
    raise exception using
      errcode = '23514',
      message = 'portal_auth_identity_required',
      detail = 'New website applications require portal_identity_required=true.';
  end if;

  -- Once a row is canonical it can never be downgraded to the legacy mode.
  if tg_op = 'UPDATE'
     and coalesce(old.portal_identity_required, false) is true
     and coalesce(new.portal_identity_required, false) is not true then
    raise exception using
      errcode = '23514',
      message = 'portal_auth_identity_downgrade_forbidden',
      detail = 'A canonical website application cannot disable portal identity enforcement.';
  end if;

  -- Preserve operational updates of historical rows created before the
  -- mandatory pre-auth contract. New inserts can never enter this branch.
  if tg_op = 'UPDATE'
     and coalesce(old.portal_identity_required, false) is not true
     and coalesce(new.portal_identity_required, false) is not true then
    return new;
  end if;

  v_auth_user_id := nullif(trim(coalesce(new.payload ->> 'auth_user_id', '')), '');
  v_portal_user_id := nullif(trim(coalesce(new.payload ->> 'customer_portal_user_id', '')), '');

  if v_auth_user_id is null or v_portal_user_id is null then
    raise exception using
      errcode = '23514',
      message = 'portal_auth_identity_required',
      detail = 'Website applications require auth_user_id and customer_portal_user_id before submission.';
  end if;

  if v_auth_user_id <> v_portal_user_id
     or v_auth_user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '23514',
      message = 'portal_auth_identity_mismatch',
      detail = 'Portal identifiers must be the same valid UUID from one verified server session.';
  end if;

  return new;
end;
$$;

revoke all on function public.gridex_validate_website_application_portal_identity()
  from public, anon, authenticated;
grant execute on function public.gridex_validate_website_application_portal_identity()
  to service_role;

comment on column public.website_customer_applications.portal_identity_required is
  'True for every canonical website application. New rows require a pre-authenticated tenant portal UUID pair; false is retained only for historical legacy rows.';

-- Canonicalize already-created rows when their payload already contains the
-- valid paired identity. Rows without it remain legacy and can still be
-- reconciled operationally, but cannot be recreated as new applications.
update public.website_customer_applications
set portal_identity_required = true,
    updated_at = now()
where coalesce(portal_identity_required, false) is not true
  and nullif(trim(coalesce(payload ->> 'auth_user_id', '')), '') is not null
  and nullif(trim(coalesce(payload ->> 'customer_portal_user_id', '')), '') is not null
  and payload ->> 'auth_user_id' = payload ->> 'customer_portal_user_id'
  and payload ->> 'auth_user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

commit;
