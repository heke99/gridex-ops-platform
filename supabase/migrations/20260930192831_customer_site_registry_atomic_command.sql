-- CLI-created forward migration. OPS site data, address candidate provenance,
-- audit/result and outgoing worker intent share one database transaction.
begin;
set local lock_timeout='10s';

alter table public.customer_sites add column site_revision bigint not null default 0 check(site_revision>=0);
create function private.gridex_customer_site_revision_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if tg_op='INSERT' then new.site_revision:=0;
  else
    -- Cover every trusted writer, including grid-owner response and canonical
    -- address commits. Timestamps/caller-supplied counters cannot forge a revision.
    new.site_revision:=old.site_revision+case when
      (to_jsonb(new)-array['site_revision','address_revision','updated_at','updated_by','address_received_at','is_active','normalized_facility_id'])
      is distinct from
      (to_jsonb(old)-array['site_revision','address_revision','updated_at','updated_by','address_received_at','is_active','normalized_facility_id'])
      then 1 else 0 end;
  end if;
  return new;
end;
$function$;
create trigger zzz_gridex_customer_site_revision before insert or update on public.customer_sites
  for each row execute function private.gridex_customer_site_revision_v1();
revoke all on function private.gridex_customer_site_revision_v1() from public,anon,authenticated,service_role;

create function private.gridex_site_ops_actor_allowed_v1(p_actor uuid,p_session uuid,p_company uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if current_user<>'service_role' then raise exception 'site_service_required' using errcode='42501'; end if;
  if p_actor is null or p_session is null or p_company is null
    or not private.gridex_profile_session_active_v1(p_actor,p_session) then return false; end if;
  perform 1 from public.company_memberships m where m.company_id=p_company and m.user_id=p_actor
    and m.is_active and m.status='active' for share;
  if not found then return false; end if;
  perform private.gridex_profile_authority_lock_v1(p_actor,p_company);
  return private.gridex_profile_session_active_v1(p_actor,p_session) and
    (coalesce(public.gridex_actor_has_company_permission(p_actor,p_company,'sites.write'),false)
      or coalesce(public.gridex_actor_has_company_permission(p_actor,p_company,'customers.write'),false));
end;
$function$;
revoke all on function private.gridex_site_ops_actor_allowed_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.gridex_site_ops_actor_allowed_v1(uuid,uuid,uuid) to service_role;

create function public.gridex_save_customer_site_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_company uuid; v_customer uuid; v_site_id uuid; v_actor uuid; v_session uuid; v_key text; v_reason text;
  v_expected bigint; v_flow text; v_changes jsonb; v_candidate jsonb; v_hints jsonb; v_request jsonb; v_namespace text;
  v_before public.customer_sites%rowtype; v_site public.customer_sites%rowtype; v_existing public.canonical_command_results%rowtype;
  v_created boolean; v_changed boolean; v_status text; v_address_hash text; v_normalized text; v_candidate_snapshot jsonb;
  v_event uuid; v_job uuid; v_operation uuid; v_trace uuid; v_snapshot jsonb; v_result jsonb;
begin
  if current_user<>'service_role' then raise exception 'site_service_required' using errcode='42501'; end if;
  if p_command is null or jsonb_typeof(p_command)<>'object' or
    exists(select 1 from jsonb_object_keys(p_command) k(key) where key not in
      ('companyId','customerId','siteId','actorUserId','sessionId','reason','expectedRevision','idempotencyKey','siteFlowType','changes','addressHints','candidate'))
    or not p_command ?& array['companyId','customerId','siteId','actorUserId','sessionId','reason','expectedRevision','idempotencyKey','siteFlowType','changes','addressHints','candidate']
    or coalesce(p_command->>'companyId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'customerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'actorUserId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'sessionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (p_command->'siteId'<>'null'::jsonb and coalesce(p_command->>'siteId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or jsonb_typeof(p_command->'reason') is distinct from 'string' or length(btrim(p_command->>'reason')) not between 1 and 200
    or jsonb_typeof(p_command->'idempotencyKey') is distinct from 'string'
    or coalesce(p_command->>'idempotencyKey','') !~ '^[A-Za-z0-9._:+~-]{8,200}$'
    or jsonb_typeof(p_command->'expectedRevision') is distinct from 'number'
    or coalesce(p_command->>'expectedRevision','') !~ '^[0-9]{1,16}$' or (p_command->>'expectedRevision')::numeric>9007199254740991
    or coalesce(p_command->>'siteFlowType','') not in ('switch','move_in','move_out_takeover')
    or jsonb_typeof(p_command->'changes') is distinct from 'object'
    or jsonb_typeof(p_command->'addressHints') is distinct from 'object'
    or jsonb_typeof(p_command->'candidate') is distinct from 'object'
  then raise exception 'invalid_site_command' using errcode='22023'; end if;
  v_company:=(p_command->>'companyId')::uuid; v_customer:=(p_command->>'customerId')::uuid;
  v_site_id:=(p_command->>'siteId')::uuid; v_actor:=(p_command->>'actorUserId')::uuid; v_session:=(p_command->>'sessionId')::uuid;
  v_expected:=(p_command->>'expectedRevision')::bigint; v_key:=p_command->>'idempotencyKey'; v_reason:=btrim(p_command->>'reason');
  v_changes:=p_command->'changes'; v_candidate:=p_command->'candidate'; v_hints:=p_command->'addressHints'; v_flow:=p_command->>'siteFlowType';
  if not v_changes ?& array['site_name','facility_id','site_type','status','move_in_date','annual_consumption_kwh',
      'current_supplier_name','current_supplier_org_number','street','care_of','postal_code','city','country',
      'moved_from_street','moved_from_postal_code','moved_from_city','moved_from_supplier_name','internal_notes']
    or exists(select 1 from jsonb_object_keys(v_changes) k(key) where key not in
      ('site_name','facility_id','site_type','status','move_in_date','annual_consumption_kwh','current_supplier_name','current_supplier_org_number',
        'street','care_of','postal_code','city','country','moved_from_street','moved_from_postal_code','moved_from_city','moved_from_supplier_name','internal_notes'))
    or exists(select 1 from jsonb_each(v_changes) e(key,value) where key not in ('annual_consumption_kwh') and
      (jsonb_typeof(value) not in ('string','null') or (value<>'null'::jsonb and
        (length(btrim(value#>>'{}'))<1 or length(value#>>'{}')>case key when 'site_name' then 200 when 'facility_id' then 120
          when 'current_supplier_name' then 240 when 'current_supplier_org_number' then 50 when 'street' then 300 when 'care_of' then 200
          when 'postal_code' then 20 when 'city' then 120 when 'country' then 2 when 'moved_from_street' then 300
          when 'moved_from_postal_code' then 20 when 'moved_from_city' then 120 when 'moved_from_supplier_name' then 240
          when 'internal_notes' then 10000 when 'move_in_date' then 10 else 40 end))))
    or jsonb_typeof(v_changes->'site_name') is distinct from 'string'
    or coalesce(v_changes->>'site_type','') not in ('consumption','production','mixed')
    or coalesce(v_changes->>'status','') not in ('draft','active','pending_move','inactive','closed')
    or coalesce(v_changes->>'country','') !~ '^[A-Z]{2}$'
    or jsonb_typeof(v_changes->'annual_consumption_kwh') not in ('number','null')
    or (v_changes->'annual_consumption_kwh'<>'null'::jsonb and ((v_changes->>'annual_consumption_kwh')::numeric<0
      or (v_changes->>'annual_consumption_kwh')::numeric>1000000000000))
    or (v_changes->'move_in_date'<>'null'::jsonb and coalesce(v_changes->>'move_in_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  then raise exception 'invalid_site_field' using errcode='22023'; end if;
  -- The cast validates calendar dates as well as the ISO representation.
  begin perform (v_changes->>'move_in_date')::date;
  exception when datetime_field_overflow or invalid_datetime_format then raise exception 'invalid_site_field' using errcode='22023'; end;
  if (v_site_id is null and v_expected<>0)
    or (v_flow<>'switch' and (v_changes->'move_in_date'='null'::jsonb or v_changes->'street'='null'::jsonb
      or v_changes->'postal_code'='null'::jsonb or v_changes->'city'='null'::jsonb))
    or (v_flow='switch' and (v_changes->'moved_from_street'<>'null'::jsonb or v_changes->'moved_from_postal_code'<>'null'::jsonb
      or v_changes->'moved_from_city'<>'null'::jsonb or v_changes->'moved_from_supplier_name'<>'null'::jsonb))
  then raise exception 'invalid_site_flow' using errcode='22023'; end if;
  if not v_hints ?& array['claimedGridOwnerId','claimedPriceAreaCode']
    or exists(select 1 from jsonb_object_keys(v_hints) k(key) where key not in ('claimedGridOwnerId','claimedPriceAreaCode'))
    or (v_hints->'claimedGridOwnerId'<>'null'::jsonb and coalesce(v_hints->>'claimedGridOwnerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (v_hints->'claimedPriceAreaCode'<>'null'::jsonb and coalesce(v_hints->>'claimedPriceAreaCode','') not in ('SE1','SE2','SE3','SE4'))
  then raise exception 'site_candidate_invalid' using errcode='22023'; end if;

  perform 1 from public.customers c where c.id=v_customer and c.company_id=v_company and c.status<>'archived'
    and c.archived_at is null for update;
  if not found then raise exception 'site_customer_unavailable' using errcode='42501'; end if;
  perform 1 from public.companies c where c.id=v_company and c.is_active and c.status='active' for share;
  if not found then raise exception 'site_tenant_unavailable' using errcode='42501'; end if;
  if not private.gridex_site_ops_actor_allowed_v1(v_actor,v_session,v_company) then
    raise exception 'site_actor_forbidden' using errcode='42501'; end if;
  if v_site_id is not null then
    select * into v_before from public.customer_sites s where s.id=v_site_id and s.company_id=v_company
      and s.customer_id=v_customer and s.archived_at is null for update;
    if not found then raise exception 'site_resource_not_found' using errcode='P0002'; end if;
  end if;
  v_namespace:=encode(extensions.digest(concat_ws(':','customer.site.save.v1',v_customer::text,v_actor::text,v_key),'sha256'),'hex');
  v_request:=jsonb_build_object('companyId',v_company,'customerId',v_customer,'siteId',v_site_id,'actorUserId',v_actor,
    'expectedRevision',v_expected,'siteFlowType',v_flow,'changesHash',public.canonical_json_sha256(v_changes),'hintsHash',public.canonical_json_sha256(v_hints));
  select * into v_existing from public.canonical_command_results r where r.company_id=v_company
    and r.command_type='customer.site.save.v1' and r.idempotency_key=v_namespace for update;
  if found then
    if v_existing.request_payload is distinct from v_request then raise exception 'site_idempotency_conflict' using errcode='P0001'; end if;
    -- New-create replay also locks the persisted result's exact resource. A
    -- completed key never grants authority over an archived/reassigned site.
    perform 1 from public.customer_sites s where s.id=(v_existing.result_payload->>'siteId')::uuid and s.company_id=v_company
      and s.customer_id=v_customer and s.archived_at is null for update;
    if not found then raise exception 'site_resource_not_found' using errcode='P0002'; end if;
    if not private.gridex_site_ops_actor_allowed_v1(v_actor,v_session,v_company) then raise exception 'site_actor_forbidden' using errcode='42501'; end if;
    return v_existing.result_payload||jsonb_build_object('replayed',true);
  end if;
  if v_site_id is not null and v_before.site_revision<>v_expected then raise exception 'site_revision_conflict' using errcode='P0001'; end if;
  if not private.gridex_site_ops_actor_allowed_v1(v_actor,v_session,v_company) then raise exception 'site_actor_forbidden' using errcode='42501'; end if;
  if not v_candidate ?& array['street','postal_code','city','country','care_of','apartment_number','complete','normalized','address_hash']
    or exists(select 1 from jsonb_object_keys(v_candidate) k(key) where key not in
      ('street','postal_code','city','country','care_of','apartment_number','complete','normalized','address_hash'))
    or jsonb_typeof(v_candidate->'complete') is distinct from 'boolean'
    or exists(select 1 from jsonb_each(v_candidate) e(key,value) where key<>'complete' and jsonb_typeof(value) not in ('string','null'))
    or v_candidate->>'street' is distinct from nullif(regexp_replace(btrim(v_changes->>'street'),'\s+',' ','g'),'')
    or v_candidate->>'city' is distinct from nullif(regexp_replace(btrim(v_changes->>'city'),'\s+',' ','g'),'')
    or v_candidate->>'care_of' is distinct from nullif(regexp_replace(btrim(v_changes->>'care_of'),'\s+',' ','g'),'')
    or v_candidate->>'country' is distinct from v_changes->>'country'
    or v_candidate->>'postal_code' is distinct from case when regexp_replace(coalesce(v_changes->>'postal_code',''),'\D','','g') ~ '^[0-9]{5}$'
      then regexp_replace(v_changes->>'postal_code','\D','','g') else null end
    or v_candidate->>'apartment_number' is distinct from v_before.apartment_number
    or (v_candidate->>'complete')::boolean is distinct from
      (coalesce(length(v_candidate->>'street'),0)>0 and coalesce(v_candidate->>'postal_code','') ~ '^[0-9]{5}$'
        and coalesce(length(v_candidate->>'city'),0)>0 and v_candidate->>'country'='SE')
  then raise exception 'site_candidate_invalid' using errcode='22023'; end if;
  v_address_hash:=v_candidate->>'address_hash'; v_normalized:=v_candidate->>'normalized';
  if (v_candidate->>'complete')::boolean then
    if v_normalized is null or v_address_hash is null or v_address_hash !~ '^[a-f0-9]{64}$'
      or v_address_hash<>encode(extensions.digest(v_normalized,'sha256'),'hex') then
      raise exception 'site_candidate_invalid' using errcode='22023'; end if;
  elsif v_address_hash is not null or v_normalized is not null then
    raise exception 'site_candidate_invalid' using errcode='22023';
  end if;

  v_created:=v_site_id is null;
  if v_created then
    insert into public.customer_sites(company_id,customer_id,site_name,facility_id,site_type,status,move_in_date,annual_consumption_kwh,
      current_supplier_name,current_supplier_org_number,country,moved_from_street,moved_from_postal_code,moved_from_city,
      moved_from_supplier_name,internal_notes,created_by,updated_by)
    values(v_company,v_customer,v_changes->>'site_name',v_changes->>'facility_id',v_changes->>'site_type',v_changes->>'status',
      (v_changes->>'move_in_date')::date,(v_changes->>'annual_consumption_kwh')::numeric,v_changes->>'current_supplier_name',
      v_changes->>'current_supplier_org_number',v_changes->>'country',v_changes->>'moved_from_street',v_changes->>'moved_from_postal_code',
      v_changes->>'moved_from_city',v_changes->>'moved_from_supplier_name',v_changes->>'internal_notes',v_actor,v_actor)
      returning * into v_site;
    v_site_id:=v_site.id;
  else
    -- Canonical address/grid context are handled separately below, so manual
    -- form values cannot overwrite a verified address before rank comparison.
    update public.customer_sites set site_name=v_changes->>'site_name',facility_id=v_changes->>'facility_id',site_type=v_changes->>'site_type',
      status=v_changes->>'status',move_in_date=(v_changes->>'move_in_date')::date,annual_consumption_kwh=(v_changes->>'annual_consumption_kwh')::numeric,
      current_supplier_name=v_changes->>'current_supplier_name',current_supplier_org_number=v_changes->>'current_supplier_org_number',
      moved_from_street=v_changes->>'moved_from_street',moved_from_postal_code=v_changes->>'moved_from_postal_code',
      moved_from_city=v_changes->>'moved_from_city',moved_from_supplier_name=v_changes->>'moved_from_supplier_name',
      internal_notes=v_changes->>'internal_notes',updated_by=v_actor,updated_at=clock_timestamp()
      where id=v_site_id and company_id=v_company and customer_id=v_customer returning * into v_site;
  end if;
  -- Hints are evidence even when the physical address is unchanged, incomplete
  -- or under review. Keep them independently of canonical routing/provenance.
  update public.customer_sites set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'site_flow_type',v_flow,'claimed_grid_owner_id',v_hints->>'claimedGridOwnerId','claimed_price_area_code',v_hints->>'claimedPriceAreaCode'),
    updated_at=clock_timestamp() where id=v_site_id and company_id=v_company and customer_id=v_customer returning * into v_site;
  v_candidate_snapshot:=(v_candidate-'complete'-'normalized')||jsonb_build_object('source','manual_intake','source_reference',v_site_id,
    'claimed_grid_owner_id',v_hints->>'claimedGridOwnerId','claimed_price_area_code',v_hints->>'claimedPriceAreaCode');
  if not (v_candidate->>'complete')::boolean then
    v_status:='incomplete';
    -- Incomplete intake is retained as evidence and cannot erase a complete or
    -- verified canonical address. New sites retain every submitted field.
    update public.customer_sites set
      street=case when address_hash is null then v_candidate->>'street' else street end,
      postal_code=case when address_hash is null then v_changes->>'postal_code' else postal_code end,
      city=case when address_hash is null then v_candidate->>'city' else city end,
      country=case when address_hash is null then v_changes->>'country' else country end,
      care_of=case when address_hash is null then v_candidate->>'care_of' else care_of end,
      address_status=case when address_hash is null then 'incomplete' else address_status end,
      address_quality_status=case when address_hash is null then 'incomplete' else address_quality_status end,
      address_quality_warnings=case when address_hash is null then '["site_address_requires_street_postal_code_city"]'::jsonb else address_quality_warnings end,
      address_received_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=v_site_id and company_id=v_company and customer_id=v_customer;
    insert into public.customer_site_address_history(company_id,customer_id,customer_site_id,address_hash,source,source_reference,actor_user_id,snapshot)
      values(v_company,v_customer,v_site_id,null,'manual_intake',v_site_id::text,v_actor,v_candidate_snapshot||jsonb_build_object('raw_postal_code',v_changes->>'postal_code'));
  elsif v_site.address_hash=v_address_hash and row(v_site.care_of,v_site.apartment_number) is not distinct from
      row(v_candidate->>'care_of',v_candidate->>'apartment_number') then
    v_status:='unchanged';
    update public.customer_sites set address_received_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=v_site_id and company_id=v_company and customer_id=v_customer;
  elsif v_site.address_hash is not null and (v_site.address_verified_at is not null or v_site.address_verification_method='grid_owner_response')
    and v_site.address_source in ('grid_owner_response','superadmin','tenant_api') then
    v_status:='conflict';
    insert into public.customer_site_address_conflicts(company_id,customer_id,customer_site_id,status,existing_address,candidate_address,
      candidate_source,candidate_source_reference,dedupe_key)
      values(v_company,v_customer,v_site_id,'open',jsonb_build_object('address_hash',v_site.address_hash,'source',v_site.address_source),
        v_candidate_snapshot,'manual_intake',v_site_id::text,encode(extensions.digest(v_company::text||':'||v_site_id::text||':manual_intake:'||v_address_hash,'sha256'),'hex'))
      on conflict do nothing;
  else
    v_status:='updated';
    perform public.gridex_commit_customer_site_address(v_company,v_customer,v_site_id,v_candidate->>'street',v_candidate->>'postal_code',
      v_candidate->>'city',v_candidate->>'country',v_candidate->>'care_of',v_candidate->>'apartment_number',v_normalized,v_address_hash,
      'manual_intake',v_site_id::text,jsonb_build_object('site_command',true,'site_flow_type',v_flow,
        'claimed_grid_owner_id',v_hints->>'claimedGridOwnerId','claimed_price_area_code',v_hints->>'claimedPriceAreaCode'),v_actor);
  end if;
  update public.customer_sites set
    data_quality_status=case when facility_id is null then 'missing_facility_id' when grid_owner_id is null then 'missing_grid_owner' else 'ready_for_request' end,
    missing_data_status=case when facility_id is null then 'facility_id' when grid_owner_id is null then 'grid_owner' else null end,
    updated_at=clock_timestamp() where id=v_site_id and company_id=v_company and customer_id=v_customer returning * into v_site;
  -- Existing supported missing-data tasks are created in the same transaction;
  -- no post-commit form writer or swallowed audit error can lose this intent.
  insert into public.customer_data_tasks(company_id,customer_id,customer_site_id,task_type,status,priority,description,created_by,updated_by)
    select v_company,v_customer,v_site_id,t.kind,'open','high',t.description,v_actor,v_actor
    from (values('missing_facility_id',v_site.facility_id is null,'Saknar anläggnings-ID. Komplettera innan en uppgiftsbegäran kan skickas.'),
      ('missing_grid_owner',v_site.grid_owner_id is null,'Nätägare behöver verifieras innan Ediel kan skickas.')) t(kind,needed,description)
    where t.needed and not exists(select 1 from public.customer_data_tasks d where d.company_id=v_company and d.customer_id=v_customer
      and d.customer_site_id=v_site_id and d.task_type=t.kind and d.status in ('open','in_progress'));
  if v_status in ('updated','unchanged') and v_site.status not in ('inactive','closed') then
    -- Only durable intent is enqueued here. The existing worker independently
    -- checks facility identity, verified grid owner and routing before dispatch.
    v_snapshot:=jsonb_build_object('site_id',v_site_id,'address_hash',v_site.address_hash,'grid_owner_id',v_site.grid_owner_id,
      'grid_area_code',v_site.grid_area_code,'route_profile_id',null,'facility_id',v_site.facility_id,'captured_at',clock_timestamp());
    insert into public.customer_operation_jobs(company_id,customer_id,customer_site_id,job_type,status,idempotency_key,payload,
      request_snapshot,priority,created_by)
      values(v_company,v_customer,v_site_id,'request_customer_data','queued','customer-data:'||v_customer::text||':'||v_site_id::text,
        jsonb_build_object('requestedFrom','customer_site_command','site_snapshot',v_snapshot),v_snapshot,20,v_actor)
      on conflict do nothing returning id,operation_id,trace_id into v_job,v_operation,v_trace;
    if v_job is not null then
      insert into public.customer_operation_request_snapshots(company_id,customer_id,customer_site_id,customer_operation_job_id,
        operation_id,request_kind,site_address_hash,grid_owner_id,grid_area_code,snapshot,trace_id)
        values(v_company,v_customer,v_site_id,v_job,v_operation,'customer_data_request',v_site.address_hash,
          v_site.grid_owner_id,v_site.grid_area_code,v_snapshot||jsonb_build_object('operation_id',v_operation,'trace_id',v_trace),v_trace);
    end if;
  end if;
  v_changed:=v_created or v_site.site_revision<>v_expected;
  v_result:=jsonb_build_object('companyId',v_company,'customerId',v_customer,'siteId',v_site_id,'revision',v_site.site_revision,
    'changed',v_changed,'replayed',false,'addressStatus',v_status);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
    values(v_company,'customer.site.save.v1',v_namespace,v_request,v_result,v_actor);
  insert into public.canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
    values(v_company,'CUSTOMER_SITE_COMMAND_ACCEPTED','customer_site',v_site_id,v_site.site_revision,v_namespace,
      jsonb_build_object('customerId',v_customer,'siteId',v_site_id,'revision',v_site.site_revision,'changed',v_changed,'addressStatus',v_status,
        'operationJobId',v_job),v_actor) returning id into v_event;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
    values(v_company,v_event,'customer.site.saved',v_namespace,jsonb_build_object('customerId',v_customer,'siteId',v_site_id,
      'revision',v_site.site_revision,'addressStatus',v_status));
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,
    reason,idempotency_key,before_state,after_state,metadata)
    values(v_company,'CUSTOMER_SITE_COMMAND','customer_site',v_site_id,v_site.site_revision,v_actor,v_reason,v_namespace,
      jsonb_build_object('revision',v_expected,'created',v_created),v_result-'companyId'-'customerId'-'siteId',
      jsonb_build_object('changesHash',v_request->>'changesHash','hintsHash',v_request->>'hintsHash','siteFlowType',v_flow));
  -- Resource/job/result/audit unique locks may wait across wall-clock expiry.
  if not private.gridex_site_ops_actor_allowed_v1(v_actor,v_session,v_company) then raise exception 'site_actor_forbidden' using errcode='42501'; end if;
  return v_result;
end;
$function$;
revoke all on function public.gridex_save_customer_site_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_save_customer_site_v1(jsonb) to service_role;
commit;
