-- Canonical tenant lifecycle/offboarding v1.
-- Retires the competing legacy command and makes pause/resume/close side effects
-- deterministic and reversible only for resources paused by this lifecycle.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local search_path = public, auth, pg_catalog;

alter table public.webhook_subscriptions
  add column if not exists lifecycle_paused_by_tenant boolean not null default false,
  add column if not exists lifecycle_previous_status text;

alter table public.tenant_contract_channels
  add column if not exists lifecycle_paused_by_tenant boolean not null default false,
  add column if not exists lifecycle_previous_status text;

alter table public.company_provisioning_jobs
  add column if not exists lifecycle_blocked_by_tenant boolean not null default false,
  add column if not exists lifecycle_previous_status text;

alter table public.customer_operation_jobs
  add column if not exists lifecycle_blocked_by_tenant boolean not null default false,
  add column if not exists lifecycle_previous_status text;

do $rename$
begin
  if to_regprocedure(
    'public.canonical_transition_tenant_lifecycle(uuid,text,bigint,text,uuid,text)'
  ) is not null
  and to_regprocedure(
    'public.canonical_transition_tenant_lifecycle_v3_pre_offboarding(uuid,text,bigint,text,uuid,text)'
  ) is null then
    alter function public.canonical_transition_tenant_lifecycle(
      uuid,text,bigint,text,uuid,text
    ) rename to canonical_transition_tenant_lifecycle_v3_pre_offboarding;
  end if;
end
$rename$;

revoke all on function public.canonical_transition_tenant_lifecycle_v3_pre_offboarding(
  uuid,text,bigint,text,uuid,text
) from public, anon, authenticated, service_role;

create or replace function public.canonical_transition_tenant_lifecycle(
  p_company_id uuid,
  p_target_status text,
  p_expected_state_version bigint,
  p_reason text,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_readiness jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if not public.canonical_actor_is_authorized(
    p_company_id,
    p_actor_user_id,
    'tenant.lifecycle.transition',
    true
  ) then
    raise exception using errcode = '42501', message = 'actor_not_authorized_for_tenant_lifecycle';
  end if;

  if p_target_status = 'active'
     and to_regprocedure('public.gridex_tenant_activation_readiness(uuid)') is not null then
    v_readiness := public.gridex_tenant_activation_readiness(p_company_id);
    if not coalesce((v_readiness->>'ready')::boolean, false) then
      return jsonb_build_object(
        'changed', false,
        'code', 'tenant_not_operationally_ready',
        'blocking_reasons', coalesce(v_readiness->'blocking_reasons', '[]'::jsonb),
        'readiness', v_readiness
      );
    end if;
  end if;

  if p_target_status = 'closed' then
    if exists (
      select 1 from public.customer_contracts contract
      where contract.company_id = p_company_id
        and contract.status in ('active','signed','current')
    ) then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'tenant_has_active_customer_contracts',
        'message', 'Aktiva kundavtal måste överföras eller avslutas.'
      ));
    end if;
    if exists (
      select 1 from public.supplier_switch_requests request
      where request.company_id = p_company_id
        and request.status not in ('completed','failed','cancelled','rejected')
    ) then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'tenant_has_open_supplier_switches',
        'message', 'Pågående leverantörsbyten måste slutföras.'
      ));
    end if;
    if exists (
      select 1 from public.billing_underlays underlay
      where underlay.company_id = p_company_id
        and underlay.status not in ('completed','exported','cancelled','rejected')
    ) then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'tenant_has_unsettled_billing',
        'message', 'Ofärdig fakturering måste regleras.'
      ));
    end if;
    if jsonb_array_length(v_blockers) > 0 then
      return jsonb_build_object(
        'changed', false,
        'code', 'tenant_closure_blocked',
        'blocking_reasons', v_blockers
      );
    end if;
  end if;

  v_result := public.canonical_transition_tenant_lifecycle_v3_pre_offboarding(
    p_company_id,
    p_target_status,
    p_expected_state_version,
    p_reason,
    p_actor_user_id,
    p_idempotency_key
  );

  if p_target_status in ('paused','suspended','archived','pending_deletion','closed') then
    update public.integration_api_clients client
    set status = case when p_target_status = 'closed' then 'revoked' else 'paused' end,
        revoked_at = case when p_target_status = 'closed' then coalesce(client.revoked_at, now()) else client.revoked_at end,
        revoked_by = case when p_target_status = 'closed' then p_actor_user_id else client.revoked_by end,
        revoke_reason = case when p_target_status = 'closed' then p_reason else client.revoke_reason end,
        metadata = coalesce(client.metadata, '{}'::jsonb) || jsonb_build_object(
          'lifecycle_paused_by_tenant', true,
          'lifecycle_previous_status', coalesce(
            client.metadata->>'lifecycle_previous_status',
            client.status
          ),
          'lifecycle_status', p_target_status,
          'lifecycle_transition_at', now()
        ),
        updated_at = now()
    where client.company_id = p_company_id
      and client.deleted_at is null
      and (
        client.status = 'active'
        or (
          p_target_status = 'closed'
          and client.status = 'paused'
          and coalesce((client.metadata->>'lifecycle_paused_by_tenant')::boolean, false)
        )
      );

    update public.webhook_subscriptions subscription
    set lifecycle_paused_by_tenant = true,
        lifecycle_previous_status = subscription.status,
        status = case when p_target_status = 'closed' then 'disabled' else 'paused' end,
        updated_at = now()
    where subscription.company_id = p_company_id
      and subscription.status = 'active';

    update public.tenant_contract_channels channel
    set lifecycle_paused_by_tenant = true,
        lifecycle_previous_status = channel.status,
        status = case when p_target_status = 'closed' then 'ended' else 'paused' end,
        valid_to = case when p_target_status = 'closed' then coalesce(channel.valid_to, now()) else channel.valid_to end,
        updated_by = p_actor_user_id,
        updated_at = now()
    from public.tenant_contract_assignments assignment
    where channel.assignment_id = assignment.id
      and assignment.company_id = p_company_id
      and channel.status = 'active';

    update public.company_provisioning_jobs job
    set status = 'blocked_tenant_state',
        lifecycle_blocked_by_tenant = true,
        lifecycle_previous_status = job.status,
        claimed_at = null,
        last_error_code = 'tenant_lifecycle_blocked',
        last_error_details = coalesce(job.last_error_details, '{}'::jsonb)
          || jsonb_build_object('tenant_status', p_target_status),
        updated_at = now()
    where job.company_id = p_company_id
      and job.status = 'pending';

    update public.customer_operation_jobs job
    set status = case when p_target_status = 'closed' then 'cancelled' else 'blocked' end,
        lifecycle_blocked_by_tenant = true,
        lifecycle_previous_status = job.status,
        locked_at = null,
        locked_by = null,
        last_error_code = 'tenant_lifecycle_blocked',
        last_error_message = 'Tenant lifecycle blocks scheduled business work.',
        updated_at = now()
    where job.company_id = p_company_id
      and job.status = 'queued';

    update public.customer_portal_identities identity
    set status = 'disabled',
        metadata = coalesce(identity.metadata, '{}'::jsonb) || jsonb_build_object(
          'lifecycle_paused_by_tenant', true,
          'lifecycle_previous_status', identity.status,
          'lifecycle_status', p_target_status
        ),
        updated_at = now()
    where identity.company_id = p_company_id
      and identity.status = 'active';

    if p_target_status = 'closed' then
      delete from auth.sessions session
      where session.user_id in (
        select membership.user_id
        from public.company_memberships membership
        where membership.company_id = p_company_id
          and membership.status = 'active'
          and coalesce(membership.is_active, true)
      );
    end if;
  elsif p_target_status = 'active' then
    update public.integration_api_clients client
    set status = 'active',
        metadata = coalesce(client.metadata, '{}'::jsonb)
          - 'lifecycle_paused_by_tenant'
          - 'lifecycle_previous_status'
          - 'lifecycle_status'
          - 'lifecycle_transition_at',
        updated_at = now()
    where client.company_id = p_company_id
      and client.status = 'paused'
      and client.launch_ready is true
      and coalesce((client.metadata->>'lifecycle_paused_by_tenant')::boolean, false);

    update public.webhook_subscriptions subscription
    set status = 'active',
        lifecycle_paused_by_tenant = false,
        lifecycle_previous_status = null,
        updated_at = now()
    where subscription.company_id = p_company_id
      and subscription.status = 'paused'
      and subscription.lifecycle_paused_by_tenant
      and subscription.lifecycle_previous_status = 'active';

    update public.tenant_contract_channels channel
    set status = 'active',
        lifecycle_paused_by_tenant = false,
        lifecycle_previous_status = null,
        updated_by = p_actor_user_id,
        updated_at = now()
    from public.tenant_contract_assignments assignment
    where channel.assignment_id = assignment.id
      and assignment.company_id = p_company_id
      and channel.status = 'paused'
      and channel.lifecycle_paused_by_tenant
      and channel.lifecycle_previous_status = 'active';

    update public.company_provisioning_jobs job
    set status = job.lifecycle_previous_status,
        lifecycle_blocked_by_tenant = false,
        lifecycle_previous_status = null,
        available_at = now(),
        last_error_code = null,
        last_error_details = '{}'::jsonb,
        updated_at = now()
    where job.company_id = p_company_id
      and job.status = 'blocked_tenant_state'
      and job.lifecycle_blocked_by_tenant
      and job.lifecycle_previous_status = 'pending';

    update public.customer_operation_jobs job
    set status = job.lifecycle_previous_status,
        lifecycle_blocked_by_tenant = false,
        lifecycle_previous_status = null,
        run_after = now(),
        last_error = null,
        last_error_code = null,
        last_error_message = null,
        updated_at = now()
    where job.company_id = p_company_id
      and job.status = 'blocked'
      and job.lifecycle_blocked_by_tenant
      and job.lifecycle_previous_status = 'queued';

    update public.customer_portal_identities identity
    set status = 'active',
        metadata = coalesce(identity.metadata, '{}'::jsonb)
          - 'lifecycle_paused_by_tenant'
          - 'lifecycle_previous_status'
          - 'lifecycle_status',
        updated_at = now()
    where identity.company_id = p_company_id
      and identity.status = 'disabled'
      and coalesce((identity.metadata->>'lifecycle_paused_by_tenant')::boolean, false)
      and identity.metadata->>'lifecycle_previous_status' = 'active';
  end if;

  return v_result || jsonb_build_object(
    'offboarding_policy', 'canonical_lifecycle_offboarding_v1'
  );
end
$function$;

revoke all on function public.canonical_transition_tenant_lifecycle(
  uuid,text,bigint,text,uuid,text
) from public, anon, authenticated;
grant execute on function public.canonical_transition_tenant_lifecycle(
  uuid,text,bigint,text,uuid,text
) to service_role;

-- The legacy command is retained only as historical schema. It is deliberately
-- not executable by runtime roles; all writes use the idempotent canonical API.
revoke all on function public.gridex_transition_tenant_lifecycle(
  uuid,text,uuid,text
) from public, anon, authenticated, service_role;

commit;

