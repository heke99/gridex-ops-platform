\set ON_ERROR_STOP on
\pset pager off

\if :{?company_a_id}
\else
  \echo 'company_a_id is required'
  \quit 2
\endif
\if :{?company_b_id}
\else
  \echo 'company_b_id is required'
  \quit 2
\endif
\if :{?user_a_id}
\else
  \echo 'user_a_id is required'
  \quit 2
\endif
\if :{?user_b_id}
\else
  \echo 'user_b_id is required'
  \quit 2
\endif

begin;
select set_config('gridex.test.company_a_id', :'company_a_id', true);
select set_config('gridex.test.company_b_id', :'company_b_id', true);
select set_config('gridex.test.user_a_id', :'user_a_id', true);
select set_config('gridex.test.user_b_id', :'user_b_id', true);

-- Preconditions require real active authenticated memberships and at least one attempt per tenant.
do $$
begin
  if not exists(select 1 from public.company_memberships where company_id=current_setting('gridex.test.company_a_id')::uuid and user_id=current_setting('gridex.test.user_a_id')::uuid and status='active') then
    raise exception 'fixture_user_a_membership_missing';
  end if;
  if not exists(select 1 from public.company_memberships where company_id=current_setting('gridex.test.company_b_id')::uuid and user_id=current_setting('gridex.test.user_b_id')::uuid and status='active') then
    raise exception 'fixture_user_b_membership_missing';
  end if;
  if not exists(select 1 from public.actor_test_attempts where company_id=current_setting('gridex.test.company_a_id')::uuid) then
    raise exception 'fixture_company_a_attempt_missing';
  end if;
  if not exists(select 1 from public.actor_test_attempts where company_id=current_setting('gridex.test.company_b_id')::uuid) then
    raise exception 'fixture_company_b_attempt_missing';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.user_a_id'), true);
do $$
begin
  if exists(select 1 from public.actor_test_attempts where company_id=current_setting('gridex.test.company_b_id')::uuid) then
    raise exception 'rls_user_a_can_read_company_b';
  end if;
  if not exists(select 1 from public.actor_test_attempts where company_id=current_setting('gridex.test.company_a_id')::uuid) then
    raise exception 'rls_user_a_cannot_read_company_a';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.user_b_id'), true);
do $$
begin
  if exists(select 1 from public.actor_test_attempts where company_id=current_setting('gridex.test.company_a_id')::uuid) then
    raise exception 'rls_user_b_can_read_company_a';
  end if;
  if not exists(select 1 from public.actor_test_attempts where company_id=current_setting('gridex.test.company_b_id')::uuid) then
    raise exception 'rls_user_b_cannot_read_company_b';
  end if;
end;
$$;

rollback;
\echo 'Canonical production RLS regression passed with authenticated user contexts.'
