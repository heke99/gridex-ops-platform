-- One approved internal lifecycle event -> timeline + domain/outbox + unsent
-- notification intent. This does not send, render, activate supply or replace
-- activate_customer_supply_v1's existing atomic welcome intent.
begin;

create function private.gridex_record_customer_operation_event_v1(p_event jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_company uuid; v_customer uuid; v_site uuid; v_point uuid; v_contract uuid;
  v_parent_job uuid; v_operation uuid; v_actor uuid;
  v_code text; v_template text; v_source text; v_key text; v_notification_key text;
  v_payload jsonb; v_timeline_payload jsonb; v_domain_payload jsonb; v_intent_payload jsonb;
  v_domain public.domain_events%rowtype; v_timeline public.customer_operation_events%rowtype;
  v_job public.customer_operation_jobs%rowtype; v_outbox public.event_outbox%rowtype;
  v_contract_row public.customer_contracts%rowtype; v_point_row public.metering_points%rowtype;
  v_expected_domain jsonb; v_expected_timeline jsonb;
  v_domain_id uuid; v_timeline_id uuid; v_job_id uuid; v_replayed boolean;
begin
  if current_user<>'service_role' then raise exception 'lifecycle_event_service_required' using errcode='42501'; end if;
  if jsonb_typeof(p_event) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_event) k where k not in
      ('company_id','customer_id','customer_site_id','metering_point_id','contract_id','customer_operation_job_id',
       'operation_id','actor_user_id','aggregate_type','aggregate_id','event_code','title','message','status','severity',
       'action_required','action_url','source','visibility','payload','idempotency_key','source_event_id','notification_template'))
    or jsonb_typeof(p_event->'payload') is distinct from 'object' then
    raise exception 'invalid_lifecycle_event' using errcode='22023';
  end if;
  v_company:=nullif(p_event->>'company_id','')::uuid; v_customer:=nullif(p_event->>'customer_id','')::uuid;
  v_site:=nullif(p_event->>'customer_site_id','')::uuid; v_point:=nullif(p_event->>'metering_point_id','')::uuid;
  v_contract:=nullif(p_event->>'contract_id','')::uuid; v_parent_job:=nullif(p_event->>'customer_operation_job_id','')::uuid;
  v_operation:=nullif(p_event->>'operation_id','')::uuid; v_actor:=nullif(p_event->>'actor_user_id','')::uuid;
  v_code:=p_event->>'event_code'; v_source:=nullif(btrim(p_event->>'source_event_id'),'');
  v_template:=case v_code when 'supplier_switch.requested' then 'switch.started'
    when 'supplier_switch.accepted' then 'switch.confirmed' when 'supplier_switch.confirmed' then 'switch.confirmed'
    when 'supplier_switch.rejected' then 'switch.action_required'
    when 'supplier_switch.manual_review_required' then 'switch.action_required'
    when 'supply_period.activated' then 'customer.welcome_active' when 'supply_period.active' then 'customer.welcome_active' end;
  if v_company is null or v_customer is null or v_source is null or length(v_source)>2048
    or v_template is null or v_template is distinct from p_event->>'notification_template'
    or coalesce(p_event->>'aggregate_type','') not in ('customer','customer_site','metering_point')
    or nullif(p_event->>'aggregate_id','') is null
    or p_event->>'title' is null or p_event->>'message' is null then
    raise exception 'invalid_lifecycle_event' using errcode='22023'; end if;
  v_key:=coalesce(nullif(p_event->>'idempotency_key',''),v_source);
  v_notification_key:='lifecycle_notification:'||v_source||':'||v_template;
  v_payload:=p_event->'payload';

  -- Rebind current company/customer and every supplied resource before replay.
  -- This records an approved service follow-up; interactive permission/session
  -- decisions stay at the original transition owner, not a fabricated send rule.
  perform 1 from public.companies where id=v_company for share;
  if not found then raise exception 'lifecycle_resource_scope_mismatch' using errcode='23503'; end if;
  perform 1 from public.customers where id=v_customer and company_id=v_company for share;
  if not found then raise exception 'lifecycle_resource_scope_mismatch' using errcode='23503'; end if;
  if v_contract is not null then
    select * into v_contract_row from public.customer_contracts where id=v_contract and company_id=v_company and customer_id=v_customer for share;
    if not found or (v_contract_row.customer_site_id is not null and v_contract_row.site_id is not null
      and v_contract_row.customer_site_id<>v_contract_row.site_id)
      or (v_site is not null and coalesce(v_contract_row.customer_site_id,v_contract_row.site_id) is distinct from v_site)
      or (v_point is not null and v_contract_row.metering_point_id is not null and v_contract_row.metering_point_id<>v_point) then
      raise exception 'lifecycle_resource_scope_mismatch' using errcode='23503'; end if;
    -- Validate derived ownership too, while preserving the original intent tuple.
    perform 1 from public.customer_sites where id=coalesce(v_contract_row.customer_site_id,v_contract_row.site_id)
      and company_id=v_company and customer_id=v_customer for share;
    if coalesce(v_contract_row.customer_site_id,v_contract_row.site_id) is not null and not found then
      raise exception 'lifecycle_resource_scope_mismatch' using errcode='23503'; end if;
  end if;
  if coalesce(v_point,v_contract_row.metering_point_id) is not null then
    select * into v_point_row from public.metering_points where id=coalesce(v_point,v_contract_row.metering_point_id)
      and company_id=v_company and customer_id=v_customer for share;
    if not found or (v_point_row.customer_site_id is not null and v_point_row.site_id is not null
      and v_point_row.customer_site_id<>v_point_row.site_id)
      or (coalesce(v_site,v_contract_row.customer_site_id,v_contract_row.site_id) is not null
      and coalesce(v_point_row.customer_site_id,v_point_row.site_id) is distinct from coalesce(v_site,v_contract_row.customer_site_id,v_contract_row.site_id)) then
      raise exception 'lifecycle_resource_scope_mismatch' using errcode='23503'; end if;
    if coalesce(v_point_row.customer_site_id,v_point_row.site_id) is not null then
      perform 1 from public.customer_sites where id=coalesce(v_point_row.customer_site_id,v_point_row.site_id) and company_id=v_company and customer_id=v_customer for share;
      if not found then raise exception 'lifecycle_resource_scope_mismatch' using errcode='23503'; end if;
    end if;
  end if;
  if v_site is not null then
    perform 1 from public.customer_sites where id=v_site and company_id=v_company and customer_id=v_customer for share;
    if not found then raise exception 'lifecycle_resource_scope_mismatch' using errcode='23503'; end if;
  end if;
  if v_parent_job is not null then
    perform 1 from public.customer_operation_jobs where id=v_parent_job and company_id=v_company and customer_id=v_customer
      and (coalesce(v_site,v_contract_row.customer_site_id,v_contract_row.site_id,v_point_row.customer_site_id,v_point_row.site_id) is null
        or customer_site_id is not distinct from coalesce(v_site,v_contract_row.customer_site_id,v_contract_row.site_id,v_point_row.customer_site_id,v_point_row.site_id))
      -- Site jobs may legitimately select their verified point later. An
      -- already bound different point cannot be replaced by that continuation.
      and (coalesce(v_point,v_contract_row.metering_point_id) is null or metering_point_id is null
        or metering_point_id=coalesce(v_point,v_contract_row.metering_point_id))
      and (v_operation is null or operation_id=v_operation) for share;
    if not found then raise exception 'lifecycle_resource_scope_mismatch' using errcode='23503'; end if;
  end if;
  if (p_event->>'aggregate_type'='customer' and p_event->>'aggregate_id'<>v_customer::text)
    or (p_event->>'aggregate_type'='customer_site' and p_event->>'aggregate_id' is distinct from v_site::text)
    or (p_event->>'aggregate_type'='metering_point' and p_event->>'aggregate_id' is distinct from v_point::text) then
    raise exception 'lifecycle_resource_scope_mismatch' using errcode='23503'; end if;

  -- Serialize the permanent approved event, including same-key retries after a
  -- lost response. Hash collisions serialize extra requests without accepting them.
  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||v_source,0));
  v_timeline_payload:=v_payload||jsonb_build_object('operation_id',v_operation);
  v_domain_payload:=jsonb_build_object('title',p_event->>'title','message',p_event->>'message','operation_id',v_operation)||v_payload;
  v_intent_payload:=jsonb_build_object('event_type',v_code,'source_event_id',v_source,'contract_id',v_contract,'payload',v_payload);
  v_expected_domain:=jsonb_build_object('company_id',v_company,'event_type',v_code,'aggregate_type',p_event->>'aggregate_type',
    'aggregate_id',p_event->>'aggregate_id','subject_customer_id',v_customer,'actor_user_id',v_actor,
    'source',coalesce(p_event->>'source','customer_operations'),'payload',v_domain_payload,'idempotency_key',v_key);
  v_expected_timeline:=jsonb_build_object('company_id',v_company,'customer_id',v_customer,'customer_site_id',v_site,
    'metering_point_id',v_point,'customer_operation_job_id',v_parent_job,'operation_id',v_operation,'event_code',v_code,
    'title',p_event->>'title','message',p_event->>'message','status',p_event->>'status','severity',p_event->>'severity',
    'action_required',coalesce((p_event->>'action_required')::boolean,false),'action_url',p_event->>'action_url',
    'source',coalesce(p_event->>'source','customer_operations'),'visibility',coalesce(p_event->>'visibility','tenant'),
    'payload',v_timeline_payload,'idempotency_key',v_key);

  select * into v_domain from public.domain_events where idempotency_key=v_key for update;
  if found then
    if (to_jsonb(v_domain)-array['id','event_version','occurred_at','created_at']) is distinct from v_expected_domain then
      raise exception 'lifecycle_event_idempotency_conflict' using errcode='23505'; end if;
    v_domain_id:=v_domain.id;
  else
    insert into public.domain_events(company_id,event_type,aggregate_type,aggregate_id,subject_customer_id,actor_user_id,source,payload,idempotency_key)
      values(v_company,v_code,p_event->>'aggregate_type',p_event->>'aggregate_id',v_customer,v_actor,
        coalesce(p_event->>'source','customer_operations'),v_domain_payload,v_key) returning id into v_domain_id;
  end if;
  select * into v_outbox from public.event_outbox where domain_event_id=v_domain_id and destination_type='webhook' and destination_key='webhook_fanout_v1' for update;
  if found then
    if v_outbox.company_id is distinct from v_company or v_outbox.payload is distinct from jsonb_build_object(
      'event_type',v_code,'aggregate_type',p_event->>'aggregate_type','aggregate_id',p_event->>'aggregate_id') then
      raise exception 'lifecycle_event_idempotency_conflict' using errcode='23505'; end if;
  else
    insert into public.event_outbox(company_id,domain_event_id,destination_type,destination_key,status,attempts,max_attempts,available_at,payload)
      values(v_company,v_domain_id,'webhook','webhook_fanout_v1','queued',0,12,clock_timestamp(),
        jsonb_build_object('event_type',v_code,'aggregate_type',p_event->>'aggregate_type','aggregate_id',p_event->>'aggregate_id'));
  end if;
  select * into v_timeline from public.customer_operation_events where company_id=v_company and idempotency_key=v_key for update;
  if found then
    if (to_jsonb(v_timeline)-array['id','occurred_at','created_at']) is distinct from v_expected_timeline then
      raise exception 'lifecycle_event_idempotency_conflict' using errcode='23505'; end if;
    v_timeline_id:=v_timeline.id;
  else
    insert into public.customer_operation_events(company_id,customer_id,customer_site_id,metering_point_id,customer_operation_job_id,
      operation_id,event_code,title,message,status,severity,action_required,action_url,source,visibility,payload,idempotency_key)
      values(v_company,v_customer,v_site,v_point,v_parent_job,v_operation,v_code,p_event->>'title',p_event->>'message',
        p_event->>'status',p_event->>'severity',coalesce((p_event->>'action_required')::boolean,false),p_event->>'action_url',
        coalesce(p_event->>'source','customer_operations'),coalesce(p_event->>'visibility','tenant'),v_timeline_payload,v_key)
      returning id into v_timeline_id;
  end if;
  select * into v_job from public.customer_operation_jobs where company_id=v_company and job_type='dispatch_lifecycle_notification'
    and idempotency_key=v_notification_key for update;
  v_replayed:=found;
  if found then
    if v_job.customer_id is distinct from v_customer or v_job.customer_site_id is distinct from v_site
      or v_job.metering_point_id is distinct from v_point or v_job.payload is distinct from v_intent_payload
      or v_job.request_snapshot is distinct from v_payload then
      raise exception 'lifecycle_event_idempotency_conflict' using errcode='23505'; end if;
    v_job_id:=v_job.id;
  else
    -- Required intent is deliberately last. A fault here rolls every preceding
    -- event/outbox/timeline write back in the same database transaction.
    insert into public.customer_operation_jobs(company_id,customer_id,customer_site_id,metering_point_id,job_type,status,priority,
      idempotency_key,payload,request_snapshot,run_after)
      values(v_company,v_customer,v_site,v_point,'dispatch_lifecycle_notification','queued',40,v_notification_key,
        v_intent_payload,v_payload,clock_timestamp()) returning id into v_job_id;
  end if;
  return jsonb_build_object('operationEventId',v_timeline_id,'domainEventId',v_domain_id,'notificationJobId',v_job_id,
    'eventKey',v_template,'replayed',v_replayed);
end;
$function$;
revoke all on function private.gridex_record_customer_operation_event_v1(jsonb) from public,anon,authenticated;
grant execute on function private.gridex_record_customer_operation_event_v1(jsonb) to service_role;

create function public.gridex_record_customer_operation_event_v1(p_event jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
  select private.gridex_record_customer_operation_event_v1(p_event);
$function$;
revoke all on function public.gridex_record_customer_operation_event_v1(jsonb) from public,anon,authenticated;
grant execute on function public.gridex_record_customer_operation_event_v1(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
