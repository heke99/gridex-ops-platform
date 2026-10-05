-- Billing-period lock and its price-period lock change together.
--
-- Before: locking wrote billing_period_locks and then price_period_locks with the
-- second write's errors ignored (unlock likewise), so a billing month could be
-- locked while its prices stayed editable, or reopened while prices stayed
-- locked. After: gridex_set_billing_period_lock_v1 writes both, and on reopen
-- unlocks the month's pricing runs, in one transaction for the tenant.

create or replace function public.gridex_set_billing_period_lock_v1(
  p_company_id uuid,
  p_billing_month text,
  p_locked boolean,
  p_status text,
  p_actor_user_id uuid,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_now timestamptz := now();
  v_year integer;
  v_month integer;
  v_status text := case when p_locked then coalesce(nullif(p_status, ''), 'locked') else 'reopened' end;
  v_lock public.billing_period_locks%rowtype;
  v_unlocked_runs integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'billing_period_lock_service_role_required';
  end if;
  if p_company_id is null or p_locked is null or p_billing_month !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or (p_locked and v_status not in ('locked', 'exported', 'closed')) then
    raise exception using errcode = '22023', message = 'billing_period_lock_payload_invalid';
  end if;
  v_year := split_part(p_billing_month, '-', 1)::integer;
  v_month := split_part(p_billing_month, '-', 2)::integer;

  if p_locked then
    insert into public.billing_period_locks (
      company_id, billing_year, billing_month, status, locked_by, locked_at, unlocked_by, unlocked_at,
      lock_reason, metadata, updated_at
    ) values (
      p_company_id, v_year, v_month, v_status, p_actor_user_id, v_now, null, null,
      coalesce(p_reason, 'Fakturaperioden är låst.'), coalesce(p_metadata, '{}'::jsonb), v_now
    )
    on conflict (company_id, billing_year, billing_month) do update set
      status = excluded.status, locked_by = excluded.locked_by, locked_at = excluded.locked_at,
      unlocked_by = null, unlocked_at = null, lock_reason = excluded.lock_reason,
      metadata = excluded.metadata, updated_at = excluded.updated_at
    returning * into v_lock;

    insert into public.price_period_locks (
      company_id, billing_month, lock_scope, status, locked_by, locked_at, reason, metadata
    ) values (
      p_company_id, p_billing_month, 'billing_period', 'locked', p_actor_user_id, v_now,
      coalesce(p_reason, 'Fakturaperioden är låst.'), coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (company_id, billing_month, lock_scope) do update set
      status = 'locked', locked_by = excluded.locked_by, locked_at = excluded.locked_at,
      reason = excluded.reason, metadata = excluded.metadata;
  else
    insert into public.billing_period_locks (
      company_id, billing_year, billing_month, status, unlocked_by, unlocked_at, lock_reason, updated_at
    ) values (
      p_company_id, v_year, v_month, 'reopened', p_actor_user_id, v_now,
      coalesce(p_reason, 'Fakturaperioden har låsts upp.'), v_now
    )
    on conflict (company_id, billing_year, billing_month) do update set
      status = 'reopened', unlocked_by = excluded.unlocked_by, unlocked_at = excluded.unlocked_at,
      lock_reason = excluded.lock_reason, updated_at = excluded.updated_at
    returning * into v_lock;

    update public.price_period_locks
    set status = 'unlocked', reason = coalesce(p_reason, 'Fakturaperioden har låsts upp.')
    where company_id = p_company_id
      and billing_month = p_billing_month
      and lock_scope in ('billing_period', 'invoice_export');

    v_unlocked_runs := public.gridex_unlock_pricing_runs_for_month(
      p_company_id, p_billing_month, p_actor_user_id, coalesce(p_reason, 'billing_period_unlocked'));
  end if;

  return jsonb_build_object('lock', to_jsonb(v_lock), 'unlocked_pricing_runs', coalesce(v_unlocked_runs, 0));
end
$function$;

revoke all on function public.gridex_set_billing_period_lock_v1(uuid, text, boolean, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.gridex_set_billing_period_lock_v1(uuid, text, boolean, text, uuid, text, jsonb) to service_role;
