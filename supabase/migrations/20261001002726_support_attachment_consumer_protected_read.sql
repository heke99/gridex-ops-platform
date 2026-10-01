begin;
-- Dedicated scan consumption does not repurpose or rewind the generic event bus.
create table private.support_attachment_scan_jobs(
  scan_intent_id uuid primary key references public.canonical_event_outbox(id),
  company_id uuid not null references public.companies(id),attachment_id uuid not null references public.customer_support_attachments(id),
  source_binding jsonb not null,status text not null default 'queued'
    check(status in ('queued','processing','blocked_scanner_qualification','evidence_recorded','needs_review')),
  available_at timestamptz not null default clock_timestamp(),claim_token uuid,claimed_at timestamptz,claim_expires_at timestamptz,
  scan_nonce_id uuid references private.support_attachment_scan_challenges(nonce_id),
  claim_count integer not null default 0 check(claim_count between 0 and 1000000),last_reason text,
  updated_at timestamptz not null default clock_timestamp(),
  check((status='processing')=(claim_token is not null and claimed_at is not null and claim_expires_at is not null))
);
create index support_attachment_scan_jobs_due on private.support_attachment_scan_jobs(company_id,status,available_at,scan_intent_id);
create unique index support_attachment_scan_jobs_nonce on private.support_attachment_scan_jobs(scan_nonce_id) where scan_nonce_id is not null;
create table private.support_attachment_scan_turns(company_id uuid primary key references public.companies(id),last_claimed_at timestamptz not null);
create table private.support_attachment_read_nonces(
  nonce_id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
  attachment_id uuid not null references public.customer_support_attachments(id),actor_context jsonb not null,binding jsonb not null,
  issued_at bigint not null,expires_at bigint not null check(expires_at>issued_at and expires_at-issued_at<=60),consumed_at timestamptz
);
create index support_attachment_read_nonce_owner on private.support_attachment_read_nonces(company_id,expires_at);
alter table private.support_attachment_scan_jobs enable row level security;
alter table private.support_attachment_scan_turns enable row level security;
alter table private.support_attachment_read_nonces enable row level security;
revoke all on private.support_attachment_scan_jobs,private.support_attachment_scan_turns,private.support_attachment_read_nonces from public,anon,authenticated;
grant select,insert,update on private.support_attachment_scan_jobs,private.support_attachment_scan_turns,private.support_attachment_read_nonces to service_role;
create function private.gridex_support_attachment_consumer_guard_v1()returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op<>'UPDATE' then raise exception 'support_attachment_consumer_identity_immutable' using errcode='55000'; end if;
  if tg_table_name='support_attachment_scan_jobs' then
    if (to_jsonb(new)-array['status','available_at','claim_token','claimed_at','claim_expires_at','scan_nonce_id','claim_count','last_reason','updated_at'])
      is distinct from (to_jsonb(old)-array['status','available_at','claim_token','claimed_at','claim_expires_at','scan_nonce_id','claim_count','last_reason','updated_at'])
      or (old.scan_nonce_id is not null and new.scan_nonce_id is distinct from old.scan_nonce_id) then
      raise exception 'support_attachment_consumer_identity_immutable' using errcode='55000'; end if;
  elsif (to_jsonb(new)-'consumed_at') is distinct from (to_jsonb(old)-'consumed_at') or old.consumed_at is not null or new.consumed_at is null then
    raise exception 'support_attachment_read_nonce_immutable' using errcode='55000';
  end if;
  return new;
end;$$;
revoke all on function private.gridex_support_attachment_consumer_guard_v1() from public,anon,authenticated;
create trigger support_attachment_scan_job_identity before update or delete on private.support_attachment_scan_jobs
  for each row execute function private.gridex_support_attachment_consumer_guard_v1();
create trigger support_attachment_read_nonce_identity before update or delete on private.support_attachment_read_nonces
  for each row execute function private.gridex_support_attachment_consumer_guard_v1();

create function public.gridex_claim_support_attachment_scans_v1(p_company_id uuid,p_limit integer,p_claim_token uuid)
returns setof jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare v_now timestamptz:=clock_timestamp();
begin
  if current_user<>'service_role' then raise exception 'support_scan_service_required' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 20 or p_claim_token is null then raise exception 'invalid_support_scan' using errcode='22023'; end if;
  -- One namespace mutex also serializes first seed/turn updates across workers.
  perform pg_advisory_xact_lock(hashtextextended('support_attachment_scan_consumer_v1',0));
  with stale as (select scan_intent_id from private.support_attachment_scan_jobs
    where status='processing' and claim_expires_at<=v_now and (p_company_id is null or company_id=p_company_id)
    order by claim_expires_at,scan_intent_id limit 20 for update skip locked)
  update private.support_attachment_scan_jobs j set status='needs_review',claim_token=null,claimed_at=null,claim_expires_at=null,
    last_reason='scan_claim_expired_no_automatic_redispatch',updated_at=v_now from stale where j.scan_intent_id=stale.scan_intent_id;
  with intents as (
    select o.*,row_number()over(partition by o.company_id order by o.created_at,o.id) as tenant_rank,t.last_claimed_at
    from public.canonical_event_outbox o join public.customer_support_attachments a on a.company_id=o.company_id
      and a.id::text=o.payload->>'attachmentId' and a.customer_id::text=o.payload->>'customerId' and a.customer_case_id::text=o.payload->>'caseId'
    join public.companies c on c.id=o.company_id and c.is_active and c.status='active'
    left join private.support_attachment_scan_turns t on t.company_id=o.company_id
    where o.topic='customer.support.attachment.scan_requested' and o.available_at<=v_now and a.uploaded_at is not null
      and (p_company_id is null or o.company_id=p_company_id)
      and not exists(select 1 from private.support_attachment_scan_jobs j where j.scan_intent_id=o.id)
  ), chosen as(select * from intents where tenant_rank<=5 order by tenant_rank,last_claimed_at nulls first,created_at,id limit 100)
  insert into private.support_attachment_scan_jobs(scan_intent_id,company_id,attachment_id,source_binding,available_at)
    select id,company_id,(payload->>'attachmentId')::uuid,jsonb_build_object('companyId',company_id,'domainEventId',domain_event_id,
      'topic',topic,'idempotencyKey',idempotency_key,'payload',payload),available_at from chosen on conflict(scan_intent_id)do nothing;
  return query with ranked as(
    select j.scan_intent_id,row_number()over(partition by j.company_id order by j.available_at,j.scan_intent_id) as tenant_rank,t.last_claimed_at
    from private.support_attachment_scan_jobs j join public.companies c on c.id=j.company_id and c.is_active and c.status='active'
    left join private.support_attachment_scan_turns t on t.company_id=j.company_id
    where j.status in ('queued','blocked_scanner_qualification') and j.available_at<=v_now and j.claim_count<1000000
      and (p_company_id is null or j.company_id=p_company_id)
  ),chosen as(select j.scan_intent_id from private.support_attachment_scan_jobs j join ranked r using(scan_intent_id)
    where r.tenant_rank<=5 order by r.tenant_rank,r.last_claimed_at nulls first,j.available_at,j.scan_intent_id
    limit p_limit for update of j skip locked),applied as(
    update private.support_attachment_scan_jobs j set status='processing',claim_token=p_claim_token,claimed_at=v_now,
      claim_expires_at=v_now+interval '5 minutes',claim_count=claim_count+1,last_reason=null,updated_at=v_now
    from chosen where j.scan_intent_id=chosen.scan_intent_id and j.status in ('queued','blocked_scanner_qualification') returning j.*
  ),turns as(insert into private.support_attachment_scan_turns(company_id,last_claimed_at)
    select distinct company_id,v_now from applied on conflict(company_id)do update set last_claimed_at=excluded.last_claimed_at returning company_id)
  select jsonb_build_object('scanIntentId',a.scan_intent_id,'companyId',a.company_id,'attachmentId',a.attachment_id,'claimToken',a.claim_token)
    from applied a join turns using(company_id) order by a.available_at,a.scan_intent_id;
end;$$;
revoke all on function public.gridex_claim_support_attachment_scans_v1(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.gridex_claim_support_attachment_scans_v1(uuid,integer,uuid) to service_role;

create function private.gridex_support_scan_job_source_v1(p_intent uuid,p_company uuid,p_attachment uuid,p_binding jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare lineage jsonb;o public.canonical_event_outbox%rowtype;
begin
  lineage:=private.gridex_support_scan_lineage_v1(p_company,p_attachment);
  select * into o from public.canonical_event_outbox where id=p_intent and company_id=p_company for share;
  if not found or lineage->>'scanIntentId' is distinct from p_intent::text or p_binding is distinct from
    jsonb_build_object('companyId',o.company_id,'domainEventId',o.domain_event_id,'topic',o.topic,'idempotencyKey',o.idempotency_key,'payload',o.payload) then
    raise exception 'support_scan_intent_changed' using errcode='23503'; end if;
  return lineage;
end;$$;
revoke all on function private.gridex_support_scan_job_source_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.gridex_support_scan_job_source_v1(uuid,uuid,uuid,jsonb) to service_role;

create function public.gridex_bind_support_attachment_scan_claim_v1(p_intent_id uuid,p_claim_token uuid,p_nonce_id uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare j private.support_attachment_scan_jobs%rowtype;ch private.support_attachment_scan_challenges%rowtype;lineage jsonb;
begin
  if current_user<>'service_role' then raise exception 'support_scan_service_required' using errcode='42501'; end if;
  select * into j from private.support_attachment_scan_jobs where scan_intent_id=p_intent_id;
  if not found then raise exception 'support_scan_claim_unavailable' using errcode='42501'; end if;
  lineage:=private.gridex_support_scan_job_source_v1(j.scan_intent_id,j.company_id,j.attachment_id,j.source_binding);
  select * into ch from private.support_attachment_scan_challenges where nonce_id=p_nonce_id and company_id=j.company_id and attachment_id=j.attachment_id for share;
  if not found or ch.consumed_at is not null or ch.expires_at<=floor(extract(epoch from clock_timestamp()))::bigint
    or ch.binding-array['nonceId','issuedAt','expiresAt','issuerHash','subjectHash','keyHash'] is distinct from lineage then
    raise exception 'support_scan_nonce_unavailable' using errcode='42501'; end if;
  update private.support_attachment_scan_jobs set scan_nonce_id=p_nonce_id,updated_at=clock_timestamp()
    where scan_intent_id=p_intent_id and status='processing' and claim_token=p_claim_token and claim_expires_at>clock_timestamp()
      and (scan_nonce_id is null or scan_nonce_id=p_nonce_id);
  if not found then raise exception 'support_scan_claim_unavailable' using errcode='42501'; end if;
  return true;
end;$$;
revoke all on function public.gridex_bind_support_attachment_scan_claim_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gridex_bind_support_attachment_scan_claim_v1(uuid,uuid,uuid) to service_role;

create function public.gridex_get_support_attachment_scan_callback_v1(p_nonce_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare j private.support_attachment_scan_jobs%rowtype;ch private.support_attachment_scan_challenges%rowtype;lineage jsonb;r private.support_attachment_scanner_roots%rowtype;
begin
  if current_user<>'service_role' then raise exception 'support_scan_service_required' using errcode='42501'; end if;
  select * into j from private.support_attachment_scan_jobs where scan_nonce_id=p_nonce_id;
  if not found or j.status not in ('processing','evidence_recorded') or (j.status='processing' and j.claim_expires_at<=clock_timestamp()) then
    raise exception 'support_scan_claim_unavailable' using errcode='42501'; end if;
  lineage:=private.gridex_support_scan_job_source_v1(j.scan_intent_id,j.company_id,j.attachment_id,j.source_binding);
  select * into ch from private.support_attachment_scan_challenges where nonce_id=p_nonce_id for share;
  if not found or ch.expires_at<=floor(extract(epoch from clock_timestamp()))::bigint
    or ch.binding-array['nonceId','issuedAt','expiresAt','issuerHash','subjectHash','keyHash'] is distinct from lineage then
    raise exception 'support_scan_nonce_unavailable' using errcode='42501'; end if;
  r:=private.gridex_support_scanner_root_v1(j.company_id,jsonb_build_object('issuerHash',ch.binding->>'issuerHash',
    'subjectHash',ch.binding->>'subjectHash','keyHash',ch.binding->>'keyHash'));
  if r.valid_until is not null and r.valid_until<=clock_timestamp() then raise exception 'support_scanner_unavailable' using errcode='42501'; end if;
  return jsonb_build_object('challenge',ch.binding,'scanIntentId',j.scan_intent_id,'claimToken',j.claim_token,'status',j.status);
end;$$;
revoke all on function public.gridex_get_support_attachment_scan_callback_v1(uuid) from public,anon,authenticated;
grant execute on function public.gridex_get_support_attachment_scan_callback_v1(uuid) to service_role;

create function public.gridex_finish_support_attachment_scan_claim_v1(p_intent_id uuid,p_claim_token uuid,p_outcome text)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare j private.support_attachment_scan_jobs%rowtype;lineage jsonb;
begin
  if current_user<>'service_role' then raise exception 'support_scan_service_required' using errcode='42501'; end if;
  if p_outcome is null or p_outcome not in ('blocked_scanner_qualification','evidence_recorded','needs_review') then
    raise exception 'invalid_support_scan' using errcode='22023'; end if;
  select * into j from private.support_attachment_scan_jobs where scan_intent_id=p_intent_id;
  if not found then raise exception 'support_scan_claim_unavailable' using errcode='42501'; end if;
  lineage:=private.gridex_support_scan_job_source_v1(j.scan_intent_id,j.company_id,j.attachment_id,j.source_binding);
  if p_outcome='evidence_recorded' and not exists(select 1 from private.support_attachment_scan_receipts
    where nonce_id=j.scan_nonce_id and company_id=j.company_id and attachment_id=j.attachment_id
      and binding-array['nonceId','issuedAt','expiresAt','issuerHash','subjectHash','keyHash']=lineage) then
    raise exception 'support_scan_receipt_required' using errcode='42501'; end if;
  update private.support_attachment_scan_jobs set status=p_outcome,claim_token=null,claimed_at=null,claim_expires_at=null,
    available_at=clock_timestamp()+interval '5 minutes',last_reason=p_outcome,updated_at=clock_timestamp()
    where scan_intent_id=p_intent_id and status='processing' and claim_token=p_claim_token and claim_expires_at>clock_timestamp();
  if not found then raise exception 'support_scan_claim_unavailable' using errcode='42501'; end if;
  return true;
end;$$;
revoke all on function public.gridex_finish_support_attachment_scan_claim_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gridex_finish_support_attachment_scan_claim_v1(uuid,uuid,text) to service_role;

create function public.gridex_commit_support_attachment_scan_callback_v1(p_nonce_id uuid,p_claim_token uuid,p_proof jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare j private.support_attachment_scan_jobs%rowtype;r jsonb;
begin
  if current_user<>'service_role' then raise exception 'support_scan_service_required' using errcode='42501'; end if;
  select * into j from private.support_attachment_scan_jobs where scan_nonce_id=p_nonce_id;
  if not found or j.status not in ('processing','evidence_recorded')
    or (j.status='processing' and (j.claim_token is distinct from p_claim_token or j.claim_expires_at<=clock_timestamp()))
    or (j.status='evidence_recorded' and p_claim_token is not null) then
    raise exception 'support_scan_claim_unavailable' using errcode='42501'; end if;
  -- Existing owner reacquires lineage/root/nonce and enforces exact proof/replay.
  -- Its receipt and this completion share the same outer transaction.
  perform private.gridex_support_scan_job_source_v1(j.scan_intent_id,j.company_id,j.attachment_id,j.source_binding);
  r:=public.gridex_record_support_attachment_scan_v1(p_nonce_id,p_proof);
  select * into j from private.support_attachment_scan_jobs where scan_nonce_id=p_nonce_id for update;
  if j.status='processing' then
    perform public.gridex_finish_support_attachment_scan_claim_v1(j.scan_intent_id,p_claim_token,'evidence_recorded');
  elsif j.status<>'evidence_recorded' or r->>'replayed' is distinct from 'true' then
    raise exception 'support_scan_claim_unavailable' using errcode='42501';
  end if;
  -- A later job lock/trigger wait belongs to this transaction too. Recheck the
  -- current root, exact nonce/lineage and signed expiry after its final write.
  perform public.gridex_get_support_attachment_scan_callback_v1(p_nonce_id);
  if (p_proof->>'expiresAt')::bigint<=floor(extract(epoch from clock_timestamp()))::bigint then
    raise exception 'support_scan_proof_expired' using errcode='42501'; end if;
  return r||jsonb_build_object('outcome','blocked_scanner_qualification','releaseAllowed',false);
end;$$;
revoke all on function public.gridex_commit_support_attachment_scan_callback_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_commit_support_attachment_scan_callback_v1(uuid,uuid,jsonb) to service_role;

-- Internal protected-read capabilities are denial witnesses only. There is no
-- qualified-provider switch, URL generator or file-returning/release branch.
create function private.gridex_support_attachment_read_owner_v1(p_context jsonb,p_attachment uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare a public.customer_support_attachments%rowtype;c public.customer_cases%rowtype;lineage jsonb;selector jsonb;reference text;
begin
  if current_user<>'service_role' then raise exception 'support_scan_service_required' using errcode='42501'; end if;
  if jsonb_typeof(p_context) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_context) k
    where k not in ('companyId','customerId','mode','actorUserId','sessionId','clientId','subject')) then
    raise exception 'invalid_support_scan' using errcode='22023'; end if;
  if not private.gridex_support_actor_v1(p_context,false) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  select * into a from public.customer_support_attachments where id=p_attachment and company_id=(p_context->>'companyId')::uuid
    and customer_id=(p_context->>'customerId')::uuid and (p_context->>'mode'='ops' or visibility='customer');
  if not found then raise exception 'support_scan_resource_unavailable' using errcode='P0002'; end if;
  if p_context->>'mode'='ops' then selector:=jsonb_build_object('caseId',a.customer_case_id);
  else
    select public_reference into reference from public.customer_support_threads where id=a.customer_case_id and company_id=a.company_id and customer_id=a.customer_id;
    selector:=jsonb_build_object('caseReference',reference);
  end if;
  c:=private.gridex_support_attachment_case_v1(p_context,selector,p_context->>'mode'<>'ops');
  lineage:=private.gridex_support_scan_lineage_v1(a.company_id,a.id);
  if lineage->>'caseId' is distinct from c.id::text or not exists(select 1 from public.customer_support_attachments
    where id=a.id and company_id=(p_context->>'companyId')::uuid and customer_id=(p_context->>'customerId')::uuid
      and customer_case_id=c.id and (p_context->>'mode'='ops' or visibility='customer'))
    or not private.gridex_support_clock_active_v1(p_context) then
    raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  return lineage;
end;$$;
revoke all on function private.gridex_support_attachment_read_owner_v1(jsonb,uuid) from public,anon,authenticated;
grant execute on function private.gridex_support_attachment_read_owner_v1(jsonb,uuid) to service_role;

create function public.gridex_prepare_support_attachment_read_v1(p_context jsonb,p_attachment_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare lineage jsonb;v_now bigint;v_nonce uuid:=gen_random_uuid();
begin
  lineage:=private.gridex_support_attachment_read_owner_v1(p_context,p_attachment_id);
  perform pg_advisory_xact_lock(hashtextextended((p_context->>'companyId')||':support-attachment-read',0));
  v_now:=floor(extract(epoch from clock_timestamp()))::bigint;
  if (select count(*) from private.support_attachment_read_nonces where company_id=(p_context->>'companyId')::uuid
    and expires_at>v_now and consumed_at is null)>=1000
    or (select count(*) from private.support_attachment_read_nonces where company_id=(p_context->>'companyId')::uuid
      and actor_context-array['customerId','sessionId']=p_context-array['customerId','sessionId'] and issued_at>v_now-60)>=20 then
    raise exception 'support_attachment_read_limit' using errcode='54000'; end if;
  insert into private.support_attachment_read_nonces(nonce_id,company_id,attachment_id,actor_context,binding,issued_at,expires_at)
    values(v_nonce,(p_context->>'companyId')::uuid,p_attachment_id,p_context,lineage,v_now,v_now+60);
  if not private.gridex_support_clock_active_v1(p_context) or v_now+60<=floor(extract(epoch from clock_timestamp()))::bigint then
    raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  return jsonb_build_object('nonceId',v_nonce,'issuedAt',v_now,'expiresAt',v_now+60,'binding',lineage,'releaseAllowed',false);
end;$$;
revoke all on function public.gridex_prepare_support_attachment_read_v1(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.gridex_prepare_support_attachment_read_v1(jsonb,uuid) to service_role;

create function public.gridex_get_support_attachment_read_nonce_v1(p_context jsonb,p_nonce_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare n private.support_attachment_read_nonces%rowtype;lineage jsonb;
begin
  if current_user<>'service_role' then raise exception 'support_scan_service_required' using errcode='42501'; end if;
  select * into n from private.support_attachment_read_nonces where nonce_id=p_nonce_id;
  if not found or n.actor_context is distinct from p_context then raise exception 'support_attachment_read_nonce_unavailable' using errcode='42501'; end if;
  lineage:=private.gridex_support_attachment_read_owner_v1(p_context,n.attachment_id);
  select * into n from private.support_attachment_read_nonces where nonce_id=p_nonce_id for share;
  if n.actor_context is distinct from p_context or n.binding is distinct from lineage or n.consumed_at is not null
    or n.expires_at<=floor(extract(epoch from clock_timestamp()))::bigint then
    raise exception 'support_attachment_read_nonce_unavailable' using errcode='42501'; end if;
  return jsonb_build_object('nonceId',n.nonce_id,'issuedAt',n.issued_at,'expiresAt',n.expires_at,'binding',lineage,'releaseAllowed',false);
end;$$;
revoke all on function public.gridex_get_support_attachment_read_nonce_v1(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.gridex_get_support_attachment_read_nonce_v1(jsonb,uuid) to service_role;

create function public.gridex_finish_support_attachment_read_v1(p_context jsonb,p_nonce_id uuid,p_witness jsonb default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare n private.support_attachment_read_nonces%rowtype;lineage jsonb;
begin
  if current_user<>'service_role' then raise exception 'support_scan_service_required' using errcode='42501'; end if;
  select * into n from private.support_attachment_read_nonces where nonce_id=p_nonce_id;
  if not found or n.actor_context is distinct from p_context then raise exception 'support_attachment_read_nonce_unavailable' using errcode='42501'; end if;
  lineage:=private.gridex_support_attachment_read_owner_v1(p_context,n.attachment_id);
  select * into n from private.support_attachment_read_nonces where nonce_id=p_nonce_id for update;
  if n.actor_context is distinct from p_context or n.binding is distinct from lineage or n.consumed_at is not null
    or n.expires_at<=floor(extract(epoch from clock_timestamp()))::bigint then
    raise exception 'support_attachment_read_nonce_unavailable' using errcode='42501'; end if;
  if p_witness is not null and p_witness is distinct from jsonb_build_object('objectId',lineage->'objectId',
    'objectVersion',lineage->'objectVersion','objectUpdatedAt',lineage->'objectUpdatedAt','sha256',lineage->'sha256','byteSize',lineage->'byteSize') then
    raise exception 'support_scan_object_changed' using errcode='23503'; end if;
  update private.support_attachment_read_nonces set consumed_at=clock_timestamp() where nonce_id=p_nonce_id;
  if not private.gridex_support_clock_active_v1(p_context) or n.expires_at<=floor(extract(epoch from clock_timestamp()))::bigint then
    raise exception 'support_attachment_read_nonce_unavailable' using errcode='42501'; end if;
  return jsonb_build_object('releaseAllowed',false,'outcome','blocked_scanner_qualification','physicalHashVerified',p_witness is not null);
end;$$;
revoke all on function public.gridex_finish_support_attachment_read_v1(jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_finish_support_attachment_read_v1(jsonb,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
