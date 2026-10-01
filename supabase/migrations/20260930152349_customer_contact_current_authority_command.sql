-- Forward contact adapter: current owner/session authority before replay,
-- route-scoped compact legacy claims and atomic v1 mutation/result completion.
-- The CLI is unavailable locally; timestamp captured from actual UTC.
begin;
set local lock_timeout='10s';

-- Preserve the qualified v1 mutation engine and its historical hashes while
-- removing its public service RPC entry point. Only the guarded v2 command
-- below may expose it through the Data API; private is not an exposed schema.
alter function public.gridex_change_customer_contact_v1(jsonb) set schema private;
alter function private.gridex_change_customer_contact_v1(jsonb) rename to gridex_apply_customer_contact_v1;
revoke all on function private.gridex_apply_customer_contact_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.gridex_apply_customer_contact_v1(jsonb) to service_role;

-- Keep the historical signature discoverable, but fail closed even for an
-- owner invocation. Restoring EXECUTE alone must not restore sessionless OPS
-- writes or the older API delegation policy.
create function public.gridex_change_customer_contact_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  raise exception 'contact_legacy_entrypoint_disabled' using errcode='42501';
end;
$function$;
revoke all on function public.gridex_change_customer_contact_v1(jsonb) from public,anon,authenticated,service_role;

create function private.gridex_contact_result_resource_v2(p_company uuid,p_customer uuid,p_target text,p_result jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if current_user<>'service_role' then raise exception 'contact_service_required' using errcode='42501'; end if;
  if nullif(p_result->>'contactId','') is null then return false; end if;
  perform 1 from public.customer_contacts c where c.id=(p_result->>'contactId')::uuid
    and c.company_id=p_company and c.customer_id=p_customer and c.is_primary=(p_target='primary') for share;
  return found;
end;
$function$;
revoke all on function private.gridex_contact_result_resource_v2(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.gridex_contact_result_resource_v2(uuid,uuid,text,jsonb) to service_role;

create function public.gridex_change_customer_contact_v2(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_context jsonb; v_authorization jsonb; v_payload jsonb; v_changes jsonb; v_request jsonb;
  v_company uuid; v_customer uuid; v_actor uuid; v_client uuid; v_selected uuid;
  v_mode text; v_subject text; v_key text; v_scoped_key text; v_json text; v_expected bigint;
  v_expected_json jsonb; v_result jsonb; v_body jsonb; v_updated uuid;
  v_old public.canonical_command_results%rowtype;
  v_claim public.customer_portal_write_idempotency%rowtype;
begin
  if current_user<>'service_role' then raise exception 'contact_service_required' using errcode='42501'; end if;
  if p_command is null or jsonb_typeof(p_command)<>'object'
    or exists(select 1 from jsonb_object_keys(p_command) k(key) where key not in
      ('companyId','customerId','contactId','actorUserId','sessionId','clientId','subject','mode','reason',
        'idempotencyKey','expectedRevision','changes','contactTarget','contactType','requestJson'))
    or jsonb_typeof(p_command->'changes') is distinct from 'object' or p_command->'changes'='{}'::jsonb
    or exists(select 1 from jsonb_object_keys(p_command->'changes') k(key) where key not in ('email','phone','name','title'))
    or coalesce(p_command->>'mode','') not in ('api','ops')
  then raise exception 'invalid_contact_command' using errcode='22023'; end if;
  v_mode:=p_command->>'mode'; v_changes:=p_command->'changes';
  v_expected_json:=p_command->'expectedRevision';
  if v_expected_json is not null and v_expected_json<>'null'::jsonb then
    if jsonb_typeof(v_expected_json)<>'number' or v_expected_json::text !~ '^[0-9]{1,16}$'
      or v_expected_json::numeric>9007199254740991 then
      raise exception 'invalid_contact_command' using errcode='22023'; end if;
    v_expected:=(v_expected_json::text)::bigint;
  end if;
  if v_mode='api' then
    if nullif(p_command->>'contactId','') is not null or p_command ? 'contactTarget' or p_command ? 'contactType'
      or v_changes ? 'name' or v_changes ? 'title' or jsonb_typeof(p_command->'requestJson') is distinct from 'string'
    then raise exception 'invalid_contact_command' using errcode='22023'; end if;
    v_json:=p_command->>'requestJson';
  else
    if v_expected is null then raise exception 'contact_revision_required' using errcode='22023'; end if;
    if coalesce(p_command->'requestJson','null'::jsonb)<>'null'::jsonb then
      raise exception 'invalid_contact_command' using errcode='22023'; end if;
    -- OPS has no historical HTTP compact payload. This is only private
    -- authorization context; v1's immutable canonical request stays unchanged.
    v_json:=(p_command-'sessionId'-'requestJson')::text;
  end if;
  v_authorization:=jsonb_build_object('companyId',p_command->'companyId','customerId',p_command->'customerId',
    'mode',v_mode,'actorUserId',p_command->'actorUserId','sessionId',p_command->'sessionId',
    'clientId',p_command->'clientId','subject',p_command->'subject','reason',p_command->'reason',
    'idempotencyKey',p_command->'idempotencyKey','requestJson',v_json);
  -- Locks the customer, tenant, real OPS session or current API client,
  -- owner account and matching identity before any historical result lookup.
  v_context:=private.gridex_profile_command_authorize_v1(v_authorization,'contact');
  v_company:=(v_context->>'companyId')::uuid; v_customer:=(v_context->>'customerId')::uuid;
  v_actor:=(v_context->>'actorUserId')::uuid; v_client:=(v_context->>'clientId')::uuid;
  v_key:=v_context->>'key'; v_subject:=p_command->>'subject';
  v_selected:=nullif(p_command->>'contactId','')::uuid;
  if v_mode='ops' and v_selected is not null then
    perform 1 from public.customer_contacts c where c.id=v_selected and c.company_id=v_company
      and c.customer_id=v_customer and c.is_primary=(coalesce(p_command->>'contactTarget','primary')='primary') for share;
    if not found then raise exception 'contact_selection_conflict' using errcode='P0001'; end if;
  end if;
  if v_mode='api' then
    v_payload:=jsonb_build_object('profile',v_changes)||case when v_expected is null then '{}'::jsonb
      else jsonb_build_object('expected_contact_revision',v_expected) end;
    if v_context->'payload' is distinct from v_payload then
      raise exception 'invalid_contact_command' using errcode='22023'; end if;
    select * into v_claim from public.customer_portal_write_idempotency where company_id=v_company
      and api_client_id=v_client and customer_id=v_customer and route='/api/v1/customer/profile-update'
      and idempotency_key=v_key for update;
    if found then
      if v_claim.request_hash is distinct from v_context->>'hash' then
        raise exception 'idempotency_conflict' using errcode='P0001'; end if;
      if v_claim.status='completed' then
        perform private.gridex_profile_current_clock_v1(v_context);
        return jsonb_build_object('companyId',v_company,'customerId',v_customer,'replayed',true,
          'publicBody',v_claim.response_body,'statusCode',coalesce(v_claim.response_status,200));
      elsif v_claim.status='failed' then raise exception 'idempotency_previous_attempt_failed' using errcode='P0001';
      else raise exception 'idempotency_in_progress' using errcode='P0001'; end if;
    end if;
  end if;
  -- Preserve known completed v1 results exactly after current authorization.
  -- Its historical company/key namespace is read-only compatibility; fresh
  -- commands use a customer/channel/actor scoped key below.
  v_request:=jsonb_build_object('companyId',v_company,'customerId',v_customer,'mode',v_mode,
    'actorId',v_actor,'clientId',v_client,'contactId',v_selected,
    'subjectHash',case when v_subject is null then null else public.canonical_json_sha256(to_jsonb(v_subject)) end,
    'expectedRevision',v_expected,'changesHash',public.canonical_json_sha256(v_changes));
  if p_command->>'contactTarget'='secondary' then v_request:=v_request||jsonb_build_object(
    'contactTarget','secondary','contactType',p_command->'contactType'); end if;
  select * into v_old from public.canonical_command_results where company_id=v_company
    and command_type='customer.contact.change.v1' and idempotency_key=v_key for update;
  if found and v_old.request_payload->>'customerId'=v_customer::text
    and v_old.request_payload->>'mode'=v_mode
    and (v_old.request_payload->>'clientId') is not distinct from v_client::text
    and (v_old.request_payload->>'actorId') is not distinct from v_actor::text then
    if v_old.request_hash is distinct from public.canonical_json_sha256(v_request) then
      raise exception 'idempotency_conflict' using errcode='P0001'; end if;
    if v_mode='ops' and not private.gridex_contact_result_resource_v2(v_company,v_customer,
        coalesce(p_command->>'contactTarget','primary'),v_old.result_payload) then
      raise exception 'contact_selection_conflict' using errcode='P0001'; end if;
    perform private.gridex_profile_current_clock_v1(v_context);
    return v_old.result_payload||jsonb_build_object('replayed',true);
  end if;
  if v_mode='api' then
    -- Shared route guard checks a completion from any older command category
    -- before claiming. The customer lock serializes contact/preferences/site
    -- and billing changes for this customer.
    v_context:=private.gridex_profile_command_begin_v1(v_authorization,'contact');
    if v_context ? 'replayResult' then
      return jsonb_build_object('companyId',v_company,'customerId',v_customer,'replayed',true,
        'publicBody',v_context#>'{replayResult,body}','statusCode',v_context#>'{replayResult,statusCode}');
    end if;
  end if;
  if v_expected is null then raise exception 'contact_revision_required' using errcode='22023'; end if;
  v_scoped_key:='contact.v2:'||(v_context->>'namespace');
  if v_mode='api' then
    -- A scoped v1 result without this wrapper's original route claim is an
    -- unknown prior effect. Never rewrite its historical completion or infer
    -- that it can safely execute through a newly claimed route.
    perform 1 from public.canonical_command_results where company_id=v_company
      and command_type='customer.contact.change.v1' and idempotency_key=v_scoped_key for update;
    if found then raise exception 'idempotency_conflict' using errcode='P0001'; end if;
  else
    select * into v_old from public.canonical_command_results where company_id=v_company
      and command_type='customer.contact.change.v1' and idempotency_key=v_scoped_key for update;
    if found and not private.gridex_contact_result_resource_v2(v_company,v_customer,
        coalesce(p_command->>'contactTarget','primary'),v_old.result_payload) then
      raise exception 'contact_selection_conflict' using errcode='P0001'; end if;
  end if;
  v_result:=private.gridex_apply_customer_contact_v1((p_command-'sessionId'-'requestJson')||
    jsonb_build_object('idempotencyKey',v_scoped_key));
  if v_mode='api' then
    -- v1 wrote its completion in this same transaction. Keep its immutable
    -- logical data and reference, attach the original route key/compact hash.
    update public.customer_portal_completions set idempotency_key=v_key,request_hash=v_context->>'hash'
      where company_id=v_company and customer_id=v_customer and api_client_id=v_client
        and completion_type='profile_update' and completion_reference=v_result->>'completionReference'
        and idempotency_key=v_scoped_key returning id into v_updated;
    if v_updated is null then raise exception 'contact_completion_failed' using errcode='P0001'; end if;
    v_body:=jsonb_build_object('data',jsonb_build_object('completion_reference',v_result->'completionReference',
      'status','accepted','created_at',v_result->'createdAt','profile_updated',v_result->'changed',
      'contact_revision',v_result->'revision','facility_updated',false,'address_result',null));
    update public.customer_portal_write_idempotency set status='completed',response_status=200,response_body=v_body,
      completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=(v_context->>'claimId')::uuid and company_id=v_company and api_client_id=v_client
        and customer_id=v_customer and route='/api/v1/customer/profile-update' and idempotency_key=v_key
        and request_hash=v_context->>'hash' and status='processing' returning id into v_updated;
    if v_updated is null then raise exception 'contact_completion_failed' using errcode='P0001'; end if;
  end if;
  perform private.gridex_profile_current_clock_v1(v_context);
  return v_result;
end;
$function$;
revoke all on function public.gridex_change_customer_contact_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_change_customer_contact_v2(jsonb) to service_role;
commit;
