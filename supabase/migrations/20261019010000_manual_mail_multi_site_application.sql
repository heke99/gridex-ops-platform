-- One authenticated customer source may contain independently scoped site replies.
-- Keep its original request/site foreign keys unchanged. The batch namespace is
-- server-owned under the existing inbound provenance trigger; only final member
-- applications can act as downstream facts. No POA, inbound, or outbound is cloned.
create or replace function public.gridex_manual_reply_source_matches_v2(p_source jsonb,p_request jsonb,p_pending boolean default false)
returns boolean language plpgsql volatile security invoker set search_path=public as $$
declare member jsonb;parent public.grid_owner_information_requests%rowtype;
begin
 if p_source->>'company_id' is distinct from p_request->>'company_id'
   or p_source->>'customer_id' is distinct from p_request->>'customer_id' then return false; end if;
 if p_source->>'request_id'=p_request->>'id' and p_source->>'customer_site_id'=p_request->>'customer_site_id' then return true; end if;
 -- Every child remains part of the original verified conversation. A later
 -- unresolved rejection there invalidates its receipts as well. The hold
 -- writer locks these child sites before changing the parent; the transport
 -- gate already holds the child's site and performs this fresh read afterward.
 select * into parent from public.grid_owner_information_requests r
   where r.id::text=p_source->>'request_id' and r.company_id::text=p_source->>'company_id'
     and r.customer_id::text=p_source->>'customer_id' and r.customer_site_id::text=p_source->>'customer_site_id';
 if not found or parent.metadata#>'{counterparty_reply,requires_review}'='true'::jsonb
   or parent.metadata#>'{counterparty_reply,hold}'='true'::jsonb
   or parent.status in ('cancelled','failed','closed','needs_review') then return false; end if;
 member:=p_source#>array['extracted_payload','manual_automation','site_applications',p_request->>'id'];
 return coalesce(member->'version'='1'::jsonb
   and member->>'parentRequestId'=p_source->>'request_id'
   and member->>'companyId'=p_request->>'company_id' and member->>'customerId'=p_request->>'customer_id'
   and member->>'siteId'=p_request->>'customer_site_id' and member->>'requestId'=p_request->>'id'
   and member->>'requestType'=p_request->>'request_type'
   and member->>'powerOfAttorneyId'=p_request->>'poa_id'
   and member->>'sourceHash'=p_source#>>'{extracted_payload,manual_automation,sourceHash}'
   and (member->>'status'='applied' or (p_pending and member->>'status'='applying')),false);
end $$;
-- Caller RLS applies to both the supplied rows and the current parent lookup.
-- No privileges are elevated; SSR and physical-entry guards remain invokers.
revoke all on function public.gridex_manual_reply_source_matches_v2(jsonb,jsonb,boolean) from public,anon;
grant execute on function public.gridex_manual_reply_source_matches_v2(jsonb,jsonb,boolean) to authenticated,service_role;

create or replace function public.gridex_manual_reply_application_v2(p_source jsonb,p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=public as $$
declare member jsonb;
begin
 if not public.gridex_manual_reply_source_matches_v2(p_source,p_request,false) then return null; end if;
 member:=p_source#>array['extracted_payload','manual_automation','site_applications',p_request->>'id'];
 if member->>'status'='applied' then return member->'application'; end if;
 if p_source->>'request_id'=p_request->>'id' and p_source->>'customer_site_id'=p_request->>'customer_site_id'
   then return p_source#>'{extracted_payload,manual_automation,application}'; end if;
 return null;
end $$;
revoke all on function public.gridex_manual_reply_application_v2(jsonb,jsonb) from public,anon;
grant execute on function public.gridex_manual_reply_application_v2(jsonb,jsonb) to authenticated,service_role;

create or replace function public.gridex_store_manual_reply_application_v2(p_company_id uuid,p_request_id uuid,p_inbound_id uuid,p_application jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare i public.manual_inbound_messages%rowtype;r public.grid_owner_information_requests%rowtype;automation jsonb;member jsonb;
begin
 select * into i from public.manual_inbound_messages where id=p_inbound_id and company_id=p_company_id for update;
 select * into r from public.grid_owner_information_requests where id=p_request_id and company_id=p_company_id;
 if i.id is null or r.id is null or not public.gridex_manual_reply_source_matches_v2(to_jsonb(i),to_jsonb(r),true)
   then raise exception 'manual_reply_source_ownership' using errcode='23514'; end if;
 automation:=coalesce(i.extracted_payload->'manual_automation','{}'::jsonb);
 member:=automation#>array['site_applications',r.id::text];
 if member is not null then
   automation:=jsonb_set(automation,array['site_applications',r.id::text],member||jsonb_build_object('status','applied','application',p_application));
 end if;
 if i.request_id=r.id and i.customer_site_id=r.customer_site_id then automation:=automation||jsonb_build_object('application',p_application); end if;
 update public.manual_inbound_messages set processing_state='applied',extracted_payload=jsonb_set(extracted_payload,'{manual_automation}',automation)
   where id=p_inbound_id and company_id=p_company_id;
end $$;
revoke all on function public.gridex_store_manual_reply_application_v2(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_store_manual_reply_application_v2(uuid,uuid,uuid,jsonb) to service_role;


-- Reading authority is revalidated after OCR/model work. Unlike outbound
-- readiness this does not require Ediel/customer-flow send eligibility.
create or replace function public.gridex_manual_grid_owner_source_current_v2(p_company_id uuid,p_grid_owner_id uuid,p_from_email text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v_actor_id uuid;
begin
 if coalesce(btrim(p_from_email),'') !~* '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then return false; end if;
 select g.platform_market_actor_id into v_actor_id from public.grid_owners g where g.id=p_grid_owner_id
   and (g.company_id is null or g.company_id=p_company_id) and g.is_active=true for share;
 if not found or v_actor_id is null then return false; end if;
 perform 1 from public.platform_market_actors a where a.id=v_actor_id and a.status='active' and a.match_status='verified'
   and a.verified_at is not null for share;
 if not found then return false; end if;
 perform 1 from public.platform_actor_roles ar where ar.actor_id=v_actor_id and ar.actor_role='grid_owner' and ar.is_active=true for share;
 if not found then return false; end if;
 perform 1 from public.grid_owner_contact_channels c where c.grid_owner_id=p_grid_owner_id
   and (c.company_id is null or c.company_id=p_company_id) and c.is_enabled=true and c.is_verified=true and c.verified_at is not null
   and lower(btrim(c.email))=lower(btrim(p_from_email)) for share;
 return found;
end $$;
revoke all on function public.gridex_manual_grid_owner_source_current_v2(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gridex_manual_grid_owner_source_current_v2(uuid,uuid,text) to service_role;

-- Forward source adapter: gridex_manual_reply_context_v1; existing business validations retained.
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
  if not found or i.company_id is distinct from p_company_id
    or i.customer_id is distinct from r.customer_id or not public.gridex_manual_reply_source_matches_v2(to_jsonb(i),to_jsonb(r),true)
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
    -- Site serialization makes this a fresh read after any concurrent hold.
    -- Never project a positive source over a later/equal unresolved sibling.
    if exists(select 1 from public.grid_owner_information_requests held
      left join public.manual_inbound_messages held_source
        on held_source.id::text=held.metadata#>>'{counterparty_reply,inbound_id}'
        and held_source.company_id=held.company_id and held_source.customer_id=held.customer_id
        and public.gridex_manual_reply_source_matches_v2(to_jsonb(held_source),to_jsonb(held),false)
      where held.id<>r.id and held.company_id=p_company_id and held.customer_id=r.customer_id and held.customer_site_id=r.customer_site_id
        and held.request_type='current_supplier_contract_information_request' and held.metadata->>'supplier_id'=s.current_supplier_id::text
        and held.metadata#>'{counterparty_reply,requires_review}'='true'::jsonb
        and (held_source.received_at is null or held_source.received_at>=i.received_at))
      then return jsonb_build_object('ok',false,'code','manual_reply_newer_counterparty_hold'); end if;
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
  if p_kind='facility' and public.gridex_manual_grid_owner_source_current_v2(p_company_id,r.grid_owner_id,i.from_email) is distinct from true
    then return jsonb_build_object('ok',false,'code','manual_reply_grid_owner_route_revoked'); end if;
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
    and i.processing_state='applied' and public.gridex_manual_reply_application_v2(to_jsonb(i),to_jsonb(r))=r.parsed_payload
    then return jsonb_build_object('ok',true,'alreadyApplied',true,'applied',true,'complete',r.status='completed','customerId',r.customer_id,'customerSiteId',r.customer_site_id,'effectiveStartDate',r.parsed_payload#>>'{terms,effectiveStartDate}','result',r.parsed_payload->'result'); end if;
  if r.status not in ('sent','waiting_response','received','manual_email_sent','waiting_manual_response','manual_response_received','manual_response_parsed')
    then return jsonb_build_object('ok',false,'code','manual_reply_request_not_waiting'); end if;
  if r.received_at > i.received_at or (r.received_at=i.received_at and r.parsed_payload->>'inbound_id' is not null and r.parsed_payload->>'inbound_id'<>p_inbound_id::text)
    then return jsonb_build_object('ok',false,'code','manual_reply_stale_source'); end if;
  return jsonb_build_object('ok',true,'customerId',r.customer_id,'customerSiteId',r.customer_site_id,'receivedAt',i.received_at,'batchMember',coalesce(i.extracted_payload#>'{manual_automation,site_applications}' ? r.id::text,false),'request',to_jsonb(r),'site',to_jsonb(s),'customer',c,'inbound',to_jsonb(i));
end $$;


-- Forward source adapter: gridex_apply_manual_commercial_reply_v1; existing business validations retained.
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
  hint_value:=case when ctx->'batchMember'='true'::jsonb then null else ctx#>>'{inbound,metering_point_id}' end;
  if hint_value is not null then
    perform 1 from public.metering_points mp where mp.id::text=hint_value and mp.company_id=p_company_id and mp.customer_id=v_customer_id
      and mp.site_id=v_site_id and (mp.customer_site_id is null or mp.customer_site_id=v_site_id) for share;
    if not found then return jsonb_build_object('ok',false,'code','manual_reply_meter_ownership_conflict'); end if;
  end if;
  -- Earlier facts may be accumulated only from the previous atomic source
  -- application. Editable site metadata is a projection and is never authority.
  if ctx#>'{request,parsed_payload,applied}'='true'::jsonb then
    select public.gridex_manual_reply_application_v2(to_jsonb(pi),ctx->'request') into previous
      from public.manual_inbound_messages pi
      where pi.id::text=ctx#>>'{request,parsed_payload,inbound_id}'
        and pi.company_id=p_company_id and pi.customer_id=v_customer_id and public.gridex_manual_reply_source_matches_v2(to_jsonb(pi),ctx->'request',false)
        and pi.resolution_status='matched' and pi.processing_state='applied'
        and pi.extracted_payload->'sender_credible'='true'::jsonb and pi.extracted_payload#>>'{sender_verification,status}'='verified'
        and pi.extracted_payload->'manual_reply_structure_requires_review' is distinct from 'true'::jsonb
        and pi.extracted_payload->'mime_requires_review' is distinct from 'true'::jsonb
        and coalesce(pi.extracted_payload->'customer_identity_review_reasons','[]'::jsonb)='[]'::jsonb
        and pi.extracted_payload#>>'{manual_automation,sourceHash}'=ctx#>>'{request,parsed_payload,sourceHash}'
        and public.gridex_manual_reply_application_v2(to_jsonb(pi),ctx->'request')=ctx#>'{request,parsed_payload}'
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
    values(p_company_id,v_customer_id,v_site_id,'manual_supplier_terms_applied','Leverantörssvar registrerat','Verifierade avtalsuppgifter har kopplats till rätt kund och anläggning.',case when complete then 'completed' else 'response_received' end,'info',false,'manual_inbound_ingestion',snapshot,'manual-supplier-terms:'||p_inbound_id::text||case when ctx->'batchMember'='true'::jsonb then ':'||p_request_id::text else '' end)
    on conflict(company_id,idempotency_key) where idempotency_key is not null do nothing;
  perform public.gridex_store_manual_reply_application_v2(p_company_id,p_request_id,p_inbound_id,result_payload);
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


-- Forward source adapter: gridex_apply_manual_facility_reply_v1; existing business validations retained.
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
  perform public.gridex_store_manual_reply_application_v2(p_company_id,p_request_id,p_inbound_id,snapshot);
  return result||jsonb_build_object('applied',true,'alreadyApplied',false);
exception when others then
  return jsonb_build_object('ok',false,'applied',false,'code','manual_reply_transaction_failed');
end $$;


-- Forward source adapter: gridex_manual_supplier_start_floor_v1; existing business validations retained.
create or replace function public.gridex_manual_supplier_start_floor_v1(
  p_company_id uuid,p_customer_id uuid,p_site_id uuid
) returns date language plpgsql stable security invoker set search_path = public as $$
declare floor_date date;
begin
  select max((r.parsed_payload#>>'{terms,effectiveStartDate}')::date) into floor_date
    from public.customer_sites s
    join public.grid_owner_information_requests r on r.company_id=s.company_id and r.customer_id=s.customer_id and r.customer_site_id=s.id
    join public.manual_inbound_messages i on i.id::text=r.parsed_payload->>'inbound_id'
      and i.company_id=r.company_id and i.customer_id=r.customer_id and public.gridex_manual_reply_source_matches_v2(to_jsonb(i),to_jsonb(r),false)
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
      and public.gridex_manual_reply_application_v2(to_jsonb(i),to_jsonb(r))=r.parsed_payload;
  return floor_date;
exception when others then return null;
end $$;


-- Forward source adapter: gridex_guard_manual_supplier_start_floor_v1; existing business validations retained.
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
      and i.company_id=r.company_id and i.customer_id=r.customer_id and public.gridex_manual_reply_source_matches_v2(to_jsonb(i),to_jsonb(r),false)
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
      and public.gridex_manual_reply_application_v2(to_jsonb(i),to_jsonb(r))=r.parsed_payload;
  if floor_date is not null then new.requested_start_date:=greatest(new.requested_start_date,floor_date); end if;
  return new;
end $$;


-- Forward source adapter: gridex_manual_supplier_terms_verified_v1; existing business validations retained.
create or replace function public.gridex_manual_supplier_terms_verified_v1(
  p_company_id uuid,p_customer_id uuid,p_site_id uuid,p_snapshot jsonb
) returns boolean language sql stable security invoker set search_path = public as $$
  select exists(
    select 1 from public.customer_sites s
    join public.grid_owner_information_requests r on r.company_id=s.company_id and r.customer_id=s.customer_id and r.customer_site_id=s.id
    join public.manual_inbound_messages i on i.id::text=r.parsed_payload->>'inbound_id'
      and i.company_id=r.company_id and i.customer_id=r.customer_id and public.gridex_manual_reply_source_matches_v2(to_jsonb(i),to_jsonb(r),false)
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
          and held_source.company_id=held.company_id and held_source.customer_id=held.customer_id
          and public.gridex_manual_reply_source_matches_v2(to_jsonb(held_source),to_jsonb(held),false)
        where held.id<>r.id and held.company_id=r.company_id and held.customer_id=r.customer_id and held.customer_site_id=r.customer_site_id
          and held.request_type='current_supplier_contract_information_request'
          and held.metadata->>'supplier_id'=s.current_supplier_id::text
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
      and public.gridex_manual_reply_application_v2(to_jsonb(i),to_jsonb(r))=r.parsed_payload
  );
$$;


-- Forward source adapter: gridex_hold_manual_counterparty_reply_v1; existing business validations retained.
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
  previous_hold_received timestamptz;
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
    and r.metadata#>>'{counterparty_reply,inbound_id}'=p_inbound_id::text
    then return jsonb_build_object('ok',true,'held',true,'alreadyHeld',true,'customerId',r.customer_id,'customerSiteId',r.customer_site_id); end if;
  if r.status not in ('completed','needs_review','ready_to_send_manual_email','manual_email_queued','manual_email_sent','waiting_manual_response','manual_response_received','manual_response_parsed','sent','waiting_response','received')
    then return jsonb_build_object('ok',false,'held',false,'code','counterparty_hold_request_not_completed'); end if;
  -- Explicit review resolves a source; it does not erase its ordering. A
  -- replay/older callback cannot undo that review, but a new later source can.
  if r.metadata#>>'{counterparty_reply,inbound_id}' is not null then
    select previous.received_at into previous_hold_received from public.manual_inbound_messages previous
      where previous.id::text=r.metadata#>>'{counterparty_reply,inbound_id}' and previous.request_id=r.id
        and previous.company_id=p_company_id and previous.customer_id=r.customer_id and previous.customer_site_id=r.customer_site_id;
    if (previous_hold_received is null and r.metadata#>'{counterparty_reply,requires_review}'='true'::jsonb)
      or (previous_hold_received is not null and i.received_at<=previous_hold_received)
      then return jsonb_build_object('ok',false,'held',false,'code','counterparty_hold_stale_source'); end if;
  end if;
  -- Compare durable source receipt, never completed_at (a processing clock).
  -- A later positive conversation for this same provider also wins over an
  -- older denial addressed to a previous conversation.
  select max(pi.received_at) into latest_positive from public.grid_owner_information_requests pr
    join public.manual_inbound_messages pi on pi.id::text=pr.parsed_payload->>'inbound_id'
      and pi.company_id=pr.company_id and pi.customer_id=pr.customer_id and public.gridex_manual_reply_source_matches_v2(to_jsonb(pi),to_jsonb(pr),false)
    where pr.company_id=p_company_id and pr.customer_id=r.customer_id
      and (pr.customer_site_id=r.customer_site_id or pi.request_id=r.id)
      and pr.request_type='current_supplier_contract_information_request' and pr.parsed_payload->'complete'='true'::jsonb
      and pr.metadata->>'supplier_id'=s.current_supplier_id::text and pi.processing_state='applied'
      and pi.extracted_payload->'sender_credible'='true'::jsonb and pi.extracted_payload#>>'{sender_verification,status}'='verified'
      and public.gridex_manual_reply_application_v2(to_jsonb(pi),to_jsonb(pr))=pr.parsed_payload;
  if latest_positive is not null and i.received_at<=latest_positive
    then return jsonb_build_object('ok',false,'held',false,'code','counterparty_hold_stale_source'); end if;

  blocker:=case when p_assessment->>'outcome'='rejected' then 'current_supplier_poa_rejected' else 'current_supplier_poa_completion_required' end;
  hold_payload:=p_assessment||jsonb_build_object('requires_review',true,'inbound_id',p_inbound_id,'poa_id',r.poa_id,'received_at',i.received_at,'sourceHash',source_hash);
  -- Keep terminal history terminal. Reopening a completed inquiry may collide
  -- with an existing open-site/idempotency index; its authoritative hold flag
  -- blocks proof and physical entry independently of the status projection.
  update public.grid_owner_information_requests set status=case when r.status='completed' then 'completed' else 'needs_review' end,next_follow_up_at=null,received_at=i.received_at,
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


-- Forward source adapter: gridex_lock_manual_commercial_hold_site_v1; existing business validations retained.
create or replace function public.gridex_lock_manual_commercial_hold_site_v1()
returns trigger language plpgsql security invoker set search_path=public as $$
declare previous_received timestamptz; incoming_received timestamptz;
begin
  if new.request_type is distinct from 'current_supplier_contract_information_request'
    or new.metadata#>'{counterparty_reply,requires_review}' is distinct from 'true'::jsonb then return new; end if;
  perform s.id from public.customer_sites s
    where s.company_id=new.company_id and s.customer_id=new.customer_id
      and s.current_supplier_id::text=new.metadata->>'supplier_id'
      and (s.id=new.customer_site_id or exists(
        select 1 from public.manual_inbound_messages source
        cross join lateral jsonb_each(coalesce(source.extracted_payload#>'{manual_automation,site_applications}','{}'::jsonb)) item
        join public.grid_owner_information_requests child on child.id::text=item.key
          and child.company_id=new.company_id and child.customer_id=new.customer_id and child.customer_site_id=s.id
        where source.request_id=new.id and source.customer_site_id=new.customer_site_id
          and source.company_id=new.company_id and source.customer_id=new.customer_id
          and item.value->'version'='1'::jsonb and item.value->>'status'='applied'
          and item.value->>'parentRequestId'=new.id::text and item.value->>'companyId'=new.company_id::text
          and item.value->>'customerId'=new.customer_id::text and item.value->>'siteId'=s.id::text
          and item.value->>'requestId'=child.id::text and item.value->>'requestType'=child.request_type
          and item.value->>'powerOfAttorneyId'=child.poa_id::text
          and item.value->>'sourceHash'=source.extracted_payload#>>'{manual_automation,sourceHash}'
          and item.value->'application'=child.parsed_payload
          and child.request_type='current_supplier_contract_information_request'
          and child.metadata->>'supplier_id'=new.metadata->>'supplier_id'
      )) order by s.id for update;
  -- Defend the remaining direct recorder path against stale whole-row snapshots.
  -- Explicit review clears requires_review above; entity merges keep their
  -- existing server-owned identity operation and invalidate old source proof.
  if old.metadata#>'{counterparty_reply,requires_review}'='true'::jsonb
    and old.id=new.id and old.company_id=new.company_id and old.customer_id=new.customer_id and old.customer_site_id=new.customer_site_id
    and old.metadata->>'supplier_id' is not distinct from new.metadata->>'supplier_id'
    and old.metadata#>>'{counterparty_reply,inbound_id}' is distinct from new.metadata#>>'{counterparty_reply,inbound_id}' then
    select source.received_at into previous_received from public.manual_inbound_messages source
      where source.id::text=old.metadata#>>'{counterparty_reply,inbound_id}' and source.request_id=old.id
        and source.company_id=old.company_id and source.customer_id=old.customer_id and source.customer_site_id=old.customer_site_id;
    select source.received_at into incoming_received from public.manual_inbound_messages source
      where source.id::text=new.metadata#>>'{counterparty_reply,inbound_id}' and source.request_id=new.id
        and source.company_id=new.company_id and source.customer_id=new.customer_id and source.customer_site_id=new.customer_site_id;
    if previous_received is null or incoming_received is null or incoming_received<=previous_received then return old; end if;
  end if;
  return new;
end $$;
-- The parent source is locked for the whole batch. Registered members are
-- visible only inside this transaction until every row has a durable outcome.
create or replace function public.gridex_apply_manual_multi_site_reply_v1(
 p_company_id uuid,p_parent_request_id uuid,p_inbound_id uuid,p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 parent public.grid_owner_information_requests%rowtype;
 source public.manual_inbound_messages%rowtype;
 target public.grid_owner_information_requests%rowtype;
 site public.customer_sites%rowtype;
 poa public.powers_of_attorney%rowtype;
 ctx jsonb;item jsonb;item_payload jsonb;member jsonb;result jsonb;summary jsonb;
 automation jsonb;members jsonb;results jsonb:='[]'::jsonb;
 facility text;kind text;reason text;target_id uuid;cir_id uuid;matches integer;
 applied_count integer:=0;review_count integer:=0;internal_created boolean;
begin
 if jsonb_typeof(p_payload->'items') is distinct from 'array'
   or jsonb_array_length(p_payload->'items') not between 1 and 64
   then return jsonb_build_object('ok',false,'code','manual_multi_site_invalid_items'); end if;
 select * into parent from public.grid_owner_information_requests where id=p_parent_request_id and company_id=p_company_id for update;
 if not found then return jsonb_build_object('ok',false,'code','manual_reply_request_not_found'); end if;
 select * into source from public.manual_inbound_messages where id=p_inbound_id for update;
 if not found or source.company_id is distinct from p_company_id or source.request_id is distinct from parent.id
   or source.customer_id is distinct from parent.customer_id or source.customer_site_id is distinct from parent.customer_site_id
   then return jsonb_build_object('ok',false,'code','manual_reply_source_ownership'); end if;
 kind:=case when parent.request_type='current_supplier_contract_information_request' then 'commercial' else 'facility' end;
 ctx:=public.gridex_manual_reply_context_v1(p_company_id,parent.id,source.id,p_payload->>'sourceHash',kind);
 if ctx->'ok' is distinct from 'true'::jsonb then return ctx; end if;
 summary:=source.extracted_payload#>'{manual_automation,multi_site}';
 if summary->'version'='1'::jsonb and summary->>'parentRequestId'=parent.id::text
   and summary->>'sourceHash'=p_payload->>'sourceHash' then return summary||jsonb_build_object('ok',true,'alreadyApplied',true); end if;
 if ctx->'alreadyApplied'='true'::jsonb then return jsonb_build_object('ok',false,'code','manual_multi_site_source_already_applied'); end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'items') x group by x->>'facilityId' having count(*)>1)
   then return jsonb_build_object('ok',false,'code','manual_multi_site_duplicate_facility'); end if;
 -- Stable target order avoids opposite-order batches locking sites differently.
 for item in select value from jsonb_array_elements(p_payload->'items') order by value->>'facilityId' loop
  facility:=item->>'facilityId';reason:=null;target:=null;site:=null;target_id:=null;internal_created:=false;
  begin
   if jsonb_typeof(item) is distinct from 'object' or coalesce(facility,'') !~ '^[0-9]{18}$'
     then reason:='manual_multi_site_facility_invalid'; end if;
   if item ? 'reasons' and (jsonb_typeof(item->'reasons') is distinct from 'array' or item->'reasons'<>'[]'::jsonb)
     then reason:='manual_multi_site_item_requires_review'; end if;
   if reason is null then
    select count(*) into matches from public.customer_sites s where s.company_id=p_company_id and s.customer_id=parent.customer_id
      and regexp_replace(s.facility_id,'\s','','g')=facility;
    if matches<>1 then reason:='manual_multi_site_site_unknown_or_ambiguous';
    else
     select * into site from public.customer_sites s where s.company_id=p_company_id and s.customer_id=parent.customer_id
       and regexp_replace(s.facility_id,'\s','','g')=facility for update;
     if site.is_active is distinct from true or site.protected_identity is true or site.archived_at is not null or site.closed_at is not null
       then reason:='manual_reply_lifecycle_blocked'; end if;
     if (kind='commercial' and site.current_supplier_id::text is distinct from parent.metadata->>'supplier_id')
       or (kind='facility' and (parent.grid_owner_id is null or site.grid_owner_id is distinct from parent.grid_owner_id))
       then reason:='manual_multi_site_party_mismatch'; end if;
    end if;
   end if;
   if reason is null then
    if item ? 'requestId' then
     if coalesce(item->>'requestId','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then reason:='manual_multi_site_request_invalid';
     else
      select * into target from public.grid_owner_information_requests r where r.id=(item->>'requestId')::uuid
       and r.company_id=p_company_id and r.customer_id=parent.customer_id and r.customer_site_id=site.id for update;
      if not found then reason:='manual_multi_site_request_scope'; end if;
     end if;
    else
     select count(*) into matches from public.grid_owner_information_requests r where r.company_id=p_company_id
       and r.customer_id=parent.customer_id and r.customer_site_id=site.id and r.status not in ('completed','cancelled','failed','closed')
       and ((kind='commercial' and r.request_type='current_supplier_contract_information_request'
          and r.metadata->>'supplier_id'=parent.metadata->>'supplier_id')
         or (kind='facility' and r.request_type in ('facility_identifier_lookup','facility_lookup') and r.grid_owner_id=parent.grid_owner_id));
     if matches>1 then reason:='manual_multi_site_request_ambiguous';
     elsif matches=1 then
      select * into target from public.grid_owner_information_requests r where r.company_id=p_company_id
       and r.customer_id=parent.customer_id and r.customer_site_id=site.id and r.status not in ('completed','cancelled','failed','closed')
       and ((kind='commercial' and r.request_type='current_supplier_contract_information_request' and r.metadata->>'supplier_id'=parent.metadata->>'supplier_id')
         or (kind='facility' and r.request_type in ('facility_identifier_lookup','facility_lookup') and r.grid_owner_id=parent.grid_owner_id)) for update;
     end if;
    end if;
   end if;
   if reason is null and target.id is null then
    -- A received-only internal request is permitted only with independently
    -- current site authority. Its POA/document are never copied from the parent.
    select * into poa from public.powers_of_attorney p where p.company_id=p_company_id and p.customer_id=parent.customer_id
      and public.gridex_manual_reply_poa_current_v1(p_company_id,parent.customer_id,site.id,p.id,
        case when kind='commercial' then p.document_id else null end,kind,null)
      order by p.id limit 1 for share;
    if not found then reason:='manual_multi_site_current_poa_required';
    else
     target_id:=gen_random_uuid();cir_id:=null;
     if kind='commercial' then
      if public.gridex_manual_supplier_route_current_v1(p_company_id,site.current_supplier_id,
        (parent.metadata->>'supplier_actor_id')::uuid,(parent.metadata->>'supplier_contact_id')::uuid,parent.recipient_email) is distinct from true
        then reason:='manual_reply_supplier_route_revoked';
      else
       cir_id:=gen_random_uuid();
       insert into public.customer_info_requests(id,company_id,customer_id,site_id,target_party_type,request_type,status,authorization_document_id,
          verified_payload,blocker_details)
        values(cir_id,p_company_id,parent.customer_id,site.id,'current_supplier','supplier_contract_information','missing_binding_info',poa.document_id,
          jsonb_build_object('manual_supplier_request_id',target_id,'supplier_id',site.current_supplier_id,
            'supplier_actor_id',parent.metadata->>'supplier_actor_id','supplier_contact_id',parent.metadata->>'supplier_contact_id'),'{}');
      end if;
     end if;
     if reason is null then
      insert into public.grid_owner_information_requests(id,company_id,customer_id,customer_site_id,request_type,status,channel,grid_owner_id,poa_id,case_reference,
        recipient_email,created_by,metadata,parsed_payload,received_payload)
      values(target_id,p_company_id,parent.customer_id,site.id,parent.request_type,'received','manual_email',
        case when kind='facility' then parent.grid_owner_id else null end,poa.id,'GX-FIR-'||upper(replace(target_id::text,'-','')),parent.recipient_email,parent.created_by,
        jsonb_strip_nulls(jsonb_build_object('manual_multi_site_parent_request_id',parent.id,'manual_multi_site_source_inbound_id',source.id,'auto_send_allowed',false,
          'target_party',case when kind='commercial' then 'current_supplier' else 'grid_owner' end,'customer_info_request_id',cir_id,
          'authorization_document_id',case when kind='commercial' then poa.document_id else null end,
          'supplier_id',case when kind='commercial' then site.current_supplier_id else null end,
          'supplier_actor_id',case when kind='commercial' then parent.metadata->>'supplier_actor_id' else null end,
          'supplier_contact_id',case when kind='commercial' then parent.metadata->>'supplier_contact_id' else null end)),'{}','{}') returning * into target;
      internal_created:=true;
     end if;
    end if;
   end if;
   if reason is null then
    if (kind='commercial' and (target.request_type<>'current_supplier_contract_information_request'
        or target.metadata->>'supplier_id' is distinct from parent.metadata->>'supplier_id'
        or target.metadata->>'supplier_actor_id' is distinct from parent.metadata->>'supplier_actor_id'
        or target.metadata->>'supplier_contact_id' is distinct from parent.metadata->>'supplier_contact_id'))
      or (kind='facility' and (target.request_type not in ('facility_identifier_lookup','facility_lookup') or target.grid_owner_id is distinct from parent.grid_owner_id))
      then reason:='manual_multi_site_party_mismatch'; end if;
   end if;
   if reason is null then
    member:=jsonb_build_object('version',1,'parentRequestId',parent.id,'companyId',p_company_id,'customerId',parent.customer_id,
      'siteId',site.id,'requestId',target.id,'requestType',target.request_type,'powerOfAttorneyId',target.poa_id,
      'facilityId',facility,'sourceHash',p_payload->>'sourceHash','internalCreated',internal_created,'status','applying');
    select coalesce(extracted_payload->'manual_automation','{}') into automation from public.manual_inbound_messages where id=source.id;
    members:=coalesce(automation->'site_applications','{}')||jsonb_build_object(target.id::text,member);
    update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{manual_automation}',automation||jsonb_build_object('site_applications',members)) where id=source.id;
    item_payload:=coalesce(item->'payload','{}')||jsonb_build_object('sourceHash',p_payload->>'sourceHash');
    if nullif(item_payload#>>'{extracted,facility_id}','') is not null and item_payload#>>'{extracted,facility_id}'<>facility
      then raise exception 'manual_multi_site_facility_hint_conflict' using errcode='23514'; end if;
    if item_payload#>>'{extracted,facility_id}' is null then
      item_payload:=item_payload||jsonb_build_object('extracted',coalesce(item_payload->'extracted','{}')||jsonb_build_object('facility_id',facility));
    end if;
    if kind='facility' and nullif(item_payload->>'grid_area_code','') is null
      then item_payload:=item_payload||jsonb_build_object('grid_area_code',site.grid_area_code); end if;
    if kind='commercial' then result:=public.gridex_apply_manual_commercial_reply_v1(p_company_id,target.id,source.id,item_payload);
    else result:=public.gridex_apply_manual_facility_reply_v1(p_company_id,target.id,source.id,item_payload); end if;
    if result->'ok'='true'::jsonb and result->'applied'='true'::jsonb then
      applied_count:=applied_count+1;
      results:=results||jsonb_build_array(jsonb_build_object('facilityId',facility,'siteId',site.id,'requestId',target.id,'outcome','applied','complete',result->'complete'));
    else reason:=coalesce(result->>'code','manual_multi_site_application_rejected'); end if;
   end if;
  exception when others then reason:='manual_multi_site_item_failed'; end;
  if reason is not null then
   review_count:=review_count+1;
   results:=results||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('facilityId',facility,'siteId',site.id,'requestId',target.id,'outcome','needs_review','reason',reason)));
   if target.id is not null then
    select coalesce(extracted_payload->'manual_automation','{}') into automation from public.manual_inbound_messages where id=source.id;
    member:=coalesce(automation#>array['site_applications',target.id::text],'{}')||jsonb_build_object('status','needs_review','reason',reason);
    members:=coalesce(automation->'site_applications','{}')||jsonb_build_object(target.id::text,member);
    update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{manual_automation}',automation||jsonb_build_object('site_applications',members)) where id=source.id;
   end if;
  end if;
 end loop;
 summary:=jsonb_build_object('version',1,'parentRequestId',parent.id,'sourceHash',p_payload->>'sourceHash','appliedCount',applied_count,'reviewCount',review_count,'results',results);
 select coalesce(extracted_payload->'manual_automation','{}') into automation from public.manual_inbound_messages where id=source.id;
 update public.manual_inbound_messages set processing_state=case when applied_count>0 then 'applied' else 'needs_review' end,
  extracted_payload=jsonb_set(extracted_payload,'{manual_automation}',automation||jsonb_build_object('multi_site',summary)) where id=source.id;
 return summary||jsonb_build_object('ok',true,'alreadyApplied',false);
end $$;
revoke all on function public.gridex_apply_manual_multi_site_reply_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_apply_manual_multi_site_reply_v1(uuid,uuid,uuid,jsonb) to service_role;

-- A child's first real clarification is still part of the received parent
-- conversation. Serialize queue/claim with the parent hold writer on the same
-- child site; only the immutable protected source map establishes this link.
create or replace function public.gridex_guard_manual_multi_site_outbox_v2()
returns trigger language plpgsql security invoker set search_path=public as $$
declare r public.grid_owner_information_requests%rowtype;source public.manual_inbound_messages%rowtype;member jsonb;
begin
 if coalesce(new.external_delivery,false) is not true or new.status not in ('queued','sending') or new.request_id is null then return new; end if;
 select * into r from public.grid_owner_information_requests where id=new.request_id and company_id=new.company_id;
 if not found or r.request_type is distinct from 'current_supplier_contract_information_request' then return new; end if;
 select * into source from public.manual_inbound_messages i where i.id::text=r.parsed_payload->>'inbound_id'
   and i.company_id=r.company_id and i.customer_id=r.customer_id;
 if source.id is null then
   if r.metadata ? 'manual_multi_site_parent_request_id' then raise exception 'manual_multi_site_outbox_source_not_current' using errcode='23514'; end if;
   return new;
 end if;
 if source.request_id=r.id and source.customer_site_id=r.customer_site_id then return new; end if;
 member:=source.extracted_payload#>array['manual_automation','site_applications',r.id::text];
 if member is null and not (r.metadata ? 'manual_multi_site_parent_request_id') then return new; end if;
 perform 1 from public.customer_sites s where s.id=r.customer_site_id and s.company_id=r.company_id and s.customer_id=r.customer_id for share;
 if not found then raise exception 'manual_multi_site_outbox_source_not_current' using errcode='23514'; end if;
 -- Separate post-lock statement observes a hold committed while acquiring the
 -- site lock, instead of retaining an earlier queue-time authority snapshot.
 select * into r from public.grid_owner_information_requests where id=new.request_id and company_id=new.company_id;
 select * into source from public.manual_inbound_messages i where i.id::text=r.parsed_payload->>'inbound_id'
   and i.company_id=r.company_id and i.customer_id=r.customer_id;
 if source.id is null or source.processing_state is distinct from 'applied' or source.resolution_status is distinct from 'matched'
   or source.extracted_payload->'sender_credible' is distinct from 'true'::jsonb
   or source.extracted_payload#>>'{sender_verification,status}' is distinct from 'verified'
   or not public.gridex_manual_reply_source_matches_v2(to_jsonb(source),to_jsonb(r),false)
   or public.gridex_manual_reply_application_v2(to_jsonb(source),to_jsonb(r)) is distinct from r.parsed_payload
   then raise exception 'manual_multi_site_outbox_source_not_current' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function public.gridex_guard_manual_multi_site_outbox_v2() from public,anon,authenticated;
grant execute on function public.gridex_guard_manual_multi_site_outbox_v2() to service_role;
create or replace trigger manual_email_outbox_multi_site_source_tg
 before insert or update of status,external_delivery,request_id,company_id,to_email on public.manual_email_outbox
 for each row execute function public.gridex_guard_manual_multi_site_outbox_v2();
