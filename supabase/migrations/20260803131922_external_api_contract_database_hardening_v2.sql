begin;

create or replace function public.gridex_contract_platform_readiness(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_company_id is null then
    raise exception using
      errcode = '22023',
      message = 'company_id_required';
  end if;

  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.gridex_can_read_company(p_company_id)
  then
    raise exception using
      errcode = '42501',
      message = 'insufficient_company_access';
  end if;

  return public.gridex_contract_platform_readiness_internal_v1(p_company_id);
end;
$$;

comment on function public.gridex_contract_platform_readiness(uuid) is
  'Tenant-authorized readiness facade. Authenticated callers may only read companies permitted by gridex_can_read_company; service_role may inspect any company. Database administrators can use the revoked internal function directly.';

revoke all on function public.gridex_contract_platform_readiness(uuid)
  from public, anon;
grant execute on function public.gridex_contract_platform_readiness(uuid)
  to authenticated, service_role;

commit;
