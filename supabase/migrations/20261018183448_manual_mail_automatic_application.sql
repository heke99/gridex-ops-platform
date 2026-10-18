-- Incoming email is evidence, never identity or market execution authority.
-- These service-only commands recheck stored correlation, transport verification,
-- current holds and lifecycle ownership while holding all business rows.
create or replace function public.gridex_manual_reply_context_v1(
  p_company_id uuid, p_request_id uuid, p_inbound_id uuid, p_source_hash text, p_kind text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  r public.grid_owner_information_requests%rowtype;
  i public.manual_inbound_messages%rowtype;
  s public.customer_sites%rowtype;
  c jsonb;
  co jsonb;
  cir public.customer_info_requests%rowtype;
begin
  select * into r from public.grid_owner_information_requests
    where company_id=p_company_id and id=p_request_id for update;
  if not found then return jsonb_build_object('ok',false,'code','manual_reply_request_not_found'); end if;
  select * into i from public.manual_inbound_messages where id=p_inbound_id for update;
  if not found or i.company_id is distinct from p_company_id or i.request_id is distinct from r.id
    or i.customer_id is distinct from r.customer_id or i.customer_site_id is distinct from r.customer_site_id
    or r.customer_id is null or r.customer_site_id is null or i.resolution_status is distinct from 'matched'
    then return jsonb_build_object('ok',false,'code','manual_reply_source_ownership'); end if;
  if i.extracted_payload->'sender_credible' is distinct from 'true'::jsonb
    or i.extracted_payload#>>'{sender_verification,status}' is distinct from 'verified'
    or p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$'
    or i.extracted_payload#>>'{manual_automation,sourceHash}' is distinct from p_source_hash
    then return jsonb_build_object('ok',false,'code','manual_reply_source_unverified'); end if;
  if i.extracted_payload->'manual_reply_structure_requires_review'='true'::jsonb or i.extracted_payload->'mime_requires_review'='true'::jsonb
    or coalesce(i.extracted_payload->'customer_identity_review_reasons','[]'::jsonb) is distinct from '[]'::jsonb
    then return jsonb_build_object('ok',false,'code','manual_reply_source_requires_review'); end if;
  select * into s from public.customer_sites
    where company_id=p_company_id and id=r.customer_site_id and customer_id=r.customer_id for update;
  if not found then return jsonb_build_object('ok',false,'code','manual_reply_site_ownership'); end if;
  select to_jsonb(t) into c from public.customers t where id=r.customer_id and company_id=p_company_id for share;
  select to_jsonb(t) into co from public.companies t where id=p_company_id for share;
  if c is null or co is null or co->'is_active' is distinct from 'true'::jsonb
    or co->>'status' not in ('active','onboarding') or co->>'lifecycle_status' is distinct from 'active' or co->>'closed_at' is not null
    or c->>'archived_at' is not null or c->>'anonymized_at' is not null or c->>'merged_into_customer_id' is not null
    or c->>'lifecycle_closed_at' is not null or c->>'status' in ('archived','closed','anonymized','merged','cancelled','inactive','paused','suspended')
    or s.is_active is distinct from true or s.archived_at is not null or s.closed_at is not null
    or s.status in ('archived','closed','cancelled','inactive')
    then return jsonb_build_object('ok',false,'code','manual_reply_lifecycle_blocked'); end if;
  if s.protected_identity is true or c->'protected_identity'='true'::jsonb
    or c#>'{metadata,protected_identity}'='true'::jsonb
    then return jsonb_build_object('ok',false,'code','manual_reply_protected_identity'); end if;
  if p_kind='commercial' then
    select * into cir from public.customer_info_requests
      where id::text=r.metadata->>'customer_info_request_id' and company_id=p_company_id
        and customer_id=r.customer_id and site_id=r.customer_site_id and target_party_type='current_supplier' for update;
    if not found or cir.authorization_document_id::text is distinct from r.metadata->>'authorization_document_id' or r.grid_owner_id is not null or r.metadata->>'target_party' is distinct from 'current_supplier'
      or r.metadata->>'supplier_id' is distinct from s.current_supplier_id::text
      or cir.verified_payload->>'manual_supplier_request_id' is distinct from r.id::text
      or cir.verified_payload->>'supplier_id' is distinct from s.current_supplier_id::text
      or (cir.blocker_code is not null and cir.blocker_code not in ('supplier_terms_incomplete','current_supplier_response_waiting','missing_binding_info','missing_termination_info'))
      or cir.verified_payload#>'{counterparty_reply,requires_review}'='true'::jsonb
      or cir.status not in ('ready_to_send','sent','waiting_response','received','partially_received','missing_binding_info','missing_termination_info','ready_for_switch')
      or not exists(select 1 from public.electricity_suppliers es where es.id=s.current_supplier_id
        and (es.company_id is null or es.company_id=p_company_id) and es.is_active=true
        and es.platform_market_actor_id::text=r.metadata->>'supplier_actor_id'
        and cir.verified_payload->>'supplier_actor_id'=es.platform_market_actor_id::text
        and cir.verified_payload->>'supplier_contact_id'=r.metadata->>'supplier_contact_id')
      then return jsonb_build_object('ok',false,'code','manual_reply_supplier_request_ownership'); end if;
  end if;
  if p_kind='commercial' and public.gridex_manual_supplier_route_current_v1(p_company_id,s.current_supplier_id,
    (r.metadata->>'supplier_actor_id')::uuid,(r.metadata->>'supplier_contact_id')::uuid,r.recipient_email) is distinct from true
    then return jsonb_build_object('ok',false,'code','manual_reply_supplier_route_revoked'); end if;
  if public.gridex_manual_reply_poa_current_v1(p_company_id,r.customer_id,r.customer_site_id,r.poa_id,
    case when p_kind='commercial' then (r.metadata->>'authorization_document_id')::uuid else null end,p_kind,
    case when p_kind='commercial' then cir.metering_point_id else null end) is distinct from true
    then return jsonb_build_object('ok',false,'code','manual_reply_current_poa_required'); end if;
  if r.metadata#>'{counterparty_reply,requires_review}'='true'::jsonb
    then return jsonb_build_object('ok',false,'code','manual_reply_current_hold'); end if;
  if (p_kind='commercial' and r.request_type is distinct from 'current_supplier_contract_information_request')
    or (p_kind='facility' and r.request_type not in ('facility_identifier_lookup','facility_lookup','metering_point_lookup','grid_area_confirmation','grid_contract_information'))
    then return jsonb_build_object('ok',false,'code','manual_reply_request_type'); end if;
  if r.parsed_payload->'applied'='true'::jsonb and r.parsed_payload->>'inbound_id'=p_inbound_id::text
    and i.processing_state='applied'
    then return jsonb_build_object('ok',true,'alreadyApplied',true,'applied',true,'complete',r.status='completed','customerId',r.customer_id,'customerSiteId',r.customer_site_id,'effectiveStartDate',r.parsed_payload#>>'{terms,effectiveStartDate}','result',r.parsed_payload->'result'); end if;
  if r.status not in ('sent','waiting_response','received','manual_email_sent','waiting_manual_response','manual_response_received','manual_response_parsed')
    then return jsonb_build_object('ok',false,'code','manual_reply_request_not_waiting'); end if;
  if r.received_at > i.received_at or (r.received_at=i.received_at and r.parsed_payload->>'inbound_id' is not null and r.parsed_payload->>'inbound_id'<>p_inbound_id::text)
    then return jsonb_build_object('ok',false,'code','manual_reply_stale_source'); end if;
  return jsonb_build_object('ok',true,'customerId',r.customer_id,'customerSiteId',r.customer_site_id,'receivedAt',i.received_at,'request',to_jsonb(r),'site',to_jsonb(s),'customer',c,'inbound',to_jsonb(i));
end $$;
revoke all on function public.gridex_manual_reply_context_v1(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.gridex_manual_reply_context_v1(uuid,uuid,uuid,text,text) to service_role;

create or replace function public.gridex_apply_manual_commercial_reply_v1(
  p_company_id uuid,p_request_id uuid,p_inbound_id uuid,p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  ctx jsonb;
  terms jsonb := p_payload->'terms';
  evidence jsonb := p_payload->'evidence';
  k text;
  value text;
  contract_end date;
  earliest date;
  deadline date;
  effective date;
  fee numeric;
  complete boolean;
  response_status text;
  snapshot jsonb;
  site jsonb;
  previous jsonb;
  received timestamptz;
  v_customer_id uuid;
  v_site_id uuid;
  result_payload jsonb;
  next_follow_up timestamptz;
  missing_fields jsonb;
  field_sources jsonb:='{}'::jsonb;
  current_terms jsonb:=p_payload->'terms';
  hint_key text; hint_value text; expected_value text;
begin
  ctx := public.gridex_manual_reply_context_v1(p_company_id,p_request_id,p_inbound_id,p_payload->>'sourceHash','commercial');
  if ctx->'ok' is distinct from 'true'::jsonb or ctx->'alreadyApplied'='true'::jsonb then return ctx; end if;
  if p_payload ? 'nextFollowUpAt' then
    if jsonb_typeof(p_payload->'nextFollowUpAt') is distinct from 'string'
      or p_payload->>'nextFollowUpAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
      then return jsonb_build_object('ok',false,'code','manual_reply_invalid_follow_up'); end if;
    next_follow_up:=(p_payload->>'nextFollowUpAt')::timestamptz;
    if next_follow_up>now()+interval '1 month'
      then return jsonb_build_object('ok',false,'code','manual_reply_invalid_follow_up'); end if;
  end if;
  site := ctx->'site';
  v_customer_id := (ctx->>'customerId')::uuid;
  v_site_id := (ctx->>'customerSiteId')::uuid;
  received := (ctx->>'receivedAt')::timestamptz;
  if next_follow_up<received then return jsonb_build_object('ok',false,'code','manual_reply_invalid_follow_up'); end if;
  if jsonb_typeof(terms) is distinct from 'object' or terms='{}'::jsonb or jsonb_typeof(evidence) is distinct from 'object'
    or jsonb_typeof(p_payload->'extracted') is distinct from 'object'
    then return jsonb_build_object('ok',false,'code','manual_reply_invalid_terms'); end if;
  -- A strong thread identifies a candidate request; explicit body/AI hints
  -- must still agree with its locked customer, site and canonical meter.
  for hint_key,expected_value in select * from (values
    ('company_id',p_company_id::text),('customer_id',v_customer_id::text),('customer_site_id',v_site_id::text),('site_id',v_site_id::text),
    ('request_id',p_request_id::text),('customer_number',ctx#>>'{customer,customer_number}')) hints(k,v) loop
    hint_value:=nullif(btrim(p_payload#>>array['extracted',hint_key]),'');
    if hint_value is not null and (jsonb_typeof(p_payload#>array['extracted',hint_key]) is distinct from 'string'
      or lower(hint_value) is distinct from lower(expected_value))
      then return jsonb_build_object('ok',false,'code','manual_reply_identity_hint_conflict'); end if;
  end loop;
  foreach hint_key in array array['personal_number','org_number','customer_identity_number'] loop
    if p_payload#>array['extracted',hint_key] is not null and p_payload#>array['extracted',hint_key]<>'null'::jsonb then
      if jsonb_typeof(p_payload#>array['extracted',hint_key]) is distinct from 'string'
        then return jsonb_build_object('ok',false,'code','manual_reply_customer_identity_conflict'); end if;
      hint_value:=regexp_replace(p_payload#>>array['extracted',hint_key],'[^0-9]','','g');
      expected_value:=regexp_replace(ctx#>>array['customer',hint_key],'[^0-9]','','g');
      if (hint_key='personal_number' and (length(hint_value) not in (10,12)
        or not coalesce(hint_value=expected_value or (length(hint_value)=10 and length(expected_value)=12 and hint_value=right(expected_value,10)),false)))
        or (hint_key='org_number' and (length(hint_value)<>10 or hint_value is distinct from expected_value))
        or (hint_key='customer_identity_number' and (length(hint_value) not in (10,12) or not coalesce(
          hint_value=regexp_replace(ctx#>>'{customer,personal_number}','[^0-9]','','g')
          or (length(hint_value)=10 and length(regexp_replace(ctx#>>'{customer,personal_number}','[^0-9]','','g'))=12
            and hint_value=right(regexp_replace(ctx#>>'{customer,personal_number}','[^0-9]','','g'),10))
          or (length(hint_value)=10 and hint_value=regexp_replace(ctx#>>'{customer,org_number}','[^0-9]','','g')),false)))
        then return jsonb_build_object('ok',false,'code','manual_reply_customer_identity_conflict'); end if;
    end if;
  end loop;
  hint_value:=nullif(btrim(p_payload#>>'{extracted,facility_id}'),'');
  if hint_value is not null and (jsonb_typeof(p_payload#>'{extracted,facility_id}') is distinct from 'string'
    or hint_value !~ '^[0-9]{18}$' or hint_value is distinct from nullif(btrim(site->>'facility_id'),''))
    then return jsonb_build_object('ok',false,'code','manual_reply_facility_hint_conflict'); end if;
  foreach hint_key in array array['metering_point_id','metering_point_record_id'] loop
    hint_value:=nullif(btrim(p_payload#>>array['extracted',hint_key]),'');
    if hint_value is not null then
      if jsonb_typeof(p_payload#>array['extracted',hint_key]) is distinct from 'string'
        or (hint_key='metering_point_id' and hint_value !~ '^[0-9]{18}$')
        then return jsonb_build_object('ok',false,'code','manual_reply_meter_hint_conflict'); end if;
      perform 1 from public.metering_points mp where mp.company_id=p_company_id and mp.customer_id=v_customer_id and mp.site_id=v_site_id
        and (mp.customer_site_id is null or mp.customer_site_id=v_site_id)
        and (case when hint_key='metering_point_record_id' then mp.id::text=hint_value else hint_value in (mp.metering_point_id,mp.meter_point_id,mp.ediel_reference) end) for share;
      if not found then return jsonb_build_object('ok',false,'code','manual_reply_meter_hint_conflict'); end if;
    end if;
  end loop;
  hint_value:=ctx#>>'{inbound,metering_point_id}';
  if hint_value is not null then
    perform 1 from public.metering_points mp where mp.id::text=hint_value and mp.company_id=p_company_id and mp.customer_id=v_customer_id
      and mp.site_id=v_site_id and (mp.customer_site_id is null or mp.customer_site_id=v_site_id) for share;
    if not found then return jsonb_build_object('ok',false,'code','manual_reply_meter_ownership_conflict'); end if;
  end if;
  -- Earlier facts may be accumulated only from the previous atomic source
  -- application. Editable site metadata is a projection and is never authority.
  if ctx#>'{request,parsed_payload,applied}'='true'::jsonb then
    select pi.extracted_payload#>'{manual_automation,application}' into previous
      from public.manual_inbound_messages pi
      where pi.id::text=ctx#>>'{request,parsed_payload,inbound_id}'
        and pi.company_id=p_company_id and pi.customer_id=v_customer_id and pi.customer_site_id=v_site_id and pi.request_id=p_request_id
        and pi.resolution_status='matched' and pi.processing_state='applied'
        and pi.extracted_payload->'sender_credible'='true'::jsonb and pi.extracted_payload#>>'{sender_verification,status}'='verified'
        and pi.extracted_payload->'manual_reply_structure_requires_review' is distinct from 'true'::jsonb
        and pi.extracted_payload->'mime_requires_review' is distinct from 'true'::jsonb
        and coalesce(pi.extracted_payload->'customer_identity_review_reasons','[]'::jsonb)='[]'::jsonb
        and pi.extracted_payload#>>'{manual_automation,sourceHash}'=ctx#>>'{request,parsed_payload,sourceHash}'
        and pi.extracted_payload#>'{manual_automation,application}'=ctx#>'{request,parsed_payload}'
        and ctx#>>'{request,parsed_payload,customerInfoRequestId}'=ctx#>>'{request,metadata,customer_info_request_id}'
        and ctx#>>'{request,parsed_payload,supplierId}'=ctx#>>'{request,metadata,supplier_id}'
        and ctx#>>'{request,parsed_payload,supplierActorId}'=ctx#>>'{request,metadata,supplier_actor_id}'
        and ctx#>>'{request,parsed_payload,powerOfAttorneyId}'=ctx#>>'{request,poa_id}'
        and ctx#>>'{request,parsed_payload,authorizationDocumentId}'=ctx#>>'{request,metadata,authorization_document_id}';
    if not found then return jsonb_build_object('ok',false,'code','manual_reply_previous_source_unverified'); end if;
    if (previous->>'receivedAt')::timestamptz>received then return jsonb_build_object('ok',false,'code','manual_reply_stale_source'); end if;
    if exists(select 1 from jsonb_each(coalesce(previous->'terms','{}'::jsonb)) old where old.key<>'effectiveStartDate' and terms ? old.key and terms->old.key is distinct from old.value)
      then return jsonb_build_object('ok',false,'code','manual_reply_existing_fact_conflict'); end if;
    terms:=coalesce(previous->'terms','{}'::jsonb)||terms;
    evidence:=coalesce(previous->'evidence','{}'::jsonb)||evidence;
    field_sources:=coalesce(previous->'fieldSources','{}'::jsonb);
  end if;
  for k in select key from jsonb_object_keys(current_terms) key where key<>'effectiveStartDate' loop
    field_sources:=field_sources||jsonb_build_object(k,jsonb_build_object('inboundId',p_inbound_id,'sourceHash',p_payload->>'sourceHash','receivedAt',received,'evidence',p_payload#>>array['evidence',k]));
  end loop;
  for k,value in select key,terms->>key from jsonb_object_keys(terms) key loop
    if k not in ('contractEndDate','earliestStartDate','cancellationDeadline','noticePeriod','bindingPeriod','terminationFee','contractStatus','cancellationRegistered','effectiveStartDate')
      or jsonb_typeof(terms->k) is distinct from 'string' or value='' or length(value)>200
      or (k<>'effectiveStartDate' and (jsonb_typeof(evidence->k) is distinct from 'string' or length(evidence->>k)<1 or length(evidence->>k)>12000))
      then return jsonb_build_object('ok',false,'code','manual_reply_invalid_terms'); end if;
    if k in ('contractEndDate','earliestStartDate','cancellationDeadline','effectiveStartDate') then
      if value !~ '^\d{4}-\d{2}-\d{2}$' or value::date<'1900-01-01'::date
        or value::date > make_date(extract(year from received at time zone 'Europe/Stockholm')::int+10,12,31)
        then return jsonb_build_object('ok',false,'code','manual_reply_invalid_date'); end if;
    elsif k in ('noticePeriod','bindingPeriod') and value !~ '^\d{1,3} (dag|dagar|månad|månader)$' then
      return jsonb_build_object('ok',false,'code','manual_reply_invalid_duration');
    elsif k='terminationFee' then
      if lower(value) in ('ingen','ingen brytavgift') then fee:=0;
      elsif value ~* '^\d+(?:[,.]\d{1,2})?\s*(kr|sek)$' then fee:=replace(regexp_replace(value,'\s*(kr|sek)$','','i'),',','.')::numeric;
      else return jsonb_build_object('ok',false,'code','manual_reply_invalid_fee'); end if;
    elsif k='contractStatus' and lower(value) !~ '^(tills ?vidare|aktivt?|löpande|tidsbundet?|uppsagt?|avslutat?|rörligt|fastpris)$' then
      return jsonb_build_object('ok',false,'code','manual_reply_invalid_contract_status');
    elsif k='cancellationRegistered' and lower(value) !~ '^(ja|nej|registrerad|bekräftad|mottagen|ej registrerad|inte registrerad)$' then
      return jsonb_build_object('ok',false,'code','manual_reply_invalid_cancellation_status');
    end if;
  end loop;
  contract_end := (terms->>'contractEndDate')::date;
  earliest := (terms->>'earliestStartDate')::date;
  deadline := (terms->>'cancellationDeadline')::date;
  effective := (terms->>'effectiveStartDate')::date;
  if (earliest is not null and contract_end is not null and earliest<=contract_end)
    or (deadline is not null and contract_end is not null and deadline>contract_end)
    or (deadline<(received at time zone 'Europe/Stockholm')::date and lower(coalesce(terms->>'cancellationRegistered','')) not in ('ja','registrerad','bekräftad','mottagen'))
    or (current_terms ? 'effectiveStartDate' and (((current_terms->>'effectiveStartDate')::date<(current_terms->>'earliestStartDate')::date) or ((current_terms->>'effectiveStartDate')::date<=(current_terms->>'contractEndDate')::date)))
    or (effective is not null and earliest is null and contract_end is null)
    then return jsonb_build_object('ok',false,'code','manual_reply_contradictory_terms'); end if;
  effective := greatest(effective,(previous#>>'{terms,effectiveStartDate}')::date,earliest,contract_end+1);
  if effective is not null then terms:=terms||jsonb_build_object('effectiveStartDate',effective); end if;
  -- Established facts without a verified automatic predecessor are manual facts.
  -- They must never be silently replaced by a conflicting inbound claim.
  if (contract_end is not null and site->>'current_supplier_contract_end_date' is not null and (site->>'current_supplier_contract_end_date')::date<>contract_end)
    or (terms ? 'noticePeriod' and site->>'current_supplier_notice_period' is not null and site->>'current_supplier_notice_period'<>terms->>'noticePeriod')
    or (terms ? 'contractStatus' and site->>'current_supplier_contract_status' is not null and site->>'current_supplier_contract_status'<>terms->>'contractStatus')
    or (fee is not null and site->>'current_supplier_termination_fee' is not null and (site->>'current_supplier_termination_fee')::numeric<>fee)
    then return jsonb_build_object('ok',false,'code','manual_reply_existing_fact_conflict'); end if;
  -- Native original binding locks the switch row before sealing its date.
  -- Serialize existing normal switches before examining any outbound reference;
  -- a concurrent binder must either finish first or observe the raised date.
  perform ss.id from public.supplier_switch_requests ss
    where ss.company_id=p_company_id and ss.customer_id=v_customer_id and coalesce(ss.customer_site_id,ss.site_id)=v_site_id
      and ss.request_type='switch' and (ss.site_id is null or ss.site_id=v_site_id) and (ss.customer_site_id is null or ss.customer_site_id=v_site_id)
    order by ss.id for update;
  if effective is not null and exists(select 1 from public.supplier_switch_requests ss
    where ss.company_id=p_company_id and ss.customer_id=v_customer_id and coalesce(ss.customer_site_id,ss.site_id)=v_site_id
      and ss.outbound_z03_message_id is not null)
    then return jsonb_build_object('ok',false,'code','manual_reply_outbound_original_bound'); end if;
  complete := earliest is not null and coalesce(fee=0,false);
  response_status := case when fee>0 then 'termination_fee' when complete then 'free_to_switch' else 'waiting_response' end;
  snapshot:=jsonb_build_object('version',1,'inboundId',p_inbound_id,'sourceHash',p_payload->>'sourceHash','receivedAt',received,'companyId',p_company_id,'customerId',v_customer_id,'siteId',v_site_id,'requestId',p_request_id,'customerInfoRequestId',ctx#>'{request,metadata,customer_info_request_id}','supplierId',ctx#>'{request,metadata,supplier_id}','supplierActorId',ctx#>'{request,metadata,supplier_actor_id}','supplierContactId',ctx#>'{request,metadata,supplier_contact_id}','powerOfAttorneyId',ctx#>'{request,poa_id}','authorizationDocumentId',ctx#>'{request,metadata,authorization_document_id}','terms',terms,'evidence',evidence,'fieldSources',field_sources,'extracted',p_payload->'extracted');
  missing_fields:='[]'::jsonb;
  if earliest is null then missing_fields:=missing_fields||jsonb_build_array('earliest_supplier_start_date'); end if;
  if fee is null then missing_fields:=missing_fields||jsonb_build_array('termination_fee'); end if;
  result_payload:=snapshot||jsonb_build_object('applied',true,'inbound_id',p_inbound_id,'complete',complete,'responseStatus',response_status,'missingFields',missing_fields);
  update public.customer_sites set
    current_supplier_contract_end_date=coalesce(contract_end,current_supplier_contract_end_date),
    current_supplier_contract_status=coalesce(terms->>'contractStatus',current_supplier_contract_status),
    current_supplier_notice_period=coalesce(terms->>'noticePeriod',current_supplier_notice_period),
    current_supplier_termination_fee=coalesce(fee,current_supplier_termination_fee),
    current_supplier_response_status=response_status,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('manual_supplier_terms',snapshot),updated_at=now()
    where company_id=p_company_id and customer_id=v_customer_id and id=v_site_id;
  update public.grid_owner_information_requests set status=case when complete then 'completed' else 'manual_response_received' end,
    completed_at=case when complete then now() else null end,next_follow_up_at=case when complete then null else next_follow_up end,received_at=received,
    parsed_payload=result_payload,received_payload=coalesce(received_payload,'{}'::jsonb)||jsonb_build_object('manual_supplier_terms',snapshot),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('manual_supplier_terms',snapshot),
    last_error_code=null,last_error_message=null,updated_at=now()
    where company_id=p_company_id and id=p_request_id;
  update public.customer_info_requests set status=case when complete then 'ready_for_switch' else 'partially_received' end,
    verified_payload=coalesce(verified_payload,'{}'::jsonb)||jsonb_build_object('manual_supplier_terms',snapshot),
    received_at=received,updated_at=now(),
    blocker_code=case when complete then null else 'supplier_terms_incomplete' end,
    blocker_reason=case when complete then null else 'Leverantörssvaret innehåller verifierade deluppgifter. Ett komplett besked om start och avgifter inväntas.' end,
    blocker_details=case when complete then '{}'::jsonb else jsonb_build_object('manual_supplier_request_id',p_request_id,'inbound_id',p_inbound_id) end,
    next_required_action=case when complete then 'Utvärdera leverantörsbyte genom ordinarie readiness.' else 'Invänta kompletterande avtalsuppgifter.' end
    where company_id=p_company_id and customer_id=v_customer_id and site_id=v_site_id
      and id::text=ctx#>>'{request,metadata,customer_info_request_id}';
  insert into public.customer_operation_events(company_id,customer_id,customer_site_id,event_code,title,message,status,severity,action_required,source,payload,idempotency_key)
    values(p_company_id,v_customer_id,v_site_id,'manual_supplier_terms_applied','Leverantörssvar registrerat','Verifierade avtalsuppgifter har kopplats till rätt kund och anläggning.',case when complete then 'completed' else 'response_received' end,'info',false,'manual_inbound_ingestion',snapshot,'manual-supplier-terms:'||p_inbound_id::text)
    on conflict(company_id,idempotency_key) where idempotency_key is not null do nothing;
  update public.manual_inbound_messages set processing_state='applied',
    extracted_payload=jsonb_set(extracted_payload,'{manual_automation}',coalesce(extracted_payload->'manual_automation','{}'::jsonb)||jsonb_build_object('application',result_payload))
    where id=p_inbound_id and company_id=p_company_id and request_id=p_request_id;
  if effective is not null then
    update public.supplier_switch_requests ss set requested_start_date=greatest(ss.requested_start_date,effective),
      metadata=coalesce(ss.metadata,'{}'::jsonb)||jsonb_build_object('manual_supplier_terms',snapshot),updated_at=now()
      where ss.company_id=p_company_id and ss.customer_id=v_customer_id and coalesce(ss.customer_site_id,ss.site_id)=v_site_id
        and ss.request_type='switch' and (ss.site_id is null or ss.site_id=v_site_id) and (ss.customer_site_id is null or ss.customer_site_id=v_site_id)
        and ss.status in ('draft','pending','ready','ready_to_send','waiting','waiting_for_start','scheduled')
        and ss.submitted_at is null and ss.completed_at is null and ss.paused_at is null
        and ss.outbound_z03_message_id is null and ss.lifecycle_blocked=false;
  end if;
  -- Defense in depth against a binding introduced by a statement trigger or
  -- another application hook after the first check. Raising rolls back every
  -- site/request/source/event write in this command, including hook effects.
  if effective is not null and exists(select 1 from public.supplier_switch_requests ss
    where ss.company_id=p_company_id and ss.customer_id=v_customer_id and coalesce(ss.customer_site_id,ss.site_id)=v_site_id
      and ss.outbound_z03_message_id is not null)
    then raise exception 'manual_reply_outbound_original_bound' using errcode='40001'; end if;
  return jsonb_build_object('ok',true,'applied',true,'alreadyApplied',false,'complete',complete,'effectiveStartDate',effective,'customerId',v_customer_id,'customerSiteId',v_site_id);
exception when others then
  -- PL/pgSQL exception block rolls back every write in this command.
  return jsonb_build_object('ok',false,'applied',false,'code','manual_reply_transaction_failed');
end $$;
revoke all on function public.gridex_apply_manual_commercial_reply_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_apply_manual_commercial_reply_v1(uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.gridex_apply_manual_facility_reply_v1(
  p_company_id uuid,p_request_id uuid,p_inbound_id uuid,p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  ctx jsonb; result jsonb; snapshot jsonb;
  facts jsonb:=coalesce(p_payload->'facts','{}'::jsonb);
  k text; value text; annual_kwh numeric; supplier_name text; supplier_id uuid;
  supplier_matches int; supplier_current_name text;
  applied_facts jsonb:='{}'::jsonb;
  fact_snapshot jsonb;
  hint_key text; hint_value text; expected_value text;
begin
  ctx:=public.gridex_manual_reply_context_v1(p_company_id,p_request_id,p_inbound_id,p_payload->>'sourceHash','facility');
  if ctx->'ok' is distinct from 'true'::jsonb then return ctx; end if;
  if ctx->'alreadyApplied'='true'::jsonb then return coalesce(ctx->'result','{}'::jsonb)||jsonb_build_object('ok',true,'applied',true,'alreadyApplied',true); end if;
  foreach hint_key in array array['personal_number','org_number','customer_identity_number'] loop
    if p_payload#>array['extracted',hint_key] is not null and p_payload#>array['extracted',hint_key]<>'null'::jsonb then
      if jsonb_typeof(p_payload#>array['extracted',hint_key]) is distinct from 'string'
        then return jsonb_build_object('ok',false,'code','manual_reply_customer_identity_conflict'); end if;
      hint_value:=regexp_replace(p_payload#>>array['extracted',hint_key],'[^0-9]','','g');
      expected_value:=regexp_replace(ctx#>>array['customer',hint_key],'[^0-9]','','g');
      if (hint_key='personal_number' and (length(hint_value) not in (10,12)
        or not coalesce(hint_value=expected_value or (length(hint_value)=10 and length(expected_value)=12 and hint_value=right(expected_value,10)),false)))
        or (hint_key='org_number' and (length(hint_value)<>10 or hint_value is distinct from expected_value))
        or (hint_key='customer_identity_number' and (length(hint_value) not in (10,12) or not coalesce(
          hint_value=regexp_replace(ctx#>>'{customer,personal_number}','[^0-9]','','g')
          or (length(hint_value)=10 and length(regexp_replace(ctx#>>'{customer,personal_number}','[^0-9]','','g'))=12
            and hint_value=right(regexp_replace(ctx#>>'{customer,personal_number}','[^0-9]','','g'),10))
          or (length(hint_value)=10 and hint_value=regexp_replace(ctx#>>'{customer,org_number}','[^0-9]','','g')),false)))
        then return jsonb_build_object('ok',false,'code','manual_reply_customer_identity_conflict'); end if;
    end if;
  end loop;
  if coalesce(p_payload->>'facility_id',p_payload->>'metering_point_id','') !~ '^\d{18}$'
    or (p_payload->>'facility_id' is not null and p_payload->>'facility_id' !~ '^\d{18}$')
    or (p_payload->>'metering_point_id' is not null and p_payload->>'metering_point_id' !~ '^\d{18}$')
    or coalesce(p_payload->>'grid_area_code','') !~ '^[A-Z0-9]{3}$'
    or (p_payload->>'price_area_code' is not null and p_payload->>'price_area_code' not in ('SE1','SE2','SE3','SE4'))
    then return jsonb_build_object('ok',false,'code','manual_reply_invalid_facility'); end if;
  if jsonb_typeof(facts) is distinct from 'object' then return jsonb_build_object('ok',false,'code','manual_reply_invalid_facility_facts'); end if;
  for k,value in select key,facts->>key from jsonb_object_keys(facts) key loop
    if k not in ('annualConsumptionKwh','currentSupplierName','meteringMethod','reportingFrequency','readingFrequency')
      then return jsonb_build_object('ok',false,'code','manual_reply_invalid_facility_facts'); end if;
    if k='annualConsumptionKwh' then
      if jsonb_typeof(facts->k) is distinct from 'number' or value::numeric<0 or value::numeric>1000000000
        then return jsonb_build_object('ok',false,'code','manual_reply_invalid_annual_consumption'); end if;
      annual_kwh:=value::numeric;
      if ctx#>>'{site,annual_consumption_kwh}' is not null and (ctx#>>'{site,annual_consumption_kwh}')::numeric<>annual_kwh
        then return jsonb_build_object('ok',false,'code','manual_reply_annual_consumption_conflict'); end if;
    elsif jsonb_typeof(facts->k) is distinct from 'string' or length(trim(value))=0 or length(value)>200 then
      return jsonb_build_object('ok',false,'code','manual_reply_invalid_facility_facts');
    elsif k='readingFrequency' and value not in ('hourly','daily','monthly','manual') then
      return jsonb_build_object('ok',false,'code','manual_reply_invalid_reading_frequency');
    end if;
  end loop;
  supplier_name:=nullif(trim(facts->>'currentSupplierName'),'');
  if supplier_name is not null then
    supplier_current_name:=ctx#>>'{site,current_supplier_name}';
    if ctx#>>'{site,current_supplier_id}' is not null then
      select es.name into supplier_current_name from public.electricity_suppliers es
        where es.id::text=ctx#>>'{site,current_supplier_id}' and (es.company_id is null or es.company_id=p_company_id);
    end if;
    if supplier_current_name is not null and lower(trim(supplier_current_name))<>lower(supplier_name)
      then return jsonb_build_object('ok',false,'code','manual_reply_current_supplier_conflict'); end if;
    select count(*),min(es.id::text)::uuid into supplier_matches,supplier_id
      from public.electricity_suppliers es
      join public.platform_market_actors actor on actor.id=es.platform_market_actor_id and actor.status='active' and actor.match_status='verified'
      where (es.company_id is null or es.company_id=p_company_id) and es.is_active=true and lower(trim(es.name))=lower(supplier_name)
        and exists(select 1 from public.platform_actor_roles ar where ar.actor_id=actor.id and ar.is_active=true and ar.actor_role in ('electricity_supplier','supplier'));
    if supplier_matches<>1 then supplier_id:=null; end if;
    if supplier_id is not null and ctx#>>'{site,current_supplier_id}' is not null and ctx#>>'{site,current_supplier_id}'<>supplier_id::text
      then return jsonb_build_object('ok',false,'code','manual_reply_current_supplier_conflict'); end if;
  end if;
  result:=public.gridex_complete_facility_response(
    p_company_id=>p_company_id,p_request_id=>p_request_id,p_source=>'manual_email',
    p_facility_id=>p_payload->>'facility_id',p_metering_point_external_id=>p_payload->>'metering_point_id',
    p_grid_area_code=>p_payload->>'grid_area_code',p_price_area_code=>p_payload->>'price_area_code',
    p_source_party_grid_owner_id=>(ctx#>>'{request,grid_owner_id}')::uuid,
    p_raw_payload=>coalesce(p_payload->'raw_payload','{}'::jsonb),p_note=>'Verified manual inbound reply');
  if result->'ok' is distinct from 'true'::jsonb then return result; end if;
  fact_snapshot:=jsonb_build_object('version',1,'inboundId',p_inbound_id,'sourceHash',p_payload->>'sourceHash','receivedAt',ctx->'receivedAt','companyId',p_company_id,'customerId',ctx->'customerId','siteId',ctx->'customerSiteId','requestId',p_request_id,'facts',facts,'extracted',coalesce(p_payload->'extracted','{}'::jsonb));
  if facts<>'{}'::jsonb then
    update public.customer_sites set annual_consumption_kwh=coalesce(annual_kwh,annual_consumption_kwh),
      current_supplier_name=coalesce(supplier_name,current_supplier_name),
      current_supplier_id=coalesce(supplier_id,current_supplier_id),
      current_supplier_unknown=case when supplier_id is not null then false else current_supplier_unknown end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('manual_facility_facts',fact_snapshot),updated_at=now()
      where company_id=p_company_id and id::text=ctx->>'customerSiteId' and customer_id::text=ctx->>'customerId';
    if annual_kwh is not null then applied_facts:=applied_facts||jsonb_build_object('annualConsumptionKwh',annual_kwh); end if;
    if supplier_name is not null then applied_facts:=applied_facts||jsonb_build_object('currentSupplierName',supplier_name,'currentSupplierResolved',supplier_id is not null); end if;
    if result->>'meteringPointRecordId' is not null then
      update public.metering_points set reading_frequency=coalesce(facts->>'readingFrequency',reading_frequency),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('manual_facility_facts',fact_snapshot),updated_at=now()
        where id::text=result->>'meteringPointRecordId' and company_id=p_company_id and customer_id::text=ctx->>'customerId'
          and site_id::text=ctx->>'customerSiteId' and (customer_site_id is null or customer_site_id::text=ctx->>'customerSiteId');
      if found and facts ? 'readingFrequency' then applied_facts:=applied_facts||jsonb_build_object('readingFrequency',facts->'readingFrequency'); end if;
    end if;
  end if;
  result:=result||jsonb_build_object('appliedFacts',applied_facts);
  snapshot:=jsonb_build_object('version',1,'inboundId',p_inbound_id,'sourceHash',p_payload->>'sourceHash','receivedAt',ctx->'receivedAt','companyId',p_company_id,'customerId',ctx->'customerId','siteId',ctx->'customerSiteId','requestId',p_request_id,'applied',true,'inbound_id',p_inbound_id,'result',result);
  update public.grid_owner_information_requests set parsed_payload=snapshot,next_follow_up_at=null where company_id=p_company_id and id=p_request_id;
  update public.manual_inbound_messages set processing_state='applied',extracted_payload=jsonb_set(extracted_payload,'{manual_automation}',coalesce(extracted_payload->'manual_automation','{}'::jsonb)||jsonb_build_object('application',snapshot)) where id=p_inbound_id and company_id=p_company_id and request_id=p_request_id;
  return result||jsonb_build_object('applied',true,'alreadyApplied',false);
exception when others then
  return jsonb_build_object('ok',false,'applied',false,'code','manual_reply_transaction_failed');
end $$;
revoke all on function public.gridex_apply_manual_facility_reply_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_apply_manual_facility_reply_v1(uuid,uuid,uuid,jsonb) to service_role;

-- Read only from the three atomically linked records. A tenant-editable site
-- metadata field alone can never provide a supplier start-date proof.
create or replace function public.gridex_manual_supplier_start_floor_v1(
  p_company_id uuid,p_customer_id uuid,p_site_id uuid
) returns date language plpgsql stable security invoker set search_path = public as $$
declare floor_date date;
begin
  select max((r.parsed_payload#>>'{terms,effectiveStartDate}')::date) into floor_date
    from public.customer_sites s
    join public.grid_owner_information_requests r on r.company_id=s.company_id and r.customer_id=s.customer_id and r.customer_site_id=s.id
    join public.manual_inbound_messages i on i.id::text=r.parsed_payload->>'inbound_id'
      and i.company_id=r.company_id and i.customer_id=r.customer_id and i.customer_site_id=r.customer_site_id and i.request_id=r.id
    where s.company_id=p_company_id and s.customer_id=p_customer_id and s.id=p_site_id
      and s.is_active=true and s.protected_identity=false
      and s.current_supplier_id::text=r.metadata->>'supplier_id'
      and r.request_type='current_supplier_contract_information_request'
      and r.parsed_payload->>'customerInfoRequestId'=r.metadata->>'customer_info_request_id'
      and r.parsed_payload->>'supplierId'=r.metadata->>'supplier_id'
      and r.parsed_payload->>'supplierActorId'=r.metadata->>'supplier_actor_id'
      and r.parsed_payload->>'powerOfAttorneyId'=r.poa_id::text
      and r.parsed_payload->>'authorizationDocumentId'=r.metadata->>'authorization_document_id'
      and r.parsed_payload->'applied'='true'::jsonb and r.parsed_payload->'version'='1'::jsonb
      and r.parsed_payload->>'companyId'=p_company_id::text and r.parsed_payload->>'customerId'=p_customer_id::text
      and r.parsed_payload->>'siteId'=p_site_id::text and r.parsed_payload->>'requestId'=r.id::text
      and r.parsed_payload->>'inboundId'=i.id::text
      and r.parsed_payload#>>'{terms,effectiveStartDate}' ~ '^\d{4}-\d{2}-\d{2}$'
      and i.resolution_status='matched' and i.processing_state='applied'
      and i.extracted_payload->'sender_credible'='true'::jsonb
      and i.extracted_payload#>>'{sender_verification,status}'='verified'
      and i.extracted_payload->'manual_reply_structure_requires_review' is distinct from 'true'::jsonb
      and i.extracted_payload->'mime_requires_review' is distinct from 'true'::jsonb
      and coalesce(i.extracted_payload->'customer_identity_review_reasons','[]'::jsonb)='[]'::jsonb
      and i.extracted_payload#>>'{manual_automation,sourceHash}'=r.parsed_payload->>'sourceHash'
      and i.extracted_payload#>'{manual_automation,application}'=r.parsed_payload;
  return floor_date;
exception when others then return null;
end $$;
revoke all on function public.gridex_manual_supplier_start_floor_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gridex_manual_supplier_start_floor_v1(uuid,uuid,uuid) to service_role;

create or replace function public.gridex_guard_manual_supplier_start_floor_v1()
returns trigger language plpgsql security invoker set search_path = public as $$
declare floor_date date; resolved_site uuid; resolved_supplier uuid;
begin
  if new.request_type is distinct from 'switch' or new.status not in ('draft','pending','ready','ready_to_send','waiting','waiting_for_start','scheduled')
    or new.submitted_at is not null or new.completed_at is not null or new.paused_at is not null
    or new.outbound_z03_message_id is not null or new.lifecycle_blocked is distinct from false
    then return new; end if;
  resolved_site:=coalesce(new.customer_site_id,new.site_id);
  if (new.customer_site_id is not null and new.customer_site_id<>resolved_site)
    or (new.site_id is not null and new.site_id<>resolved_site) then return new; end if;
  -- Serializes a newly created switch with an incoming source application.
  select s.current_supplier_id into resolved_supplier from public.customer_sites s where s.company_id=new.company_id and s.customer_id=new.customer_id and s.id=resolved_site for update;
  if not found then return new; end if;
  -- Inline evidence join keeps an authenticated caller subject to its own RLS
  -- without granting execution of the internal floor helper.
  select max((r.parsed_payload#>>'{terms,effectiveStartDate}')::date) into floor_date
    from public.grid_owner_information_requests r
    join public.manual_inbound_messages i on i.id::text=r.parsed_payload->>'inbound_id'
      and i.company_id=r.company_id and i.customer_id=r.customer_id and i.customer_site_id=r.customer_site_id and i.request_id=r.id
    where r.company_id=new.company_id and r.customer_id=new.customer_id and r.customer_site_id=resolved_site
      and r.metadata->>'supplier_id'=resolved_supplier::text
      and r.request_type='current_supplier_contract_information_request'
      and r.parsed_payload->>'customerInfoRequestId'=r.metadata->>'customer_info_request_id'
      and r.parsed_payload->>'supplierId'=r.metadata->>'supplier_id'
      and r.parsed_payload->>'supplierActorId'=r.metadata->>'supplier_actor_id'
      and r.parsed_payload->>'powerOfAttorneyId'=r.poa_id::text
      and r.parsed_payload->>'authorizationDocumentId'=r.metadata->>'authorization_document_id'
      and r.parsed_payload->'applied'='true'::jsonb and r.parsed_payload->'version'='1'::jsonb
      and r.parsed_payload->>'companyId'=new.company_id::text and r.parsed_payload->>'customerId'=new.customer_id::text
      and r.parsed_payload->>'siteId'=resolved_site::text and r.parsed_payload->>'requestId'=r.id::text and r.parsed_payload->>'inboundId'=i.id::text
      and r.parsed_payload#>>'{terms,effectiveStartDate}' ~ '^\d{4}-\d{2}-\d{2}$'
      and i.resolution_status='matched' and i.processing_state='applied'
      and i.extracted_payload->'sender_credible'='true'::jsonb and i.extracted_payload#>>'{sender_verification,status}'='verified'
      and i.extracted_payload->'manual_reply_structure_requires_review' is distinct from 'true'::jsonb
      and i.extracted_payload->'mime_requires_review' is distinct from 'true'::jsonb
      and coalesce(i.extracted_payload->'customer_identity_review_reasons','[]'::jsonb)='[]'::jsonb
      and i.extracted_payload#>>'{manual_automation,sourceHash}'=r.parsed_payload->>'sourceHash'
      and i.extracted_payload#>'{manual_automation,application}'=r.parsed_payload;
  if floor_date is not null then new.requested_start_date:=greatest(new.requested_start_date,floor_date); end if;
  return new;
end $$;
revoke all on function public.gridex_guard_manual_supplier_start_floor_v1() from public,anon,authenticated;
grant execute on function public.gridex_guard_manual_supplier_start_floor_v1() to service_role;
create or replace trigger gridex_manual_supplier_start_floor_v1
  before insert or update of requested_start_date,company_id,customer_id,site_id,customer_site_id on public.supplier_switch_requests
  for each row execute function public.gridex_guard_manual_supplier_start_floor_v1();

-- Preserve every historical request type accepted by an installed CHECK while
-- admitting the separate current-supplier purpose. No network purpose is remapped.
do $$
declare prior_expression text;
begin
  select pg_get_expr(conbin,conrelid) into prior_expression from pg_constraint
    where conrelid='public.grid_owner_information_requests'::regclass and conname='grid_owner_information_requests_request_type_check' and contype='c';
  if prior_expression is not null and position('current_supplier_contract_information_request' in prior_expression)=0 then
    alter table public.grid_owner_information_requests drop constraint grid_owner_information_requests_request_type_check;
    execute 'alter table public.grid_owner_information_requests add constraint grid_owner_information_requests_request_type_check check (request_type = ''current_supplier_contract_information_request'' or ('||prior_expression||'))';
  end if;
end $$;
create unique index if not exists gridex_manual_supplier_open_cir_v1
  on public.grid_owner_information_requests(company_id,(metadata->>'customer_info_request_id'))
  where request_type='current_supplier_contract_information_request'
    and metadata->>'customer_info_request_id' is not null and status not in ('completed','cancelled','failed');

-- Existing network guard body below is retained; the commercial branch has its
-- own exact current-supplier identity and verified commercial-contact proof.
create or replace function public.gridex_assert_verified_site_owner_for_manual_outbox()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_request public.grid_owner_information_requests%rowtype;
  v_request_type text;
  v_request_grid_owner_id uuid;
  v_site_grid_owner_id uuid;
  v_site_grid_area_code text;
  v_site_resolution_status text;
  v_owner_verified boolean;
  v_owner_technical_only boolean;
  v_owner_verification_status text;
  v_site_specific_verified boolean;
begin
  if coalesce(new.external_delivery, false) is not true
     or new.status not in ('queued','sending')
     or new.request_id is null then
    return new;
  end if;

  select * into v_request from public.grid_owner_information_requests where id=new.request_id and company_id=new.company_id;
  if not found then raise exception using errcode='23514',message='manual_outbox_request_ownership'; end if;
  if v_request.request_type='current_supplier_contract_information_request' then
    if not exists(
      select 1 from public.customer_sites s
      join public.customer_info_requests cir on cir.id::text=v_request.metadata->>'customer_info_request_id'
        and cir.company_id=s.company_id and cir.customer_id=s.customer_id and cir.site_id=s.id and cir.target_party_type='current_supplier'
      join public.electricity_suppliers es on es.id=s.current_supplier_id
        and (es.company_id is null or es.company_id=s.company_id) and es.is_active=true
      join public.platform_market_actors actor on actor.id=es.platform_market_actor_id and actor.status='active' and actor.match_status='verified'
      join public.platform_actor_contacts pc on pc.actor_id=actor.id and pc.id::text=v_request.metadata->>'supplier_contact_id'
      where s.id=v_request.customer_site_id and s.company_id=new.company_id and s.customer_id=v_request.customer_id
        and s.is_active=true and s.archived_at is null and s.closed_at is null and s.protected_identity=false
        and v_request.grid_owner_id is null and v_request.metadata->>'target_party'='current_supplier'
        and v_request.metadata->>'supplier_id'=es.id::text and v_request.metadata->>'supplier_actor_id'=actor.id::text
        and cir.verified_payload->>'manual_supplier_request_id'=v_request.id::text
        and cir.verified_payload->>'supplier_id'=es.id::text and cir.verified_payload->>'supplier_actor_id'=actor.id::text
        and cir.verified_payload->>'supplier_contact_id'=pc.id::text
        and public.gridex_manual_reply_poa_current_v1(new.company_id,v_request.customer_id,v_request.customer_site_id,v_request.poa_id,cir.authorization_document_id,'commercial',cir.metering_point_id)=true
        and cir.authorization_document_id::text=v_request.metadata->>'authorization_document_id'
        and cir.status in ('ready_to_send','sent','waiting_response','received','partially_received','missing_binding_info','missing_termination_info')
        and v_request.metadata#>'{counterparty_reply,requires_review}' is distinct from 'true'::jsonb
        and lower(trim(pc.email))=lower(trim(new.to_email)) and lower(trim(pc.email))=lower(trim(v_request.recipient_email))
        and pc.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        and pc.channel='email' and pc.is_verified=true and pc.verified_at is not null
        and pc.contact_type in ('poa','customer_service','switching','general')
        and (pc.valid_from is null or pc.valid_from <= (now() at time zone 'Europe/Stockholm')::date)
        and (pc.valid_to is null or pc.valid_to >= (now() at time zone 'Europe/Stockholm')::date)
        and exists(select 1 from public.platform_actor_roles ar where ar.actor_id=actor.id and ar.is_active=true and ar.actor_role in ('electricity_supplier','supplier'))
        and not exists(select 1 from public.platform_actor_contacts other where other.actor_id=actor.id and other.id<>pc.id
          and other.channel='email' and other.is_verified=true and other.verified_at is not null
          and other.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          and (other.valid_from is null or other.valid_from <= (now() at time zone 'Europe/Stockholm')::date)
          and (other.valid_to is null or other.valid_to >= (now() at time zone 'Europe/Stockholm')::date)
          and case other.contact_type when 'poa' then 1 when 'customer_service' then 2 when 'switching' then 3 when 'general' then 4 else 100 end
            <= case pc.contact_type when 'poa' then 1 when 'customer_service' then 2 when 'switching' then 3 else 4 end)
    ) then raise exception using errcode='23514',message='manual_supplier_outbox_requires_verified_current_supplier'; end if;
    return new;
  end if;

  select r.request_type,
         r.grid_owner_id,
         s.grid_owner_id,
         s.grid_area_code,
         s.resolution_status,
         g.verified_for_customer_flow,
         g.technical_owner_only,
         g.verification_status,
         coalesce(
           csr.id is not null
           and csr.company_id = s.company_id
           and csr.customer_id = s.customer_id
           and csr.customer_site_id = s.id
           and csr.grid_owner_id = s.grid_owner_id
           and csr.resolution_status = 'grid_area_master_validated'
           and csr.automation_allowed is true
           and lower(coalesce(csr.source_claims->>'manual_grid_owner_confirmation','false')) in ('true','1','yes'),
           false
         )
    into v_request_type,
         v_request_grid_owner_id,
         v_site_grid_owner_id,
         v_site_grid_area_code,
         v_site_resolution_status,
         v_owner_verified,
         v_owner_technical_only,
         v_owner_verification_status,
         v_site_specific_verified
    from public.grid_owner_information_requests r
    join public.customer_sites s
      on s.id = r.customer_site_id
     and s.company_id = r.company_id
     and s.customer_id = r.customer_id
    left join public.grid_owners g on g.id = r.grid_owner_id
    left join public.customer_site_resolution csr on csr.id = s.resolution_id
   where r.id = new.request_id
     and r.company_id = new.company_id;

  if not found then
    return new;
  end if;

  if v_request_type in ('facility_lookup', 'facility_identifier_lookup') then
    if v_site_grid_owner_id is null
       or v_request_grid_owner_id is null
       or v_request_grid_owner_id is distinct from v_site_grid_owner_id
       or nullif(btrim(coalesce(v_site_grid_area_code, '')), '') is null
       or coalesce(v_site_resolution_status, '') not in (
         'grid_area_master_validated',
         'facility_data_requested',
         'facility_data_received',
         'facility_verified'
       ) then
      raise exception using
        errcode = '23514',
        message = 'manual_facility_outbox_requires_canonical_geographic_site_owner',
        detail = 'External facility-information mail requires customer_sites.grid_owner_id and grid_area_code from canonical site geography. selected_grid_owner_id and Ediel/PRODAT readiness are not geographical authority.';
    end if;
    return new;
  end if;

  if v_site_grid_owner_id is null
     or v_request_grid_owner_id is null
     or v_request_grid_owner_id is distinct from v_site_grid_owner_id
     or v_owner_verified is distinct from true
     or coalesce(v_owner_verification_status, '') <> 'verified'
     or (coalesce(v_owner_technical_only, false) is true and not coalesce(v_site_specific_verified, false)) then
    raise exception using
      errcode = '23514',
      message = 'manual_grid_owner_outbox_requires_verified_site_owner',
      detail = 'External non-facility grid-owner mail requires exact site ownership and customer-flow verified operational routing.';
  end if;

  return new;
end;
$$;

create or replace trigger manual_email_outbox_verified_site_owner_tg
  before insert or update of status,external_delivery,request_id,company_id,to_email on public.manual_email_outbox
  for each row execute function public.gridex_assert_verified_site_owner_for_manual_outbox();

-- A complete provider-confirmed earliest start may waive recalculating a notice
-- period only when the entire local snapshot has this exact retained source.
create or replace function public.gridex_manual_supplier_terms_verified_v1(
  p_company_id uuid,p_customer_id uuid,p_site_id uuid,p_snapshot jsonb
) returns boolean language sql stable security invoker set search_path = public as $$
  select exists(
    select 1 from public.customer_sites s
    join public.grid_owner_information_requests r on r.company_id=s.company_id and r.customer_id=s.customer_id and r.customer_site_id=s.id
    join public.manual_inbound_messages i on i.id::text=r.parsed_payload->>'inbound_id'
      and i.company_id=r.company_id and i.customer_id=r.customer_id and i.customer_site_id=r.customer_site_id and i.request_id=r.id
    where s.company_id=p_company_id and s.customer_id=p_customer_id and s.id=p_site_id and s.is_active=true and s.protected_identity=false
      and s.current_supplier_id::text=r.metadata->>'supplier_id'
      and r.request_type='current_supplier_contract_information_request' and r.status='completed'
      and r.metadata#>'{counterparty_reply,requires_review}' is distinct from 'true'::jsonb
      -- A completed conversation cannot overrule a later unresolved denial
      -- from another inquiry to the same current supplier. Open-recorder
      -- received_at is a processing clock: order only by its retained inbound
      -- source, and keep an unavailable/mismatched source on review.
      and not exists(select 1 from public.grid_owner_information_requests held
        left join public.manual_inbound_messages held_source
          on held_source.id::text=held.metadata#>>'{counterparty_reply,inbound_id}'
          and held_source.request_id=held.id and held_source.company_id=held.company_id
          and held_source.customer_id=held.customer_id and held_source.customer_site_id=held.customer_site_id
        where held.id<>r.id and held.company_id=r.company_id and held.customer_id=r.customer_id and held.customer_site_id=r.customer_site_id
          and held.request_type='current_supplier_contract_information_request'
          and held.metadata->>'supplier_id'=s.current_supplier_id::text
          and held.status not in ('cancelled','closed','completed','resolved')
          and held.metadata#>'{counterparty_reply,requires_review}'='true'::jsonb
          and (held_source.received_at is null or held_source.received_at>=i.received_at))
      and r.parsed_payload->>'customerInfoRequestId'=r.metadata->>'customer_info_request_id'
      and r.parsed_payload->>'supplierId'=r.metadata->>'supplier_id'
      and r.parsed_payload->>'supplierActorId'=r.metadata->>'supplier_actor_id'
      and r.parsed_payload->>'powerOfAttorneyId'=r.poa_id::text
      and r.parsed_payload->>'authorizationDocumentId'=r.metadata->>'authorization_document_id'
      and r.parsed_payload->'applied'='true'::jsonb and r.parsed_payload->'complete'='true'::jsonb
      and r.parsed_payload->>'responseStatus'='free_to_switch'
      and r.parsed_payload->'version'='1'::jsonb
      and r.parsed_payload->>'companyId'=p_company_id::text and r.parsed_payload->>'customerId'=p_customer_id::text
      and r.parsed_payload->>'siteId'=p_site_id::text and r.parsed_payload->>'requestId'=r.id::text and r.parsed_payload->>'inboundId'=i.id::text
      and r.parsed_payload#>>'{terms,earliestStartDate}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and r.parsed_payload#>>'{terms,effectiveStartDate}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and p_snapshot=r.parsed_payload-array['applied','inbound_id','complete','responseStatus','missingFields']
      and i.resolution_status='matched' and i.processing_state='applied'
      and i.extracted_payload->'sender_credible'='true'::jsonb and i.extracted_payload#>>'{sender_verification,status}'='verified'
      and i.extracted_payload->'manual_reply_structure_requires_review' is distinct from 'true'::jsonb
      and i.extracted_payload->'mime_requires_review' is distinct from 'true'::jsonb
      and coalesce(i.extracted_payload->'customer_identity_review_reasons','[]'::jsonb)='[]'::jsonb
      and i.extracted_payload#>>'{manual_automation,sourceHash}'=r.parsed_payload->>'sourceHash'
      and i.extracted_payload#>'{manual_automation,application}'=r.parsed_payload
  );
$$;
revoke all on function public.gridex_manual_supplier_terms_verified_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_manual_supplier_terms_verified_v1(uuid,uuid,uuid,jsonb) to service_role;

-- Hold the current acceptance and authority rows through application. This
-- closes revocation/scope changes while a provider or AI read was in flight.
create or replace function public.gridex_manual_reply_poa_current_v1(
  p_company_id uuid,p_customer_id uuid,p_site_id uuid,p_poa_id uuid,p_document_id uuid,p_kind text,p_metering_point_id uuid default null
) returns boolean language plpgsql security invoker set search_path = public as $$
declare
  p public.powers_of_attorney%rowtype;
  d public.customer_authorization_documents%rowtype;
  a public.authorization_scopes%rowtype;
  signed_scopes jsonb;
  today date:=(now() at time zone 'Europe/Stockholm')::date;
  contract_ref uuid;
begin
  select * into p from public.powers_of_attorney where id=p_poa_id and company_id=p_company_id and customer_id=p_customer_id for share;
  if not found or lower(p.status) not in ('signed','accepted','active','completed') or p.revoked_at is not null
    or to_jsonb(p)->>'replaced_by_id' is not null
    or coalesce(p.customer_site_id,p.site_id) is distinct from p_site_id
    or (p.customer_site_id is not null and p.customer_site_id<>p_site_id) or (p.site_id is not null and p.site_id<>p_site_id)
    or p.valid_from>today or p.valid_to<today or p.valid_until<today or p.expires_at<now()
    or not coalesce((p.signed_at is not null or p.accepted_at is not null or p.legal_text_version_id is not null
      or (jsonb_typeof(p.evidence_payload)='object' and p.evidence_payload-'verification_reference'<>'{}'::jsonb)
      or (jsonb_typeof(p.fullmakt_snapshot)='object' and p.fullmakt_snapshot<>'{}'::jsonb)),false)
    then return false; end if;
  if p_kind='facility' then
    return lower(trim(p.scope)) in ('facility_information_lookup','supplier_switch','all')
      or p.scope_summary->'facility_information_lookup'='true'::jsonb or p.scope_summary->'supplier_switch'='true'::jsonb
      or (jsonb_typeof(p.scope_summary)='array' and (p.scope_summary ? 'facility_information_lookup' or p.scope_summary ? 'supplier_switch'))
      or (jsonb_typeof(p.scope_summary->'scopes')='array' and (p.scope_summary->'scopes' ? 'facility_information_lookup' or p.scope_summary->'scopes' ? 'supplier_switch'));
  end if;
  if p_kind is distinct from 'commercial' or lower(p.status) not in ('signed','accepted','active') or p.document_id is distinct from p_document_id
    or p.metering_point_id is not null and p.metering_point_id is distinct from p_metering_point_id then return false; end if;
  select * into d from public.customer_authorization_documents where id=p_document_id and company_id=p_company_id
    and customer_id=p_customer_id and site_id=p_site_id and power_of_attorney_id=p_poa_id
    and document_type in ('power_of_attorney','complete_agreement') and status in ('active','signed') for share;
  if not found or (d.metering_point_id is not null and d.metering_point_id is distinct from p_metering_point_id) then return false; end if;
  if jsonb_typeof(p.signed_scope_snapshot)='array' and jsonb_array_length(p.signed_scope_snapshot)>0 then signed_scopes:=p.signed_scope_snapshot;
  elsif jsonb_typeof(p.scope_summary->'scopes')='array' then signed_scopes:=p.scope_summary->'scopes';
  else return false; end if;
  if not exists(select 1 from jsonb_array_elements_text(signed_scopes) scope where lower(trim(scope)) in ('current_supplier_contract','supplier_switch')) then return false; end if;
  if (p.contract_id is not null and p.customer_contract_id is not null and p.contract_id<>p.customer_contract_id)
    or (d.customer_contract_id is not null and coalesce(p.customer_contract_id,p.contract_id) is not null and d.customer_contract_id<>coalesce(p.customer_contract_id,p.contract_id)) then return false; end if;
  contract_ref:=coalesce(d.customer_contract_id,p.customer_contract_id,p.contract_id);
  if contract_ref is not null and not exists(select 1 from public.customer_contracts c where c.id=contract_ref and c.company_id=p_company_id and c.customer_id=p_customer_id
    and (c.site_id is null or c.site_id=p_site_id) and (c.customer_site_id is null or c.customer_site_id=p_site_id)
    and (c.metering_point_id is null or c.metering_point_id=p_metering_point_id)) then return false; end if;
  select * into a from public.authorization_scopes where company_id=p_company_id and customer_id=p_customer_id
    and authorization_document_id=p_document_id and status='active' and revoked_at is null and covers_current_supplier_contract=true
    and (valid_from is null or valid_from<=today) and (valid_to is null or valid_to>=today) order by id limit 1 for share;
  return found;
end $$;
revoke all on function public.gridex_manual_reply_poa_current_v1(uuid,uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.gridex_manual_reply_poa_current_v1(uuid,uuid,uuid,uuid,uuid,text,uuid) to service_role;

-- Human session claims (including platform-admin membership) are not transport
-- attestation. Keep derived source witnesses and their exact request bindings
-- writable only by the real server/database execution role. Existing RLS and
-- grants remain in force for ordinary notes and manual business review.
create or replace function public.gridex_guard_manual_mail_provenance_v1()
returns trigger language plpgsql security invoker set search_path=public as $$
declare
  before_row jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  after_row jsonb:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  before_payload jsonb; after_payload jsonb;
  protected boolean; k text;
begin
  if current_user in ('service_role','postgres','supabase_admin') then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_table_schema='public' and tg_table_name='manual_inbound_messages' then
    before_payload:=coalesce(before_row->'extracted_payload','{}'::jsonb);
    after_payload:=coalesce(after_row->'extracted_payload','{}'::jsonb);
    protected:=before_payload ?| array['sender_verification','manual_automation','sender_credible','source_fingerprint','ai_read_only','reply_assessment','manual_reply_structure_requires_review','mime_requires_review','customer_identity_review_reasons']
      or after_payload ?| array['sender_verification','manual_automation','sender_credible','source_fingerprint','ai_read_only','reply_assessment','manual_reply_structure_requires_review','mime_requires_review','customer_identity_review_reasons'];
    foreach k in array array['sender_verification','manual_automation','sender_credible','source_fingerprint','ai_read_only','reply_assessment','manual_reply_structure_requires_review','mime_requires_review','customer_identity_review_reasons'] loop
      if before_payload->k is distinct from after_payload->k then
        raise exception using errcode='42501',message='manual_mail_provenance_service_role_required';
      end if;
    end loop;
    if protected then
      if tg_op='DELETE' then raise exception using errcode='42501',message='manual_mail_provenance_service_role_required'; end if;
      foreach k in array array['id','company_id','request_id','customer_id','customer_site_id','grid_owner_id','metering_point_id',
        'resolution_status','processing_state','received_at','provider_message_id','mailbox','mailbox_company_id',
        'from_email','to_email','subject','body_text','body_html','normalized_text','in_reply_to','reference_message_ids','attachments'] loop
        if before_row->k is distinct from after_row->k then
          raise exception using errcode='42501',message='manual_mail_provenance_service_role_required';
        end if;
      end loop;
    end if;
  elsif tg_table_schema='public' and tg_table_name='grid_owner_information_requests' then
    before_payload:=coalesce(before_row->'parsed_payload','{}'::jsonb);
    after_payload:=coalesce(after_row->'parsed_payload','{}'::jsonb);
    protected:=before_payload ?| array['applied','sourceHash','inbound_id','inboundId','fieldSources']
      or after_payload ?| array['applied','sourceHash','inbound_id','inboundId','fieldSources'];
    if protected then
      if tg_op='DELETE' or before_payload is distinct from after_payload then
        raise exception using errcode='42501',message='manual_mail_provenance_service_role_required';
      end if;
      foreach k in array array['id','company_id','customer_id','customer_site_id','request_type','poa_id','received_at'] loop
        if before_row->k is distinct from after_row->k then
          raise exception using errcode='42501',message='manual_mail_provenance_service_role_required';
        end if;
      end loop;
      foreach k in array array['target_party','customer_info_request_id','supplier_id','supplier_actor_id','supplier_contact_id','authorization_document_id','manual_supplier_terms','counterparty_reply'] loop
        if before_row#>array['metadata',k] is distinct from after_row#>array['metadata',k] then
          raise exception using errcode='42501',message='manual_mail_provenance_service_role_required';
        end if;
      end loop;
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.gridex_guard_manual_mail_provenance_v1() from public,anon,authenticated;
grant execute on function public.gridex_guard_manual_mail_provenance_v1() to service_role;
create or replace trigger gridex_manual_inbound_provenance_v1 before insert or update or delete on public.manual_inbound_messages
  for each row execute function public.gridex_guard_manual_mail_provenance_v1();
create or replace trigger gridex_manual_request_provenance_v1 before insert or update or delete on public.grid_owner_information_requests
  for each row execute function public.gridex_guard_manual_mail_provenance_v1();

-- Current routing authority must still exist after correlation/model I/O.
-- Locks prevent a concurrent revoke from changing an already checked row before
-- this application's business writes commit; priority ambiguity stays closed.
create or replace function public.gridex_manual_supplier_route_current_v1(
  p_company_id uuid,p_supplier_id uuid,p_actor_id uuid,p_contact_id uuid,p_recipient_email text
) returns boolean language plpgsql security invoker set search_path=public as $$
declare pc public.platform_actor_contacts%rowtype; today date:=(now() at time zone 'Europe/Stockholm')::date;
begin
  perform 1 from public.electricity_suppliers es where es.id=p_supplier_id and (es.company_id is null or es.company_id=p_company_id)
    and es.is_active=true and es.platform_market_actor_id=p_actor_id for share;
  if not found then return false; end if;
  perform 1 from public.platform_market_actors actor where actor.id=p_actor_id and actor.status='active' and actor.match_status='verified' for share;
  if not found then return false; end if;
  perform 1 from public.platform_actor_roles ar where ar.actor_id=p_actor_id and ar.is_active=true and ar.actor_role in ('electricity_supplier','supplier') for share;
  if not found then return false; end if;
  select * into pc from public.platform_actor_contacts where id=p_contact_id and actor_id=p_actor_id
    and channel='email' and is_verified=true and verified_at is not null
    and contact_type in ('poa','customer_service','switching','general')
    and (valid_from is null or valid_from<=today) and (valid_to is null or valid_to>=today)
    and btrim(email) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    and lower(btrim(email))=lower(btrim(p_recipient_email)) for share;
  if not found then return false; end if;
  perform 1 from public.platform_actor_contacts other where other.actor_id=p_actor_id and other.id<>pc.id
    and other.channel='email' and other.is_verified=true and other.verified_at is not null
    and btrim(other.email) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    and (other.valid_from is null or other.valid_from<=today) and (other.valid_to is null or other.valid_to>=today)
    and case other.contact_type when 'poa' then 1 when 'customer_service' then 2 when 'switching' then 3 when 'general' then 4 else 100 end
      <=case pc.contact_type when 'poa' then 1 when 'customer_service' then 2 when 'switching' then 3 else 4 end for share;
  return not found;
end $$;
revoke all on function public.gridex_manual_supplier_route_current_v1(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gridex_manual_supplier_route_current_v1(uuid,uuid,uuid,uuid,text) to service_role;

-- A later authenticated denial may remove readiness, but never authorizes a
-- market send or rewrites an already submitted original. POA validity is not a
-- prerequisite for stopping: the denial can concern that very POA.
create or replace function public.gridex_hold_manual_counterparty_reply_v1(
  p_company_id uuid,p_request_id uuid,p_inbound_id uuid,p_assessment jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  r public.grid_owner_information_requests%rowtype;
  i public.manual_inbound_messages%rowtype;
  s public.customer_sites%rowtype;
  cir public.customer_info_requests%rowtype;
  source_hash text;
  hold_payload jsonb;
  latest_positive timestamptz;
  blocker text;
begin
  select * into r from public.grid_owner_information_requests where company_id=p_company_id and id=p_request_id for update;
  if not found or r.request_type is distinct from 'current_supplier_contract_information_request'
    then return jsonb_build_object('ok',false,'held',false,'code','counterparty_hold_request_invalid'); end if;
  select * into i from public.manual_inbound_messages where id=p_inbound_id for update;
  source_hash:=i.extracted_payload#>>'{manual_automation,sourceHash}';
  if not found or r.customer_id is null or r.customer_site_id is null
    or i.company_id is distinct from p_company_id or i.request_id is distinct from r.id
    or i.customer_id is distinct from r.customer_id or i.customer_site_id is distinct from r.customer_site_id
    or i.resolution_status is distinct from 'matched'
    or coalesce(i.processing_state,'') not in ('received','normalized','matched','parsed','needs_review')
    or i.extracted_payload->'sender_credible' is distinct from 'true'::jsonb
    or i.extracted_payload#>>'{sender_verification,status}' is distinct from 'verified'
    or i.extracted_payload#>'{sender_verification,version}' is distinct from '1'::jsonb
    or i.extracted_payload#>>'{sender_verification,method}' is distinct from 'dkim'
    or coalesce(i.extracted_payload#>>'{sender_verification,raw_sha256}','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(i.extracted_payload#>'{sender_verification,signed_headers}') is distinct from 'array'
    or not (i.extracted_payload#>'{sender_verification,signed_headers}' ? 'from')
    or coalesce(to_jsonb(i)->>'from_email','') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or lower(trim(to_jsonb(i)->>'from_email')) is distinct from lower(trim(i.extracted_payload#>>'{sender_verification,from_email}'))
    or coalesce(i.extracted_payload#>>'{sender_verification,signing_domain}','')=''
    or source_hash is null or source_hash !~ '^[a-f0-9]{64}$'
    or i.extracted_payload->'manual_reply_structure_requires_review'='true'::jsonb
    or i.extracted_payload->'mime_requires_review'='true'::jsonb
    or coalesce(i.extracted_payload->'customer_identity_review_reasons','[]'::jsonb) is distinct from '[]'::jsonb
    or i.received_at is null
    then return jsonb_build_object('ok',false,'held',false,'code','counterparty_hold_source_unverified'); end if;
  if jsonb_typeof(p_assessment) is distinct from 'object'
    or p_assessment is distinct from i.extracted_payload->'reply_assessment'
    or coalesce(p_assessment->>'outcome','') not in ('rejected','completion_requested')
    or p_assessment->>'intent' is distinct from (case when p_assessment->>'outcome'='rejected' then 'power_of_attorney_rejected' else 'power_of_attorney_completion_requested' end)
    or jsonb_typeof(p_assessment->'reason_codes') is distinct from 'array'
    or jsonb_array_length(p_assessment->'reason_codes') not between 1 and 20
    or jsonb_typeof(p_assessment->'evidence') is distinct from 'array'
    or jsonb_array_length(p_assessment->'evidence') not between 1 and 20
    or jsonb_typeof(p_assessment->'message') is distinct from 'string'
    or length(p_assessment->>'message') not between 1 and 5000
    then return jsonb_build_object('ok',false,'held',false,'code','counterparty_hold_assessment_unverified'); end if;

  select * into s from public.customer_sites where id=r.customer_site_id and company_id=p_company_id and customer_id=r.customer_id for update;
  if not found then return jsonb_build_object('ok',false,'held',false,'code','counterparty_hold_site_invalid'); end if;
  select * into cir from public.customer_info_requests where id::text=r.metadata->>'customer_info_request_id'
    and company_id=p_company_id and customer_id=r.customer_id and site_id=r.customer_site_id and target_party_type='current_supplier' for update;
  if not found or r.grid_owner_id is not null or r.metadata->>'target_party' is distinct from 'current_supplier'
    or r.metadata->>'supplier_id' is distinct from s.current_supplier_id::text
    or cir.verified_payload->>'manual_supplier_request_id' is distinct from r.id::text
    or cir.verified_payload->>'supplier_id' is distinct from s.current_supplier_id::text
    or cir.verified_payload->>'supplier_actor_id' is distinct from r.metadata->>'supplier_actor_id'
    or cir.verified_payload->>'supplier_contact_id' is distinct from r.metadata->>'supplier_contact_id'
    or not exists(select 1 from public.electricity_suppliers es
      join public.platform_market_actors actor on actor.id=es.platform_market_actor_id and actor.status='active' and actor.match_status='verified'
      join public.platform_actor_contacts pc on pc.actor_id=actor.id and pc.id::text=r.metadata->>'supplier_contact_id'
      where es.id=s.current_supplier_id and (es.company_id is null or es.company_id=p_company_id) and es.is_active=true
        and es.platform_market_actor_id::text=r.metadata->>'supplier_actor_id'
        and pc.channel='email' and pc.is_verified=true and pc.verified_at is not null
        and pc.contact_type in ('poa','customer_service','switching','general')
        and lower(trim(pc.email))=lower(trim(r.recipient_email))
        and (pc.valid_from is null or pc.valid_from<=(now() at time zone 'Europe/Stockholm')::date)
        and (pc.valid_to is null or pc.valid_to>=(now() at time zone 'Europe/Stockholm')::date)
        and exists(select 1 from public.platform_actor_roles ar where ar.actor_id=actor.id and ar.is_active=true and ar.actor_role in ('electricity_supplier','supplier')))
    then return jsonb_build_object('ok',false,'held',false,'code','counterparty_hold_current_supplier_changed'); end if;

  if r.metadata#>'{counterparty_reply,requires_review}'='true'::jsonb
    and r.metadata#>>'{counterparty_reply,inbound_id}'=p_inbound_id::text and r.status='needs_review'
    then return jsonb_build_object('ok',true,'held',true,'alreadyHeld',true,'customerId',r.customer_id,'customerSiteId',r.customer_site_id); end if;
  if r.status is distinct from 'completed'
    then return jsonb_build_object('ok',false,'held',false,'code','counterparty_hold_request_not_completed'); end if;
  -- Compare durable source receipt, never completed_at (a processing clock).
  -- A later positive conversation for this same provider also wins over an
  -- older denial addressed to a previous conversation.
  select max(pr.received_at) into latest_positive from public.grid_owner_information_requests pr
    join public.manual_inbound_messages pi on pi.id::text=pr.parsed_payload->>'inbound_id'
      and pi.company_id=pr.company_id and pi.request_id=pr.id and pi.customer_id=pr.customer_id and pi.customer_site_id=pr.customer_site_id
    where pr.company_id=p_company_id and pr.customer_id=r.customer_id and pr.customer_site_id=r.customer_site_id
      and pr.request_type='current_supplier_contract_information_request' and pr.status='completed'
      and pr.metadata->>'supplier_id'=s.current_supplier_id::text and pi.processing_state='applied'
      and pi.extracted_payload->'sender_credible'='true'::jsonb and pi.extracted_payload#>>'{sender_verification,status}'='verified'
      and pi.extracted_payload#>'{manual_automation,application}'=pr.parsed_payload;
  if r.received_at is null or i.received_at<=r.received_at or (latest_positive is not null and i.received_at<=latest_positive)
    then return jsonb_build_object('ok',false,'held',false,'code','counterparty_hold_stale_source'); end if;

  blocker:=case when p_assessment->>'outcome'='rejected' then 'current_supplier_poa_rejected' else 'current_supplier_poa_completion_required' end;
  hold_payload:=p_assessment||jsonb_build_object('requires_review',true,'inbound_id',p_inbound_id,'poa_id',r.poa_id,'received_at',i.received_at,'sourceHash',source_hash);
  update public.grid_owner_information_requests set status='needs_review',next_follow_up_at=null,received_at=i.received_at,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('counterparty_reply',hold_payload),
    received_payload=coalesce(received_payload,'{}'::jsonb)||jsonb_build_object('counterparty_reply',hold_payload),
    last_error_code=p_assessment#>>'{reason_codes,0}',last_error_message=left(p_assessment->>'message',500),updated_at=now()
    where company_id=p_company_id and id=r.id;
  update public.customer_sites set current_supplier_response_status=case
      when current_supplier_response_status is null or current_supplier_response_status in ('free_to_switch','waiting_response','received','response_received') then 'manual_review'
      else current_supplier_response_status end,updated_at=now()
    where company_id=p_company_id and customer_id=r.customer_id and id=r.customer_site_id;
  update public.customer_info_requests set status='manual_review_required',blocker_code=blocker,
    blocker_reason=left(p_assessment->>'message',500),blocker_details=jsonb_build_object('manual_supplier_request_id',r.id,'inbound_id',i.id),
    next_required_action='Granska motpartens fullmaktsbesked innan leverantörsbytet fortsätter.',
    verified_payload=coalesce(verified_payload,'{}'::jsonb)||jsonb_build_object('counterparty_reply',hold_payload),updated_at=now()
    where company_id=p_company_id and customer_id=r.customer_id and site_id=r.customer_site_id and id=cir.id;
  -- Only untouched normal-switch projections are paused. Sent/submitted rows,
  -- cancellation flows and immutable market originals are not rewritten.
  update public.supplier_switch_requests ss set status='manual_followup_required',lifecycle_blocked=true,lifecycle_block_source=blocker,
    pause_reason=left(p_assessment->>'message',500),paused_at=coalesce(paused_at,now()),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('manual_counterparty_hold',hold_payload),updated_at=now()
    where ss.company_id=p_company_id and ss.customer_id=r.customer_id and coalesce(ss.customer_site_id,ss.site_id)=r.customer_site_id
      and (ss.site_id is null or ss.site_id=r.customer_site_id) and (ss.customer_site_id is null or ss.customer_site_id=r.customer_site_id)
      and ss.request_type='switch' and coalesce(ss.prodat_variant,'L')='L' and coalesce(ss.prodat_reason,'Z22')='Z22'
      and ss.status in ('draft','queued','manual_followup_required') and ss.submitted_at is null and ss.completed_at is null
      and ss.outbound_z03_message_id is null and ss.lifecycle_blocked=false;
  update public.manual_inbound_messages set processing_state='needs_review',extracted_payload=jsonb_set(extracted_payload,'{manual_automation}',
    coalesce(extracted_payload->'manual_automation','{}'::jsonb)||jsonb_build_object('counterparty_hold',hold_payload))
    where id=i.id and company_id=p_company_id and request_id=r.id;
  insert into public.customer_operation_events(company_id,customer_id,customer_site_id,event_code,title,message,status,severity,action_required,source,payload,idempotency_key)
    values(p_company_id,r.customer_id,r.customer_site_id,p_assessment->>'intent','Motpartens fullmaktsbesked kräver granskning',left(p_assessment->>'message',500),
      'needs_review','warning',true,'manual_inbound_ingestion',jsonb_build_object('request_id',r.id,'inbound_id',i.id,'reason_codes',p_assessment->'reason_codes'),
      'manual-counterparty-reply:'||i.id::text)
    on conflict(company_id,idempotency_key) where idempotency_key is not null do nothing;
  return jsonb_build_object('ok',true,'held',true,'alreadyHeld',false,'customerId',r.customer_id,'customerSiteId',r.customer_site_id);
end $$;
revoke all on function public.gridex_hold_manual_counterparty_reply_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_hold_manual_counterparty_reply_v1(uuid,uuid,uuid,jsonb) to service_role;

-- A prepared normal-switch original may outlive a later commercial reply.
-- Add a first-entry checkpoint at the journal's physical-effect boundary;
-- native owner functions, source qualification and table ACLs stay intact.
create or replace function public.gridex_guard_manual_supplier_transport_entry_v1()
returns trigger language plpgsql security invoker set search_path=public as $$
declare
  m public.ediel_messages%rowtype;
  ss public.supplier_switch_requests%rowtype;
  s public.customer_sites%rowtype;
  resolved_site uuid;
  snapshot jsonb;
  manual_workflow boolean;
  source_verified boolean;
  floor_date date;
  original_start date;
begin
  if new.entered_at is null or (tg_op='UPDATE' and old.entered_at is not null) then return new; end if;
  select * into m from public.ediel_messages where id=new.message_id and company_id=new.company_id and environment=new.environment;
  if not found or m.direction is distinct from 'outbound' or m.message_family is distinct from 'PRODAT' or m.message_code is distinct from 'Z03' then return new; end if;
  -- Only the message's canonical owner may select its switch/move/cancel
  -- lane. An unrelated row can share an outbound reference and proves nothing.
  select * into ss from public.supplier_switch_requests where id=m.switch_request_id and company_id=m.company_id;
  if not found then
    if exists(select 1 from public.supplier_switch_requests candidate where candidate.company_id=m.company_id
      and candidate.outbound_z03_message_id=m.id and candidate.request_type='switch')
      or exists(select 1 from public.customer_sites candidate where candidate.id=m.site_id and candidate.company_id=m.company_id
        and candidate.customer_id=m.customer_id and (
          lower(coalesce(candidate.current_supplier_response_status,'')) in ('waiting_response','manual_review','binding_period','termination_fee','blocked')
          or coalesce(candidate.current_supplier_termination_fee,0)>0 or coalesce(candidate.metadata,'{}'::jsonb) ? 'manual_supplier_terms'
          or exists(select 1 from public.grid_owner_information_requests r where r.company_id=candidate.company_id and r.customer_id=candidate.customer_id
            and r.customer_site_id=candidate.id and r.request_type='current_supplier_contract_information_request'
            and r.metadata->>'supplier_id'=candidate.current_supplier_id::text and r.status not in ('cancelled','closed'))))
      then raise exception 'manual_supplier_transport_not_ready' using errcode='23514'; end if;
    return new; -- Unrelated legacy/native source admission remains its owner's job.
  end if;
  if ss.outbound_z03_message_id is distinct from m.id or ss.customer_id is distinct from m.customer_id
    or coalesce(ss.customer_site_id,ss.site_id) is distinct from m.site_id
    or (ss.customer_site_id is not null and ss.customer_site_id<>m.site_id) or (ss.site_id is not null and ss.site_id<>m.site_id)
    then raise exception 'manual_supplier_transport_not_ready' using errcode='23514'; end if;
  if ss.request_type is distinct from 'switch' or ss.status='cancellation_requested'
    or coalesce(ss.prodat_variant,'L') in ('LK','C') or coalesce(ss.prodat_reason,'Z22')<>'Z22' then return new; end if;
  resolved_site:=coalesce(ss.customer_site_id,ss.site_id);
  -- Positive application and negative holds both own this row FOR UPDATE.
  -- Take site before switch, matching the new mail commands, and retain it
  -- through native entry. Reading request proof adds no reverse row locks.
  select * into s from public.customer_sites where id=resolved_site and company_id=ss.company_id and customer_id=ss.customer_id for share;
  if not found then raise exception 'manual_supplier_transport_not_ready' using errcode='23514'; end if;
  select * into ss from public.supplier_switch_requests where id=ss.id and company_id=m.company_id for share;
  if ss.outbound_z03_message_id is distinct from m.id or ss.customer_id is distinct from s.customer_id
    or coalesce(ss.customer_site_id,ss.site_id) is distinct from s.id
    or (ss.customer_site_id is not null and ss.customer_site_id<>s.id) or (ss.site_id is not null and ss.site_id<>s.id)
    or m.switch_request_id is distinct from ss.id or m.customer_id is distinct from s.customer_id or m.site_id is distinct from s.id
    then raise exception 'manual_supplier_transport_not_ready' using errcode='23514'; end if;
  if ss.request_type is distinct from 'switch' or ss.status='cancellation_requested'
    or coalesce(ss.prodat_variant,'L') in ('LK','C') or coalesce(ss.prodat_reason,'Z22')<>'Z22' then return new; end if;
  if lower(coalesce(s.current_supplier_response_status,'')) in ('waiting_response','manual_review','binding_period','termination_fee','blocked')
    or coalesce(s.current_supplier_termination_fee,0)>0
    then raise exception 'manual_supplier_transport_not_ready' using errcode='23514'; end if;
  select exists(select 1 from public.grid_owner_information_requests r
    where r.company_id=s.company_id and r.customer_id=s.customer_id and r.customer_site_id=s.id
      and r.request_type='current_supplier_contract_information_request' and r.metadata->>'supplier_id'=s.current_supplier_id::text
      and r.status not in ('cancelled','closed')) into manual_workflow;
  snapshot:=s.metadata->'manual_supplier_terms';
  if not manual_workflow and not (coalesce(s.metadata,'{}'::jsonb) ? 'manual_supplier_terms')
    and not (coalesce(ss.metadata,'{}'::jsonb) ? 'manual_supplier_terms') then return new; end if;
  -- This is a separate post-lock SPI statement. Under READ COMMITTED a
  -- hold writer we waited for has committed before this proof snapshot starts.
  select public.gridex_manual_supplier_terms_verified_v1(s.company_id,s.customer_id,s.id,snapshot) into source_verified;
  if lower(coalesce(s.current_supplier_response_status,''))<>'free_to_switch'
    or source_verified is distinct from true
    then raise exception 'manual_supplier_transport_not_ready' using errcode='23514'; end if;
  floor_date:=public.gridex_manual_supplier_start_floor_v1(s.company_id,s.customer_id,s.id);
  select gridex_received_sources.permission_date_v1(o.original_object->>'start') into original_start
    from gridex_received_sources.switch_originals o where o.message_id=m.id and o.company_id=m.company_id and o.switch_id=ss.id
      and o.original_object->>'reason'='Z22';
  if floor_date is null or ss.requested_start_date is null or original_start is null
    or ss.requested_start_date<floor_date or original_start<floor_date
    then raise exception 'manual_supplier_transport_start_before_floor' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.gridex_guard_manual_supplier_transport_entry_v1() from public,anon,authenticated,service_role;
create trigger gridex_manual_supplier_transport_first_entry
  before insert or update of entered_at on gridex_ediel_transport.attempts
  for each row execute function public.gridex_guard_manual_supplier_transport_entry_v1();

-- The existing open-request recorder writes a hold directly to GOIR. Join it
-- to the same site serialization row used by atomic mail application and first
-- physical entry; retain its existing business payload and write privileges.
create or replace function public.gridex_lock_manual_commercial_hold_site_v1()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.request_type is distinct from 'current_supplier_contract_information_request'
    or new.metadata#>'{counterparty_reply,requires_review}' is distinct from 'true'::jsonb
    or new.status in ('cancelled','closed','completed','resolved') then return new; end if;
  perform s.id from public.customer_sites s
    where s.company_id=new.company_id and s.customer_id=new.customer_id and s.id=new.customer_site_id
      and s.current_supplier_id::text=new.metadata->>'supplier_id' for update;
  return new;
end $$;
revoke all on function public.gridex_lock_manual_commercial_hold_site_v1() from public,anon,authenticated,service_role;
create trigger gridex_manual_commercial_hold_site_lock
  before update of status,metadata,received_at,company_id,customer_id,customer_site_id,request_type on public.grid_owner_information_requests
  for each row execute function public.gridex_lock_manual_commercial_hold_site_v1();
