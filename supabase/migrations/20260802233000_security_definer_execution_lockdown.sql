-- Revoke externally callable trigger-only SECURITY DEFINER functions and the
-- internal contract-readiness RPC. Tenant-aware authorization helpers used by
-- RLS are intentionally not changed by this migration.

do $lockdown$
declare
  function_record record;
begin
  for function_record in
    select procedure.oid::regprocedure as signature
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and procedure.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      function_record.signature
    );
    execute format(
      'grant execute on function %s to service_role',
      function_record.signature
    );
  end loop;
end
$lockdown$;

revoke execute on function public.gridex_validate_contract_channel_readiness(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.gridex_validate_contract_channel_readiness(uuid,uuid,text)
  to service_role;

-- Internal schema verification must not be callable through PostgREST.
do $lockdown$
declare
  function_record record;
begin
  for function_record in
    select procedure.oid::regprocedure as signature
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and procedure.proname in (
        'gridex_verify_contract_schema_alignment',
        'gridex_capture_ediel_rule_pack_snapshot',
        'gridex_capture_portfolio_monthly_price_history',
        'gridex_capture_signed_contract_evidence',
        'gridex_bind_customer_contract_to_exact_publication',
        'gridex_bind_internal_customer_contract',
        'gridex_validate_commercial_model_v1'
      )
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      function_record.signature
    );
    execute format(
      'grant execute on function %s to service_role',
      function_record.signature
    );
  end loop;
end
$lockdown$;
