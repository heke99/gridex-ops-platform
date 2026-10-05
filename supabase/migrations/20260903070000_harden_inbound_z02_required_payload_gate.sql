-- Fail-closed Z02 payload and identity gate.
-- Runs after the exact-correlation gate and before the atomic Z02 apply trigger.
-- A correlated response with missing or conflicting required facts must never
-- mutate site or metering-point state.

create or replace function public.gridex_edifact_cci_cav_value(p_raw text, p_cci_code text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_match text[];
  v_value text;
begin
  if coalesce(p_raw, '') = '' or coalesce(p_cci_code, '') = '' then return null; end if;
  v_match := regexp_match(
    p_raw,
    'CCI\\+\\+' || regexp_replace(p_cci_code, '([^a-zA-Z0-9])', '\\\1', 'g') || '[^'']*''[[:space:]]*CAV\\+([^+''\\r\\n]+)'
  );
  v_value := nullif(btrim(v_match[1]), '');
  if v_value is null then return null; end if;
  return nullif(btrim(regexp_replace(v_value, '^.*:', '')), '');
exception when others then return null;
end;
$$;

create or replace function public.gridex_edifact_nad_element(p_raw text, p_qualifier text, p_element_index integer)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_match text[];
  v_parts text[];
  v_segment text;
begin
  if coalesce(p_raw, '') = '' or coalesce(p_qualifier, '') = '' or p_element_index < 0 then return null; end if;
  v_match := regexp_match(
    p_raw,
    'NAD\\+' || regexp_replace(p_qualifier, '([^a-zA-Z0-9])', '\\\1', 'g') || '\\+([^''\\r\\n]+)'
  );
  v_segment := 'NAD+' || p_qualifier || '+' || coalesce(v_match[1], '');
  v_parts := string_to_array(v_segment, '+');
  return nullif(btrim(v_parts[p_element_index + 1]), '');
exception when others then return null;
end;
$$;

create or replace function public.gridex_gate_inbound_z02_required_payload()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_request_id uuid;
  v_message_id uuid;
  v_request public.customer_info_requests%rowtype;
  v_message public.ediel_messages%rowtype;
  v_site public.customer_sites%rowtype;
  v_customer public.customers%rowtype;
  v_lin text;
  v_li text;
  v_grid_area text;
  v_measure_method text;
  v_reason text;
  v_ud_composite text;
  v_ud_id text;
  v_ud_qualifier text;
  v_ud_name text;
  v_ud_postcode text;
  v_ud_city text;
  v_ud_country text;
  v_it_composite text;
  v_it_id text;
  v_it_address text;
  v_it_postcode text;
  v_it_city text;
  v_it_country text;
  v_expected_customer_id text;
  v_expected_customer_qualifier text;
  v_expected_facility_id text;
  v_reason_code text := null;
  v_reason_text text := null;
  v_details jsonb := '{}'::jsonb;
begin
  if new.job_type <> 'apply_inbound_grid_owner_response'
     or new.status not in ('queued', 'running')
     or coalesce(new.result ->> 'z02_correlation_status', '') <> 'exact' then
    return new;
  end if;

  begin
    v_request_id := nullif(new.payload ->> 'customer_info_request_id', '')::uuid;
    v_message_id := nullif(new.payload ->> 'ediel_message_id', '')::uuid;
  exception when others then
    v_reason_code := 'z02_payload_identifiers_invalid';
    v_reason_text := 'Z02 payload-gaten saknar giltiga request/message-ID.';
  end;

  if v_reason_code is null then
    select * into v_request from public.customer_info_requests where id = v_request_id and company_id = new.company_id;
    select * into v_message from public.ediel_messages
      where id = v_message_id and company_id = new.company_id
        and direction = 'inbound' and message_family = 'PRODAT' and upper(coalesce(message_code,'')) = 'Z02';
    select * into v_site from public.customer_sites
      where id = new.customer_site_id and company_id = new.company_id and customer_id = new.customer_id;
    select * into v_customer from public.customers where id = new.customer_id and company_id = new.company_id;
    if v_request.id is null or v_message.id is null or v_site.id is null or v_customer.id is null then
      v_reason_code := 'z02_payload_context_missing';
      v_reason_text := 'Z02 payload-gaten kunde inte läsa exakt request, meddelande, kund och anläggning.';
    end if;
  end if;

  if v_reason_code is null then
    v_lin := public.gridex_edifact_first_lin_item_id(v_message.raw_payload);
    v_li := public.gridex_edifact_rff_value(v_message.raw_payload, 'LI');
    v_grid_area := public.gridex_edifact_rff_value(v_message.raw_payload, 'Z05');
    v_measure_method := public.gridex_edifact_cci_cav_value(v_message.raw_payload, 'Z04');
    v_reason := public.gridex_edifact_cci_cav_value(v_message.raw_payload, 'Z13');

    v_ud_composite := public.gridex_edifact_nad_element(v_message.raw_payload, 'UD', 2);
    v_ud_id := nullif(btrim(split_part(coalesce(v_ud_composite,''), ':', 1)), '');
    v_ud_qualifier := nullif(btrim(split_part(coalesce(v_ud_composite,''), ':', 2)), '');
    v_ud_name := public.gridex_edifact_nad_element(v_message.raw_payload, 'UD', 4);
    v_ud_postcode := public.gridex_edifact_nad_element(v_message.raw_payload, 'UD', 8);
    v_ud_city := public.gridex_edifact_nad_element(v_message.raw_payload, 'UD', 6);
    v_ud_country := public.gridex_edifact_nad_element(v_message.raw_payload, 'UD', 9);

    v_it_composite := public.gridex_edifact_nad_element(v_message.raw_payload, 'IT', 2);
    v_it_id := nullif(btrim(split_part(coalesce(v_it_composite,''), ':', 1)), '');
    v_it_address := public.gridex_edifact_nad_element(v_message.raw_payload, 'IT', 5);
    v_it_postcode := public.gridex_edifact_nad_element(v_message.raw_payload, 'IT', 8);
    v_it_city := public.gridex_edifact_nad_element(v_message.raw_payload, 'IT', 6);
    v_it_country := public.gridex_edifact_nad_element(v_message.raw_payload, 'IT', 9);

    v_expected_customer_id := coalesce(nullif(btrim(v_customer.org_number), ''), nullif(btrim(v_customer.personal_number), ''));
    v_expected_customer_qualifier := case
      when nullif(btrim(v_customer.org_number), '') is not null then 'SE1'
      when nullif(btrim(v_customer.personal_number), '') is not null then 'SE2'
      else null
    end;
    v_expected_facility_id := coalesce(nullif(btrim(v_site.normalized_facility_id), ''), nullif(btrim(v_site.facility_id), ''));

    if v_lin is null then
      v_reason_code := 'z02_required_line_item_missing'; v_reason_text := 'Z02 saknar obligatoriskt LIN anläggnings-/mätpunkts-ID (fält 209).';
    elsif v_li is null then
      v_reason_code := 'z02_required_line_reference_missing'; v_reason_text := 'Z02 saknar obligatorisk RFF+LI (fält 226).';
    elsif v_grid_area is null then
      v_reason_code := 'z02_required_grid_area_missing'; v_reason_text := 'Z02 saknar obligatoriskt nätområde RFF+Z05 (fält 260).';
    elsif v_measure_method is null then
      v_reason_code := 'z02_required_measure_method_missing'; v_reason_text := 'Z02 saknar obligatorisk mätmetod CCI++Z04/CAV (fält 217).';
    elsif v_reason is null then
      v_reason_code := 'z02_required_reason_missing'; v_reason_text := 'Z02 saknar obligatorisk transaktionsorsak CCI++Z13/CAV (fält 223).';
    elsif v_ud_id is null or v_ud_name is null or v_ud_postcode is null or v_ud_city is null or v_ud_country is null then
      v_reason_code := 'z02_required_end_user_fields_missing'; v_reason_text := 'Z02 saknar obligatoriska elanvändaruppgifter i NAD+UD (fält 227/228/231/232/316).';
    elsif v_it_id is null or v_it_address is null then
      v_reason_code := 'z02_required_installation_fields_missing'; v_reason_text := 'Z02 saknar obligatoriskt anläggnings-ID eller anläggningsadress i NAD+IT (fält 233/234).';
    elsif regexp_replace(upper(v_it_id), '[^0-9A-Z]', '', 'g') <> regexp_replace(upper(v_lin), '[^0-9A-Z]', '', 'g') then
      v_reason_code := 'z02_installation_id_line_item_mismatch'; v_reason_text := 'Z02 NAD+IT anläggnings-ID matchar inte LIN fält 209.';
    elsif v_expected_facility_id is not null and regexp_replace(upper(v_expected_facility_id), '[^0-9A-Z]', '', 'g') <> regexp_replace(upper(v_lin), '[^0-9A-Z]', '', 'g') then
      v_reason_code := 'z02_facility_identifier_conflict'; v_reason_text := 'Z02 anläggnings-ID matchar inte den anläggning som Gridex frågade om.';
    elsif v_expected_customer_id is not null and regexp_replace(upper(v_expected_customer_id), '[^0-9A-Z]', '', 'g') <> regexp_replace(upper(v_ud_id), '[^0-9A-Z]', '', 'g') then
      v_reason_code := 'z02_end_user_identity_conflict'; v_reason_text := 'Z02 elanvändaridentitet matchar inte kunden i originating Z01.';
    elsif v_expected_customer_qualifier is not null and upper(coalesce(v_ud_qualifier,'')) <> v_expected_customer_qualifier then
      v_reason_code := 'z02_end_user_qualifier_conflict'; v_reason_text := 'Z02 elanvändarens ID-kvalificerare matchar inte kundens juridiska identitet.';
    elsif nullif(btrim(v_site.street), '') is not null and lower(regexp_replace(btrim(v_it_address), '[[:space:]]+', ' ', 'g')) <> lower(regexp_replace(btrim(v_site.street), '[[:space:]]+', ' ', 'g')) then
      v_reason_code := 'z02_installation_address_conflict'; v_reason_text := 'Z02 anläggningsadress matchar inte den canonical adress som originating Z01 avsåg.';
    elsif v_it_postcode is not null and regexp_replace(v_it_postcode, '[^0-9]', '', 'g') <> regexp_replace(coalesce(v_site.postal_code,''), '[^0-9]', '', 'g') then
      v_reason_code := 'z02_installation_postcode_conflict'; v_reason_text := 'Z02 anläggningens postnummer matchar inte originating site.';
    elsif v_it_city is not null and lower(btrim(v_it_city)) <> lower(btrim(coalesce(v_site.city,''))) then
      v_reason_code := 'z02_installation_city_conflict'; v_reason_text := 'Z02 anläggningens ort matchar inte originating site.';
    elsif v_it_country is not null and upper(btrim(v_it_country)) <> upper(btrim(coalesce(v_site.country,'SE'))) then
      v_reason_code := 'z02_installation_country_conflict'; v_reason_text := 'Z02 anläggningens land matchar inte originating site.';
    end if;
  end if;

  v_details := jsonb_build_object(
    'gate', 'gridex_gate_inbound_z02_required_payload',
    'inbound_message_id', v_message_id,
    'customer_info_request_id', v_request_id,
    'line_item_id', v_lin,
    'line_reference', v_li,
    'grid_area', v_grid_area,
    'measure_method', v_measure_method,
    'reason_for_transaction', v_reason,
    'end_user_id', v_ud_id,
    'end_user_qualifier', v_ud_qualifier,
    'installation_id', v_it_id,
    'installation_address', v_it_address,
    'evaluated_at', now()
  );

  if v_reason_code is not null then
    new.status := 'needs_review';
    new.result := coalesce(new.result, '{}'::jsonb) || jsonb_build_object(
      'reason', v_reason_code,
      'reason_code', v_reason_code,
      'blocker_reason', v_reason_text,
      'z02_payload_validation', v_details
    );
    if v_request_id is not null then
      update public.customer_info_requests
      set status = 'manual_review_required',
          blocker_code = v_reason_code,
          blocker_reason = v_reason_text,
          blocker_details = coalesce(blocker_details, '{}'::jsonb) || jsonb_build_object('z02_payload_validation', v_details),
          next_required_action = 'Granska Z02 required fields och identitetskonflikt innan svaret appliceras.',
          updated_at = now()
      where id = v_request_id and company_id = new.company_id;
    end if;
    return new;
  end if;

  new.result := coalesce(new.result, '{}'::jsonb) || jsonb_build_object(
    'z02_payload_validation_status', 'valid',
    'z02_payload_validation', v_details
  );
  return new;
end;
$$;

revoke all on function public.gridex_edifact_cci_cav_value(text,text) from public, anon, authenticated;
grant execute on function public.gridex_edifact_cci_cav_value(text,text) to service_role;
revoke all on function public.gridex_edifact_nad_element(text,text,integer) from public, anon, authenticated;
grant execute on function public.gridex_edifact_nad_element(text,text,integer) to service_role;
revoke all on function public.gridex_gate_inbound_z02_required_payload() from public, anon, authenticated;
grant execute on function public.gridex_gate_inbound_z02_required_payload() to service_role;

drop trigger if exists trg_customer_operation_job_z02_payload_validation on public.customer_operation_jobs;
create trigger trg_customer_operation_job_z02_payload_validation
before insert or update of status, payload, job_type
on public.customer_operation_jobs
for each row
execute function public.gridex_gate_inbound_z02_required_payload();

comment on function public.gridex_gate_inbound_z02_required_payload() is
  'PRODAT 26-A Z02 required-field and identity gate. Runs after exact correlation and before atomic apply; conflicts become needs_review and never mutate site/metering data.';
