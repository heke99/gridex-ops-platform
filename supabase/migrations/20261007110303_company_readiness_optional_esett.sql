-- Optional historical company status must fail closed on current row shapes.
-- No column/status/evidence/grant is created; missing eSett status remains blocked.
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
  if lower(coalesce(to_jsonb(c)->>'esett_status', 'missing')) <> 'ready' then
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
