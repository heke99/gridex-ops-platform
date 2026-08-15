-- Converge tenant/go-live readiness on canonical runtime state.
-- This migration is intentionally tenant-generic: no company IDs, Ediel IDs,
-- routes, test cases, counterparties, or credentials are hardcoded.

create or replace function public.gridex_company_go_live_readiness(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'extensions'
as $function$
declare
  c public.companies%rowtype;
  blockers text[] := array[]::text[];
  prodat_total integer := 6;
  utilts_total integer := 5;
  prodat_passed integer := 0;
  utilts_passed integer := 0;
  v_prod_actor_count integer := 0;
  v_test_actor_count integer := 0;
  v_prod_actor_id uuid;
  v_test_actor_id uuid;
  v_has_prod_route boolean := false;
  v_has_test_route boolean := false;
  v_has_brp boolean := false;
  v_has_prod_mailbox boolean := false;
  v_prod_receiver_source text;
  v_prod_dynamic_strategy text;
  v_prod_receiver_ediel_id text;
  v_prod_mailbox_id uuid;
  v_prod_application_reference text;
  v_prod_certificate_required boolean;
  v_prod_certificate_id uuid;
  v_prod_receiver_certificate_id uuid;
  v_dynamic_receiver boolean := false;
  v_evidence jsonb := '{}'::jsonb;
  v_evidence_ready boolean := false;
begin
  select * into c
  from public.companies
  where id = p_company_id;

  if not found then
    return jsonb_build_object(
      'company_id', p_company_id,
      'status', 'missing_company',
      'blockers', jsonb_build_array('Bolaget hittades inte')
    );
  end if;

  select count(*)
  into v_prod_actor_count
  from public.ediel_actor_settings eas
  where eas.company_id = p_company_id
    and eas.environment = 'production'
    and coalesce(eas.is_active, false) = true
    and lower(coalesce(eas.actor_role, eas.role, '')) in ('supplier', 'electricity_supplier');

  if v_prod_actor_count = 1 then
    select eas.id
    into v_prod_actor_id
    from public.ediel_actor_settings eas
    where eas.company_id = p_company_id
      and eas.environment = 'production'
      and coalesce(eas.is_active, false) = true
      and lower(coalesce(eas.actor_role, eas.role, '')) in ('supplier', 'electricity_supplier')
    order by eas.updated_at desc, eas.id
    limit 1;
  elsif v_prod_actor_count = 0 then
    blockers := array_append(blockers, 'Aktiv supplier-produktionsaktörsprofil saknas');
  else
    blockers := array_append(blockers, 'Flera aktiva supplier-produktionsaktörsprofiler finns');
  end if;

  select count(*)
  into v_test_actor_count
  from public.ediel_actor_settings eas
  where eas.company_id = p_company_id
    and eas.environment = 'test'
    and coalesce(eas.is_active, false) = true
    and lower(coalesce(eas.actor_role, eas.role, '')) in ('supplier', 'electricity_supplier');

  if v_test_actor_count = 1 then
    select eas.id
    into v_test_actor_id
    from public.ediel_actor_settings eas
    where eas.company_id = p_company_id
      and eas.environment = 'test'
      and coalesce(eas.is_active, false) = true
      and lower(coalesce(eas.actor_role, eas.role, '')) in ('supplier', 'electricity_supplier')
    order by eas.updated_at desc, eas.id
    limit 1;
  elsif v_test_actor_count = 0 then
    blockers := array_append(blockers, 'Aktiv supplier-testaktörsprofil saknas');
  else
    blockers := array_append(blockers, 'Flera aktiva supplier-testaktörsprofiler finns');
  end if;

  if v_prod_actor_id is not null then
    select exists(
      select 1
      from public.ediel_route_profiles erp
      where erp.company_id = p_company_id
        and erp.environment = 'production'
        and erp.actor_setting_id = v_prod_actor_id
        and coalesce(erp.is_enabled, false) = true
        and coalesce(erp.is_active, true) = true
        and upper(coalesce(erp.message_family, '')) = 'PRODAT'
    ) into v_has_prod_route;

    select
      erp.receiver_source,
      erp.dynamic_receiver_strategy,
      erp.receiver_ediel_id,
      erp.mailbox_id,
      erp.application_reference,
      coalesce(erp.certificate_required, false),
      erp.certificate_id,
      erp.receiver_certificate_id
    into
      v_prod_receiver_source,
      v_prod_dynamic_strategy,
      v_prod_receiver_ediel_id,
      v_prod_mailbox_id,
      v_prod_application_reference,
      v_prod_certificate_required,
      v_prod_certificate_id,
      v_prod_receiver_certificate_id
    from public.ediel_route_profiles erp
    where erp.company_id = p_company_id
      and erp.environment = 'production'
      and erp.actor_setting_id = v_prod_actor_id
      and coalesce(erp.is_enabled, false) = true
      and coalesce(erp.is_active, true) = true
      and upper(coalesce(erp.message_family, '')) = 'PRODAT'
    order by coalesce(erp.is_production_route, false) desc, erp.updated_at desc, erp.id
    limit 1;
  end if;

  if v_test_actor_id is not null then
    select exists(
      select 1
      from public.ediel_route_profiles erp
      where erp.company_id = p_company_id
        and erp.environment = 'test'
        and erp.actor_setting_id = v_test_actor_id
        and coalesce(erp.is_enabled, false) = true
        and coalesce(erp.is_active, true) = true
    ) into v_has_test_route;
  end if;

  v_dynamic_receiver :=
    lower(coalesce(v_prod_receiver_source, '')) in (
      'selected_metering_point_grid_owner',
      'selected_customer_site_grid_owner',
      'selected_supplier_switch_grid_owner',
      'selected_data_request_grid_owner',
      'original_inbound_sender',
      'original_inbound_receiver'
    )
    or (
      nullif(btrim(coalesce(v_prod_dynamic_strategy, '')), '') is not null
      and lower(v_prod_dynamic_strategy) <> 'resolve_from_counterparty_id'
    );

  select exists(
    select 1
    from public.ediel_brp_settings b
    where b.company_id = p_company_id
      and b.environment = 'production'
      and coalesce(b.is_active, true) = true
      and nullif(btrim(coalesce(b.brp_ediel_id, '')), '') is not null
  ) into v_has_brp;

  if v_prod_mailbox_id is not null then
    select exists(
      select 1
      from public.ediel_mailboxes m
      where m.id = v_prod_mailbox_id
        and m.environment = 'production'
        and coalesce(m.is_active, false) = true
        and (m.company_id = p_company_id or m.company_id is null)
    ) into v_has_prod_mailbox;
  end if;
  v_has_prod_mailbox := v_has_prod_mailbox
    or nullif(btrim(coalesce(c.production_mailbox, '')), '') is not null;

  begin
    v_evidence := public.canonical_ediel_production_evidence_readiness(p_company_id);
    v_evidence_ready := coalesce((v_evidence ->> 'ready')::boolean, false);
  exception when others then
    v_evidence := jsonb_build_object('ready', false, 'error', sqlerrm);
    v_evidence_ready := false;
  end;

  if v_evidence_ready then
    prodat_passed := prodat_total;
    utilts_passed := utilts_total;
  elsif to_regclass('public.actor_test_results') is not null then
    select
      count(*) filter (
        where package_key = 'PRODAT_SUPPLIER'
          and status in ('passed', 'manual_verified')
          and coalesce(is_stale, false) = false
      ),
      count(*) filter (
        where package_key = 'UTILTS_METERING'
          and status in ('passed', 'manual_verified')
          and coalesce(is_stale, false) = false
      )
    into prodat_passed, utilts_passed
    from public.actor_test_results
    where company_id = p_company_id;
  end if;

  if nullif(btrim(coalesce(c.org_number, '')), '') is null then
    blockers := array_append(blockers, 'Orgnummer saknas');
  end if;
  if nullif(btrim(coalesce(c.production_ediel_id, c.ediel_id, '')), '') is null then
    blockers := array_append(blockers, 'Produktions Ediel-id saknas');
  end if;
  if not v_has_brp then
    blockers := array_append(blockers, 'Aktiv production-BRP saknas');
  end if;
  if lower(coalesce(c.esett_status, 'missing')) <> 'ready' then
    blockers := array_append(blockers, 'eSett-status är inte klar');
  end if;
  if not v_has_prod_route then
    blockers := array_append(blockers, 'Supplier-bunden PRODAT-produktionsroute saknas');
  end if;
  if not v_has_test_route then
    blockers := array_append(blockers, 'Supplier-bunden test-route saknas');
  end if;
  if not v_has_prod_mailbox then
    blockers := array_append(blockers, 'Produktionsmailbox/transport saknas');
  end if;
  if v_has_prod_route and nullif(btrim(coalesce(v_prod_application_reference, c.production_application_reference, '')), '') is null then
    blockers := array_append(blockers, 'Produktions Application Reference saknas');
  end if;
  if v_has_prod_route and not v_dynamic_receiver and nullif(btrim(coalesce(v_prod_receiver_ediel_id, '')), '') is null then
    blockers := array_append(blockers, 'Fast produktionsmotpart saknas och dynamisk receiver är inte konfigurerad');
  end if;
  if v_has_prod_route
     and coalesce(v_prod_certificate_required, false)
     and not v_dynamic_receiver
     and v_prod_certificate_id is null
     and v_prod_receiver_certificate_id is null then
    blockers := array_append(blockers, 'Mottagarcertifikat saknas för fast PRODAT-produktionsroute');
  end if;

  if not v_evidence_ready then
    blockers := array_append(
      blockers,
      format(
        'Canonical Ediel-evidens är inte komplett (PRODAT %s/%s, UTILTS %s/%s)',
        prodat_passed, prodat_total, utilts_passed, utilts_total
      )
    );
  end if;

  return jsonb_build_object(
    'company_id', p_company_id,
    'status', case when cardinality(blockers) = 0 then 'ready' else 'blocked' end,
    'blockers', to_jsonb(blockers),
    'prodat_passed', prodat_passed,
    'prodat_total', prodat_total,
    'utilts_passed', utilts_passed,
    'utilts_total', utilts_total,
    'has_production_actor', v_prod_actor_count = 1,
    'has_test_actor', v_test_actor_count = 1,
    'has_production_route', v_has_prod_route,
    'has_test_route', v_has_test_route,
    'has_production_mailbox', v_has_prod_mailbox,
    'dynamic_receiver_capable', v_dynamic_receiver,
    'evidence_ready', v_evidence_ready,
    'evidence', v_evidence,
    'source', 'canonical_runtime_v2'
  );
end;
$function$;

create or replace function public.gridex_tenant_activation_readiness(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  c public.companies%rowtype;
  v_blockers jsonb := '[]'::jsonb;
  v_go_live jsonb := '{}'::jsonb;
  v_contract jsonb := '{}'::jsonb;
  v_incomplete_task_count integer := 0;
begin
  select * into c
  from public.companies
  where id = p_company_id;

  if not found then
    return jsonb_build_object(
      'ready', false,
      'blocking_reasons', jsonb_build_array(
        jsonb_build_object('code', 'tenant_not_found', 'message', 'Tenant hittades inte.')
      )
    );
  end if;

  if lower(coalesce(c.status, '')) in ('paused', 'suspended', 'archived', 'blocked', 'pending_deletion', 'deleted_test_only') then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_lifecycle_not_active',
      'message', 'Bolagets lifecycle-status tillåter inte aktivering.'
    ));
  end if;

  if nullif(btrim(coalesce(c.legal_name, c.name, '')), '') is null
     or nullif(btrim(coalesce(c.org_number, '')), '') is null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_missing_legal_entity',
      'message', 'Juridiskt namn eller organisationsnummer saknas.'
    ));
  end if;

  if not exists(
    select 1
    from public.company_memberships m
    where m.company_id = p_company_id
      and m.status = 'active'
      and coalesce(m.membership_role, '') in ('owner', 'admin', 'company_admin')
  ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_missing_admin',
      'message', 'Aktiv bolagsadministratör saknas.'
    ));
  end if;

  if nullif(btrim(coalesce(c.external_tenant_reference, '')), '') is null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_missing_external_reference',
      'message', 'Extern tenantreferens saknas.'
    ));
  end if;

  if not exists(
    select 1
    from public.integration_api_clients i
    where i.company_id = p_company_id
      and i.status = 'active'
      and array[
        'integration_context.read',
        'website_contracts.read',
        'website_contracts.diagnostics',
        'website_energy_area.resolve',
        'website_quotes.write',
        'website_quotes.validate',
        'website_applications.write',
        'website_legal.read'
      ]::text[] <@ coalesce(i.scopes, '{}'::text[])
  ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_missing_required_scopes',
      'message', 'Aktiv API-klient med obligatoriska website_sales-scopes saknas.'
    ));
  end if;

  if not exists(
    select 1
    from public.tenant_contract_channels ch
    join public.tenant_contract_assignments ta on ta.id = ch.assignment_id
    where ta.company_id = p_company_id
      and ch.channel in ('website', 'api')
  ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_missing_contract_channel',
      'message', 'Försäljningskanal för hemsida/API saknas.'
    ));
  end if;

  if nullif(btrim(coalesce(c.primary_contact_email, c.support_email, '')), '') is null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_missing_customer_communication',
      'message', 'Kund- eller supportadress saknas.'
    ));
  end if;

  begin
    v_contract := public.gridex_contract_platform_readiness_internal_v1(p_company_id);
  exception when others then
    v_contract := jsonb_build_object('error', sqlerrm);
  end;

  if coalesce((v_contract #>> '{website,can_display}')::boolean, false) = false then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_website_not_ready',
      'message', 'Publicerade avtal kan inte visas för tenantens webbflöde.'
    ));
  end if;
  if coalesce((v_contract #>> '{applications,can_accept}')::boolean, false) = false then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_applications_not_ready',
      'message', 'Tenantens ansökningsflöde kan inte ta emot nya avtal.'
    ));
  end if;
  if coalesce(v_contract #>> '{legal_profile,status}', '') <> 'ready' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_legal_profile_not_ready',
      'message', 'Juridisk profil är inte komplett.'
    ));
  end if;
  if coalesce(v_contract #>> '{documents,status}', '') <> 'ready' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_documents_not_ready',
      'message', 'Dokumentflödet är inte production-ready.'
    ));
  end if;
  if coalesce(v_contract #>> '{customer_operations,status}', '') <> 'ready' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_customer_operations_not_ready',
      'message', 'Kundoperationsflödet är inte production-ready.'
    ));
  end if;

  v_go_live := public.gridex_company_go_live_readiness(p_company_id);
  if coalesce(v_go_live ->> 'status', 'blocked') <> 'ready' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tenant_ediel_go_live_not_ready',
      'message', 'Ediel go-live readiness är inte klar.',
      'details', coalesce(v_go_live -> 'blockers', '[]'::jsonb)
    ));
  end if;

  select count(*)
  into v_incomplete_task_count
  from public.company_onboarding_tasks t
  where t.company_id = p_company_id
    and t.status <> 'complete';

  return jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'tenant_id', p_company_id,
    'status', c.status,
    'blocking_reasons', v_blockers,
    'ediel', v_go_live,
    'contract_platform', v_contract,
    'onboarding_task_incomplete_count_advisory', v_incomplete_task_count,
    'onboarding_tasks_are_gate', false,
    'source', 'canonical_runtime_v2',
    'evaluated_at', now()
  );
end;
$function$;

create or replace function public.gridex_reconcile_company_onboarding_tasks_v1(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_contract jsonb := '{}'::jsonb;
  v_go_live jsonb := '{}'::jsonb;
  v_api boolean := false;
  v_prod_actor boolean := false;
  v_test_actor boolean := false;
  v_brp boolean := false;
  v_prod_route boolean := false;
  v_test_route boolean := false;
  v_transport boolean := false;
  v_prod_certificate boolean := false;
  v_legal boolean := false;
  v_website boolean := false;
  v_customer_automation boolean := false;
  v_complete_count integer := 0;
begin
  if not exists(select 1 from public.companies where id = p_company_id) then
    raise exception 'tenant_not_found';
  end if;

  perform public.gridex_seed_company_onboarding_tasks(p_company_id);

  v_contract := public.gridex_contract_platform_readiness_internal_v1(p_company_id);
  v_go_live := public.gridex_company_go_live_readiness(p_company_id);

  select exists(
    select 1
    from public.integration_api_clients i
    where i.company_id = p_company_id
      and i.status = 'active'
      and array[
        'integration_context.read',
        'website_contracts.read',
        'website_contracts.diagnostics',
        'website_energy_area.resolve',
        'website_quotes.write',
        'website_quotes.validate',
        'website_applications.write',
        'website_legal.read'
      ]::text[] <@ coalesce(i.scopes, '{}'::text[])
  ) into v_api;

  select exists(
    select 1 from public.ediel_actor_settings a
    where a.company_id = p_company_id
      and a.environment = 'production'
      and coalesce(a.is_active, false) = true
      and lower(coalesce(a.actor_role, a.role, '')) in ('supplier', 'electricity_supplier')
  ) into v_prod_actor;

  select exists(
    select 1 from public.ediel_actor_settings a
    where a.company_id = p_company_id
      and a.environment = 'test'
      and coalesce(a.is_active, false) = true
      and lower(coalesce(a.actor_role, a.role, '')) in ('supplier', 'electricity_supplier')
  ) into v_test_actor;

  select exists(
    select 1 from public.ediel_brp_settings b
    where b.company_id = p_company_id
      and b.environment = 'production'
      and coalesce(b.is_active, true) = true
      and nullif(btrim(coalesce(b.brp_ediel_id, '')), '') is not null
  ) into v_brp;

  select exists(
    select 1
    from public.ediel_route_profiles r
    join public.ediel_actor_settings a on a.id = r.actor_setting_id
    where r.company_id = p_company_id
      and r.environment = 'production'
      and a.company_id = p_company_id
      and a.environment = 'production'
      and coalesce(a.is_active, false) = true
      and lower(coalesce(a.actor_role, a.role, '')) in ('supplier', 'electricity_supplier')
      and coalesce(r.is_enabled, false) = true
      and coalesce(r.is_active, true) = true
      and upper(coalesce(r.message_family, '')) = 'PRODAT'
  ) into v_prod_route;

  select exists(
    select 1
    from public.ediel_route_profiles r
    join public.ediel_actor_settings a on a.id = r.actor_setting_id
    where r.company_id = p_company_id
      and r.environment = 'test'
      and a.company_id = p_company_id
      and a.environment = 'test'
      and coalesce(a.is_active, false) = true
      and lower(coalesce(a.actor_role, a.role, '')) in ('supplier', 'electricity_supplier')
      and coalesce(r.is_enabled, false) = true
      and coalesce(r.is_active, true) = true
  ) into v_test_route;

  select exists(
    select 1
    from public.ediel_route_profiles r
    join public.ediel_actor_settings a on a.id = r.actor_setting_id
    join public.ediel_mailboxes m on m.id = r.mailbox_id
    where r.company_id = p_company_id
      and a.company_id = p_company_id
      and coalesce(a.is_active, false) = true
      and lower(coalesce(a.actor_role, a.role, '')) in ('supplier', 'electricity_supplier')
      and coalesce(r.is_enabled, false) = true
      and coalesce(r.is_active, true) = true
      and coalesce(m.is_active, false) = true
      and m.environment = r.environment
      and (m.company_id = p_company_id or m.company_id is null)
  ) into v_transport;

  select exists(
    select 1
    from public.ediel_route_profiles r
    join public.ediel_actor_settings a on a.id = r.actor_setting_id
    where r.company_id = p_company_id
      and r.environment = 'production'
      and a.company_id = p_company_id
      and a.environment = 'production'
      and coalesce(a.is_active, false) = true
      and lower(coalesce(a.actor_role, a.role, '')) in ('supplier', 'electricity_supplier')
      and coalesce(r.is_enabled, false) = true
      and coalesce(r.is_active, true) = true
      and upper(coalesce(r.message_family, '')) = 'PRODAT'
      and (
        coalesce(r.certificate_required, false) = false
        or lower(coalesce(r.receiver_source, '')) in (
          'selected_metering_point_grid_owner',
          'selected_customer_site_grid_owner',
          'selected_supplier_switch_grid_owner',
          'selected_data_request_grid_owner',
          'original_inbound_sender',
          'original_inbound_receiver'
        )
        or r.receiver_certificate_id is not null
        or r.certificate_id is not null
      )
  ) into v_prod_certificate;

  v_legal :=
    coalesce(v_contract #>> '{legal_profile,status}', '') = 'ready'
    and coalesce(v_contract #>> '{documents,status}', '') = 'ready';

  v_website :=
    v_api
    and coalesce((v_contract #>> '{website,can_display}')::boolean, false)
    and coalesce((v_contract #>> '{applications,can_accept}')::boolean, false);

  v_customer_automation :=
    coalesce((v_contract #>> '{applications,can_accept}')::boolean, false)
    and coalesce(v_contract #>> '{customer_operations,status}', '') = 'ready';

  update public.company_onboarding_tasks
  set status = case when v_api then 'complete' else 'pending' end,
      blocker_reason = case when v_api then null else 'Aktiv API-klient med obligatoriska website_sales-scopes saknas.' end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'canonical_runtime_v2', 'reconciled_at', now())
  where company_id = p_company_id and task_key = 'api_client_scopes';

  update public.company_onboarding_tasks
  set status = case when v_customer_automation then 'complete' else 'pending' end,
      blocker_reason = case when v_customer_automation then null else 'Ansöknings- eller kundoperationsflödet är inte ready.' end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'canonical_runtime_v2', 'reconciled_at', now())
  where company_id = p_company_id and task_key = 'customer_automation_readiness';

  update public.company_onboarding_tasks
  set status = case when v_brp then 'complete' else 'pending' end,
      blocker_reason = case when v_brp then null else 'Aktiv production-BRP saknas.' end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'canonical_runtime_v2', 'reconciled_at', now())
  where company_id = p_company_id and task_key = 'brp_settings';

  update public.company_onboarding_tasks
  set status = case when v_prod_certificate then 'complete' else 'pending' end,
      blocker_reason = case when v_prod_certificate then null else 'PRODAT-route saknar säker mottagar-/certifikatstrategi.' end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'canonical_runtime_v2', 'reconciled_at', now())
  where company_id = p_company_id and task_key = 'production_certificate';

  update public.company_onboarding_tasks
  set status = case when v_prod_actor then 'complete' else 'pending' end,
      blocker_reason = case when v_prod_actor then null else 'Aktiv supplier-produktionsaktörsprofil saknas.' end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'canonical_runtime_v2', 'reconciled_at', now())
  where company_id = p_company_id and task_key = 'production_ediel_actor_settings';

  update public.company_onboarding_tasks
  set status = case when v_test_actor then 'complete' else 'pending' end,
      blocker_reason = case when v_test_actor then null else 'Aktiv supplier-testaktörsprofil saknas.' end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'canonical_runtime_v2', 'reconciled_at', now())
  where company_id = p_company_id and task_key = 'test_ediel_actor_settings';

  update public.company_onboarding_tasks
  set status = case when v_legal then 'complete' else 'pending' end,
      blocker_reason = case when v_legal then null else 'Juridisk profil eller dokumentflöde är inte ready.' end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'canonical_runtime_v2', 'reconciled_at', now())
  where company_id = p_company_id and task_key = 'legal_default_package';

  update public.company_onboarding_tasks
  set status = case when v_prod_route then 'complete' else 'pending' end,
      blocker_reason = case when v_prod_route then null else 'Supplier-bunden PRODAT-produktionsroute saknas.' end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'canonical_runtime_v2', 'reconciled_at', now())
  where company_id = p_company_id and task_key = 'production_route_readiness';

  update public.company_onboarding_tasks
  set status = case when v_test_route then 'complete' else 'pending' end,
      blocker_reason = case when v_test_route then null else 'Supplier-bunden test-route saknas.' end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'canonical_runtime_v2', 'reconciled_at', now())
  where company_id = p_company_id and task_key = 'test_route_readiness';

  update public.company_onboarding_tasks
  set status = case when v_transport then 'complete' else 'pending' end,
      blocker_reason = case when v_transport then null else 'Aktiv route saknar tenant- eller shared-mailboxtransport.' end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'canonical_runtime_v2', 'reconciled_at', now())
  where company_id = p_company_id and task_key = 'shared_mailbox_transport';

  update public.company_onboarding_tasks
  set status = case when v_website then 'complete' else 'pending' end,
      blocker_reason = case when v_website then null else 'Webb/API-kontraktflödet är inte komplett.' end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'canonical_runtime_v2', 'reconciled_at', now())
  where company_id = p_company_id and task_key = 'website_portal_integration';

  select count(*)
  into v_complete_count
  from public.company_onboarding_tasks
  where company_id = p_company_id and status = 'complete';

  return jsonb_build_object(
    'company_id', p_company_id,
    'complete_count', v_complete_count,
    'total_count', (select count(*) from public.company_onboarding_tasks where company_id = p_company_id),
    'go_live', v_go_live,
    'source', 'canonical_runtime_v2',
    'reconciled_at', now()
  );
end;
$function$;

revoke all on function public.gridex_reconcile_company_onboarding_tasks_v1(uuid) from public;
revoke all on function public.gridex_reconcile_company_onboarding_tasks_v1(uuid) from anon;
revoke all on function public.gridex_reconcile_company_onboarding_tasks_v1(uuid) from authenticated;
grant execute on function public.gridex_reconcile_company_onboarding_tasks_v1(uuid) to service_role;

-- Existing tenants are reconciled from their actual runtime state. This is
-- data-driven and applies identically to every tenant; it does not grant go-live.
do $block$
declare
  v_company record;
begin
  for v_company in select id from public.companies loop
    begin
      perform public.gridex_reconcile_company_onboarding_tasks_v1(v_company.id);
    exception when others then
      raise warning 'onboarding reconciliation failed for company %: %', v_company.id, sqlerrm;
    end;
  end loop;
end;
$block$;
