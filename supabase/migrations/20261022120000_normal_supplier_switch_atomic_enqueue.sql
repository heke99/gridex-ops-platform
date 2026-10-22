-- Source-only coordinator: qualify with the existing native/GEN producer before
-- consumer integration. It cannot originate wire, reserve or enter transport.
-- A prebound native original is mandatory, including in test environments.
create function public.gridex_enqueue_normal_supplier_switch_v1(
  p_company_id uuid, p_switch_id uuid, p_intent_id uuid, p_message_id uuid,
  p_outbound_request_id uuid, p_actor_user_id uuid, p_expected_payload_hash text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  m public.ediel_messages%rowtype;
  s public.supplier_switch_requests%rowtype;
  i public.ediel_message_intents%rowtype;
  r public.outbound_requests%rowtype;
  c public.customer_contracts%rowtype;
  original gridex_received_sources.switch_originals%rowtype;
  q public.ediel_outbox%rowtype;
  candidate public.ediel_outbox%rowtype;
  queue_count integer := 0;
  projection jsonb;
  repaired jsonb;
  held jsonb := jsonb_build_object('status','held','authorizesProviderEntry',false,'deliveryProven',false);
  lock_key_expected text;
  has_history boolean;
  subtype text;
  reason text;
  result jsonb;
begin
  if p_company_id is null or p_actor_user_id is null then
    raise exception using errcode='42501', message='normal_switch_enqueue_actor_required';
  end if;
  -- Use the same authorization/source graph order as native transport/binding.
  -- These are existing qualified owners, not weaker copies of their guards.
  perform gridex_ediel_ack_replay.lock_current_graph_v2();
  perform gridex_bilateral_prodat.lock_source_receipts_v1();
  perform gridex_bilateral_prodat.lock_outbound_v1();
  if not exists(select from public.user_profiles where id=p_actor_user_id and user_status='active')
    or not exists(select from public.company_memberships where company_id=p_company_id and user_id=p_actor_user_id
      and status='active' and is_active is true and accepted_at is not null)
    or public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write') is distinct from true then
    raise exception using errcode='42501', message='normal_switch_enqueue_actor_required';
  end if;
  if p_switch_id is null or p_intent_id is null or p_message_id is null or p_outbound_request_id is null
    or (p_expected_payload_hash ~ '^[0-9a-f]{64}$') is not true then
    return held || jsonb_build_object('reason','invalid_original_identity');
  end if;

  -- NOWAIT refuses an inverse outbox-claim lock race; no partial status writes
  -- precede locks. A real multi-session native qualification remains required.
  select * into m from public.ediel_messages where id=p_message_id and company_id=p_company_id for update nowait;
  if not found then return held || jsonb_build_object('reason','original_unavailable'); end if;
  select * into original from gridex_received_sources.switch_originals where message_id=m.id for share nowait;
  if not found or original.company_id is distinct from p_company_id or original.switch_id is distinct from p_switch_id
    or original.intent_id is distinct from p_intent_id or original.outbound_request_id is distinct from p_outbound_request_id
    or original.payload_hash is distinct from p_expected_payload_hash or original.recovery_operation_id is not null then
    return held || jsonb_build_object('reason','native_original_required');
  end if;
  select * into s from public.supplier_switch_requests where id=p_switch_id and company_id=p_company_id for share nowait;
  if not found then return held || jsonb_build_object('reason','current_switch_required'); end if;
  select * into i from public.ediel_message_intents where id=p_intent_id and company_id=p_company_id for update nowait;
  if not found then return held || jsonb_build_object('reason','current_intent_required'); end if;
  select * into r from public.outbound_requests where id=p_outbound_request_id and company_id=p_company_id for update nowait;
  if not found then return held || jsonb_build_object('reason','current_outbound_required'); end if;
  select * into c from public.customer_contracts where id=original.contract_id and company_id=p_company_id for share nowait;
  if not found then return held || jsonb_build_object('reason','current_contract_required'); end if;
  subtype := case when s.request_type='move_in' then 'LK' else s.prodat_variant end;
  reason := case subtype when 'L' then 'Z22' when 'LK' then 'Z23' when 'H' then 'Z25' end;
  if s.customer_id is null or coalesce(s.site_id,s.customer_site_id) is null or s.metering_point_id is null
    or s.requested_start_date is null or (s.request_type in ('switch','move_in')) is not true
    or (subtype in ('L','LK','H')) is not true or s.prodat_variant is distinct from subtype or s.prodat_reason is distinct from reason
    or s.lifecycle_blocked is distinct from false or s.lifecycle_block_id is not null or s.paused_at is not null
    or (s.status in ('draft','ready','ready_for_switch','ready_for_z03','z03_ready','validated','prepared','queued','waiting','waiting_response')) is not true
    or s.outbound_z03_message_id is distinct from m.id or s.inbound_z04_message_id is not null
    or (s.site_id is not null and s.site_id is distinct from m.site_id)
    or (s.customer_site_id is not null and s.customer_site_id is distinct from m.site_id)
    or (s.contract_id is not null and s.contract_id is distinct from c.id)
    or (s.customer_contract_id is not null and s.customer_contract_id is distinct from c.id)
    or coalesce(s.customer_contract_id,s.contract_id) is distinct from c.id
    or c.customer_id is distinct from s.customer_id or c.metering_point_id is distinct from s.metering_point_id
    or (c.status in ('signed','active')) is not true or c.signed_at is null or nullif(btrim(c.signed_version),'') is null
    or (original.contract_hash ~ '^[0-9a-f]{64}$') is not true
    or gridex_received_sources.production_contract_hash_v1(c) is distinct from original.contract_hash
    or m.direction is distinct from 'outbound' or m.message_standard is distinct from 'edifact'
    or m.message_family is distinct from 'PRODAT' or m.message_code is distinct from 'Z03'
    or (m.environment in ('test','production')) is not true
    or m.switch_request_id is distinct from s.id or m.source_operation_id is distinct from s.id::text
    or m.customer_id is distinct from s.customer_id or m.site_id is distinct from coalesce(s.site_id,s.customer_site_id)
    or m.metering_point_id is distinct from s.metering_point_id
    or m.intent_id is distinct from i.id or m.outbound_request_id is distinct from r.id
    or m.immutable_rendered_at is null or m.immutable_payload_hash is distinct from p_expected_payload_hash
    or m.raw_payload is null or encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') is distinct from p_expected_payload_hash
    or i.environment is distinct from m.environment or i.direction is distinct from m.direction
    or i.message_family is distinct from m.message_family or i.message_code is distinct from m.message_code
    or i.ediel_message_id is distinct from m.id or i.outbound_request_id is distinct from r.id
    or i.supplier_switch_request_id is distinct from s.id or i.operation_id is distinct from s.id
    or i.customer_id is distinct from s.customer_id or i.customer_site_id is distinct from m.site_id
    or i.requested_effective_date is distinct from s.requested_start_date
    or i.route_profile_id is distinct from m.route_profile_id or i.communication_route_id is distinct from m.communication_route_id
    or i.validation_status is distinct from 'validated' or i.render_status is distinct from 'rendered'
    or i.payload->>'transactionSubtype' is distinct from subtype or i.payload->>'reasonForTransaction' is distinct from reason
    or i.payload->>'requestType' is distinct from s.request_type
    or nullif(i.payload->>'power_of_attorney_id','') is distinct from s.power_of_attorney_id::text
    -- A null request document may legitimately resolve from its current POA.
    -- A nonnull explicit document must always remain the original document.
    or (s.authorization_document_id is not null and i.payload->>'authorization_document_id' is distinct from s.authorization_document_id::text)
    or r.customer_id is distinct from m.customer_id or r.site_id is distinct from m.site_id or r.metering_point_id is distinct from m.metering_point_id
    or r.source_type is distinct from 'supplier_switch_request' or r.source_id is distinct from s.id or r.operation_id is distinct from s.id
    or jsonb_typeof(r.payload) is distinct from 'object' or jsonb_typeof(coalesce(r.response_payload,'{}'::jsonb)) is distinct from 'object'
    or r.request_type is distinct from 'supplier_switch' or r.payload->>'environment' is distinct from m.environment
    or r.communication_route_id is distinct from m.communication_route_id then
    return held || jsonb_build_object('reason','current_original_scope_changed');
  end if;

  -- Native guards re-evaluate the original source/BRP/profile and signed consent
  -- at send phase. Their exceptions roll back the entire coordinator statement.
  perform gridex_ediel_transport.require_message_intent_v1(m);
  perform gridex_received_sources.require_switch_contract_request_current_v1(m.company_id,m.id,p_actor_user_id);
  perform gridex_received_sources.require_switch_brp_source_current_v1(m.company_id,m.id,p_actor_user_id);
  if gridex_bilateral_prodat.outbound_required_v1(m.raw_payload) then
    perform gridex_bilateral_prodat.require_outbound_original_v1(m,false);
  end if;

  lock_key_expected := 'outbound:' || r.id::text || ':' || m.id::text;
  for candidate in select * from public.ediel_outbox where ediel_message_id=m.id or lock_key=lock_key_expected order by id for update nowait loop
    queue_count := queue_count+1;
    q := candidate;
  end loop;
  if queue_count>1 then return held || jsonb_build_object('reason','original_queue_ambiguous'); end if;
  if queue_count=1 and (q.company_id is distinct from m.company_id or q.environment is distinct from m.environment
    or q.ediel_message_id is distinct from m.id or q.intent_id is distinct from i.id
    or q.source_message_id is distinct from m.related_message_id or q.route_profile_id is distinct from m.route_profile_id
    or q.lock_key is distinct from lock_key_expected or q.immutable_payload_hash is distinct from p_expected_payload_hash
    or q.payload->>'outboundRequestId' is distinct from r.id::text) then
    return held || jsonb_build_object('reason','original_queue_scope_changed');
  end if;
  has_history := exists(select from gridex_ediel_transport.attempts where message_id=m.id)
    or exists(select from gridex_outbound_dispatch.attempts where message_id=m.id)
    or exists(select from gridex_outbound_dispatch.events where message_id=m.id);
  if exists(select from gridex_outbound_dispatch.originals where message_id=m.id and
    (company_id is distinct from m.company_id or environment is distinct from m.environment
      or payload_hash is distinct from p_expected_payload_hash or raw_payload is distinct from m.raw_payload)) then
    return held || jsonb_build_object('reason','sealed_original_changed');
  end if;

  -- An observation is not authority to resend. Only the existing separately
  -- actor-gated accepted projection can repair its already accepted original.
  if has_history then
    projection := public.gridex_ediel_accepted_transport_projection_v1(m.company_id,m.environment,p_actor_user_id,m.id);
    if projection->>'status'='accepted_projection' and projection->>'companyId'=m.company_id::text
      and projection->>'environment'=m.environment and projection->>'messageId'=m.id::text
      and projection->>'originalHash'=p_expected_payload_hash and nullif(projection->>'attemptId','') is not null
      and nullif(projection->>'observedAt','') is not null
      and projection->'authorizesProviderEntry'='false'::jsonb and projection->'deliveryProven'='false'::jsonb
      and (m.status in ('draft','prepared','queued','sending','sent')) is true
      and (r.status in ('queued','prepared','sent','acknowledged')) is true then
      repaired := public.gridex_ediel_repair_accepted_transport_projection_v1(m.company_id,m.environment,p_actor_user_id,m.id);
      if repaired is null or repaired->>'status' is distinct from 'accepted_projection'
        or repaired->>'companyId' is distinct from m.company_id::text or repaired->>'environment' is distinct from m.environment
        or repaired->>'messageId' is distinct from m.id::text or repaired->>'originalHash' is distinct from p_expected_payload_hash
        or repaired->>'attemptId' is distinct from projection->>'attemptId'
        or repaired->'authorizesProviderEntry' is distinct from 'false'::jsonb or repaired->'deliveryProven' is distinct from 'false'::jsonb then
        raise exception 'normal_switch_enqueue_accepted_repair_unconfirmed';
      end if;
      return jsonb_build_object('status','accepted','messageId',m.id,'authorizesProviderEntry',false,'deliveryProven',false);
    end if;
    return held || jsonb_build_object('reason','existing_transport_history');
  end if;

  -- Current claims have the exact existing claim RPC shape: both counters
  -- incremented, a fresh attempt UUID and the worker's strict ten-minute lease.
  -- Observe only; never enter, extend, clear or retry that worker's claim.
  if queue_count=1 and q.status='sending' then
    if m.status in ('queued','sending') and i.outbox_status='queued' and r.status='prepared'
      and nullif(btrim(q.locked_by),'') is not null and q.locked_at is not null
      and q.locked_at<=clock_timestamp() and q.locked_at>clock_timestamp()-interval '10 minutes'
      and q.current_send_attempt_id is not null and q.attempts>0 and q.send_attempt_count>0
      and q.blocked_at is null and q.blocked_reason is null and q.last_error is null then
      return jsonb_build_object('status','in_progress','messageId',m.id,'outboxId',q.id,'authorizesProviderEntry',false,'deliveryProven',false);
    end if;
    return held || jsonb_build_object('reason','transport_claim_unconfirmed');
  end if;
  if (m.status in ('draft','prepared','queued')) is not true or (i.outbox_status in ('not_queued','queued')) is not true
    or (r.status in ('queued','prepared')) is not true
    or (queue_count=1 and ((q.status in ('draft','prepared','queued')) is not true
      or q.attempts is distinct from 0 or q.send_attempt_count is distinct from 0 or q.current_send_attempt_id is not null
      or q.locked_by is not null or q.locked_at is not null or q.blocked_at is not null or q.blocked_reason is not null or q.last_error is not null)) then
    return held || jsonb_build_object('reason','original_queue_not_fresh');
  end if;
  perform public.gridex_assert_supplier_switch_ready(m.company_id,c.id);

  if queue_count=0 then
    insert into public.ediel_outbox(company_id,ediel_message_id,intent_id,source_message_id,environment,status,lock_key,
      route_profile_id,message_family,message_code,priority,payload,immutable_payload_hash,queued_at,created_by,updated_by)
    values(m.company_id,m.id,i.id,m.related_message_id,m.environment,'queued',lock_key_expected,m.route_profile_id,m.message_family,m.message_code,50,
      jsonb_build_object('outboundRequestId',r.id,'externalReference',r.external_reference),p_expected_payload_hash,clock_timestamp(),p_actor_user_id,p_actor_user_id)
    on conflict(lock_key) do nothing returning * into q;
    -- A foreign/concurrent winner must not commit partial projections. Caller
    -- may inspect the durable original later; it cannot overwrite the winner.
    if not found then raise exception 'normal_switch_enqueue_concurrent_queue_winner'; end if;
  elsif q.status is distinct from 'queued' then
    update public.ediel_outbox set status='queued',queued_at=clock_timestamp(),updated_by=p_actor_user_id,updated_at=clock_timestamp() where id=q.id;
  end if;
  if m.status is distinct from 'queued' then
    update public.ediel_messages set status='queued',updated_by=p_actor_user_id,updated_at=clock_timestamp() where id=m.id;
  end if;
  if i.outbox_status is distinct from 'queued' then
    update public.ediel_message_intents set outbox_status='queued',updated_by=p_actor_user_id,updated_at=clock_timestamp() where id=i.id;
  end if;
  result := coalesce(r.response_payload,'{}'::jsonb) || jsonb_build_object('edielMessageId',m.id,'edielOutboxQueued',true);
  if r.status is distinct from 'prepared' or r.response_payload is distinct from result then
    update public.outbound_requests set status='prepared',response_payload=result,updated_by=p_actor_user_id,updated_at=clock_timestamp() where id=r.id;
  end if;
  return jsonb_build_object('status','queued','messageId',m.id,'outboxId',q.id,'authorizesProviderEntry',false,'deliveryProven',false);
end;
$$;
revoke all on function public.gridex_enqueue_normal_supplier_switch_v1(uuid,uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gridex_enqueue_normal_supplier_switch_v1(uuid,uuid,uuid,uuid,uuid,uuid,text) to service_role;
