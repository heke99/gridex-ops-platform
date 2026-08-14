-- Keep the tenant-website activation guard fail-closed for generic Aktivera,
-- while allowing canonical lifecycle resume of launch-ready clients that were
-- paused by tenant offboarding (lifecycle_paused_by_tenant).
--
-- Without this exemption, paused → active company transitions raise
-- TENANT_WEBSITE_ACTIVATION_REQUIRES_CANONICAL_GO_LIVE because live clients do
-- not carry provisioning_preflight_pending blockers.

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

  -- Lifecycle resume: offboarding paused an already launch-ready client and is
  -- restoring status=active while clearing lifecycle_* metadata keys.
  if tg_op = 'UPDATE'
     and old.status = 'paused'
     and coalesce((old.metadata->>'lifecycle_paused_by_tenant')::boolean, false)
     and new.launch_ready is true
     and coalesce(new.metadata->>'go_live_flow','') = 'canonical_tenant_website_v2'
     and nullif(coalesce(new.metadata->>'provisioning_receipt_id',''), '') is not null
     and not coalesce((new.metadata->>'lifecycle_paused_by_tenant')::boolean, false)
  then
    v_receipt_id_text := nullif(coalesce(new.metadata->>'provisioning_receipt_id',''), '');
    if exists (
      select 1
      from public.tenant_website_installation_receipts receipt
      where receipt.id::text = v_receipt_id_text
        and receipt.company_id = new.company_id
        and receipt.api_client_id = new.id
        and receipt.profile_key = 'tenant_website'
        and receipt.state = 'completed'
        and receipt.completed_at is not null
        and nullif(receipt.receipt_sha256,'') is not null
    ) then
      return new;
    end if;
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

comment on function public.gridex_guard_tenant_website_activation_v2() is
  'Fail-closed guard: tenant_website credentials may enter active only through canonical_tenant_website_v2 provisioning/revalidation, or via lifecycle resume of a launch-ready client paused by tenant offboarding with a completed binding receipt.';

commit;
