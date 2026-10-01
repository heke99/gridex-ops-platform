-- Durable bounded agreement-orphan settlement. No external release or delivery.
begin;
set local lock_timeout='10s';

alter function private.gridex_agreement_command_v1(jsonb) rename to gridex_agreement_command_v1_unchecked;
revoke all on function private.gridex_agreement_command_v1_unchecked(jsonb) from public,anon,authenticated,service_role;

create function private.gridex_agreement_command_v1(p_command jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $function$
declare v_document text; v_bucket text; v_path text; v_upload private.gridex_agreement_uploads_v1%rowtype;
begin
  if p_command->>'operation'='save' then
    if p_command->'payload'->'documentFile' is not null then
      select * into v_upload from private.gridex_agreement_uploads_v1
        where id=nullif(p_command->>'uploadIntentId','')::uuid;
      if found then v_bucket:=v_upload.bucket; v_path:=v_upload.object_key; end if;
    else
      v_document:=nullif(btrim(p_command->'payload'->>'documentPath'),'');
      if v_document is not null then
        v_bucket:=case when strpos(v_document,':')>0 then split_part(v_document,':',1) else 'grid-owner-agreements' end;
        v_path:=case when strpos(v_document,':')>0 then substr(v_document,strpos(v_document,':')+1) else v_document end;
      end if;
    end if;
    if v_path is not null then
      -- Consistent order: exact object before the old command's actor/key lock.
      perform pg_advisory_xact_lock(hashtextextended('agreement-object:'||v_bucket||':'||v_path,0));
      if p_command->'payload'->'documentFile' is null then
        perform 1 from private.gridex_agreement_uploads_v1 u
          where u.bucket=v_bucket and u.object_key=v_path and u.status<>'attached' for share;
        if found then raise exception 'agreement_document_reserved' using errcode='PT409'; end if;
      end if;
    end if;
  end if;
  return private.gridex_agreement_command_v1_unchecked(p_command);
end;
$function$;
revoke all on function private.gridex_agreement_command_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.gridex_agreement_command_v1(jsonb) to service_role;
-- Refresh cached callers after renaming the private implementation.
create or replace function public.gridex_grid_owner_agreement_command_v1(p_command jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if current_user<>'service_role' then raise exception 'agreement_service_required' using errcode='42501'; end if;
  return private.gridex_agreement_command_v1(p_command);
end;
$function$;
revoke all on function public.gridex_grid_owner_agreement_command_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_grid_owner_agreement_command_v1(jsonb) to service_role;

create table private.gridex_agreement_cleanup_claims_v1(
  upload_intent_id uuid primary key references private.gridex_agreement_uploads_v1(id),
  claim_token uuid not null,attempt integer not null check(attempt>0),lease_until timestamptz not null,
  next_attempt_at timestamptz not null,last_outcome text not null check(last_outcome in('claimed','removed','retry')),
  updated_at timestamptz not null default clock_timestamp()
);
create table private.gridex_agreement_cleanup_events_v1(
  id uuid primary key default gen_random_uuid(),upload_intent_id uuid not null,company_id uuid,actor_user_id uuid not null,
  claim_token uuid not null,attempt integer not null,phase text not null check(phase in('claim','finish')),
  outcome text not null check(outcome in('claimed','removed','retry')),receipt_hash text not null,
  created_at timestamptz not null default clock_timestamp(),unique(upload_intent_id,claim_token,phase)
);
alter table private.gridex_agreement_cleanup_claims_v1 enable row level security;
alter table private.gridex_agreement_cleanup_events_v1 enable row level security;
revoke all on private.gridex_agreement_cleanup_claims_v1,private.gridex_agreement_cleanup_events_v1 from public,anon,authenticated,service_role;
create trigger gridex_agreement_cleanup_events_immutable_v1 before update or delete on private.gridex_agreement_cleanup_events_v1
  for each row execute function private.gridex_agreement_immutable_v1();

create function private.gridex_agreement_cleanup_receipt_v1(p_upload private.gridex_agreement_uploads_v1,p_claim private.gridex_agreement_cleanup_claims_v1)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $function$
  select jsonb_build_object('uploadIntentId',p_upload.id,'companyId',p_upload.company_id,'actorUserId',p_upload.actor_user_id,
    'claimToken',p_claim.claim_token,'attempt',p_claim.attempt,'bucket',p_upload.bucket,'path',p_upload.object_key,
    'fileSha256',p_upload.file_sha256,'leaseExpiresAt',floor(extract(epoch from p_claim.lease_until))::bigint);
$function$;
revoke all on function private.gridex_agreement_cleanup_receipt_v1(private.gridex_agreement_uploads_v1,private.gridex_agreement_cleanup_claims_v1) from public,anon,authenticated,service_role;

create function private.gridex_agreement_cleanup_referenced_v1(p_bucket text,p_path text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $function$
begin
  perform 1 from public.grid_owner_access_agreements a where a.document_path=p_bucket||':'||p_path
    or (p_bucket='grid-owner-agreements' and a.document_path=p_path) for share;
  if found then return true; end if;
  return exists(select 1 from private.gridex_agreement_results_v1 r
    where r.result_payload->'agreement'->>'document_path'=p_bucket||':'||p_path
      or (p_bucket='grid-owner-agreements' and r.result_payload->'agreement'->>'document_path'=p_path));
end;
$function$;
revoke all on function private.gridex_agreement_cleanup_referenced_v1(text,text) from public,anon,authenticated,service_role;

create function private.gridex_claim_agreement_cleanup_v1(p_company_id uuid,p_claim_token uuid,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog set lock_timeout='5s' as $function$
declare v_candidate record; v_upload private.gridex_agreement_uploads_v1%rowtype;
  v_claim private.gridex_agreement_cleanup_claims_v1%rowtype; v_receipt jsonb; v_result jsonb:='[]';
begin
  if p_claim_token is null or p_limit is null or p_limit not between 1 and 10 then
    raise exception 'invalid_agreement_cleanup' using errcode='22023'; end if;
  for v_candidate in select u.id,u.bucket,u.object_key,u.actor_user_id,u.idempotency_key
    from private.gridex_agreement_uploads_v1 u left join private.gridex_agreement_cleanup_claims_v1 c on c.upload_intent_id=u.id
    where u.company_id is not distinct from p_company_id and u.status in('prepared','cleanup_required','cleaned') and u.result_id is null
      and (u.status<>'prepared' or u.created_at<=clock_timestamp()-interval '15 minutes')
      and (c.upload_intent_id is null or (c.lease_until<=clock_timestamp() and c.next_attempt_at<=clock_timestamp()))
    order by u.created_at,u.id limit 100 loop
    exit when jsonb_array_length(v_result)>=p_limit;
    if not pg_try_advisory_xact_lock(hashtextextended('agreement-object:'||v_candidate.bucket||':'||v_candidate.object_key,0)) then continue; end if;
    if not pg_try_advisory_xact_lock(hashtextextended('grid-owner-agreement:'||v_candidate.actor_user_id::text||':'||v_candidate.idempotency_key,0)) then continue; end if;
    select * into v_upload from private.gridex_agreement_uploads_v1 u where u.id=v_candidate.id
      and u.company_id is not distinct from p_company_id and u.status in('prepared','cleanup_required','cleaned') and u.result_id is null
      and (u.status<>'prepared' or u.created_at<=clock_timestamp()-interval '15 minutes') for update skip locked;
    if not found or v_upload.bucket='customer-support-quarantine' or not private.gridex_agreement_object_path_v1(v_upload.object_key)
      or v_upload.file_sha256 !~ '^[a-f0-9]{64}$' then continue; end if;
    perform 1 from storage.buckets b where b.id=v_upload.bucket and not b.public for share;
    if not found or private.gridex_agreement_cleanup_referenced_v1(v_upload.bucket,v_upload.object_key) then continue; end if;
    select * into v_claim from private.gridex_agreement_cleanup_claims_v1 c where c.upload_intent_id=v_upload.id for update;
    if found and (v_claim.lease_until>clock_timestamp() or v_claim.next_attempt_at>clock_timestamp()) then continue; end if;
    update private.gridex_agreement_uploads_v1 set status='cleanup_required',updated_at=clock_timestamp() where id=v_upload.id returning * into v_upload;
    insert into private.gridex_agreement_cleanup_claims_v1(upload_intent_id,claim_token,attempt,lease_until,next_attempt_at,last_outcome)
      values(v_upload.id,p_claim_token,1,clock_timestamp()+interval '2 minutes',clock_timestamp(),'claimed')
      on conflict(upload_intent_id) do update set claim_token=excluded.claim_token,attempt=gridex_agreement_cleanup_claims_v1.attempt+1,
        lease_until=excluded.lease_until,next_attempt_at=excluded.next_attempt_at,last_outcome='claimed',updated_at=clock_timestamp()
      returning * into v_claim;
    v_receipt:=private.gridex_agreement_cleanup_receipt_v1(v_upload,v_claim);
    insert into private.gridex_agreement_cleanup_events_v1(upload_intent_id,company_id,actor_user_id,claim_token,attempt,phase,outcome,receipt_hash)
      values(v_upload.id,v_upload.company_id,v_upload.actor_user_id,p_claim_token,v_claim.attempt,'claim','claimed',encode(sha256(convert_to(v_receipt::text,'UTF8')),'hex'));
    if v_claim.lease_until<=clock_timestamp() then raise exception 'agreement_cleanup_stale' using errcode='PT409'; end if;
    v_result:=v_result||jsonb_build_array(v_receipt);
  end loop;
  return v_result;
end;
$function$;
revoke all on function private.gridex_claim_agreement_cleanup_v1(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.gridex_claim_agreement_cleanup_v1(uuid,uuid,integer) to service_role;

create function private.gridex_validate_agreement_cleanup_v1(p_receipt jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog set lock_timeout='5s' as $function$
declare v_upload private.gridex_agreement_uploads_v1%rowtype; v_claim private.gridex_agreement_cleanup_claims_v1%rowtype;
begin
  if jsonb_typeof(p_receipt)<>'object' or (p_receipt-array['uploadIntentId','companyId','actorUserId','claimToken','attempt','bucket','path','fileSha256','leaseExpiresAt'])<>'{}'::jsonb then return false; end if;
  select * into v_upload from private.gridex_agreement_uploads_v1 where id=nullif(p_receipt->>'uploadIntentId','')::uuid;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('agreement-object:'||v_upload.bucket||':'||v_upload.object_key,0));
  perform pg_advisory_xact_lock(hashtextextended('grid-owner-agreement:'||v_upload.actor_user_id::text||':'||v_upload.idempotency_key,0));
  select * into v_upload from private.gridex_agreement_uploads_v1 where id=v_upload.id and status in('cleanup_required','cleaned') and result_id is null for update;
  if not found then return false; end if;
  select * into v_claim from private.gridex_agreement_cleanup_claims_v1 where upload_intent_id=v_upload.id
    and claim_token=nullif(p_receipt->>'claimToken','')::uuid and attempt=(p_receipt->>'attempt')::integer for update;
  if not found or v_claim.lease_until<=clock_timestamp() or v_claim.last_outcome<>'claimed'
    or private.gridex_agreement_cleanup_receipt_v1(v_upload,v_claim)<>p_receipt then return false; end if;
  perform 1 from storage.buckets b where b.id=v_upload.bucket and not b.public for share;
  return found and v_upload.bucket<>'customer-support-quarantine'
    and not private.gridex_agreement_cleanup_referenced_v1(v_upload.bucket,v_upload.object_key)
    and v_claim.lease_until>clock_timestamp();
end;
$function$;
revoke all on function private.gridex_validate_agreement_cleanup_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.gridex_validate_agreement_cleanup_v1(jsonb) to service_role;

create function private.gridex_finish_agreement_cleanup_v1(p_receipt jsonb,p_outcome text) returns jsonb
language plpgsql security definer set search_path=pg_catalog set lock_timeout='5s' as $function$
declare v_event private.gridex_agreement_cleanup_events_v1%rowtype; v_upload private.gridex_agreement_uploads_v1%rowtype;
  v_hash text:=encode(sha256(convert_to(p_receipt::text,'UTF8')),'hex');
begin
  if p_outcome not in('removed','retry') or p_outcome is null then raise exception 'invalid_agreement_cleanup' using errcode='22023'; end if;
  select * into v_event from private.gridex_agreement_cleanup_events_v1 where upload_intent_id=nullif(p_receipt->>'uploadIntentId','')::uuid
    and claim_token=nullif(p_receipt->>'claimToken','')::uuid and phase='finish';
  if found then
    if v_event.receipt_hash<>v_hash or v_event.outcome<>p_outcome then raise exception 'agreement_cleanup_conflict' using errcode='PT409'; end if;
    return jsonb_build_object('finished',true,'replayed',true);
  end if;
  if not private.gridex_validate_agreement_cleanup_v1(p_receipt) then
    -- A concurrent identical finish may have committed while validation waited.
    select * into v_event from private.gridex_agreement_cleanup_events_v1 where upload_intent_id=nullif(p_receipt->>'uploadIntentId','')::uuid
      and claim_token=nullif(p_receipt->>'claimToken','')::uuid and phase='finish';
    if found and v_event.receipt_hash=v_hash and v_event.outcome=p_outcome then return jsonb_build_object('finished',true,'replayed',true); end if;
    raise exception 'agreement_cleanup_stale' using errcode='PT409';
  end if;
  select * into v_upload from private.gridex_agreement_uploads_v1 where id=(p_receipt->>'uploadIntentId')::uuid for update;
  update private.gridex_agreement_cleanup_claims_v1 set last_outcome=p_outcome,lease_until=clock_timestamp(),
    next_attempt_at=clock_timestamp()+case when p_outcome='removed' then interval '1 hour' else interval '1 minute' end,updated_at=clock_timestamp()
    where upload_intent_id=v_upload.id and claim_token=(p_receipt->>'claimToken')::uuid and attempt=(p_receipt->>'attempt')::integer;
  if not found then raise exception 'agreement_cleanup_stale' using errcode='PT409'; end if;
  update private.gridex_agreement_uploads_v1 set status=case when p_outcome='removed' then 'cleaned' else 'cleanup_required' end,updated_at=clock_timestamp() where id=v_upload.id;
  insert into private.gridex_agreement_cleanup_events_v1(upload_intent_id,company_id,actor_user_id,claim_token,attempt,phase,outcome,receipt_hash)
    values(v_upload.id,v_upload.company_id,v_upload.actor_user_id,(p_receipt->>'claimToken')::uuid,(p_receipt->>'attempt')::integer,'finish',p_outcome,v_hash);
  if to_timestamp((p_receipt->>'leaseExpiresAt')::bigint)<=clock_timestamp() then raise exception 'agreement_cleanup_stale' using errcode='PT409'; end if;
  return jsonb_build_object('finished',true,'replayed',false);
end;
$function$;
revoke all on function private.gridex_finish_agreement_cleanup_v1(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function private.gridex_finish_agreement_cleanup_v1(jsonb,text) to service_role;

create function public.gridex_claim_agreement_cleanup_v1(p_company_id uuid,p_claim_token uuid,p_limit integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if current_user<>'service_role' then raise exception 'agreement_service_required' using errcode='42501'; end if;
  return private.gridex_claim_agreement_cleanup_v1(p_company_id,p_claim_token,p_limit);
end;
$function$;
create function public.gridex_validate_agreement_cleanup_v1(p_receipt jsonb) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if current_user<>'service_role' then raise exception 'agreement_service_required' using errcode='42501'; end if;
  return private.gridex_validate_agreement_cleanup_v1(p_receipt);
end;
$function$;
create function public.gridex_finish_agreement_cleanup_v1(p_receipt jsonb,p_outcome text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if current_user<>'service_role' then raise exception 'agreement_service_required' using errcode='42501'; end if;
  return private.gridex_finish_agreement_cleanup_v1(p_receipt,p_outcome);
end;
$function$;
revoke all on function public.gridex_claim_agreement_cleanup_v1(uuid,uuid,integer),public.gridex_validate_agreement_cleanup_v1(jsonb),public.gridex_finish_agreement_cleanup_v1(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.gridex_claim_agreement_cleanup_v1(uuid,uuid,integer),public.gridex_validate_agreement_cleanup_v1(jsonb),public.gridex_finish_agreement_cleanup_v1(jsonb,text) to service_role;

-- Preserve the existing private writer's owner without granting any caller role.
do $owner$
declare v_owner text; v_signature text;
begin
  select pg_get_userbyid(proowner) into v_owner from pg_catalog.pg_proc where oid='private.gridex_agreement_command_v1_unchecked(jsonb)'::regprocedure;
  if v_owner in('anon','authenticated','service_role') then raise exception 'agreement_writer_owner_incompatible'; end if;
  for v_signature in select unnest(array[
    'private.gridex_agreement_command_v1(jsonb)',
    'private.gridex_agreement_cleanup_receipt_v1(private.gridex_agreement_uploads_v1,private.gridex_agreement_cleanup_claims_v1)',
    'private.gridex_agreement_cleanup_referenced_v1(text,text)',
    'private.gridex_claim_agreement_cleanup_v1(uuid,uuid,integer)',
    'private.gridex_validate_agreement_cleanup_v1(jsonb)',
    'private.gridex_finish_agreement_cleanup_v1(jsonb,text)']) loop
    execute format('alter function %s owner to %I',v_signature,v_owner);
  end loop;
  execute format('alter table private.gridex_agreement_cleanup_claims_v1 owner to %I',v_owner);
  execute format('alter table private.gridex_agreement_cleanup_events_v1 owner to %I',v_owner);
end;
$owner$;
notify pgrst,'reload schema';
commit;
