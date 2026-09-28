-- A disabled portal binding is a revocation, including when a normal writer
-- retries an UPSERT after the revocation commits. Row locks serialize the
-- check against the concurrent update of the same binding.
begin;

set local lock_timeout = '10s';
set local search_path = public, pg_catalog;

create function private.gridex_guard_portal_revocation_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_relid = 'public.customer_portal_identities'::regclass
     and old.status = 'disabled' then
    -- The canonical tenant resume is the only runtime operation that restores
    -- identities paused by the tenant lifecycle. Preserve every binding and
    -- all evidence other than the lifecycle markers it removes.
    if current_setting('gridex.portal_lifecycle_resume', true) = 'on'
       and old.metadata->>'lifecycle_paused_by_tenant' = 'true'
       and old.metadata->>'lifecycle_previous_status' = 'active'
       and new.status = 'active'
       and new.metadata = old.metadata
         - 'lifecycle_paused_by_tenant'
         - 'lifecycle_previous_status'
         - 'lifecycle_status'
       and to_jsonb(new) - 'status' - 'metadata' - 'updated_at'
           = to_jsonb(old) - 'status' - 'metadata' - 'updated_at' then
      return new;
    end if;
    raise exception using errcode = '23514', message = 'customer_portal_identity_revoked';
  end if;

  if tg_relid = 'public.customer_portal_accounts'::regclass
     and (old.status = 'disabled' or old.is_active is distinct from true) then
    raise exception using errcode = '23514', message = 'customer_portal_account_revoked';
  end if;

  return new;
end
$function$;

revoke all on function private.gridex_guard_portal_revocation_v1()
  from public, anon, authenticated;

create trigger customer_portal_identity_revocation_guard
  before update on public.customer_portal_identities
  for each row execute function private.gridex_guard_portal_revocation_v1();

create trigger customer_portal_account_revocation_guard
  before update on public.customer_portal_accounts
  for each row execute function private.gridex_guard_portal_revocation_v1();

-- This setting is scoped to the SECURITY DEFINER call and restored on exit.
-- The function still performs its existing actor, readiness and state checks.
alter function public.canonical_transition_tenant_lifecycle(
  uuid,text,bigint,text,uuid,text
) set gridex.portal_lifecycle_resume = 'on';

-- The existing atomic website trigger checks is_active but an older account
-- can have status=disabled while that flag is still true. This runs after the
-- existing trigger, in the same transaction, and rolls its writes back.
create function private.gridex_check_website_portal_account_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_auth_id text := nullif(btrim(coalesce(new.payload->>'auth_user_id', '')), '');
begin
  if v_auth_id is not null and not exists (
    select 1 from public.customer_portal_accounts account
    where account.company_id = new.company_id
      and account.customer_id = new.customer_id
      and account.portal_user_id = v_auth_id::uuid
      and account.status = 'active'
      and account.is_active is true
  ) then
    raise exception using errcode = '23514', message = 'customer_portal_account_revoked';
  end if;
  return new;
end
$function$;

revoke all on function private.gridex_check_website_portal_account_v1()
  from public, anon, authenticated;

create trigger website_application_portal_account_active_guard
  after insert or update on public.website_customer_applications
  for each row when (new.customer_id is not null)
  execute function private.gridex_check_website_portal_account_v1();

-- Direct Data API writes cannot re-enable portal access; server-side writes
-- use the service role, and the row guard also applies to that role.
revoke insert, update, delete, truncate
  on public.customer_portal_identities, public.customer_portal_accounts
  from public, anon, authenticated;

commit;
