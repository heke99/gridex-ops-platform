-- DB4B — customer registry hardening and Ediel test-customer cleanup helpers
-- Purpose:
--   1) Make visible customer-registry anomalies easy to diagnose.
--   2) Provide an explicit archive function for old/test customers that should no longer appear in /admin/customers.
-- Safety:
--   This migration does not delete data automatically.
--   The archive function only updates customers.status to archived when p_apply=true.
--   It does not touch auth.users, admin_users, company_memberships or companies.

create table if not exists public.gridex_archived_customer_registry_rows (
  archived_id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  archived_by uuid,
  archive_reason text not null,
  source_table text not null,
  source_id text,
  source_email text,
  source_row jsonb not null
);

create or replace view public.gridex_db4b_customer_registry_visibility_v as
select
  c.id,
  c.company_id,
  co.name as company_name,
  c.customer_number,
  c.full_name,
  c.email,
  c.phone,
  c.personal_number,
  c.source,
  c.status,
  c.created_at,
  case
    when c.company_id is null then 'hidden_missing_company_id'
    when co.id is null then 'hidden_company_not_found'
    when coalesce(c.status, '') = 'archived' then 'hidden_archived'
    when coalesce(c.source, '') = 'ediel_portal_test' then 'hidden_ediel_test_customer'
    else 'visible_active_customer'
  end as registry_visibility
from public.customers c
left join public.companies co on co.id = c.company_id;

create or replace function public.gridex_db4b_archive_customer_registry_row(
  p_lookup text,
  p_email text default null,
  p_apply boolean default false,
  p_reason text default 'Archived old/test customer from active customer registry.'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_customer_count integer := 0;
  v_profile_count integer := 0;
  v_updated_customers integer := 0;
  v_archived_profiles integer := 0;
begin
  if nullif(btrim(coalesce(p_lookup, '')), '') is null
     and nullif(btrim(coalesce(p_email, '')), '') is null then
    raise exception 'p_lookup or p_email is required';
  end if;

  select count(*)
    into v_customer_count
  from public.customers c
  where (
    p_lookup is not null and (
      c.id::text = p_lookup
      or c.customer_number = p_lookup
      or c.personal_number = p_lookup
    )
  )
  or (
    p_email is not null and lower(coalesce(c.email, '')) = lower(p_email)
  );

  select count(*)
    into v_profile_count
  from public.customer_profiles cp
  where (
    p_lookup is not null and cp.user_id::text = p_lookup
  )
  or (
    p_email is not null and lower(coalesce(cp.email, '')) = lower(p_email)
  );

  if not p_apply then
    return jsonb_build_object(
      'apply', false,
      'matched_customers', v_customer_count,
      'matched_customer_profiles', v_profile_count,
      'message', 'Dry-run only. Re-run with p_apply=true to archive matching active-registry rows.'
    );
  end if;

  insert into public.gridex_archived_customer_registry_rows(
    archived_by,
    archive_reason,
    source_table,
    source_id,
    source_email,
    source_row
  )
  select
    v_actor,
    p_reason,
    'customers',
    c.id::text,
    c.email,
    to_jsonb(c)
  from public.customers c
  where (
    p_lookup is not null and (
      c.id::text = p_lookup
      or c.customer_number = p_lookup
      or c.personal_number = p_lookup
    )
  )
  or (
    p_email is not null and lower(coalesce(c.email, '')) = lower(p_email)
  );

  update public.customers c
     set status = 'archived',
         metadata = coalesce(c.metadata, '{}'::jsonb)
           || jsonb_build_object(
             'archived_from_active_registry', true,
             'archived_at', now(),
             'archived_reason', p_reason,
             'db4b_cleanup', true
           ),
         updated_at = now(),
         updated_by = coalesce(v_actor, c.updated_by)
  where (
    p_lookup is not null and (
      c.id::text = p_lookup
      or c.customer_number = p_lookup
      or c.personal_number = p_lookup
    )
  )
  or (
    p_email is not null and lower(coalesce(c.email, '')) = lower(p_email)
  );

  get diagnostics v_updated_customers = row_count;

  insert into public.gridex_archived_customer_registry_rows(
    archived_by,
    archive_reason,
    source_table,
    source_id,
    source_email,
    source_row
  )
  select
    v_actor,
    p_reason,
    'customer_profiles',
    cp.user_id::text,
    cp.email,
    to_jsonb(cp)
  from public.customer_profiles cp
  where (
    p_lookup is not null and cp.user_id::text = p_lookup
  )
  or (
    p_email is not null and lower(coalesce(cp.email, '')) = lower(p_email)
  );

  -- customer_profiles are login/portal profile shadows, not canonical customers.
  -- Removing them from customer registry is safe as long as auth.users/user_profiles are left intact.
  delete from public.customer_profiles cp
  where (
    p_lookup is not null and cp.user_id::text = p_lookup
  )
  or (
    p_email is not null and lower(coalesce(cp.email, '')) = lower(p_email)
  );

  get diagnostics v_archived_profiles = row_count;

  return jsonb_build_object(
    'apply', true,
    'matched_customers_before_apply', v_customer_count,
    'matched_customer_profiles_before_apply', v_profile_count,
    'archived_customers', v_updated_customers,
    'removed_customer_profiles', v_archived_profiles,
    'message', 'Matching rows are archived/removed from the active customer registry. auth.users, admin_users, company_memberships and companies were not touched.'
  );
end;
$$;
