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
  v_evidence jsonb;
  v_api_bundle_active boolean := false;
  v_capability_ready boolean := false;
  v_effective_capability_status text;
begin
  select * into v_company
  from public.companies
  where id = p_company_id;

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
    where company_id = p_company_id
      and capability_code = v_capability;

    v_capability_ready :=
      coalesce(v_capability_row.enabled, false)
      and coalesce(v_capability_row.readiness_status, 'missing') = 'ready';
  end if;

  if p_operation in (
    'api_client.execute',
    'contract_channel.sell',
    'customer_automation.execute',
    'facility_lookup.execute',
    'email.send',
    'webhook.deliver'
  ) then
    select exists (
      select 1
      from public.integration_api_clients c
      where c.company_id = p_company_id
        and c.status = 'active'
        and c.profile_key = 'tenant_website'
    ) into v_api_bundle_active;
  end if;

  v_effective_capability_status := case
    when v_capability is null then 'not_required'
    when v_capability_ready then coalesce(v_capability_row.readiness_status, 'ready')
    when v_api_bundle_active then 'api_bundle'
    else coalesce(v_capability_row.readiness_status, 'missing')
  end;

  v_base_allowed := case coalesce(v_company.status, '__unknown__')
    when 'onboarding' then p_operation in (
      'tenant.provisioning.execute',
      'ediel.test.process',
      'invitation.accept',
      'company_user.manage',
      'production.prepare',
      'production.pause'
    )
    when 'active' then p_operation in (
      'tenant.provisioning.execute',
      'email.send',
      'webhook.deliver',
      'ediel.production.send',
      'ediel.test.process',
      'customer_automation.execute',
      'facility_lookup.execute',
      'invitation.accept',
      'company_user.manage',
      'production.prepare',
      'production.activate',
      'production.pause',
      'production.resume',
      'contract_channel.sell',
      'api_client.execute'
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
      v_effective_capability_status,
      v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  if v_capability is not null
     and not v_capability_ready
     and not v_api_bundle_active then
    return query select false,
      'capability_not_ready',
      v_company.status,
      v_effective_capability_status,
      v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  if p_operation in ('contract_channel.sell', 'ediel.production.send')
     and v_production_status <> 'live' then
    return query select false,
      case
        when p_operation = 'contract_channel.sell' then 'tenant_production_not_live_for_sales'
        else 'ediel_production_not_live'
      end,
      v_company.status,
      v_effective_capability_status,
      v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  if p_operation in ('contract_channel.sell', 'ediel.production.send') then
    v_evidence := public.canonical_ediel_production_evidence_readiness(p_company_id);
    if coalesce((v_evidence->>'ready')::boolean, false) is not true then
      return query select false,
        case
          when p_operation = 'contract_channel.sell' then 'tenant_production_evidence_not_ready_for_sales'
          else 'ediel_production_evidence_not_ready'
        end,
        v_company.status,
        v_effective_capability_status,
        v_production_status,
        v_company.lifecycle_state_version;
      return;
    end if;
  end if;

  return query select true,
    case when v_api_bundle_active and not v_capability_ready then 'allowed_by_tenant_api_bundle' else 'allowed' end,
    v_company.status,
    v_effective_capability_status,
    v_production_status,
    v_company.lifecycle_state_version;
end;
$$;

comment on function public.canonical_tenant_operation_decision(uuid, text) is
  'Canonical tenant operation gate. Active tenant_website API access grants the website/customer integration bundle; tenant lifecycle and live EDIEL production evidence remain fail-closed where required.';
