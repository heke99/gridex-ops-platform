begin;

alter function public.gridex_contract_platform_readiness(uuid)
  rename to gridex_contract_platform_readiness_internal_v1;

comment on function public.gridex_contract_platform_readiness_internal_v1(uuid) is
  'Internal unchecked readiness implementation. Never grant to tenant roles; call through gridex_contract_platform_readiness(uuid).';

revoke all on function public.gridex_contract_platform_readiness_internal_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.gridex_contract_platform_readiness_internal_v1(uuid)
  to service_role;

create function public.gridex_contract_platform_readiness(p_company_id uuid)
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

  if session_user not in ('postgres', 'supabase_admin')
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
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
  'Tenant-authorized readiness facade. Authenticated callers may only read companies permitted by gridex_can_read_company; service_role and database administrators may inspect any company.';

revoke all on function public.gridex_contract_platform_readiness(uuid)
  from public, anon;
grant execute on function public.gridex_contract_platform_readiness(uuid)
  to authenticated, service_role;

commit;
