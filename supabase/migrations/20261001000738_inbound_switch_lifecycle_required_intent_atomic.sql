-- Accepted/rejected switch lifecycle effects and required unsent intent share one
-- service-owned transaction. Original wire is authority; no historical ACK seal.
begin;
lock table public.ediel_messages in share row exclusive mode;

create table private.gridex_inbound_switch_received_sources (
  source_message_id uuid primary key,
  company_id uuid not null,
  environment text not null,
  message_family text not null check(message_family in ('PRODAT','APERAK','CONTRL')),
  message_code text,
  raw_payload text,
  payload_hash text,
  source_received_at timestamptz,
  sender_ediel_id text,
  receiver_ediel_id text,
  captured_at timestamptz not null default clock_timestamp(),
  check ((raw_payload is null and payload_hash is null) or
    (raw_payload is not null and payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex')))
);
alter table private.gridex_inbound_switch_received_sources enable row level security;
alter table private.gridex_inbound_switch_received_sources force row level security;
create policy inbound_switch_received_service_read on private.gridex_inbound_switch_received_sources
  for select to service_role using(true);
revoke all on private.gridex_inbound_switch_received_sources from public,anon,authenticated,service_role;
grant select on private.gridex_inbound_switch_received_sources to service_role;
create function private.gridex_capture_inbound_switch_received_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $function$
begin
  if tg_op<>'INSERT' or tg_table_schema<>'public' or tg_table_name<>'ediel_messages' then
    raise exception 'inbound_switch_received_capture_owner_required' using errcode='23514'; end if;
  if new.direction='inbound' and new.message_standard='edifact'
    and (new.message_family in ('APERAK','CONTRL') or (new.message_family='PRODAT' and new.message_code='Z04')) then
    -- Preserve ordinary legacy/raw receive writers, but do not manufacture
    -- this new owner's trusted evidence for them. Only actual SET ROLE service
    -- receive writes can later enter the new switch transaction.
    if current_setting('role',true) is distinct from 'service_role' then return new; end if;
    insert into private.gridex_inbound_switch_received_sources(source_message_id,company_id,environment,message_family,message_code,raw_payload,payload_hash,source_received_at,sender_ediel_id,receiver_ediel_id)
      values(new.id,new.company_id,new.environment,new.message_family,new.message_code,new.raw_payload,
        case when new.raw_payload is null then null else encode(sha256(convert_to(new.raw_payload,'UTF8')),'hex') end,
        new.message_received_at,new.sender_ediel_id,new.receiver_ediel_id);
  end if;
  return new;
end;
$function$;
revoke all on function private.gridex_capture_inbound_switch_received_v1() from public,anon,authenticated,service_role;
create trigger gridex_capture_inbound_switch_received_v1 after insert on public.ediel_messages
  for each row execute function private.gridex_capture_inbound_switch_received_v1();
create trigger gridex_inbound_switch_received_no_mutation before update or delete on private.gridex_inbound_switch_received_sources
  for each row execute function gridex_received_sources.reject_mutation();
create trigger gridex_inbound_switch_received_no_truncate before truncate on private.gridex_inbound_switch_received_sources
  for each statement execute function gridex_received_sources.reject_mutation();

-- Only a newly observed service dispatcher UPDATE can witness sent Z03.
-- No sent INSERT, historical backfill or caller-manufactured ledger entry.
create table private.gridex_inbound_switch_dispatch_sources (
  source_message_id uuid primary key,
  company_id uuid not null,
  environment text not null,
  switch_request_id uuid not null,
  customer_id uuid not null,
  site_id uuid not null,
  metering_point_id uuid not null,
  contract_id uuid not null,
  source_operation_id text not null,
  payload_hash text not null,
  source_sent_at timestamptz not null,
  captured_at timestamptz not null default clock_timestamp()
);
alter table private.gridex_inbound_switch_dispatch_sources enable row level security;
alter table private.gridex_inbound_switch_dispatch_sources force row level security;
create policy inbound_switch_dispatch_service_read on private.gridex_inbound_switch_dispatch_sources
  for select to service_role using(true);
revoke all on private.gridex_inbound_switch_dispatch_sources from public,anon,authenticated,service_role;
grant select on private.gridex_inbound_switch_dispatch_sources to service_role;
create function private.gridex_capture_inbound_switch_dispatch_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $function$
declare sw public.supplier_switch_requests%rowtype;
begin
  if tg_op<>'UPDATE' or tg_table_schema<>'public' or tg_table_name<>'ediel_messages' then
    raise exception 'inbound_switch_dispatch_capture_owner_required' using errcode='23514'; end if;
  if new.direction='outbound' and new.message_family='PRODAT' and new.message_code='Z03'
    and new.status='sent' and old.message_sent_at is null and new.message_sent_at is not null then
    -- SECURITY DEFINER changes current_user to this function's owner. The role
    -- GUC retains the caller's actual PostgreSQL SET ROLE, whose assignment is
    -- enforced by installed role membership; JWT/app flags are not authority.
    if current_setting('role',true) is distinct from 'service_role' then
      raise exception 'inbound_switch_dispatch_service_required' using errcode='42501'; end if;
    select * into sw from public.supplier_switch_requests where id=new.switch_request_id and company_id=new.company_id;
    if found and new.customer_id=sw.customer_id and new.site_id=coalesce(sw.customer_site_id,sw.site_id)
      and new.metering_point_id=sw.metering_point_id and coalesce(sw.customer_contract_id,sw.contract_id) is not null
      and not(sw.customer_contract_id is not null and sw.contract_id is not null and sw.customer_contract_id<>sw.contract_id)
      and new.canonical_rule_pack_id is not null and new.communication_route_id is not null and new.route_profile_id is not null
      and nullif(new.source_operation_id,'') is not null and new.raw_payload is not null
      and new.immutable_payload_hash=encode(sha256(convert_to(new.raw_payload,'UTF8')),'hex') then
      insert into private.gridex_inbound_switch_dispatch_sources(source_message_id,company_id,environment,switch_request_id,
        customer_id,site_id,metering_point_id,contract_id,source_operation_id,payload_hash,source_sent_at)
      values(new.id,new.company_id,new.environment,sw.id,sw.customer_id,coalesce(sw.customer_site_id,sw.site_id),
        sw.metering_point_id,coalesce(sw.customer_contract_id,sw.contract_id),new.source_operation_id,new.immutable_payload_hash,new.message_sent_at)
      on conflict(source_message_id) do nothing;
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.gridex_capture_inbound_switch_dispatch_v1() from public,anon,authenticated,service_role;
create trigger gridex_capture_inbound_switch_dispatch_v1 after update of status,message_sent_at on public.ediel_messages
  for each row execute function private.gridex_capture_inbound_switch_dispatch_v1();
create trigger gridex_inbound_switch_dispatch_no_mutation before update or delete on private.gridex_inbound_switch_dispatch_sources
  for each row execute function gridex_received_sources.reject_mutation();
create trigger gridex_inbound_switch_dispatch_no_truncate before truncate on private.gridex_inbound_switch_dispatch_sources
  for each statement execute function gridex_received_sources.reject_mutation();

-- Only a lexical facade: canonical bounded release-aware tokenizer stays its
-- existing owner. No grants on the original evidence parser change.
create function private.gridex_inbound_switch_wire_tokens_v1(p_raw text) returns jsonb
language sql immutable security definer set search_path=pg_catalog as $function$
  select gridex_received_sources.closure_wire_tokens_v1(p_raw);
$function$;
revoke all on function private.gridex_inbound_switch_wire_tokens_v1(text) from public,anon,authenticated;
grant execute on function private.gridex_inbound_switch_wire_tokens_v1(text) to service_role;

create table private.gridex_inbound_switch_lifecycle_receipts (
  source_message_id uuid primary key,
  company_id uuid not null,
  binding jsonb not null,
  result jsonb not null,
  committed_at timestamptz not null default clock_timestamp()
);
alter table private.gridex_inbound_switch_lifecycle_receipts enable row level security;
alter table private.gridex_inbound_switch_lifecycle_receipts force row level security;
create policy inbound_switch_receipt_service on private.gridex_inbound_switch_lifecycle_receipts
  for all to service_role using(true) with check(true);
revoke all on private.gridex_inbound_switch_lifecycle_receipts from public,anon,authenticated,service_role;
grant select,insert on private.gridex_inbound_switch_lifecycle_receipts to service_role;
create trigger gridex_inbound_switch_receipt_no_mutation before update or delete on private.gridex_inbound_switch_lifecycle_receipts
  for each row execute function gridex_received_sources.reject_mutation();
create trigger gridex_inbound_switch_receipt_no_truncate before truncate on private.gridex_inbound_switch_lifecycle_receipts
  for each statement execute function gridex_received_sources.reject_mutation();

create function private.gridex_apply_inbound_switch_lifecycle_v1(p_source_message_id uuid,p_actor_user_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog set timezone='UTC' as $function$
declare
  m public.ediel_messages%rowtype; origin public.ediel_messages%rowtype;
  sw public.supplier_switch_requests%rowtype; point public.metering_points%rowtype;
  agreement public.customer_contracts%rowtype; wf public.customer_application_workflows%rowtype;
  app public.website_customer_applications%rowtype;
  receipt private.gridex_inbound_switch_lifecycle_receipts%rowtype;
  dispatch private.gridex_inbound_switch_dispatch_sources%rowtype;
  outbound public.outbound_requests%rowtype;
  v_ack_outcome text; v_final_ack boolean; v_next_contrl text; v_next_aperak text;
  tokens jsonb; unb jsonb; unh jsonb; unt jsonb; unz jsonb; bgm jsonb; token jsonb;
  original_tokens jsonb; seal_hash text; sealed_raw text; n integer;
  v_site uuid; v_contract uuid; v_switch uuid; v_period uuid; v_case uuid; v_domain uuid;
  v_outcome text; v_title text; v_code text; v_template text; v_state text;
  v_reason text; v_start date; v_minute text; v_reference text; v_point_identity text;
  v_period_end date;
  v_operation uuid; v_key text; v_binding jsonb; v_metadata jsonb; v_payload jsonb;
  v_result jsonb; v_lifecycle jsonb; v_updated jsonb; v_event_id uuid; v_projection jsonb;
  v_event_type text; v_event_key text; v_workflow_key text; v_replayed boolean;
begin
  if current_user<>'service_role' then raise exception 'inbound_switch_service_required' using errcode='42501'; end if;
  if p_source_message_id is null then raise exception 'inbound_switch_source_required' using errcode='22023'; end if;
  select * into m from public.ediel_messages where id=p_source_message_id for update;
  if not found or m.direction is distinct from 'inbound' or m.message_standard is distinct from 'edifact'
    or m.company_id is null or m.message_family not in ('PRODAT','APERAK','CONTRL') then
    raise exception 'inbound_switch_source_scope_mismatch' using errcode='23503'; end if;

  if not exists(select 1 from private.gridex_inbound_switch_received_sources s
    where s.source_message_id=m.id and s.company_id=m.company_id and s.environment=m.environment
      and s.message_family=m.message_family and s.message_code is not distinct from m.message_code
      and s.source_received_at is not null and s.source_received_at=m.message_received_at
      and s.raw_payload is not distinct from m.raw_payload and s.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
      and s.sender_ediel_id is not distinct from m.sender_ediel_id and s.receiver_ediel_id is not distinct from m.receiver_ediel_id) then
    raise exception 'inbound_switch_trusted_receive_required' using errcode='23514'; end if;

  if m.message_family='PRODAT' then
    select s.raw_payload,s.payload_hash into sealed_raw,seal_hash from gridex_received_sources.sources s
      where s.source_message_id=m.id and s.company_id=m.company_id and s.environment=m.environment
        and s.message_code=m.message_code and s.origin='database_insert';
    if not found or m.immutable_payload_hash is distinct from seal_hash
      or m.execution_context_snapshot->'receivedProdatContext' is distinct from
        (select s.received_context from gridex_received_sources.sources s where s.source_message_id=m.id) then
      raise exception 'inbound_switch_sealed_source_required' using errcode='23514'; end if;
  else
    select s.raw_payload,s.payload_hash into sealed_raw,seal_hash from private.gridex_inbound_switch_received_sources s
      where s.source_message_id=m.id and s.company_id=m.company_id and s.environment=m.environment
        and s.message_family=m.message_family and s.message_code is not distinct from m.message_code
        and s.source_received_at is not null and s.source_received_at=m.message_received_at
        and s.sender_ediel_id is not distinct from m.sender_ediel_id and s.receiver_ediel_id is not distinct from m.receiver_ediel_id;
    if not found then raise exception 'inbound_switch_sealed_source_required' using errcode='23514'; end if;
  end if;
  if sealed_raw is null or seal_hash is null or m.raw_payload is distinct from sealed_raw
    or seal_hash is distinct from encode(sha256(convert_to(sealed_raw,'UTF8')),'hex') then
    raise exception 'inbound_switch_sealed_source_required' using errcode='23514'; end if;
  tokens:=private.gridex_inbound_switch_wire_tokens_v1(sealed_raw); n:=jsonb_array_length(tokens);
  if tokens is null or n<5 or
    exists(select 1 from unnest(array['UNB','UNH','UNT','UNZ']) tag
      where (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'=tag)<>1) then
    raise exception 'inbound_switch_wire_invalid' using errcode='23514'; end if;
  unb:=tokens->0; unh:=tokens->1; unt:=tokens->(n-2); unz:=tokens->(n-1);
  if unb->>'tag' is distinct from 'UNB' or unh->>'tag' is distinct from 'UNH'
    or unt->>'tag' is distinct from 'UNT' or unz->>'tag' is distinct from 'UNZ'
    or unh#>>'{elements,2,0}' is distinct from m.message_family
    or unb#>>'{elements,1,1}' is distinct from '3'
    or unt#>'{elements,1}' is distinct from jsonb_build_array((n-2)::text)
    or unt#>'{elements,2}' is distinct from unh#>'{elements,1}'
    or unz#>'{elements,1}' is distinct from '["1"]'::jsonb
    or unz#>'{elements,2}' is distinct from unb#>'{elements,5}' then
    raise exception 'inbound_switch_wire_invalid' using errcode='23514'; end if;

  v_switch:=m.switch_request_id;
  if m.message_family<>'PRODAT' then
    select * into origin from public.ediel_messages where id=m.related_message_id and company_id=m.company_id
      and direction='outbound' and message_family='PRODAT' and message_code='Z03';
    if not found or origin.switch_request_id is null or origin.switch_request_id is distinct from v_switch
      or origin.raw_payload is null or origin.immutable_payload_hash is distinct from
        encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex') then
      raise exception 'inbound_switch_ack_origin_mismatch' using errcode='23503'; end if;
    original_tokens:=private.gridex_inbound_switch_wire_tokens_v1(origin.raw_payload);
    if original_tokens is null then raise exception 'inbound_switch_ack_origin_mismatch' using errcode='23503'; end if;
    if m.message_family='APERAK' then
      select t into bgm from jsonb_array_elements(original_tokens) t where t->>'tag'='BGM';
      -- The originating source is PRODAT: preserve its canonical 16.B profile.
      -- UTILTS BGM312/313, missing ERC and contradictory whole-message results
      -- are never positive switch acknowledgements.
      if (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='BGM')<>1
        or not exists(select 1 from jsonb_array_elements(tokens) t where t->>'tag'='BGM' and t#>>'{elements,3,0}' in ('27','34'))
        or (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='ERC')=0
        or exists(select 1 from jsonb_array_elements(tokens) t where t->>'tag'='BGM' and t#>>'{elements,3,0}'='27')
          and exists(select 1 from jsonb_array_elements(tokens) t where t->>'tag'='ERC' and t#>>'{elements,1,0}'='100')
        or (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='RFF' and t#>>'{elements,1,0}'='ACW')<>1
        or not exists(select 1 from jsonb_array_elements(tokens) t where t->>'tag'='RFF'
          and t#>'{elements,1}'=jsonb_build_array('ACW',bgm#>>'{elements,2,0}'))
        or exists(select 1 from jsonb_array_elements(tokens) t where t->>'tag'='ERC'
          and (coalesce(t#>>'{elements,1,0}','') !~ '^[0-9]+$' or t#>>'{elements,1,2}' is distinct from '260')) then
        raise exception 'inbound_switch_ack_wire_invalid' using errcode='23514'; end if;
      v_ack_outcome:=case when exists(select 1 from jsonb_array_elements(tokens) t where t->>'tag'='ERC'
        and t#>>'{elements,1,0}'<>'100') then 'negative' else 'positive' end;
      v_outcome:=case v_ack_outcome when 'negative' then 'business_rejection' else 'ignored' end;
    else
      if (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='UCI')<>1
        or not exists(select 1 from jsonb_array_elements(tokens) t where t->>'tag'='UCI'
          and t#>'{elements,1}'=original_tokens->0#>'{elements,5}'
          and t#>'{elements,2}'=original_tokens->0#>'{elements,2}'
          and t#>'{elements,3}'=original_tokens->0#>'{elements,3}'
          and t#>>'{elements,4,0}' in ('4','1')) then
        raise exception 'inbound_switch_ack_wire_invalid' using errcode='23514'; end if;
      select case t#>>'{elements,4,0}' when '4' then 'negative' else 'positive' end into v_ack_outcome
        from jsonb_array_elements(tokens) t where t->>'tag'='UCI';
      v_outcome:=case v_ack_outcome when 'negative' then 'technical_rejection' else 'ignored' end;
    end if;
    if unb#>'{elements,2}' is distinct from original_tokens->0#>'{elements,3}'
      or unb#>'{elements,3}' is distinct from original_tokens->0#>'{elements,2}' then
      raise exception 'inbound_switch_ack_origin_mismatch' using errcode='23503'; end if;
  else
    if m.message_code is distinct from 'Z04'
      or (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='BGM')<>1
      or (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='LIN')<>1
      or (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='RFF' and t#>>'{elements,1,0}'='LI')<>1
      or (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='DTM' and t#>>'{elements,1,0}'='92')<>1
      or (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='CCI' and t#>'{elements,2}'='["Z13"]'::jsonb)<>1 then
      raise exception 'inbound_switch_wire_invalid' using errcode='23514'; end if;
    select t into bgm from jsonb_array_elements(tokens) t where t->>'tag'='BGM';
    if bgm#>'{elements,1}' is distinct from '["Z04"]'::jsonb
      or coalesce(bgm#>'{elements,3}','[""]'::jsonb) not in ('["9"]'::jsonb,'[""]'::jsonb) then
      raise exception 'inbound_switch_wire_invalid' using errcode='23514'; end if;
    select t into token from jsonb_array_elements(tokens) t where t->>'tag'='CCI' and t#>'{elements,2}'='["Z13"]'::jsonb;
    v_reason:=tokens->((token->>'index')::integer+1)#>>'{elements,1,0}';
    if tokens->((token->>'index')::integer+1)->>'tag' is distinct from 'CAV' or coalesce(v_reason,'') not in ('Z22','Z23') then
      raise exception 'inbound_switch_wire_invalid' using errcode='23514'; end if;
    select t#>>'{elements,1,1}' into v_minute from jsonb_array_elements(tokens) t where t->>'tag'='DTM' and t#>>'{elements,1,0}'='92';
    if v_minute is null or v_minute !~ '^[0-9]{12}$'
      or not exists(select 1 from jsonb_array_elements(tokens) t where t->>'tag'='DTM' and t#>>'{elements,1,0}'='92' and t#>>'{elements,1,2}'='203') then
      raise exception 'inbound_switch_start_date_required' using errcode='23514'; end if;
    -- make_timestamp rejects impossible calendar/time values, unlike to_date.
    v_start:=make_timestamp(substr(v_minute,1,4)::int,substr(v_minute,5,2)::int,substr(v_minute,7,2)::int,
      substr(v_minute,9,2)::int,substr(v_minute,11,2)::int,0)::date;
    select t#>>'{elements,1,1}' into v_reference from jsonb_array_elements(tokens) t where t->>'tag'='RFF' and t#>>'{elements,1,0}'='LI';
    select t#>>'{elements,3,0}' into v_point_identity from jsonb_array_elements(tokens) t where t->>'tag'='LIN';
    if not exists(select 1 from jsonb_array_elements(tokens) t where t->>'tag'='LIN' and t#>>'{elements,3,3}'='9') then
      raise exception 'inbound_switch_wire_invalid' using errcode='23514'; end if;
    v_outcome:='supplier_switch_accepted';
  end if;

  select * into sw from public.supplier_switch_requests where id=v_switch and company_id=m.company_id for update;
  if not found or sw.customer_id is null or sw.metering_point_id is null
    or (sw.site_id is not null and sw.customer_site_id is not null and sw.site_id<>sw.customer_site_id)
    or sw.grid_owner_id is null
    or (sw.contract_id is not null and sw.customer_contract_id is not null and sw.contract_id<>sw.customer_contract_id) then
    raise exception 'inbound_switch_resource_scope_mismatch' using errcode='23503'; end if;
  v_site:=coalesce(sw.customer_site_id,sw.site_id); v_contract:=coalesce(sw.customer_contract_id,sw.contract_id); v_operation:=sw.operation_id;
  if v_site is null or v_contract is null or m.customer_id is distinct from sw.customer_id
    or m.site_id is distinct from v_site or m.metering_point_id is distinct from sw.metering_point_id then
    raise exception 'inbound_switch_resource_scope_mismatch' using errcode='23503'; end if;
  perform 1 from public.companies where id=sw.company_id for share;
  if not found then raise exception 'inbound_switch_resource_scope_mismatch' using errcode='23503'; end if;
  perform 1 from public.customers where id=sw.customer_id and company_id=sw.company_id for share;
  if not found then raise exception 'inbound_switch_resource_scope_mismatch' using errcode='23503'; end if;
  perform 1 from public.customer_sites where id=v_site and company_id=sw.company_id and customer_id=sw.customer_id
    and grid_owner_id=sw.grid_owner_id for share;
  if not found then raise exception 'inbound_switch_resource_scope_mismatch' using errcode='23503'; end if;
  select * into point from public.metering_points where id=sw.metering_point_id and company_id=sw.company_id and customer_id=sw.customer_id for update;
  if not found or (point.site_id is not null and point.customer_site_id is not null and point.site_id<>point.customer_site_id)
    or coalesce(point.customer_site_id,point.site_id) is distinct from v_site
    or point.grid_owner_id is distinct from sw.grid_owner_id
    or (point.meter_point_id is not null and point.metering_point_id is not null and point.meter_point_id<>point.metering_point_id) then
    raise exception 'inbound_switch_resource_scope_mismatch' using errcode='23503'; end if;
  perform 1 from public.grid_owners where id=sw.grid_owner_id and (company_id is null or company_id=sw.company_id)
    and ediel_id=sw.grid_owner_ediel_id and is_active and lifecycle_status='active' for share;
  if not found then raise exception 'inbound_switch_resource_scope_mismatch' using errcode='23503'; end if;
  select * into agreement from public.customer_contracts where id=v_contract and company_id=sw.company_id and customer_id=sw.customer_id for share;
  if not found or (agreement.site_id is not null and agreement.customer_site_id is not null and agreement.site_id<>agreement.customer_site_id)
    or coalesce(agreement.customer_site_id,agreement.site_id) is distinct from v_site or agreement.metering_point_id is distinct from point.id then
    raise exception 'inbound_switch_resource_scope_mismatch' using errcode='23503'; end if;
  if m.message_family='PRODAT' then
    -- Acceptance is bound to the actual immutable originating Z03 as well as
    -- exact LI/facility and current resource aliases. Caller switch IDs do not
    -- establish that the received original belonged to this market change.
    select * into origin from public.ediel_messages where id=sw.outbound_z03_message_id
      and company_id=sw.company_id and environment=m.environment and direction='outbound'
      and message_family='PRODAT' and message_code='Z03' and switch_request_id=sw.id for share;
    if not found or origin.raw_payload is null or origin.immutable_payload_hash is distinct from
      encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex') then
      raise exception 'inbound_switch_origin_mismatch' using errcode='23503'; end if;
    original_tokens:=private.gridex_inbound_switch_wire_tokens_v1(origin.raw_payload);
    if original_tokens is null or v_reference is null or v_reference is distinct from sw.rff_li_reference
      or v_point_identity is distinct from coalesce(point.meter_point_id,point.metering_point_id)
      or unb#>>'{elements,2,0}' is distinct from sw.grid_owner_ediel_id
      or (sw.z03_variant is not null and sw.z03_variant is distinct from case v_reason when 'Z22' then 'L' else 'LK' end)
      or (select count(*) from jsonb_array_elements(original_tokens) t where t->>'tag'='RFF' and t#>>'{elements,1,0}'='LI'
        and t#>>'{elements,1,1}'=v_reference)<>1
      or (select count(*) from jsonb_array_elements(original_tokens) t where t->>'tag'='LIN'
        and t#>>'{elements,3,0}'=v_point_identity and t#>>'{elements,3,3}'='9')<>1
      or unb#>'{elements,2}' is distinct from original_tokens->0#>'{elements,3}'
      or unb#>'{elements,3}' is distinct from original_tokens->0#>'{elements,2}'
      or (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='NAD' and t#>>'{elements,1,0}'='FR')<>1
      or (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='NAD' and t#>>'{elements,1,0}'='DO')<>1
      or (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='NAD' and t#>>'{elements,1,0}'='FR'
        and t#>'{elements,2}'=jsonb_build_array(sw.grid_owner_ediel_id,'160','SVK'))<>1
      or (select count(*) from jsonb_array_elements(tokens) t where t->>'tag'='NAD' and t#>>'{elements,1,0}'='DO'
        and t#>'{elements,2}'=jsonb_build_array(original_tokens->0#>>'{elements,2,0}','160','SVK'))<>1 then
      raise exception 'inbound_switch_source_correlation_mismatch' using errcode='23503'; end if;
  end if;
  if origin.customer_id is distinct from sw.customer_id or origin.site_id is distinct from v_site
    or origin.metering_point_id is distinct from point.id or sw.outbound_z03_message_id is distinct from origin.id
    or origin.environment is distinct from m.environment then
    raise exception 'inbound_switch_origin_mismatch' using errcode='23503'; end if;

  select * into origin from public.ediel_messages where id=origin.id and company_id=sw.company_id for update;
  select * into dispatch from private.gridex_inbound_switch_dispatch_sources where source_message_id=origin.id;
  if not found or origin.message_sent_at is null or dispatch.source_sent_at is distinct from origin.message_sent_at
    or dispatch.company_id is distinct from sw.company_id or dispatch.environment is distinct from m.environment
    or dispatch.switch_request_id is distinct from sw.id or dispatch.customer_id is distinct from sw.customer_id
    or dispatch.site_id is distinct from v_site or dispatch.metering_point_id is distinct from point.id
    or dispatch.contract_id is distinct from v_contract or dispatch.source_operation_id is distinct from origin.source_operation_id
    or dispatch.payload_hash is distinct from origin.immutable_payload_hash then
    raise exception 'inbound_switch_origin_unsent' using errcode='23514'; end if;
  select * into receipt from private.gridex_inbound_switch_lifecycle_receipts where source_message_id=m.id;
  v_replayed:=found;
  if origin.status<>'sent' then
    if origin.status='acknowledged' and exists(select 1 from private.gridex_inbound_switch_lifecycle_receipts r
      where r.company_id=sw.company_id and r.binding->>'origin_message_id'=origin.id::text
        and r.binding->>'origin_hash'=dispatch.payload_hash and r.binding->>'origin_sent_at'=dispatch.source_sent_at::text
        and r.result->>'ackOutcome'='positive' and r.result->>'finalAckReached'='true') then
      null;
    elsif m.message_family<>'PRODAT' and v_replayed and origin.status='failed'
      and receipt.result->>'ackOutcome'='negative' then null;
    else raise exception 'inbound_switch_origin_unsent' using errcode='23514'; end if;
  end if;

  -- Rebind the exact original workflow on replay, including legitimate terminal
  -- state. A receipt chooses its committed row; it never establishes ownership.
  if v_replayed then
    select * into wf from public.customer_application_workflows where id=nullif(receipt.binding->>'workflow_id','')::uuid
      and company_id=sw.company_id for update;
    if nullif(receipt.binding->>'workflow_id','') is not null and not found then
      raise exception 'inbound_switch_workflow_scope_mismatch' using errcode='23503'; end if;
  else
    if (select count(*) from public.customer_application_workflows w where w.company_id=sw.company_id and
      ((v_operation is not null and w.operation_id=v_operation) or
       (v_operation is null and w.customer_id=sw.customer_id and w.customer_site_id=v_site and w.state not in ('completed','cancelled','failed'))))>1 then
      raise exception 'inbound_switch_workflow_ambiguous' using errcode='23514'; end if;
    select * into wf from public.customer_application_workflows w where w.company_id=sw.company_id and
      ((v_operation is not null and w.operation_id=v_operation) or
       (v_operation is null and w.customer_id=sw.customer_id and w.customer_site_id=v_site and w.state not in ('completed','cancelled','failed'))) for update;
  end if;
  if wf.id is not null then
    if wf.customer_id is distinct from sw.customer_id or wf.customer_site_id is distinct from v_site
      or (v_operation is not null and wf.operation_id is distinct from v_operation)
      or (wf.metering_point_id is not null and wf.metering_point_id<>point.id)
      or (wf.contract_id is not null and wf.contract_id<>v_contract) then
      raise exception 'inbound_switch_workflow_scope_mismatch' using errcode='23503'; end if;
    select * into app from public.website_customer_applications where id=wf.customer_application_id
      and company_id=sw.company_id and customer_id=sw.customer_id for share;
    if not found or (app.customer_site_id is not null and app.customer_site_id<>v_site)
      or (app.metering_point_id is not null and app.metering_point_id<>point.id)
      or (app.contract_id is not null and app.contract_id<>v_contract) then
      raise exception 'inbound_switch_workflow_scope_mismatch' using errcode='23503'; end if;
  end if;

  v_key:='ediel:'||m.id||':'||v_outcome;
  v_binding:=jsonb_build_object('source_message_id',m.id,'source_hash',seal_hash,'message_family',m.message_family,
    'message_code',m.message_code,'company_id',sw.company_id,'environment',m.environment,'customer_id',sw.customer_id,
    'site_id',v_site,'metering_point_id',point.id,'contract_id',v_contract,'switch_request_id',sw.id,
    'operation_id',v_operation,'actor_user_id',p_actor_user_id,'outcome',v_outcome,'start_date',v_start,
    'workflow_id',wf.id,'application_id',wf.customer_application_id,'origin_message_id',origin.id,
    'origin_hash',dispatch.payload_hash,'origin_sent_at',dispatch.source_sent_at::text);
  if v_replayed then
    if receipt.company_id is distinct from sw.company_id or receipt.binding is distinct from v_binding then
      raise exception 'inbound_switch_idempotency_conflict' using errcode='23505'; end if;
    -- Every replay revalidates sealed bytes/current graph above; terminal business
    -- and worker rows remain unchanged. No receipt is a source authority shortcut.
    return receipt.result||jsonb_build_object('replayed',true);
  end if;
  if sw.status not in ('queued','prepared','submitted','sent','waiting_response','acknowledged') or sw.lifecycle_blocked then
    raise exception 'inbound_switch_current_state_conflict' using errcode='23514'; end if;
  v_title:=case v_outcome when 'ignored' then 'Teknisk kvittens mottagen; affärsbekräftelse inväntas.' when 'supplier_switch_accepted' then 'Leverantörsbytet är bekräftat av nätägaren.'
    when 'business_rejection' then 'Mottagaren har avvisat meddelandet. Åtgärd krävs.'
    else 'Meddelandet har tekniskt formatfel. Plattformsadministratör behöver granska.' end;
  v_state:=case when v_outcome='supplier_switch_accepted' then 'switch_confirmed' else 'switch_rejected' end;
  v_code:=case when v_outcome='supplier_switch_accepted' then 'supplier_switch.accepted' else 'supplier_switch.rejected' end;
  v_template:=case when v_outcome='supplier_switch_accepted' then 'switch.confirmed' else 'switch.action_required' end;
  v_updated:=case when v_outcome='ignored' then '[]'::jsonb else '["supplier_switch_requests"]'::jsonb end;
  if m.message_family<>'PRODAT' then
    v_next_contrl:=case when m.message_family='CONTRL' then case v_ack_outcome when 'positive' then 'received' else 'failed' end else origin.contrl_status end;
    v_next_aperak:=case when m.message_family='APERAK' then case v_ack_outcome when 'positive' then 'received' else 'failed' end else origin.aperak_status end;
    v_final_ack:=v_ack_outcome='positive' and
      (not coalesce(origin.requires_contrl,false) or coalesce(v_next_contrl,'') in ('received','sent','not_required')) and
      (not coalesce(origin.requires_aperak,false) or coalesce(v_next_aperak,'') in ('received','sent','not_required')) and
      coalesce(origin.utilts_err_status,'')<>'pending';
    update public.ediel_messages set contrl_status=v_next_contrl,aperak_status=v_next_aperak,
      status=case when v_ack_outcome='negative' then 'failed' when v_final_ack then 'acknowledged' else status end,
      failure_reason=case when v_ack_outcome='negative' then v_title else failure_reason end,
      failed_at=case when v_ack_outcome='negative' then clock_timestamp() else failed_at end,
      acknowledged_at=case when v_final_ack then clock_timestamp() else acknowledged_at end,
      ack_due_at=case when v_ack_outcome='negative' or v_final_ack then null else ack_due_at end,
      updated_by=p_actor_user_id,updated_at=clock_timestamp() where id=origin.id;
    update public.ediel_messages set status=case v_ack_outcome when 'negative' then 'failed' else 'validated' end,
      ack_outcome=v_ack_outcome,related_message_id=origin.id,switch_request_id=sw.id,outbound_request_id=origin.outbound_request_id,
      customer_id=sw.customer_id,site_id=v_site,metering_point_id=point.id,grid_owner_id=sw.grid_owner_id,
      parsed_payload=coalesce(parsed_payload,'{}'::jsonb)||jsonb_build_object('ackOutcome',v_ack_outcome),
      validation_report=coalesce(validation_report,'{}'::jsonb)||jsonb_build_object('ackOutcome',v_ack_outcome,
        'matchedOutboundEdielMessageId',origin.id,'finalAckReached',v_final_ack),
      failure_reason=case when v_ack_outcome='negative' then v_title else null end,validated_at=clock_timestamp(),
      updated_by=p_actor_user_id,updated_at=clock_timestamp() where id=m.id;
    if not exists(select 1 from public.ediel_ack_chains where company_id=sw.company_id and source_message_id=origin.id
      and ack_family=m.message_family and ack_scope='message' and outcome=v_ack_outcome and transaction_reference is null) then
      insert into public.ediel_ack_chains(company_id,source_message_id,ack_message_id,ack_family,ack_scope,outcome)
        values(sw.company_id,origin.id,m.id,m.message_family,'message',v_ack_outcome);
    end if;
    if origin.outbound_request_id is not null then
      select * into outbound from public.outbound_requests where id=origin.outbound_request_id and company_id=sw.company_id for update;
      if not found or outbound.source_type is distinct from 'supplier_switch_request' or outbound.source_id is distinct from sw.id
        or outbound.customer_id is distinct from sw.customer_id or outbound.site_id is distinct from v_site
        or outbound.metering_point_id is distinct from point.id or outbound.sent_at is null
        or outbound.status not in ('sent','acknowledged') then
        raise exception 'inbound_switch_outbound_scope_mismatch' using errcode='23503'; end if;
      if v_ack_outcome='negative' or v_final_ack then
        update public.outbound_requests set status=case when v_ack_outcome='negative' then 'failed' else 'acknowledged' end,
          failed_at=case when v_ack_outcome='negative' then clock_timestamp() else failed_at end,
          acknowledged_at=case when v_final_ack then clock_timestamp() else acknowledged_at end,
          failure_reason=case when v_ack_outcome='negative' then v_title else null end,
          response_payload=coalesce(response_payload,'{}'::jsonb)||jsonb_build_object('inboundAckMessageId',m.id,
            'inboundAckFamily',m.message_family,'inboundAckOutcome',v_ack_outcome,'acknowledgedVia','inbound_ediel_ack'),
          updated_by=p_actor_user_id,updated_at=clock_timestamp() where id=outbound.id;
        insert into public.outbound_dispatch_events(company_id,outbound_request_id,event_type,event_status,message,payload,created_by)
          values(sw.company_id,outbound.id,case when v_ack_outcome='negative' then 'failed' else 'acknowledged' end,
            case when v_ack_outcome='negative' then 'failed' else 'acknowledged' end,v_title,
            jsonb_build_object('sourceEdielMessageId',origin.id,'ackEdielMessageId',m.id),p_actor_user_id);
      end if;
    end if;
    if v_final_ack and sw.status in ('queued','prepared') then
      v_updated:=v_updated||'["supplier_switch_requests"]'::jsonb;
      update public.supplier_switch_requests set status='submitted',updated_at=clock_timestamp() where id=sw.id;
    end if;
    insert into public.supplier_switch_events(company_id,switch_request_id,event_type,event_status,message,payload,created_by)
      values(sw.company_id,sw.id,'ediel_ack_received',case when v_ack_outcome='negative' then 'failed' when v_final_ack then 'submitted' else 'success' end,
        v_title,jsonb_build_object('sourceEdielMessageId',origin.id,'ackEdielMessageId',m.id,'outboundRequestId',origin.outbound_request_id,
          'outcome',v_ack_outcome,'finalAckReached',v_final_ack),p_actor_user_id);
    insert into public.ediel_message_events(company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
      select sw.company_id,message_id,message_id,case m.message_family when 'CONTRL' then 'contrl_received' else 'aperak_received' end,
        case v_ack_outcome when 'negative' then 'error' else 'success' end,v_title,
        jsonb_build_object('sourceEdielMessageId',origin.id,'ackEdielMessageId',m.id,'ackFamily',m.message_family,
          'ackOutcome',v_ack_outcome,'finalAckReached',v_final_ack),
        jsonb_build_object('sourceEdielMessageId',origin.id,'ackEdielMessageId',m.id,'ackFamily',m.message_family,
          'ackOutcome',v_ack_outcome,'finalAckReached',v_final_ack),p_actor_user_id
      from unnest(array[origin.id,m.id]) message_id;
    v_updated:=v_updated||'["ediel_messages","ediel_ack_chains","supplier_switch_events"]'::jsonb;
  end if;
  if v_outcome='ignored' then
    null; -- Technical ACK never becomes business acceptance or supply activation.
  elsif v_outcome='supplier_switch_accepted' then
    update public.supplier_switch_requests set status='accepted',inbound_z04_message_id=m.id,confirmed_start_date=v_start,
      external_reference=coalesce(m.external_reference,external_reference),updated_at=clock_timestamp() where id=sw.id;
    -- An overlapping period for another contract/switch is a conflict, not a row
    -- to overwrite by broad customer/point lookup. Never reactivate active/ended.
    if (select count(*) from public.customer_supply_periods where company_id=sw.company_id and customer_id=sw.customer_id
      and metering_point_id=point.id and start_date=v_start and coalesce(customer_contract_id,contract_id)=v_contract
      and (source_switch_request_id is null or source_switch_request_id=sw.id) and status in ('pending','confirmed_by_grid_owner'))>1 then
      raise exception 'inbound_switch_supply_period_ambiguous' using errcode='23514'; end if;
    if exists(select 1 from public.customer_supply_periods where company_id=sw.company_id and customer_id=sw.customer_id
      and metering_point_id=point.id and start_date=v_start and (customer_contract_id=v_contract or contract_id=v_contract)
      and customer_contract_id is not null and contract_id is not null and customer_contract_id<>contract_id) then
      raise exception 'inbound_switch_resource_scope_mismatch' using errcode='23503'; end if;
    select id,end_date into v_period,v_period_end from public.customer_supply_periods where company_id=sw.company_id and customer_id=sw.customer_id
      and metering_point_id=point.id and start_date=v_start and coalesce(customer_contract_id,contract_id)=v_contract
      and (source_switch_request_id is null or source_switch_request_id=sw.id) and status in ('pending','confirmed_by_grid_owner') for update;
    if exists(select 1 from public.customer_supply_periods where company_id=sw.company_id and metering_point_id=point.id
      and id is distinct from v_period and start_date<=coalesce(v_period_end,'infinity'::date)
      and (end_date is null or end_date>=v_start) and status in ('active','confirmed_by_grid_owner','pending')) then
      raise exception 'inbound_switch_supply_period_conflict' using errcode='23514'; end if;
    if v_period is not null then
      update public.customer_supply_periods set status='confirmed_by_grid_owner',source_message_id=m.id,
        source_switch_request_id=sw.id,updated_at=clock_timestamp() where id=v_period;
    else
      insert into public.customer_supply_periods(company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,
        source,source_process,source_message_id,source_switch_request_id,status)
      values(sw.company_id,sw.customer_id,point.id,v_contract,v_contract,v_start,'ediel_inbound_state_machine','supplier_switch',m.id,sw.id,'confirmed_by_grid_owner') returning id into v_period;
    end if;
    v_updated:=v_updated||'["customer_supply_periods"]'::jsonb;
  else
    update public.supplier_switch_requests set status='failed',failed_at=clock_timestamp(),failure_reason=v_title,
      rejection_reason_text=v_title,updated_at=clock_timestamp() where id=sw.id;
    insert into public.customer_cases(company_id,customer_id,site_id,metering_point_id,customer_contract_id,supplier_switch_request_id,
      case_type,status,priority,title,description,reason_category,source,source_ediel_message_id,metadata)
      values(sw.company_id,sw.customer_id,v_site,point.id,v_contract,sw.id,v_outcome,'open',
        case when v_outcome='technical_rejection' then 'high' else 'normal' end,v_title,v_title,'ediel_inbound_review',
        'ediel_inbound_state_machine',m.id,jsonb_build_object('source_ediel_message_id',m.id,'message_family',m.message_family,
          'message_code',m.message_code,'source_payload_hash',seal_hash)) returning id into v_case;
    v_updated:=v_updated||'["customer_cases"]'::jsonb;
  end if;

  v_metadata:=jsonb_build_object('companyId',sw.company_id,'messageFamily',m.message_family,'messageCode',m.message_code,
    'matchedSwitchRequestId',sw.id,'customerInfoRequestId',null,'source','sealed_inbound_switch_lifecycle',
    'prodatProcess',case when m.message_family='PRODAT' then 'supplier_switch' end,
    'prodatSubtype',case when m.message_family='PRODAT' then case v_reason when 'Z22' then 'L' else 'LK' end end,
    'prodatState',case when m.message_family='PRODAT' then 'switch_accepted' end);
  v_payload:=jsonb_build_object('ediel_message_id',m.id,'supplier_switch_request_id',sw.id,'outcome',v_outcome)||v_metadata;
  if v_outcome<>'ignored' then
  insert into public.ediel_message_events(company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
    values(sw.company_id,m.id,m.id,'manual_note',case when v_outcome='supplier_switch_accepted' then 'success' else 'warning' end,v_title,
      jsonb_build_object('businessStateMachine',true,'outcome',v_outcome,'tenantMessage',v_title,'updated',v_updated,
        'reviewRequired',v_outcome<>'supplier_switch_accepted')||v_metadata,
      jsonb_build_object('businessStateMachine',true,'outcome',v_outcome,'tenantMessage',v_title,'updated',v_updated,
        'reviewRequired',v_outcome<>'supplier_switch_accepted')||v_metadata,p_actor_user_id) returning id into v_event_id;
  end if;

  if v_outcome<>'ignored' and wf.id is not null and wf.state not in ('completed','cancelled','failed') then
    v_workflow_key:='workflow.ediel:'||m.id||':'||v_outcome;
    perform public.gridex_transition_customer_application_workflow(sw.company_id,wf.customer_application_id,v_state,
      'workflow.ediel.'||v_outcome,case when v_state='switch_rejected' then v_outcome end,
      jsonb_build_object('next_action',v_state,'ediel_message_id',m.id,'supplier_switch_request_id',sw.id,'inbound_outcome',v_outcome),
      null,null,v_workflow_key);
    v_projection:=jsonb_build_object('next_action',v_state,'ediel_message_id',m.id,'supplier_switch_request_id',sw.id,'inbound_outcome',v_outcome,
      'application_number',nullif(btrim(app.application_number),''),'customer_number',nullif(btrim(app.customer_number),''),
      'customer_reference',nullif(btrim(app.external_customer_id),''),'contract_number',nullif(btrim(app.contract_number),''),
      'status',case when v_state='switch_rejected' then 'failed' else 'processing' end,'workflow_state',v_state,
      'next_step',nullif(btrim(app.next_step),''),'reason_code',case when v_state='switch_rejected' then v_outcome end,
      'event_code','workflow.ediel.'||v_outcome);
    foreach v_event_type in array array['customer_application.status_changed','supplier_switch.updated'] loop
      v_event_key:=case v_event_type when 'customer_application.status_changed' then 'customer-application-status:' else 'supplier-switch-status:' end
        ||sw.company_id||':'||app.id||':'||v_workflow_key;
      insert into public.domain_events(company_id,event_type,aggregate_type,aggregate_id,subject_customer_id,actor_user_id,source,payload,idempotency_key)
        values(sw.company_id,v_event_type,'website_customer_application',app.id,sw.customer_id,null,'customer_application_workflow',
          v_projection||case when v_event_type='supplier_switch.updated' then jsonb_build_object('supplier_switch_status',v_state) else '{}'::jsonb end,v_event_key)
        returning id into v_domain;
      insert into public.event_outbox(company_id,domain_event_id,destination_type,destination_key,status,attempts,max_attempts,available_at,payload)
        values(sw.company_id,v_domain,'webhook','webhook_fanout_v1','queued',0,12,clock_timestamp(),
          jsonb_build_object('event_type',v_event_type,'aggregate_type','website_customer_application','aggregate_id',app.id));
    end loop;
    v_updated:=v_updated||'["customer_application_workflows"]'::jsonb;
  end if;

  -- Actual previously-qualified lifecycle owner inserts the REQUIRED final
  -- unsent notification job last. Its exception rolls every business effect back.
  if v_outcome<>'ignored' then
  v_lifecycle:=private.gridex_record_customer_operation_event_v1(jsonb_build_object(
    'company_id',sw.company_id,'customer_id',sw.customer_id,'customer_site_id',v_site,'metering_point_id',point.id,'contract_id',v_contract,
    'customer_operation_job_id',null,'operation_id',v_operation,'actor_user_id',p_actor_user_id,
    'aggregate_type','customer_site','aggregate_id',v_site,'event_code',v_code,'title',v_title,'message',v_title,
    'status',case when v_outcome='supplier_switch_accepted' then 'waiting_response' else 'needs_review' end,
    'severity',case when v_outcome='supplier_switch_accepted' then 'info' else 'warning' end,
    'action_required',v_outcome<>'supplier_switch_accepted','action_url',null,'source','ediel_inbound_state_machine','visibility','tenant',
    'payload',v_payload,'idempotency_key',v_key,'source_event_id',v_key,'notification_template',v_template));
  end if;
  v_result:=jsonb_build_object('outcome',v_outcome,'tenantMessage',v_title,'reviewRequired',v_outcome in ('business_rejection','technical_rejection'),
    'updated',v_updated,'metadata',v_metadata,'switchRequestId',sw.id,'supplyPeriodId',v_period,'caseId',v_case,
    'edielEventId',v_event_id,'lifecycleReceipt',v_lifecycle,'replayed',false,'ackOutcome',v_ack_outcome,
    'finalAckReached',v_final_ack,'sourceMessageId',origin.id,'outboundRequestId',origin.outbound_request_id);
  insert into private.gridex_inbound_switch_lifecycle_receipts(source_message_id,company_id,binding,result)
    values(m.id,sw.company_id,v_binding,v_result);
  return v_result;
end;
$function$;
revoke all on function private.gridex_apply_inbound_switch_lifecycle_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function private.gridex_apply_inbound_switch_lifecycle_v1(uuid,uuid) to service_role;
create function public.gridex_apply_inbound_switch_lifecycle_v1(p_source_message_id uuid,p_actor_user_id uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
  select private.gridex_apply_inbound_switch_lifecycle_v1(p_source_message_id,p_actor_user_id);
$function$;
revoke all on function public.gridex_apply_inbound_switch_lifecycle_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.gridex_apply_inbound_switch_lifecycle_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
