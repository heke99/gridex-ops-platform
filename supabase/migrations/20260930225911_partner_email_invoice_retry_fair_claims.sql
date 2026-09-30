begin;
create table private.partner_dispatch_tenant_turns(
  queue_key text not null check(queue_key in ('provider_event','tenant_email','approved_invoice_retry')),
  company_id uuid not null references public.companies(id) on delete cascade,
  last_claimed_at timestamptz not null,primary key(queue_key,company_id)
);
alter table private.partner_dispatch_tenant_turns enable row level security;
revoke all on private.partner_dispatch_tenant_turns from public,anon,authenticated;
grant select,insert,update on private.partner_dispatch_tenant_turns to service_role;
create table private.approved_invoice_retry_leases(
  company_id uuid not null,item_id uuid primary key,claim_token uuid not null,claimed_at timestamptz not null,
  finished_at timestamptz,outcome text check(outcome in ('sent','not_sent','preflight_failed')),
  failure_reason text,
  foreign key(company_id,item_id) references public.invoice_export_items(company_id,id) on delete cascade
);
alter table private.approved_invoice_retry_leases enable row level security;
revoke all on private.approved_invoice_retry_leases from public,anon,authenticated;
grant select,insert,update,delete on private.approved_invoice_retry_leases to service_role;
create index tenant_email_outbox_tenant_due_fair_idx on public.tenant_email_outbox(company_id,created_at,id)
  where status='queued' and dead_letter_at is null;
create index invoice_export_items_tenant_retry_fair_idx on public.invoice_export_items(company_id,next_retry_at,id)
  where status='failed_retryable';

-- All SQL fragments below are fixed server constants chosen from this closed
-- queue whitelist. User input is passed only as EXECUTE parameters. Shared
-- persisted turns do not grant a claim permission to send an external message.
create function private.gridex_claim_partner_queue_fair_v1(
  p_queue text,p_company uuid,p_limit integer,p_token uuid,p_statuses text[] default null,p_max_age_days integer default 365
) returns setof jsonb language plpgsql security invoker set search_path=pg_catalog as $fair$
declare
  v_now timestamptz:=clock_timestamp();v_table text;v_due text;v_order text;v_applied text;v_lease text:='';v_output text;
begin
  if current_user<>'service_role' then raise exception 'partner_queue_service_required' using errcode='42501'; end if;
  if p_queue not in ('provider_event','tenant_email','approved_invoice_retry') or p_queue is null
    or p_limit is null or p_limit<1 or p_limit>500 or p_token is null then
    raise exception 'invalid_partner_queue_claim' using errcode='22023'; end if;
  if p_queue='provider_event' then
    if p_statuses is null or coalesce(cardinality(p_statuses),0)=0 or p_max_age_days is null or p_max_age_days<1 or p_max_age_days>3650
      or exists(select 1 from unnest(p_statuses) s where s not in ('received','needs_review','failed')) then
      raise exception 'invalid_provider_event_claim_arguments' using errcode='22023'; end if;
    v_table:='invoice_provider_events';v_order:='received_at';
    v_due:=$fragment$q.company_id is not null and ($2 is null or q.company_id=$2)
      and q.received_at >= $4-make_interval(days=>$6)
      and (q.status=any($5) or (q.status='processing' and q.processing_started_at<$4-interval '15 minutes'))$fragment$;
    v_applied:=$fragment$update public.invoice_provider_events q set status='processing',processing_token=$7,
      processing_started_at=$4,attempt_count=coalesce(q.attempt_count,0)+1,failure_reason=null
      from chosen where q.id=chosen.id returning q.*$fragment$;
    v_output:='to_jsonb(applied)';
  elsif p_queue='tenant_email' then
    if p_limit>100 then raise exception 'invalid_email_queue_limit' using errcode='22023'; end if;
    -- A stale claimed email is uncertain, never automatically sent again.
    with stale as materialized(
      select q.id from public.tenant_email_outbox q where q.status='processing'
        and q.locked_at<v_now-interval '15 minutes' and (p_company is null or q.company_id=p_company)
      order by q.locked_at,q.id limit p_limit for update of q skip locked
    ) update public.tenant_email_outbox q set status='delivery_uncertain',
      last_error='Utskicket avbröts efter att det hade tagits av en worker. Leveransen är osäker och måste granskas innan omsändning.',
      failure_reason='delivery_uncertain_after_stale_processing_lock',locked_at=null,locked_by=null,lock_token=null,
      delivery_uncertain_at=v_now,updated_at=v_now from stale where q.id=stale.id;
    v_table:='tenant_email_outbox';v_order:='created_at';
    v_due:=$fragment$q.status='queued' and q.dead_letter_at is null and ($2 is null or q.company_id=$2)
      and (q.next_attempt_at is null or q.next_attempt_at<=$4)$fragment$;
    v_applied:=$fragment$update public.tenant_email_outbox q set status='processing',locked_at=$4,
      locked_by='tenant-email-outbox',lock_token=$7,updated_at=$4 from chosen where q.id=chosen.id returning q.*$fragment$;
    v_output:='to_jsonb(applied)';
  else
    if p_limit>200 then raise exception 'invalid_approved_retry_limit' using errcode='22023'; end if;
    v_table:='invoice_export_items';v_order:='next_retry_at';
    v_due:=$fragment$q.status='failed_retryable' and q.next_retry_at<=$4 and ($2 is null or q.company_id=$2)
      and q.metadata#>>'{approval,status}'='approved'
      and jsonb_typeof(q.metadata#>'{approval,approved_by}')='string'
      and nullif(btrim(q.metadata#>>'{approval,approved_by}'),'') is not null
      and not exists(select 1 from private.approved_invoice_retry_leases lease where lease.item_id=q.id
        and lease.finished_at is null and lease.claimed_at >= $4-interval '2 hours')$fragment$;
    v_applied:='select q.* from public.invoice_export_items q join chosen on q.id=chosen.id';
    v_lease:=$fragment$, leases as (
      insert into private.approved_invoice_retry_leases(company_id,item_id,claim_token,claimed_at)
      select company_id,id,$7,$4 from applied on conflict(item_id) do update set
        company_id=excluded.company_id,claim_token=excluded.claim_token,claimed_at=excluded.claimed_at,
        finished_at=null,outcome=null,failure_reason=null
      where approved_invoice_retry_leases.finished_at is not null
        or approved_invoice_retry_leases.claimed_at<$4-interval '2 hours' returning item_id
    )$fragment$;
    v_output:=$fragment$to_jsonb(applied)||jsonb_build_object('claim_token',$7)$fragment$;
  end if;
  return query execute format($query$
    with due as materialized(
      select q.company_id,min(q.%2$I) as oldest_due from public.%1$I q where %3$s group by q.company_id
    ), tenants as materialized(
      select due.*,turns.last_claimed_at from due left join private.partner_dispatch_tenant_turns turns
        on turns.queue_key=$1 and turns.company_id=due.company_id
      order by turns.last_claimed_at nulls first,due.oldest_due,due.company_id limit $3
    ), candidates as materialized(
      select q.id,tenants.company_id,tenants.last_claimed_at,tenants.oldest_due,q.%2$I as due_at,
        row_number() over(partition by tenants.company_id order by q.%2$I,q.id) as tenant_rank
      from tenants cross join lateral(
        select q.* from public.%1$I q where q.company_id=tenants.company_id and %3$s
        order by q.%2$I,q.id limit least($3,5) for update of q skip locked
      ) q
    ), chosen as materialized(
      select * from candidates order by tenant_rank,last_claimed_at nulls first,oldest_due,company_id,due_at,id limit $3
    ), applied as (%4$s)%5$s, turns as(
      insert into private.partner_dispatch_tenant_turns(queue_key,company_id,last_claimed_at)
      select distinct $1,company_id,$4 from applied %7$s on conflict(queue_key,company_id) do update
        set last_claimed_at=greatest(partner_dispatch_tenant_turns.last_claimed_at,excluded.last_claimed_at) returning company_id
    ) select %6$s from applied join chosen using(id) %7$s cross join(select count(*) from turns) persisted_turn
      order by chosen.tenant_rank,chosen.last_claimed_at nulls first,chosen.oldest_due,chosen.company_id,chosen.due_at,chosen.id
  $query$,v_table,v_order,v_due,v_applied,v_lease,v_output,
    case when p_queue='approved_invoice_retry' then 'join leases on leases.item_id=applied.id' else '' end)
    using p_queue,p_company,p_limit,v_now,p_statuses,p_max_age_days,p_token;
end;
$fair$;
revoke all on function private.gridex_claim_partner_queue_fair_v1(text,uuid,integer,uuid,text[],integer) from public,anon,authenticated;
grant execute on function private.gridex_claim_partner_queue_fair_v1(text,uuid,integer,uuid,text[],integer) to service_role;

create or replace function public.gridex_claim_invoice_provider_events(
  p_company_id uuid,p_statuses text[],p_limit integer,p_processing_token uuid,p_max_age_days integer default 365
) returns setof public.invoice_provider_events language sql security invoker set search_path=pg_catalog as $$
  select (jsonb_populate_record(null::public.invoice_provider_events,j)).*
    from private.gridex_claim_partner_queue_fair_v1('provider_event',p_company_id,p_limit,p_processing_token,p_statuses,p_max_age_days) j;
$$;
revoke all on function public.gridex_claim_invoice_provider_events(uuid,text[],integer,uuid,integer) from public,anon,authenticated;
grant execute on function public.gridex_claim_invoice_provider_events(uuid,text[],integer,uuid,integer) to service_role;
create function public.gridex_claim_tenant_email_outbox_fair_v1(p_company_id uuid,p_limit integer,p_claim_token uuid)
returns setof public.tenant_email_outbox language sql security invoker set search_path=pg_catalog as $$
  select (jsonb_populate_record(null::public.tenant_email_outbox,j)).*
    from private.gridex_claim_partner_queue_fair_v1('tenant_email',p_company_id,p_limit,p_claim_token) j;
$$;
revoke all on function public.gridex_claim_tenant_email_outbox_fair_v1(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.gridex_claim_tenant_email_outbox_fair_v1(uuid,integer,uuid) to service_role;
create function public.gridex_claim_approved_invoice_retries_fair_v1(p_company_id uuid,p_limit integer,p_claim_token uuid)
returns setof jsonb language sql security invoker set search_path=pg_catalog as $$
  select j from private.gridex_claim_partner_queue_fair_v1('approved_invoice_retry',p_company_id,p_limit,p_claim_token) j;
$$;
revoke all on function public.gridex_claim_approved_invoice_retries_fair_v1(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.gridex_claim_approved_invoice_retries_fair_v1(uuid,integer,uuid) to service_role;
create function public.gridex_release_approved_invoice_retry_v1(p_company_id uuid,p_item_id uuid,p_claim_token uuid,
  p_outcome text default 'not_sent',p_reason text default null)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare changed integer;
begin
  if current_user<>'service_role' then raise exception 'approved_retry_service_required' using errcode='42501'; end if;
  if p_outcome is null or p_outcome not in ('sent','not_sent','preflight_failed')
    or (p_reason is not null and p_reason !~ '^approved_invoice_retry_[a-z0-9_]{1,120}$') then
    raise exception 'invalid_approved_retry_completion' using errcode='22023'; end if;
  update private.approved_invoice_retry_leases set finished_at=clock_timestamp(),outcome=p_outcome,failure_reason=p_reason
    where company_id=p_company_id and item_id=p_item_id and claim_token=p_claim_token and finished_at is null;
  get diagnostics changed=row_count;return changed=1;
end;
$$;
revoke all on function public.gridex_release_approved_invoice_retry_v1(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.gridex_release_approved_invoice_retry_v1(uuid,uuid,uuid,text,text) to service_role;
commit;
