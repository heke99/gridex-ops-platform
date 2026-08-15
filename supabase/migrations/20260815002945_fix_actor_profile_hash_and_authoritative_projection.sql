begin;

-- Repair the canonical actor-profile wrapper without weakening the request-hash guard.
-- The wrapper already computes v_hash from the enriched request; persist payload+hash atomically.
do $patch$
declare
  v_def text;
  v_patched text;
  v_old constant text := 'set request_payload = v_command - ''actor_user_id''';
  v_new constant text := 'set request_payload = v_command - ''actor_user_id'', request_hash = v_hash';
begin
  select pg_get_functiondef('public.canonical_save_ediel_actor_profile(jsonb)'::regprocedure) into v_def;
  if strpos(v_def, v_old) = 0 then
    raise exception 'canonical_save_ediel_actor_profile_patch_anchor_missing';
  end if;
  v_patched := replace(v_def, v_old, v_new);
  execute v_patched;
end
$patch$;

create or replace function public.canonical_project_actor_test_result_state(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_company_id uuid := nullif(p_command->>'company_id','')::uuid;
  v_run_id uuid := nullif(p_command->>'test_run_id','')::uuid;
  v_test_case_code text := upper(nullif(btrim(p_command->>'test_case_code'),''));
  v_status text := lower(nullif(btrim(p_command->>'status'),''));
  v_idempotency_key text := nullif(btrim(p_command->>'idempotency_key'),'');
  v_request jsonb := p_command - 'actor_user_id';
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_authoritative public.actor_test_results%rowtype;
  v_result jsonb;
  v_event_id uuid;
begin
  if v_actor_user_id is null or v_company_id is null
     or v_test_case_code is null or v_idempotency_key is null then
    raise exception using errcode='22023', message='actor_company_case_and_idempotency_required';
  end if;
  if v_status not in ('running','failed','blocked') then
    raise exception using errcode='23514', message='authoritative_actor_test_status_requires_evidence_or_attestation';
  end if;
  if not public.gridex_actor_has_company_permission(
    v_actor_user_id,v_company_id,'ediel_testing.write'
  ) then
    raise exception using errcode='42501', message='ediel_testing_write_permission_denied';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('actor-test-projection:'||v_company_id::text||':'||v_test_case_code,0)
  );
  v_hash := public.canonical_json_sha256(v_request);

  select * into v_existing
  from public.canonical_command_results
  where company_id=v_company_id
    and command_type='ediel.test.projection.'||v_status
    and idempotency_key=v_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception using errcode='23505', message='IDEMPOTENCY_KEY_REUSE_MISMATCH';
    end if;
    return v_existing.result_payload;
  end if;

  if v_run_id is not null and not exists(
    select 1 from public.ediel_test_runs r
    where r.id=v_run_id and r.company_id=v_company_id
  ) then
    raise exception using errcode='23503', message='tenant_scoped_test_run_not_found';
  end if;

  select * into v_authoritative
  from public.actor_test_results
  where company_id=v_company_id and test_key=v_test_case_code
  for update;

  -- Preparing/syncing a fresh run is non-authoritative. Never downgrade a current
  -- machine/attested approval merely because the new attempt has entered running.
  -- Real failed/blocked outcomes still replace the approval and therefore remain fail-closed.
  if found
     and v_status='running'
     and v_authoritative.status in ('passed','manual_verified')
     and coalesce(v_authoritative.is_stale,false)=false then
    if v_run_id is not null then
      update public.ediel_test_runs
      set status='running', failure_reason=null, completed_at=null,
          updated_by=v_actor_user_id, updated_at=now()
      where id=v_run_id and company_id=v_company_id;
    end if;

    insert into public.canonical_audit_events(
      company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,
      idempotency_key,after_state,metadata
    ) values(
      v_company_id,'EDIEL_TEST_PROJECTION_PRESERVED_AUTHORITATIVE','actor_test_result',
      coalesce(v_run_id,v_authoritative.id),v_actor_user_id,
      'Running projection preserved current authoritative actor-test approval.',
      v_idempotency_key,jsonb_build_object(
        'test_case_code',v_test_case_code,'status',v_authoritative.status,
        'attempted_status',v_status,'test_run_id',v_run_id,
        'authoritative_result_id',v_authoritative.id
      ),coalesce(p_command->'evidence','{}'::jsonb)
    );
    insert into public.canonical_domain_events(
      company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
    ) values(
      v_company_id,'EDIEL_TEST_PROJECTION_PRESERVED_AUTHORITATIVE','actor_test_result',
      coalesce(v_run_id,v_authoritative.id),v_idempotency_key,
      jsonb_build_object(
        'test_case_code',v_test_case_code,'status',v_authoritative.status,
        'attempted_status',v_status,'test_run_id',v_run_id,
        'authoritative_result_id',v_authoritative.id
      ),v_actor_user_id
    ) returning id into v_event_id;
    insert into public.canonical_event_outbox(
      company_id,domain_event_id,topic,idempotency_key,payload
    ) values(
      v_company_id,v_event_id,'ediel.test.projection.preserved_authoritative',v_idempotency_key,
      jsonb_build_object(
        'test_case_code',v_test_case_code,'status',v_authoritative.status,
        'attempted_status',v_status,'test_run_id',v_run_id
      )
    );

    v_result:=jsonb_build_object(
      'changed',false,'preserved_authoritative',true,'company_id',v_company_id,
      'test_case_code',v_test_case_code,'status',v_authoritative.status,
      'attempted_status',v_status,'test_run_id',v_run_id,
      'authoritative_result_id',v_authoritative.id
    );
    insert into public.canonical_command_results(
      company_id,command_type,idempotency_key,request_hash,request_payload,result_payload,actor_user_id
    ) values(
      v_company_id,'ediel.test.projection.'||v_status,v_idempotency_key,v_hash,v_request,v_result,v_actor_user_id
    );
    return v_result;
  end if;

  insert into public.actor_test_results(
    company_id,test_key,test_name,test_id,package_key,message_family,message_code,direction,
    status,latest_run_at,passed_at,failure_reason,portal_status,raw_payload,
    ediel_test_run_id,evidence,is_stale,stale_reason,created_by,updated_by,created_at,updated_at
  ) values(
    v_company_id,v_test_case_code,nullif(p_command->>'test_name',''),nullif(p_command->>'test_id',''),
    nullif(p_command->>'package_key',''),nullif(p_command->>'message_family',''),
    nullif(p_command->>'message_code',''),nullif(p_command->>'direction',''),
    v_status,now(),null,nullif(p_command->>'failure_reason',''),nullif(p_command->>'portal_status',''),
    nullif(p_command->>'raw_payload',''),v_run_id,coalesce(p_command->'evidence','{}'::jsonb),
    false,null,v_actor_user_id,v_actor_user_id,now(),now()
  ) on conflict(company_id,test_key) do update set
    test_name=coalesce(excluded.test_name,public.actor_test_results.test_name),
    test_id=coalesce(excluded.test_id,public.actor_test_results.test_id),
    package_key=coalesce(excluded.package_key,public.actor_test_results.package_key),
    message_family=coalesce(excluded.message_family,public.actor_test_results.message_family),
    message_code=coalesce(excluded.message_code,public.actor_test_results.message_code),
    direction=coalesce(excluded.direction,public.actor_test_results.direction),
    status=excluded.status,latest_run_at=excluded.latest_run_at,passed_at=null,
    failure_reason=excluded.failure_reason,portal_status=excluded.portal_status,
    raw_payload=excluded.raw_payload,
    ediel_test_run_id=coalesce(excluded.ediel_test_run_id,public.actor_test_results.ediel_test_run_id),
    evidence=excluded.evidence,is_stale=false,stale_reason=null,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  if v_run_id is not null then
    update public.ediel_test_runs
    set status=case when v_status='running' then 'running' else 'failed' end,
        failure_reason=nullif(p_command->>'failure_reason',''),
        completed_at=case when v_status='running' then null else now() end,
        updated_by=v_actor_user_id,updated_at=now()
    where id=v_run_id and company_id=v_company_id;
  end if;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,
    idempotency_key,after_state,metadata
  ) values(
    v_company_id,'EDIEL_TEST_PROJECTION_UPDATED','actor_test_result',
    coalesce(v_run_id,v_company_id),v_actor_user_id,
    coalesce(nullif(p_command->>'failure_reason',''),'Non-authoritative actor-test projection updated'),
    v_idempotency_key,jsonb_build_object(
      'test_case_code',v_test_case_code,'status',v_status,'test_run_id',v_run_id
    ),coalesce(p_command->'evidence','{}'::jsonb)
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values(
    v_company_id,'EDIEL_TEST_PROJECTION_UPDATED','actor_test_result',
    coalesce(v_run_id,v_company_id),v_idempotency_key,
    jsonb_build_object('test_case_code',v_test_case_code,'status',v_status,'test_run_id',v_run_id),
    v_actor_user_id
  ) returning id into v_event_id;
  insert into public.canonical_event_outbox(
    company_id,domain_event_id,topic,idempotency_key,payload
  ) values(
    v_company_id,v_event_id,'ediel.test.projection.updated',v_idempotency_key,
    jsonb_build_object('test_case_code',v_test_case_code,'status',v_status,'test_run_id',v_run_id)
  );

  v_result:=jsonb_build_object(
    'changed',true,'company_id',v_company_id,'test_case_code',v_test_case_code,
    'status',v_status,'test_run_id',v_run_id
  );
  insert into public.canonical_command_results(
    company_id,command_type,idempotency_key,request_hash,request_payload,result_payload,actor_user_id
  ) values(
    v_company_id,'ediel.test.projection.'||v_status,v_idempotency_key,v_hash,v_request,v_result,v_actor_user_id
  );
  return v_result;
end
$function$;

revoke all on function public.canonical_project_actor_test_result_state(jsonb) from public,anon,authenticated;
grant execute on function public.canonical_project_actor_test_result_state(jsonb) to service_role;

commit;
