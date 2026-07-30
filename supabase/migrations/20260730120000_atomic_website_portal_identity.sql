-- Bind a verified website auth identity to the canonical customer in the same
-- transaction that commits the website application/quote/customer graph.
-- Existing duplicate identities intentionally make this migration fail closed:
-- they must be reconciled before a unique auth subject can be enforced.

begin;

create unique index if not exists customer_portal_identities_company_provider_auth_uidx
  on public.customer_portal_identities(company_id, provider, auth_user_id)
  where auth_user_id is not null;

create unique index if not exists customer_portal_identities_company_provider_portal_user_uidx
  on public.customer_portal_identities(company_id, provider, customer_portal_user_id)
  where customer_portal_user_id is not null;

create unique index if not exists customer_portal_accounts_company_portal_user_uidx
  on public.customer_portal_accounts(company_id, portal_user_id)
  where portal_user_id is not null;

create or replace function public.gridex_commit_website_portal_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_auth_user_id_text text :=
    nullif(btrim(coalesce(new.payload->>'auth_user_id', '')), '');
  v_portal_user_id_text text :=
    nullif(btrim(coalesce(new.payload->>'customer_portal_user_id', '')), '');
  v_auth_user_id uuid;
  v_identity_id uuid;
  v_email text :=
    nullif(lower(btrim(coalesce(new.payload#>>'{customer,email}', ''))), '');
begin
  if new.customer_id is null then
    return new;
  end if;

  if (v_auth_user_id_text is null) <> (v_portal_user_id_text is null) then
    raise exception using
      errcode = '23514',
      message = 'website_portal_identity_pair_required';
  end if;
  if v_auth_user_id_text is null then
    return new;
  end if;
  if v_auth_user_id_text is distinct from v_portal_user_id_text
     or v_auth_user_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '23514',
      message = 'website_portal_identity_mismatch';
  end if;

  v_auth_user_id := v_auth_user_id_text::uuid;

  insert into public.customer_portal_identities(
    company_id,
    customer_id,
    api_client_id,
    provider,
    external_customer_id,
    external_account_id,
    customer_number,
    auth_user_id,
    customer_portal_user_id,
    email,
    status,
    match_strength,
    match_method,
    linked_at,
    last_resolved_at,
    metadata,
    updated_at
  ) values (
    new.company_id,
    new.customer_id,
    new.api_client_id,
    'gridex_website',
    new.external_customer_id,
    v_auth_user_id_text,
    new.customer_number,
    v_auth_user_id,
    v_auth_user_id,
    v_email,
    'active',
    'strong',
    'atomic_website_application_auth',
    now(),
    now(),
    jsonb_build_object(
      'source', 'website_customer_application',
      'application_id', new.id,
      'atomic_commit', true
    ),
    now()
  )
  on conflict (company_id, provider, external_customer_id)
  do update set
    customer_id = excluded.customer_id,
    api_client_id = excluded.api_client_id,
    external_account_id = excluded.external_account_id,
    customer_number = excluded.customer_number,
    auth_user_id = excluded.auth_user_id,
    customer_portal_user_id = excluded.customer_portal_user_id,
    email = excluded.email,
    status = 'active',
    match_strength = 'strong',
    match_method = 'atomic_website_application_auth',
    linked_at = coalesce(customer_portal_identities.linked_at, now()),
    last_resolved_at = now(),
    metadata = coalesce(customer_portal_identities.metadata, '{}'::jsonb) ||
      excluded.metadata,
    updated_at = now()
  where customer_portal_identities.customer_id is null
     or customer_portal_identities.customer_id = excluded.customer_id
  returning id into v_identity_id;

  if v_identity_id is null then
    raise exception using
      errcode = '23505',
      message = 'website_portal_identity_customer_conflict';
  end if;

  insert into public.customer_portal_accounts(
    company_id,
    customer_id,
    portal_user_id,
    external_account_id,
    customer_number,
    external_customer_id,
    role,
    email,
    user_email,
    status,
    is_active,
    activated_at,
    verified_at,
    match_method,
    verified_identity_snapshot,
    metadata
  ) values (
    new.company_id,
    new.customer_id,
    v_auth_user_id,
    v_auth_user_id_text,
    new.customer_number,
    new.external_customer_id,
    'owner',
    v_email,
    v_email,
    'active',
    true,
    now(),
    now(),
    'atomic_website_application_auth',
    jsonb_build_object(
      'auth_user_id', v_auth_user_id,
      'customer_portal_user_id', v_auth_user_id,
      'portal_identity_id', v_identity_id
    ),
    jsonb_build_object(
      'source', 'website_customer_application',
      'application_id', new.id,
      'atomic_commit', true
    )
  )
  on conflict do nothing;

  if not exists (
    select 1
    from public.customer_portal_accounts account
    where account.company_id = new.company_id
      and account.portal_user_id = v_auth_user_id
      and account.customer_id = new.customer_id
      and account.is_active = true
  ) then
    raise exception using
      errcode = '23505',
      message = 'website_portal_account_customer_conflict';
  end if;

  return new;
end
$$;

drop trigger if exists website_application_atomic_portal_identity
  on public.website_customer_applications;
create trigger website_application_atomic_portal_identity
  after insert or update
  on public.website_customer_applications
  for each row
  when (new.customer_id is not null)
  execute function public.gridex_commit_website_portal_identity();

revoke all on function public.gridex_commit_website_portal_identity()
  from public, anon, authenticated;

comment on function public.gridex_commit_website_portal_identity() is
  'Fails the canonical website onboarding transaction unless the paired auth subject, portal identity and owner portal account commit for the same tenant/customer.';

commit;
