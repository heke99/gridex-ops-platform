begin;
-- Existing logical outcomes already used by the worker; current original DDL
-- rejected delivery_uncertain with SQLSTATE 23514. No historical row is rewritten.
alter table public.manual_email_outbox drop constraint manual_email_outbox_delivery_status_check;
alter table public.manual_email_outbox add constraint manual_email_outbox_delivery_status_check check(
  delivery_status is null or delivery_status in('queued','sent','delivered','delivery_delayed','bounced','complained','failed','suppressed','delivery_uncertain','blocked_tenant_state'));

create table private.manual_email_dispatch_tenant_turns(
  queue_key text not null check(queue_key in('claim','recovery')),
  company_id uuid not null references public.companies(id),
  last_claimed_at timestamptz not null,
  primary key(queue_key,company_id)
);
create table private.manual_email_dispatch_claims(
  item_id uuid primary key references public.manual_email_outbox(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  worker_id text not null check(length(worker_id)between 1 and 200),
  claim_token uuid not null,
  payload_sha256 bytea not null check(octet_length(payload_sha256)=32),
  claimed_at timestamptz not null,
  expires_at timestamptz not null,
  finished_at timestamptz
);
alter table private.manual_email_dispatch_tenant_turns enable row level security;
alter table private.manual_email_dispatch_claims enable row level security;
revoke all on private.manual_email_dispatch_tenant_turns,private.manual_email_dispatch_claims from public,anon,authenticated;
grant select,insert,update on private.manual_email_dispatch_tenant_turns,private.manual_email_dispatch_claims to service_role;

create function private.gridex_manual_email_payload_hash_v1(p_row public.manual_email_outbox)
returns bytea language sql immutable security invoker set search_path=pg_catalog as $$
 select sha256(convert_to(jsonb_build_object('company_id',p_row.company_id,'request_id',p_row.request_id,
  'to_email',p_row.to_email,'actual_recipient_email',p_row.actual_recipient_email,'from_email',p_row.from_email,'reply_to',p_row.reply_to,
  'subject',p_row.subject,'body_html',p_row.body_html,'body_text',p_row.body_text,'attachments',p_row.attachments,
  'idempotency_key',p_row.idempotency_key,'provider_idempotency_key',p_row.provider_idempotency_key,'provider',p_row.provider,
  'recipient_resolution',p_row.recipient_resolution,'external_delivery',p_row.external_delivery,'attempts',p_row.attempts)::text,'UTF8'))
$$;
revoke all on function private.gridex_manual_email_payload_hash_v1(public.manual_email_outbox) from public,anon,authenticated;
grant execute on function private.gridex_manual_email_payload_hash_v1(public.manual_email_outbox)to service_role;

create function public.gridex_claim_manual_email_outbox_fair_v1(p_company_id uuid,p_limit integer,p_worker_id text,p_claim_token uuid)
returns setof jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare v_now timestamptz:=clock_timestamp();
begin
 if current_setting('role',true)is distinct from 'service_role' then raise exception 'manual_email_service_required'using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 or p_claim_token is null or
  nullif(btrim(p_worker_id),'')is null or length(p_worker_id)>200 then raise exception 'invalid_manual_email_claim'using errcode='22023';end if;
 return query
 with due as materialized(
  select o.company_id,min(o.queued_at)as oldest_due from public.manual_email_outbox o
  where o.status='queued'and o.external_delivery and o.next_attempt_at<=v_now
   and(p_company_id is null or o.company_id=p_company_id)
   and not exists(select 1 from private.manual_email_dispatch_claims l where l.item_id=o.id and l.finished_at is null and l.expires_at>=v_now)
  group by o.company_id
 ),tenants as materialized(
  select d.*,t.last_claimed_at from due d join public.companies c on c.id=d.company_id
  left join private.manual_email_dispatch_tenant_turns t on t.queue_key='claim'and t.company_id=d.company_id
  where exists(select 1 from public.canonical_tenant_operation_decision(d.company_id,'email.send')policy where policy.allowed)
  order by t.last_claimed_at nulls first,d.oldest_due,d.company_id limit p_limit for share of c skip locked
 ),candidates as materialized(
  select o.*,t.oldest_due,t.last_claimed_at,row_number()over(partition by t.company_id order by o.queued_at,o.id)as tenant_rank
  from tenants t cross join lateral(
   select q.*from public.manual_email_outbox q where q.company_id=t.company_id and q.status='queued'and q.external_delivery and q.next_attempt_at<=v_now
    and not exists(select 1 from private.manual_email_dispatch_claims l where l.item_id=q.id and l.finished_at is null and l.expires_at>=v_now)
   order by q.queued_at,q.id limit least(p_limit,5)for update of q skip locked
  )o
 ),chosen as materialized(
  select *from candidates order by tenant_rank,last_claimed_at nulls first,oldest_due,company_id,queued_at,id limit p_limit
 ),leases as(
  insert into private.manual_email_dispatch_claims(item_id,company_id,worker_id,claim_token,payload_sha256,claimed_at,expires_at,finished_at)
  select o.id,o.company_id,p_worker_id,p_claim_token,private.gridex_manual_email_payload_hash_v1(o),v_now,v_now+interval '15 minutes',null
  from public.manual_email_outbox o join chosen c on c.id=o.id order by o.id
  on conflict(item_id)do update set company_id=excluded.company_id,worker_id=excluded.worker_id,claim_token=excluded.claim_token,
   payload_sha256=excluded.payload_sha256,claimed_at=excluded.claimed_at,expires_at=excluded.expires_at,finished_at=null
  where manual_email_dispatch_claims.finished_at is not null or manual_email_dispatch_claims.expires_at<v_now returning item_id,company_id
 ),changed as(
  update public.manual_email_outbox o set status='sending',locked_at=v_now,locked_by=p_worker_id,updated_at=v_now
  from leases l where o.id=l.item_id and o.company_id=l.company_id and o.status='queued'and o.external_delivery and o.next_attempt_at<=v_now returning o.*
 ),turns as(
  insert into private.manual_email_dispatch_tenant_turns(queue_key,company_id,last_claimed_at)
  select distinct 'claim',o.company_id,v_now from changed o order by o.company_id
  on conflict(queue_key,company_id)do update set last_claimed_at=greatest(manual_email_dispatch_tenant_turns.last_claimed_at,excluded.last_claimed_at)returning company_id
 )select to_jsonb(o)||jsonb_build_object('claim_token',p_claim_token) from changed o join chosen c on c.id=o.id
  cross join(select count(*)from turns)persisted order by c.tenant_rank,c.last_claimed_at nulls first,c.oldest_due,c.company_id,c.queued_at,c.id;
end;
$$;

create function public.gridex_recheck_manual_email_claim_v1(p_company_id uuid,p_item_id uuid,p_worker_id text,p_claim_token uuid)
returns setof public.manual_email_outbox language plpgsql security invoker set search_path=pg_catalog as $$
declare v_row public.manual_email_outbox;v_lease private.manual_email_dispatch_claims;
begin
 if current_setting('role',true)is distinct from 'service_role'then raise exception 'manual_email_service_required'using errcode='42501';end if;
 select *into v_row from public.manual_email_outbox o where o.id=p_item_id and o.company_id=p_company_id for share;
 if not found then return;end if;
 select *into v_lease from private.manual_email_dispatch_claims l where l.item_id=p_item_id and l.company_id=p_company_id for share;
 if found and v_row.status='sending'and v_row.locked_by=p_worker_id and v_lease.worker_id=p_worker_id and v_lease.claim_token=p_claim_token
  and v_lease.finished_at is null and v_lease.expires_at>clock_timestamp()and v_lease.payload_sha256=private.gridex_manual_email_payload_hash_v1(v_row)
 then return next v_row;end if;
end;
$$;

create function public.gridex_finish_manual_email_claim_v1(p_company_id uuid,p_item_id uuid,p_worker_id text,p_claim_token uuid,p_patch jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare v_row public.manual_email_outbox;v_lease private.manual_email_dispatch_claims;v_state text;v_now timestamptz;
begin
 if current_setting('role',true)is distinct from 'service_role'then raise exception 'manual_email_service_required'using errcode='42501';end if;
 if jsonb_typeof(p_patch)is distinct from 'object'or exists(select 1 from jsonb_object_keys(p_patch)k where k not in
  ('status','delivery_status','provider_message_id','sent_at','attempts','last_error','last_error_code','delivery_uncertain_at','next_attempt_at',
   'blocked_reason','blocked_at','company_status_snapshot','operation_decision_snapshot'))then raise exception 'invalid_manual_email_completion'using errcode='22023';end if;
 v_state:=p_patch->>'status';
 if v_state is null or v_state not in('sent','failed','queued','delivery_uncertain','blocked_tenant_state')or p_patch->>'delivery_status'is distinct from v_state
  or(v_state='sent'and nullif(btrim(p_patch->>'provider_message_id'),'')is null)
 then raise exception 'invalid_manual_email_completion'using errcode='22023';end if;
 if (v_state<>'blocked_tenant_state'or p_patch?'attempts')and
  (jsonb_typeof(p_patch->'attempts')is distinct from 'number'or p_patch->>'attempts'!~'^[0-9]{1,10}$'
   or(p_patch->>'attempts')::numeric>2147483647)
 then raise exception 'invalid_manual_email_attempt'using errcode='22023';end if;
 if v_state='queued'and(p_patch->>'next_attempt_at'is null or(p_patch->>'next_attempt_at')::timestamptz<=clock_timestamp())
 then raise exception 'invalid_manual_email_retry'using errcode='22023';end if;
 select *into v_row from public.manual_email_outbox o where o.id=p_item_id and o.company_id=p_company_id for update;
 if not found then return false;end if;
 select *into v_lease from private.manual_email_dispatch_claims l where l.item_id=p_item_id and l.company_id=p_company_id for update;
 v_now:=clock_timestamp();
 if not found or v_row.status<>'sending'or v_row.locked_by is distinct from p_worker_id or v_lease.worker_id is distinct from p_worker_id
  or v_lease.claim_token is distinct from p_claim_token or v_lease.finished_at is not null or v_lease.expires_at<=v_now
  or v_lease.payload_sha256 is distinct from private.gridex_manual_email_payload_hash_v1(v_row)then return false;end if;
 if p_patch?'attempts'and(p_patch->>'attempts')::integer is distinct from v_row.attempts+1 then raise exception 'invalid_manual_email_attempt'using errcode='22023';end if;
 update public.manual_email_outbox o set status=v_state,delivery_status=v_state,
  provider_message_id=case when p_patch?'provider_message_id'then p_patch->>'provider_message_id'else o.provider_message_id end,
  sent_at=case when v_state='sent'then v_now else o.sent_at end,
  attempts=case when p_patch?'attempts'then(p_patch->>'attempts')::integer else o.attempts end,
  last_error=case when p_patch?'last_error'then left(p_patch->>'last_error',500)else o.last_error end,
  last_error_code=case when p_patch?'last_error_code'then left(p_patch->>'last_error_code',100)else o.last_error_code end,
  delivery_uncertain_at=case when v_state='delivery_uncertain'then v_now when p_patch?'delivery_uncertain_at'then(p_patch->>'delivery_uncertain_at')::timestamptz else o.delivery_uncertain_at end,
  next_attempt_at=case when v_state in('sent','failed','delivery_uncertain','blocked_tenant_state')then null when p_patch?'next_attempt_at'then(p_patch->>'next_attempt_at')::timestamptz else o.next_attempt_at end,
  blocked_reason=case when p_patch?'blocked_reason'then p_patch->>'blocked_reason'else o.blocked_reason end,
  blocked_at=case when v_state='blocked_tenant_state'then v_now else o.blocked_at end,
  company_status_snapshot=case when p_patch?'company_status_snapshot'then p_patch->>'company_status_snapshot'else o.company_status_snapshot end,
  operation_decision_snapshot=case when p_patch?'operation_decision_snapshot'then p_patch->'operation_decision_snapshot'else o.operation_decision_snapshot end,
  locked_at=null,locked_by=null,updated_at=v_now where o.id=p_item_id and o.company_id=p_company_id;
 -- Re-read after real row triggers, then check the final clock after the ledger
 -- write too. A late expiry or changed lease rolls the whole command back.
 select *into v_lease from private.manual_email_dispatch_claims where item_id=p_item_id and company_id=p_company_id for update;
 if not found or v_lease.worker_id is distinct from p_worker_id or v_lease.claim_token is distinct from p_claim_token
  or v_lease.finished_at is not null or v_lease.expires_at<=clock_timestamp()
  or v_lease.payload_sha256 is distinct from private.gridex_manual_email_payload_hash_v1(v_row)
 then raise exception 'manual_email_completion_lease_changed'using errcode='40001';end if;
 update private.manual_email_dispatch_claims set finished_at=clock_timestamp() where item_id=p_item_id and company_id=p_company_id and claim_token=p_claim_token;
 if exists(select 1 from private.manual_email_dispatch_claims where item_id=p_item_id and expires_at<=clock_timestamp())
 then raise exception 'manual_email_completion_expired'using errcode='40001';end if;
 return true;
end;
$$;

create function public.gridex_recover_stale_manual_email_outbox_v1(p_company_id uuid,p_limit integer)
returns setof jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare v_now timestamptz:=clock_timestamp();
begin
 if current_setting('role',true)is distinct from 'service_role'then raise exception 'manual_email_service_required'using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid_manual_email_recovery'using errcode='22023';end if;
 return query with due as materialized(
  select o.company_id,min(o.locked_at)as oldest_due from public.manual_email_outbox o where o.status='sending'and o.locked_at<v_now-interval '15 minutes'
   and(p_company_id is null or o.company_id=p_company_id)
   and not exists(select 1 from private.manual_email_dispatch_claims l where l.item_id=o.id and
    (l.finished_at is not null or l.expires_at>=v_now or l.payload_sha256<>private.gridex_manual_email_payload_hash_v1(o)or l.worker_id is distinct from o.locked_by))
   group by o.company_id
 ),tenants as materialized(
  select d.*,t.last_claimed_at from due d left join private.manual_email_dispatch_tenant_turns t on t.company_id=d.company_id and t.queue_key='recovery'
  order by t.last_claimed_at nulls first,d.oldest_due,d.company_id limit p_limit
 ),candidates as materialized(
  select o.id,o.company_id,o.locked_at,t.oldest_due,t.last_claimed_at,row_number()over(partition by o.company_id order by o.locked_at,o.id)as tenant_rank
  from tenants t cross join lateral(select q.*from public.manual_email_outbox q where q.company_id=t.company_id and q.status='sending'and q.locked_at<v_now-interval '15 minutes'
   and not exists(select 1 from private.manual_email_dispatch_claims l where l.item_id=q.id and
    (l.finished_at is not null or l.expires_at>=v_now or l.payload_sha256<>private.gridex_manual_email_payload_hash_v1(q)or l.worker_id is distinct from q.locked_by))
   order by q.locked_at,q.id limit least(p_limit,5)for update of q skip locked)o
 ),chosen as materialized(select *from candidates order by tenant_rank,last_claimed_at nulls first,oldest_due,company_id,locked_at,id limit p_limit),changed as(
  update public.manual_email_outbox o set status='delivery_uncertain',delivery_status='delivery_uncertain',last_error='Providerleveransen måste kontrolleras innan nytt försök.',
   last_error_code='delivery_uncertain',delivery_uncertain_at=v_now,next_attempt_at=null,locked_at=null,locked_by=null,updated_at=v_now
  from chosen c where o.id=c.id and o.company_id=c.company_id and o.status='sending'and o.locked_at=c.locked_at returning o.id,o.company_id,o.request_id
 ),finished as(update private.manual_email_dispatch_claims l set finished_at=v_now from changed c where l.item_id=c.id and l.company_id=c.company_id returning l.item_id),turns as(
  insert into private.manual_email_dispatch_tenant_turns(queue_key,company_id,last_claimed_at)select distinct 'recovery',c.company_id,v_now from changed c order by c.company_id
  on conflict(queue_key,company_id)do update set last_claimed_at=greatest(manual_email_dispatch_tenant_turns.last_claimed_at,excluded.last_claimed_at)returning company_id
 )select to_jsonb(c) from changed c cross join(select count(*)from turns)persisted cross join(select count(*)from finished)closed;
end;
$$;

revoke all on function public.gridex_claim_manual_email_outbox_fair_v1(uuid,integer,text,uuid),public.gridex_recheck_manual_email_claim_v1(uuid,uuid,text,uuid),
 public.gridex_finish_manual_email_claim_v1(uuid,uuid,text,uuid,jsonb),public.gridex_recover_stale_manual_email_outbox_v1(uuid,integer) from public,anon,authenticated;
grant execute on function public.gridex_claim_manual_email_outbox_fair_v1(uuid,integer,text,uuid),public.gridex_recheck_manual_email_claim_v1(uuid,uuid,text,uuid),
 public.gridex_finish_manual_email_claim_v1(uuid,uuid,text,uuid,jsonb),public.gridex_recover_stale_manual_email_outbox_v1(uuid,integer)to service_role;
commit;
