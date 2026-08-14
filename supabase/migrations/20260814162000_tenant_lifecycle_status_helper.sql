-- Canonical tenant lifecycle status helper used by RLS and server authorization.
-- Kept as a small independent primitive so clean databases and upgraded production
-- databases share the same active/onboarding write semantics.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local search_path = public, auth, pg_catalog;

create or replace function public.gridex_company_status_is_writable(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and company.status in ('active', 'onboarding')
  )
$function$;

revoke all on function public.gridex_company_status_is_writable(uuid)
  from public, anon;
grant execute on function public.gridex_company_status_is_writable(uuid)
  to authenticated, service_role;

commit;
