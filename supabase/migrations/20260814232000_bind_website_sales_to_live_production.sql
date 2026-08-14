-- Bind new customer sales to an actually live production tenant.
--
-- Technical API/customer-portal capabilities may exist before production goes
-- live, but contract_channel.sell must fail closed until the canonical Ediel
-- production state is live. This keeps onboarding and portal reads separable
-- from accepting new electricity contracts.

begin;

create or replace function public.canonical_tenant_operation_decision(
  p_company_id uuid,
  p_operation text
)
returns table(
  allowed boolean,
  reason_code text,
  company_status text,
  capability_status text,
  production_status text,
  state_version bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_capability text;
  v_capability_row public.company_capabilities%rowtype;
  v_production_status text;
  v_base_allowed boolean := false;
begin
  select * into v_company from public.companies where id = p_company_id;
  if not found then
    return query select false, 'tenant_not_found', null::text, 'missing'::text, null::text, 0::bigint;
    return;
  end if;

  if to_regclass('public.ediel_production_state') is not null then
    execute 'select state from public.ediel_production_state where company_id = $1'
      into v_production_status using p_company_id;
  end if;
  v_production_status := coalesce(
    v_production_status,
    v_company.ediel_production_status,
    v_company.production_status,
    'disabled'
  );

  v_capability := case p_operation
    when 'email.send' then 'email_outbound'
    when 'webhook.deliver' then 'webhooks'
    when 'ediel.production.send' then 'ediel_production'
    when 'ediel.test.process' then 'ediel_test'
    when 'customer_automation.execute' then 'customer_automation'
    when 'facility_lookup.execute' then 'facility_lookup'
    when 'contract_channel.sell' then 'website_sales'
    when 'api_client.execute' then 'api_sales'
    else null
  end;

  if v_capability is not null then
    select * into v_capability_row
    from public.company_capabilities
    where company_id = p_company_id and capability_code = v_capability;
  end if;

  v_base_allowed := case coalesce(v_company.status, '__unknown__')
    when 'onboarding' then p_operation in (
      'tenant.provisioning.execute','ediel.test.process','invitation.accept',
      'company_user.manage','production.prepare','production.pause'
    )
    when 'active' then p_operation in (
      'tenant.provisioning.execute','email.send','webhook.deliver',
      'ediel.production.send','ediel.test.process','customer_automation.execute',
      'facility_lookup.execute','invitation.accept','company_user.manage',
      'production.prepare','production.activate','production.pause',
      'production.resume','contract_channel.sell','api_client.execute'
    )
    else false
  end;

  if not v_base_allowed then
    return query select false,
      case coalesce(v_company.status, '__unknown__')
        when 'paused' then 'tenant_paused'
        when 'suspended' then 'tenant_suspended'
        when 'archived' then 'tenant_archived'
        when 'pending_deletion' then 'tenant_pending_deletion'
        when 'closed' then 'tenant_closed'
        when 'deleted_test_only' then 'tenant_deleted_test_only'
        when 'onboarding' then 'operation_not_allowed_during_onboarding'
        else 'tenant_status_unknown'
      end,
      v_company.status,
      case when v_capability is null then 'not_required' else coalesce(v_capability_row.readiness_status, 'missing') end,
      v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  if v_capability is not null and not (
    coalesce(v_capability_row.enabled, false)
    and coalesce(v_capability_row.readiness_status, 'missing') = 'ready'
  ) then
    return query select false, 'capability_not_ready', v_company.status,
      coalesce(v_capability_row.readiness_status, 'missing'), v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  -- A tenant may prepare its website, customer portal and automation before
  -- production activation, but accepting a new electricity contract must be
  -- impossible until canonical production is live.
  if p_operation = 'contract_channel.sell' and v_production_status <> 'live' then
    return query select false, 'tenant_production_not_live_for_sales', v_company.status,
      coalesce(v_capability_row.readiness_status, 'missing'), v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  if p_operation = 'ediel.production.send' and v_production_status <> 'live' then
    return query select false, 'ediel_production_not_live', v_company.status,
      coalesce(v_capability_row.readiness_status, 'missing'), v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  return query select true, 'allowed', v_company.status,
    case when v_capability is null then 'not_required' else coalesce(v_capability_row.readiness_status, 'missing') end,
    v_production_status,
    v_company.lifecycle_state_version;
end;
$$;

comment on function public.canonical_tenant_operation_decision(uuid, text) is
  'Canonical tenant operation gate. New contract sales require capability readiness and live production; portal/technical operations remain independently gated.';

commit;
