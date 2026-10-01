begin;
create table private.ediel_resume_tenant_turns(
  phase text not null check(phase in('validated','draft')),
  company_id uuid not null references public.companies(id) on delete cascade,
  last_claimed_at timestamptz not null,
  primary key(phase,company_id)
);
create table private.ediel_resume_claims(
  intent_id uuid primary key references public.ediel_message_intents(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  phase text not null check(phase in('validated','draft')),
  claim_token uuid not null,
  claimed_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>claimed_at and expires_at<=claimed_at+interval '10 minutes'),
  intent_updated_at timestamptz not null,
  finished_at timestamptz,
  outcome text check(outcome in('processed','failed','skipped')),
  failure_reason text check(failure_reason is null or failure_reason~'^[a-z0-9_]{1,80}$')
);
alter table private.ediel_resume_tenant_turns enable row level security;
alter table private.ediel_resume_claims enable row level security;
revoke all on private.ediel_resume_tenant_turns,private.ediel_resume_claims from public,anon,authenticated,service_role;
grant select,insert,update on private.ediel_resume_tenant_turns,private.ediel_resume_claims to service_role;
create index ediel_resume_validated_tenant_due_idx on public.ediel_message_intents(company_id,updated_at,id)
  where validation_status='validated' and render_status in('not_rendered','failed') and outbox_status='not_queued';
create index ediel_resume_draft_tenant_due_idx on public.ediel_message_intents(company_id,updated_at,id)
  where validation_status='draft' and direction='outbound' and ediel_message_id is null and outbox_status='not_queued';

create function private.gridex_ediel_resume_phase_eligible_v1(p_intent public.ediel_message_intents,p_phase text)
returns boolean language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce(case p_phase
  when 'validated' then p_intent.validation_status='validated' and p_intent.render_status in('not_rendered','failed') and p_intent.outbox_status='not_queued'
  when 'draft' then p_intent.validation_status='draft' and p_intent.direction='outbound' and p_intent.ediel_message_id is null and p_intent.outbox_status='not_queued'
  else false end,false);
$$;
revoke all on function private.gridex_ediel_resume_phase_eligible_v1(public.ediel_message_intents,text) from public,anon,authenticated;
grant execute on function private.gridex_ediel_resume_phase_eligible_v1(public.ediel_message_intents,text) to service_role;

create function public.gridex_claim_ediel_resume_intents_fair_v1(p_phase text,p_company_id uuid,p_limit integer,p_claim_token uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_now timestamptz:=clock_timestamp();v_limit integer:=greatest(1,least(coalesce(p_limit,10),100));v_result jsonb;
begin
 if current_user<>'service_role' then raise exception 'ediel_resume_service_required' using errcode='42501';end if;
 if p_phase not in('validated','draft') or p_phase is null or p_claim_token is null then raise exception 'ediel_resume_claim_invalid' using errcode='22023';end if;
 with due as materialized(
  select i.company_id,min(i.updated_at) as oldest_due from public.ediel_message_intents i join public.companies c on c.id=i.company_id
  where c.status in('active','onboarding') and(p_company_id is null or i.company_id=p_company_id)
   and private.gridex_ediel_resume_phase_eligible_v1(i,p_phase)
   and not exists(select 1 from private.ediel_resume_claims l where l.intent_id=i.id and l.finished_at is null and l.expires_at>=v_now)
  group by i.company_id
 ), tenants as materialized(
  select d.*,t.last_claimed_at from due d join public.companies c on c.id=d.company_id
  left join private.ediel_resume_tenant_turns t on t.company_id=d.company_id and t.phase=p_phase
  where c.status in('active','onboarding') order by t.last_claimed_at nulls first,d.oldest_due,d.company_id
  limit v_limit for share of c skip locked
 ), candidates as materialized(
  select i.id,tenants.company_id,tenants.oldest_due,tenants.last_claimed_at,i.updated_at,
   row_number()over(partition by tenants.company_id order by i.updated_at,i.id) as tenant_rank
  from tenants cross join lateral(
   select i.id,i.updated_at from public.ediel_message_intents i where i.company_id=tenants.company_id
    and private.gridex_ediel_resume_phase_eligible_v1(i,p_phase)
    and not exists(select 1 from private.ediel_resume_claims l where l.intent_id=i.id and l.finished_at is null and l.expires_at>=v_now)
   order by i.updated_at,i.id limit least(v_limit,5) for update of i skip locked
  )i
 ), chosen as materialized(
  select * from candidates order by tenant_rank,last_claimed_at nulls first,oldest_due,company_id,updated_at,id limit v_limit
 ), leases as(
  insert into private.ediel_resume_claims(intent_id,company_id,phase,claim_token,claimed_at,expires_at,intent_updated_at)
   select id,company_id,p_phase,p_claim_token,v_now,v_now+interval '10 minutes',updated_at from chosen
  on conflict(intent_id)do update set phase=excluded.phase,claim_token=excluded.claim_token,claimed_at=excluded.claimed_at,
   expires_at=excluded.expires_at,intent_updated_at=excluded.intent_updated_at,finished_at=null,outcome=null,failure_reason=null
   where ediel_resume_claims.company_id=excluded.company_id
    and(ediel_resume_claims.finished_at is not null or ediel_resume_claims.expires_at<v_now)
  returning intent_id,company_id,claim_token,expires_at
 ), turns as(
  insert into private.ediel_resume_tenant_turns(phase,company_id,last_claimed_at)
   select distinct p_phase,l.company_id,v_now from leases l order by l.company_id
  on conflict(phase,company_id)do update set last_claimed_at=greatest(ediel_resume_tenant_turns.last_claimed_at,excluded.last_claimed_at)
  returning company_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('intent',to_jsonb(i),'phase',p_phase,'claimToken',l.claim_token,'expiresAt',l.expires_at)
  order by ch.tenant_rank,ch.last_claimed_at nulls first,ch.oldest_due,ch.company_id,ch.updated_at,ch.id),'[]'::jsonb)
 into v_result from leases l join chosen ch on ch.id=l.intent_id and ch.company_id=l.company_id
 join public.ediel_message_intents i on i.id=l.intent_id and i.company_id=l.company_id cross join(select count(*)from turns)persisted;
 if clock_timestamp()>=v_now+interval '10 minutes' then raise exception 'ediel_resume_claim_expired' using errcode='42501';end if;
 return v_result;
end;$$;

create function public.gridex_check_ediel_resume_claim_v1(p_company_id uuid,p_intent_id uuid,p_phase text,p_claim_token uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_intent public.ediel_message_intents%rowtype;v_lease private.ediel_resume_claims%rowtype;
begin
 if current_user<>'service_role' then raise exception 'ediel_resume_service_required' using errcode='42501';end if;
 perform 1 from public.companies c where c.id=p_company_id and c.status in('active','onboarding')for share;
 if not found then return false;end if;
 select * into v_intent from public.ediel_message_intents i where i.id=p_intent_id and i.company_id=p_company_id for update;
 if not found or not private.gridex_ediel_resume_phase_eligible_v1(v_intent,p_phase) then return false;end if;
 select * into v_lease from private.ediel_resume_claims l where l.intent_id=p_intent_id and l.company_id=p_company_id for update;
 if not found then return false;end if;
 return coalesce(v_lease.phase=p_phase and v_lease.claim_token=p_claim_token and v_lease.finished_at is null
  and v_lease.expires_at>=clock_timestamp() and v_lease.intent_updated_at=v_intent.updated_at,false);
end;$$;

create function public.gridex_finish_ediel_resume_claim_v1(p_company_id uuid,p_intent_id uuid,p_phase text,p_claim_token uuid,p_outcome text,p_reason text default null)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_lease private.ediel_resume_claims%rowtype;v_now timestamptz;
begin
 if current_user<>'service_role' then raise exception 'ediel_resume_service_required' using errcode='42501';end if;
 if p_outcome is null or p_outcome not in('processed','failed','skipped') or(p_reason is not null and p_reason!~'^[a-z0-9_]{1,80}$')
  then raise exception 'ediel_resume_completion_invalid' using errcode='22023';end if;
 perform 1 from public.companies c where c.id=p_company_id and c.status in('active','onboarding')for share;
 if not found then return false;end if;
 perform 1 from public.ediel_message_intents i where i.id=p_intent_id and i.company_id=p_company_id for update;
 if not found then return false;end if;
 select * into v_lease from private.ediel_resume_claims l where l.intent_id=p_intent_id and l.company_id=p_company_id for update;
 v_now:=clock_timestamp();
 if not found or v_lease.phase is distinct from p_phase or v_lease.claim_token is distinct from p_claim_token
  or v_lease.finished_at is not null or v_lease.expires_at<v_now then return false;end if;
 update private.ediel_resume_claims set finished_at=v_now,outcome=p_outcome,failure_reason=p_reason where intent_id=p_intent_id;
 if clock_timestamp()>v_lease.expires_at then raise exception 'ediel_resume_claim_expired' using errcode='42501';end if;
 return true;
end;$$;
revoke all on function public.gridex_claim_ediel_resume_intents_fair_v1(text,uuid,integer,uuid),public.gridex_check_ediel_resume_claim_v1(uuid,uuid,text,uuid),
 public.gridex_finish_ediel_resume_claim_v1(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.gridex_claim_ediel_resume_intents_fair_v1(text,uuid,integer,uuid),public.gridex_check_ediel_resume_claim_v1(uuid,uuid,text,uuid),
 public.gridex_finish_ediel_resume_claim_v1(uuid,uuid,text,uuid,text,text) to service_role;
commit;
