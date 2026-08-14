-- Prevent tenant_website credentials from being activated through a generic
-- status toggle. Activation must be part of the canonical provisioning /
-- revalidation transaction, which creates a fresh installation receipt and
-- marks the client as preflight-pending before any normal API traffic is allowed.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local search_path = public, pg_catalog;

create or replace function public.gridex_guard_tenant_website_activation_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_receipt_id_text text;
begin
  if new.profile_key is distinct from 'tenant_website'
     or new.status is distinct from 'active'
     or (tg_op = 'UPDATE' and old.status = 'active')
  then
    return new;
  end if;

  if new.deleted_at is not null or new.revoked_at is not null then
    raise exception using
      errcode = '23514',
      message = 'TENANT_WEBSITE_ACTIVATION_REQUIRES_CANONICAL_GO_LIVE';
  end if;

  v_receipt_id_text := nullif(coalesce(new.metadata->>'provisioning_receipt_id',''), '');

  if coalesce(new.metadata->>'go_live_flow','') <> 'canonical_tenant_website_v2'
     or v_receipt_id_text is null
     or jsonb_typeof(coalesce(new.launch_blockers,'[]'::jsonb)) <> 'array'
     or not exists (
       select 1
       from jsonb_array_elements(coalesce(new.launch_blockers,'[]'::jsonb)) blocker
       where blocker->>'code' in ('provisioning_preflight_pending','provisioning_retry_in_progress')
     )
     or not exists (
       select 1
       from public.tenant_website_installation_receipts receipt
       where receipt.id::text = v_receipt_id_text
         and receipt.company_id = new.company_id
         and receipt.profile_key = 'tenant_website'
         and receipt.environment = coalesce(nullif(new.metadata->>'environment',''), 'production')
         and receipt.state in ('company_ready','client_ready','credential_created','failed')
     )
  then
    raise exception using
      errcode = '23514',
      message = 'TENANT_WEBSITE_ACTIVATION_REQUIRES_CANONICAL_GO_LIVE',
      detail = 'Use the canonical tenant website provision/revalidation action instead of a generic status activation.';
  end if;

  return new;
end
$function$;

revoke all on function public.gridex_guard_tenant_website_activation_v2()
  from public, anon, authenticated;
grant execute on function public.gridex_guard_tenant_website_activation_v2()
  to service_role;

drop trigger if exists integration_api_clients_tenant_website_activation_guard
  on public.integration_api_clients;
create trigger integration_api_clients_tenant_website_activation_guard
before insert or update of status, profile_key, deleted_at, revoked_at, metadata, launch_blockers
on public.integration_api_clients
for each row execute function public.gridex_guard_tenant_website_activation_v2();

comment on function public.gridex_guard_tenant_website_activation_v2() is
  'Fail-closed guard: tenant_website credentials may enter active only through canonical_tenant_website_v2 provisioning/revalidation with a matching in-progress installation receipt.';

commit;
