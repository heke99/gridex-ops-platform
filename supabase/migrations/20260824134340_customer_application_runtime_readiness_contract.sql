create or replace function public.gridex_customer_application_runtime_contract_v1()
returns jsonb
language sql
stable
security invoker
set search_path to 'pg_catalog','public','extensions','pg_temp'
as $function$
with checks as (
  select
    to_regclass('public.supplier_switch_requests') is not null as supplier_switch_requests_exists,
    exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.supplier_switch_requests')
        and attname = 'communication_route_id' and attnum > 0 and not attisdropped
    ) as communication_route_id_exists,
    exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.supplier_switch_requests')
        and attname = 'ediel_route_profile_id' and attnum > 0 and not attisdropped
    ) as ediel_route_profile_id_exists,
    to_regclass('public.communication_routes') is not null as communication_routes_exists,
    to_regclass('public.ediel_route_profiles') is not null as ediel_route_profiles_exists,
    to_regprocedure('extensions.digest(text,text)') is not null as pgcrypto_digest_exists,
    to_regprocedure('public.gridex_set_grid_owner_request_idempotency_key()') is not null as request_idempotency_function_exists,
    coalesce(position(
      'extensions.digest' in pg_get_functiondef(to_regprocedure('public.gridex_set_grid_owner_request_idempotency_key()'))
    ) > 0, false) as request_idempotency_digest_qualified,
    exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = to_regclass('public.grid_owner_information_requests')
        and tgname = 'trg_grid_owner_information_requests_idempotency'
        and not tgisinternal
        and tgenabled <> 'D'
    ) as request_idempotency_trigger_enabled,
    to_regprocedure('public.gridex_lock_signed_customer_contract()') is not null as signed_contract_integrity_function_exists
)
select jsonb_build_object(
  'ready',
    supplier_switch_requests_exists
    and communication_route_id_exists
    and ediel_route_profile_id_exists
    and communication_routes_exists
    and ediel_route_profiles_exists
    and pgcrypto_digest_exists
    and request_idempotency_function_exists
    and request_idempotency_digest_qualified
    and request_idempotency_trigger_enabled
    and signed_contract_integrity_function_exists,
  'checks', jsonb_build_object(
    'supplier_switch_requests_exists', supplier_switch_requests_exists,
    'communication_route_id_exists', communication_route_id_exists,
    'ediel_route_profile_id_exists', ediel_route_profile_id_exists,
    'communication_routes_exists', communication_routes_exists,
    'ediel_route_profiles_exists', ediel_route_profiles_exists,
    'pgcrypto_digest_exists', pgcrypto_digest_exists,
    'request_idempotency_function_exists', request_idempotency_function_exists,
    'request_idempotency_digest_qualified', request_idempotency_digest_qualified,
    'request_idempotency_trigger_enabled', request_idempotency_trigger_enabled,
    'signed_contract_integrity_function_exists', signed_contract_integrity_function_exists
  )
)
from checks;
$function$;

revoke all on function public.gridex_customer_application_runtime_contract_v1() from public;
revoke all on function public.gridex_customer_application_runtime_contract_v1() from anon;
revoke all on function public.gridex_customer_application_runtime_contract_v1() from authenticated;
grant execute on function public.gridex_customer_application_runtime_contract_v1() to service_role;
