-- Restore the service RPC and read projection omitted by the historical
-- capability-only bootstrap derived from 20260801143000.
do $migration$
begin

  create or replace function public.canonical_next_customer_number(p_company_id uuid)
  returns text
  language sql
  security definer
  set search_path = public, pg_temp
  as $$ select public.gridex_next_customer_number(p_company_id); $$;

  create or replace function public.canonical_next_contract_number(
    p_company_id uuid,
    p_customer_number text default null
  )
  returns text
  language sql
  security definer
  set search_path = public, pg_temp
  as $$ select public.gridex_next_contract_number(p_company_id, p_customer_number); $$;

  create or replace function public.canonical_next_application_number(p_company_id uuid)
  returns text
  language sql
  security definer
  set search_path = public, pg_temp
  as $$ select public.gridex_next_application_number(p_company_id); $$;

  revoke all on function public.canonical_next_customer_number(uuid) from public, anon, authenticated;
  revoke all on function public.canonical_next_contract_number(uuid, text) from public, anon, authenticated;
  revoke all on function public.canonical_next_application_number(uuid) from public, anon, authenticated;
  grant execute on function public.canonical_next_customer_number(uuid) to service_role;
  grant execute on function public.canonical_next_contract_number(uuid, text) to service_role;
  grant execute on function public.canonical_next_application_number(uuid) to service_role;

  create or replace view public.canonical_tenant_effective_legal_sources_v
  with (security_invoker = true)
  as select * from public.gridex_tenant_effective_legal_sources_v;

  revoke all on table public.canonical_tenant_effective_legal_sources_v
  from public, anon, authenticated, service_role;
  grant select on table public.canonical_tenant_effective_legal_sources_v
  to authenticated, service_role;

end;
$migration$;
