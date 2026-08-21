-- Fail-closed typed correlation gate for inbound PRODAT Z02 jobs.
-- The gate runs at the durable worker boundary so legacy callers cannot enqueue
-- an automatic apply unless the inbound response proves tenant/site/origin/variant.

create or replace function public.gridex_prodat_variant_from_raw(p_raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_raw, '') ~ E'CAV\\+[^'']*Z23' then 'LK'
    when coalesce(p_raw, '') ~ E'CAV\\+[^'']*Z22' then 'L'
    else null
  end
$$;

create or replace function public.gridex_edifact_rff_value(p_raw text, p_qualifier text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_match text[];
begin
  if coalesce(p_raw, '') = '' or coalesce(p_qualifier, '') = '' then
    return null;
  end if;
  v_match := regexp_match(
    p_raw,
    'RFF\\+' || regexp_replace(p_qualifier, '([^a-zA-Z0-9])', '\\\1', 'g') || ':([^+''\\r\\n]+)'
  );
  return nullif(btrim(v_match[1]), '');
exception when others then
  return null;
end;
$$;

create or replace function public.gridex_gate_inbound_z02_operation_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_message_id uuid;
  v_request public.customer_info_requests%rowtype;
  v_inbound public.ediel_messages%rowtype;
  v_source public.ediel_messages%rowtype;
  v_source_count integer := 0;
  v_inbound_li text;
  v_inbound_tn text;
  v_inbound_acw text;
  v_source_expected_variant text;
  v_inbound_variant text;
  v_typed_match_count integer := 0;
  v_reason_code text := null;
  v_reason_text text := null;
  v_details jsonb := '{}'::jsonb;
begin
  if new.job_type <> 'apply_inbound_grid_owner_response'
     or new.status not in ('queued', 'running') then
    return new;
  end if;

  begin
    v_request_id := nullif(new.payload ->> 'customer_info_request_id', '')::uuid;
    v_message_id := nullif(new.payload ->> 'ediel_message_id', '')::uuid;
  exception when others then
    v_reason_code := 'z02_job_invalid_identifiers';
    v_reason_text := 'Inbound-jobbet saknar giltiga UUID-referenser.';
  end;

  if v_reason_code is null and (v_request_id is null or v_message_id is null) then
    v_reason_code := 'z02_job_missing_identifiers';
    v_reason_text := 'Inbound-jobbet saknar customer_info_request_id eller ediel_message_id.';
  end if;

  if v_reason_code is null then
    select * into v_request
    from public.customer_info_requests
    where id = v_request_id
      and company_id = new.company_id;

    if not found then
      v_reason_code := 'z02_request_not_found_for_tenant';
      v_reason_text := 'Customer-info-request hittades inte i jobbets tenant.';
    elsif v_request.customer_id <> new.customer_id
       or v_request.site_id is distinct from new.customer_site_id then
      v_reason_code := 'request_site_customer_mismatch';
      v_reason_text := 'Requestens kund/anläggning matchar inte operation-jobbet.';
    end if;
  end if;

  if v_reason_code is null then
    select * into v_inbound
    from public.ediel_messages
    where id = v_message_id
      and company_id = new.company_id
      and direction = 'inbound'
      and message_family = 'PRODAT'
      and upper(coalesce(message_code, '')) = 'Z02';

    if not found then
      v_reason_code := 'z02_inbound_message_not_found';
      v_reason_text := 'Meddelandet är inte ett inbound PRODAT Z02 i rätt tenant.';
    elsif v_inbound.customer_id is not null and v_inbound.customer_id <> new.customer_id then
      v_reason_code := 'z02_customer_mismatch';
      v_reason_text := 'Inbound Z02 är redan länkat till en annan kund.';
    elsif v_inbound.site_id is not null and v_inbound.site_id <> new.customer_site_id then
      v_reason_code := 'response_site_mismatch';
      v_reason_text := 'Inbound Z02 är redan länkat till en annan anläggning.';
    elsif v_request.grid_owner_id is not null
       and v_inbound.grid_owner_id is not null
       and v_request.grid_owner_id <> v_inbound.grid_owner_id then
      v_reason_code := 'grid_owner_conflict';
      v_reason_text := 'Inbound Z02 kommer från annan nätägare än originating request.';
    end if;
  end if;

  if v_reason_code is null then
    if v_request.ediel_message_id is not null then
      select * into v_source
      from public.ediel_messages
      where id = v_request.ediel_message_id
        and company_id = new.company_id
        and direction = 'outbound'
        and message_family = 'PRODAT'
        and upper(coalesce(message_code, '')) = 'Z01';
      if found then v_source_count := 1; end if;
    end if;

    if v_source_count = 0 and v_request.grid_owner_data_request_id is not null then
      select count(*)::integer into v_source_count
      from public.ediel_messages
      where company_id = new.company_id
        and grid_owner_data_request_id = v_request.grid_owner_data_request_id
        and direction = 'outbound'
        and message_family = 'PRODAT'
        and upper(coalesce(message_code, '')) = 'Z01'
        and status <> 'cancelled';

      if v_source_count = 1 then
        select * into v_source
        from public.ediel_messages
        where company_id = new.company_id
          and grid_owner_data_request_id = v_request.grid_owner_data_request_id
          and direction = 'outbound'
          and message_family = 'PRODAT'
          and upper(coalesce(message_code, '')) = 'Z01'
          and status <> 'cancelled'
        order by created_at desc
        limit 1;
      end if;
    end if;

    if v_source_count = 0 then
      v_reason_code := 'z02_originating_z01_missing';
      v_reason_text := 'Originating PRODAT Z01 kunde inte identifieras.';
    elsif v_source_count > 1 then
      v_reason_code := 'z02_originating_z01_ambiguous';
      v_reason_text := 'Flera möjliga originating PRODAT Z01 hittades.';
    elsif v_source.customer_id is distinct from new.customer_id
       or v_source.site_id is distinct from new.customer_site_id then
      v_reason_code := 'z02_origin_site_customer_mismatch';
      v_reason_text := 'Originating Z01 tillhör inte exakt samma kund och anläggning.';
    elsif coalesce(v_source.receiver_ediel_id, '') <> ''
       and coalesce(v_inbound.sender_ediel_id, '') <> ''
       and v_source.receiver_ediel_id <> v_inbound.sender_ediel_id then
      v_reason_code := 'z02_sender_receiver_mismatch';
      v_reason_text := 'Inbound avsändare matchar inte originating Z01-mottagaren.';
    elsif coalesce(v_source.sender_ediel_id, '') <> ''
       and coalesce(v_inbound.receiver_ediel_id, '') <> ''
       and v_source.sender_ediel_id <> v_inbound.receiver_ediel_id then
      v_reason_code := 'z02_receiver_sender_mismatch';
      v_reason_text := 'Inbound mottagare matchar inte originating Z01-avsändaren.';
    end if;
  end if;

  if v_reason_code is null then
    v_inbound_li := public.gridex_edifact_rff_value(v_inbound.raw_payload, 'LI');
    v_inbound_tn := public.gridex_edifact_rff_value(v_inbound.raw_payload, 'TN');
    v_inbound_acw := public.gridex_edifact_rff_value(v_inbound.raw_payload, 'ACW');

    select count(*)::integer into v_typed_match_count
    from public.ediel_business_references br
    where br.company_id = new.company_id
      and br.source_message_id = v_source.id
      and br.message_family = 'PRODAT'
      and upper(coalesce(br.message_code, '')) = 'Z01'
      and (
        (br.reference_type = 'RFF_LI' and v_inbound_li is not null and br.reference_value = v_inbound_li)
        or (br.reference_type = 'RFF_TN' and v_inbound_tn is not null and br.reference_value = v_inbound_tn)
        or (br.reference_type = 'RFF_ACW' and v_inbound_acw is not null and br.reference_value = v_inbound_acw)
      );

    if v_typed_match_count = 0 then
      v_reason_code := 'z02_typed_business_reference_mismatch';
      v_reason_text := 'Z02 saknar typed business reference som matchar originating Z01.';
    end if;
  end if;

  if v_reason_code is null then
    v_source_expected_variant := upper(coalesce(
      v_source.parsed_payload ->> 'expectedZ02Variant',
      v_source.validation_report ->> 'expectedZ02Variant',
      public.gridex_prodat_variant_from_raw(v_source.raw_payload)
    ));
    v_inbound_variant := upper(coalesce(
      v_inbound.parsed_payload ->> 'prodatVariant',
      v_inbound.validation_report ->> 'prodatVariant',
      public.gridex_prodat_variant_from_raw(v_inbound.raw_payload)
    ));

    if v_source_expected_variant not in ('L', 'LK') then
      v_reason_code := 'z02_origin_variant_missing';
      v_reason_text := 'Originating Z01 saknar canonical expected Z02-variant.';
    elsif v_inbound_variant not in ('L', 'LK') then
      v_reason_code := 'z02_response_variant_missing';
      v_reason_text := 'Inbound Z02 saknar entydig L/LK-variant.';
    elsif v_source_expected_variant <> v_inbound_variant then
      v_reason_code := 'z02_variant_mismatch';
      v_reason_text := format(
        'Inbound Z02%s matchar inte originating Z01%s.',
        v_inbound_variant,
        v_source_expected_variant
      );
    end if;
  end if;

  v_details := jsonb_build_object(
    'gate', 'gridex_gate_inbound_z02_operation_job',
    'customer_info_request_id', v_request_id,
    'inbound_message_id', v_message_id,
    'originating_z01_message_id', v_source.id,
    'typed_reference_matches', v_typed_match_count,
    'expected_z02_variant', v_source_expected_variant,
    'inbound_z02_variant', v_inbound_variant,
    'evaluated_at', now()
  );

  if v_reason_code is not null then
    new.status := 'needs_review';
    new.result := coalesce(new.result, '{}'::jsonb)
      || jsonb_build_object(
        'reason', v_reason_code,
        'reason_code', v_reason_code,
        'blocker_reason', v_reason_text,
        'correlation', v_details
      );

    if v_request_id is not null then
      update public.customer_info_requests
      set status = 'manual_review_required',
          blocker_code = v_reason_code,
          blocker_reason = v_reason_text,
          blocker_details = coalesce(blocker_details, '{}'::jsonb) || v_details,
          next_required_action = 'Granska Z02-korrelation, tenant/site och L/LK-variant innan svaret appliceras.',
          updated_at = now()
      where id = v_request_id
        and company_id = new.company_id;
    end if;

    insert into public.facility_data_quality_issues (
      company_id,
      customer_id,
      customer_site_id,
      grid_owner_id,
      issue_type,
      severity,
      source,
      source_error_code,
      source_error_text,
      recommended_action,
      retry_allowed,
      next_readiness_required,
      metadata
    )
    select
      new.company_id,
      new.customer_id,
      new.customer_site_id,
      v_request.grid_owner_id,
      case
        when v_reason_code in ('response_site_mismatch', 'z02_origin_site_customer_mismatch') then 'response_site_mismatch'
        when v_reason_code like '%tenant%' then 'tenant_mismatch'
        else 'request_site_customer_mismatch'
      end,
      'critical',
      'ediel_z02_correlation_gate',
      v_reason_code,
      v_reason_text,
      'Granska originating Z01 och inbound Z02 typed references innan automation återupptas.',
      false,
      true,
      v_details
    where not exists (
      select 1
      from public.facility_data_quality_issues q
      where q.company_id = new.company_id
        and q.customer_site_id is not distinct from new.customer_site_id
        and q.status = 'open'
        and q.source = 'ediel_z02_correlation_gate'
        and q.source_error_code = v_reason_code
        and (q.metadata ->> 'inbound_message_id') = coalesce(v_message_id::text, '')
    );

    return new;
  end if;

  new.result := coalesce(new.result, '{}'::jsonb)
    || jsonb_build_object(
      'z02_correlation_status', 'exact',
      'correlation', v_details
    );
  return new;
end;
$$;

drop trigger if exists trg_customer_operation_job_z02_correlation
  on public.customer_operation_jobs;

create trigger trg_customer_operation_job_z02_correlation
before insert or update of status, payload, job_type
on public.customer_operation_jobs
for each row
execute function public.gridex_gate_inbound_z02_operation_job();

comment on function public.gridex_gate_inbound_z02_operation_job() is
  'Fail-closed durable gate: automatic inbound Z02 application requires exact tenant/customer/site, originating Z01, typed business reference and matching L/LK variant.';
