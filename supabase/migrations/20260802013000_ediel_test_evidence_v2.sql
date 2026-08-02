-- Tenant-qualified, immutable Ediel test evidence v2.
-- Ambiguous legacy rows are reported and quarantined; tenant ownership is never guessed.

begin;

create table if not exists public.ediel_tenant_relation_quarantine (
  id uuid primary key default gen_random_uuid(),
  source_table text not null,
  source_id uuid not null,
  reason_code text not null,
  source_company_id uuid,
  related_company_ids uuid[] not null default '{}'::uuid[],
  payload jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_notes text,
  constraint ediel_tenant_relation_quarantine_source_key unique(source_table,source_id,reason_code)
);

alter table public.ediel_test_run_messages add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.ediel_test_run_steps add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.ediel_test_artifacts add column if not exists company_id uuid references public.companies(id) on delete cascade;

-- Backfill only when the related run/message tenant is exact and unambiguous.
update public.ediel_test_run_messages trm
set company_id=r.company_id
from public.ediel_test_runs r
join public.ediel_messages m on m.id=trm.ediel_message_id
where trm.test_run_id=r.id
  and r.company_id is not null
  and m.company_id=r.company_id
  and trm.company_id is null;

insert into public.ediel_tenant_relation_quarantine(
  source_table,source_id,reason_code,source_company_id,related_company_ids,payload
)
select 'ediel_test_run_messages',trm.id,
  case
    when r.company_id is null then 'run_company_missing'
    when m.company_id is null then 'message_company_missing'
    when r.company_id<>m.company_id then 'cross_tenant_run_message'
    else 'child_company_mismatch'
  end,
  trm.company_id,
  array_remove(array[r.company_id,m.company_id],null),
  jsonb_build_object('test_run_id',trm.test_run_id,'ediel_message_id',trm.ediel_message_id)
from public.ediel_test_run_messages trm
join public.ediel_test_runs r on r.id=trm.test_run_id
join public.ediel_messages m on m.id=trm.ediel_message_id
where r.company_id is null or m.company_id is null or r.company_id<>m.company_id
   or (trm.company_id is not null and trm.company_id<>r.company_id)
on conflict do nothing;

update public.ediel_test_run_steps s
set company_id=r.company_id
from public.ediel_test_runs r
where s.test_run_id=r.id and s.company_id is null and r.company_id is not null;

update public.ediel_test_artifacts a
set company_id=r.company_id
from public.ediel_test_runs r
where a.test_run_id=r.id and a.company_id is null and r.company_id is not null
  and (
    a.ediel_message_id is null
    or exists(select 1 from public.ediel_messages m where m.id=a.ediel_message_id and m.company_id=r.company_id)
  );

insert into public.ediel_tenant_relation_quarantine(source_table,source_id,reason_code,source_company_id,related_company_ids,payload)
select 'ediel_test_artifacts',a.id,'artifact_message_tenant_mismatch',a.company_id,
  array_remove(array[r.company_id,m.company_id],null),
  jsonb_build_object('test_run_id',a.test_run_id,'ediel_message_id',a.ediel_message_id)
from public.ediel_test_artifacts a
join public.ediel_test_runs r on r.id=a.test_run_id
join public.ediel_messages m on m.id=a.ediel_message_id
where r.company_id is distinct from m.company_id
on conflict do nothing;

create unique index if not exists ediel_test_runs_company_id_id_uidx
  on public.ediel_test_runs(company_id,id);
create unique index if not exists ediel_messages_company_id_id_uidx
  on public.ediel_messages(company_id,id);

-- NOT VALID checks protect every new write while preserving ambiguous legacy rows for review.
do $$
declare v_table text; v_constraint text;
begin
  foreach v_table in array array['ediel_test_runs','ediel_test_run_messages','ediel_test_run_steps','ediel_test_artifacts'] loop
    v_constraint:=v_table||'_company_id_required_v2';
    if not exists(select 1 from pg_constraint where conname=v_constraint) then
      execute format('alter table public.%I add constraint %I check(company_id is not null) not valid',v_table,v_constraint);
    end if;
  end loop;
end $$;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='ediel_test_run_messages_company_run_fk_v2') then
    alter table public.ediel_test_run_messages add constraint ediel_test_run_messages_company_run_fk_v2
      foreign key(company_id,test_run_id) references public.ediel_test_runs(company_id,id)
      on delete cascade not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='ediel_test_run_messages_company_message_fk_v2') then
    alter table public.ediel_test_run_messages add constraint ediel_test_run_messages_company_message_fk_v2
      foreign key(company_id,ediel_message_id) references public.ediel_messages(company_id,id)
      on delete cascade not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='ediel_test_run_steps_company_run_fk_v2') then
    alter table public.ediel_test_run_steps add constraint ediel_test_run_steps_company_run_fk_v2
      foreign key(company_id,test_run_id) references public.ediel_test_runs(company_id,id)
      on delete cascade not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='ediel_test_artifacts_company_run_fk_v2') then
    alter table public.ediel_test_artifacts add constraint ediel_test_artifacts_company_run_fk_v2
      foreign key(company_id,test_run_id) references public.ediel_test_runs(company_id,id)
      on delete cascade not valid;
  end if;
end $$;

create or replace function public.guard_ediel_test_run_message_evidence()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_run public.ediel_test_runs%rowtype;
  v_message public.ediel_messages%rowtype;
begin
  select * into strict v_run from public.ediel_test_runs where id=new.test_run_id;
  select * into strict v_message from public.ediel_messages where id=new.ediel_message_id;

  if new.company_id is null or v_run.company_id is null or v_message.company_id is null
     or new.company_id<>v_run.company_id or new.company_id<>v_message.company_id then
    raise exception 'ediel_test_evidence_tenant_mismatch';
  end if;
  if lower(coalesce(v_run.environment,''))<>'test' then
    raise exception 'ediel_test_run_environment_must_be_test';
  end if;
  if lower(coalesce(v_message.environment,''))<>'test' or coalesce(v_message.test_flag,0)<>1 then
    raise exception 'production_message_cannot_be_test_evidence';
  end if;
  if v_message.created_at<coalesce(v_run.started_at,v_run.created_at) then
    raise exception 'test_evidence_predates_run';
  end if;
  return new;
end;
$$;

drop trigger if exists ediel_test_run_messages_evidence_guard_v2 on public.ediel_test_run_messages;
create trigger ediel_test_run_messages_evidence_guard_v2
before insert or update of company_id,test_run_id,ediel_message_id
on public.ediel_test_run_messages
for each row execute function public.guard_ediel_test_run_message_evidence();

create table if not exists public.actor_test_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  test_run_id uuid not null,
  test_case_key text not null,
  status text not null,
  machine_verified boolean not null default false,
  configuration_snapshot_id uuid not null references public.ediel_configuration_snapshots(id) on delete restrict,
  configuration_hash text not null,
  rulebook_version text not null,
  engine_version text,
  started_at timestamptz not null,
  completed_at timestamptz,
  evidence_digest text,
  failure_code text,
  failure_details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint actor_test_attempts_status_check
    check(status in ('running','passed','failed','blocked','manual_verified','superseded')),
  constraint actor_test_attempts_passed_machine_check
    check(status<>'passed' or machine_verified),
  constraint actor_test_attempts_company_run_fk
    foreign key(company_id,test_run_id) references public.ediel_test_runs(company_id,id) on delete cascade
);

create index if not exists actor_test_attempts_current_idx
  on public.actor_test_attempts(company_id,test_case_key,configuration_snapshot_id,created_at desc);

create unique index if not exists actor_test_attempts_company_id_id_uidx
  on public.actor_test_attempts(company_id,id);

create table if not exists public.actor_test_attempt_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  attempt_id uuid not null references public.actor_test_attempts(id) on delete cascade,
  ediel_message_id uuid not null,
  evidence_role text not null,
  direction text,
  ack_outcome text,
  source_message_reference text,
  created_at timestamptz not null default now(),
  constraint actor_test_attempt_evidence_company_message_fk
    foreign key(company_id,ediel_message_id) references public.ediel_messages(company_id,id) on delete restrict,
  constraint actor_test_attempt_evidence_company_attempt_fk
    foreign key(company_id,attempt_id) references public.actor_test_attempts(company_id,id) on delete cascade,
  constraint actor_test_attempt_evidence_attempt_message_key
    unique(attempt_id,ediel_message_id,evidence_role)
);

create table if not exists public.actor_test_manual_attestations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  attempt_id uuid references public.actor_test_attempts(id) on delete restrict,
  test_run_id uuid not null,
  test_case_key text not null,
  reason text not null,
  evidence_reference text not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  status text not null default 'requested',
  decision_reason text,
  created_at timestamptz not null default now(),
  constraint actor_test_manual_attestations_status_check
    check(status in ('requested','approved','rejected','revoked')),
  constraint actor_test_manual_attestations_separation_check
    check(approved_by is null or requested_by<>approved_by),
  constraint actor_test_manual_attestations_company_attempt_fk
    foreign key(company_id,attempt_id) references public.actor_test_attempts(company_id,id) on delete restrict,
  constraint actor_test_manual_attestations_company_run_fk
    foreign key(company_id,test_run_id) references public.ediel_test_runs(company_id,id) on delete restrict
);

create or replace function public.prevent_terminal_actor_test_attempt_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.status in ('passed','failed','blocked','manual_verified','superseded') then
    raise exception 'terminal_actor_test_attempts_are_immutable';
  end if;
  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists actor_test_attempts_terminal_immutable on public.actor_test_attempts;
create trigger actor_test_attempts_terminal_immutable
before update or delete on public.actor_test_attempts
for each row execute function public.prevent_terminal_actor_test_attempt_mutation();

create or replace function public.guard_machine_passed_actor_test_result()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.status='passed' and current_setting('gridex.machine_evidence_rpc',true)<>'on' then
    raise exception 'passed_requires_canonical_machine_evidence_rpc';
  end if;
  if new.status='manual_verified' and current_setting('gridex.manual_attestation_rpc',true)<>'on' then
    raise exception 'manual_verified_requires_canonical_attestation_rpc';
  end if;
  return new;
end;
$$;
drop trigger if exists actor_test_results_machine_pass_guard on public.actor_test_results;
create trigger actor_test_results_machine_pass_guard
before insert or update of status on public.actor_test_results
for each row execute function public.guard_machine_passed_actor_test_result();

alter table public.ediel_tenant_relation_quarantine enable row level security;
alter table public.actor_test_attempts enable row level security;
alter table public.actor_test_attempt_evidence enable row level security;
alter table public.actor_test_manual_attestations enable row level security;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'ediel_test_runs','ediel_test_run_messages','ediel_test_run_steps','ediel_test_artifacts',
    'ediel_tenant_relation_quarantine','actor_test_attempts','actor_test_attempt_evidence',
    'actor_test_manual_attestations'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('drop policy if exists %I on public.%I',v_table||'_service_role_all_v2',v_table);
    execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',v_table||'_service_role_all_v2',v_table);
    execute format('drop policy if exists %I on public.%I',v_table||'_tenant_read_v2',v_table);
    execute format('create policy %I on public.%I for select to authenticated using(public.gridex_can_read_company(company_id))',v_table||'_tenant_read_v2',v_table);
  end loop;
end $$;

grant all on public.ediel_tenant_relation_quarantine,public.actor_test_attempts,
  public.actor_test_attempt_evidence,public.actor_test_manual_attestations to service_role;
grant select on public.actor_test_attempts,public.actor_test_attempt_evidence,
  public.actor_test_manual_attestations to authenticated;

create or replace view public.actor_test_current_results_v
with (security_invoker=true)
as
select distinct on (a.company_id,a.test_case_key)
  a.*
from public.actor_test_attempts a
join public.ediel_production_state ps
  on ps.company_id=a.company_id
 and ps.configuration_snapshot_id=a.configuration_snapshot_id
where a.status<>'superseded'
order by a.company_id,a.test_case_key,a.created_at desc,a.id desc;

grant select on public.actor_test_current_results_v to authenticated,service_role;

create or replace function public.canonical_record_actor_test_evidence(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid:=(p_command->>'company_id')::uuid;
  v_run_id uuid:=(p_command->>'test_run_id')::uuid;
  v_actor_user_id uuid:=nullif(p_command->>'actor_user_id','')::uuid;
  v_test_case_key text:=upper(p_command->>'test_case_key');
  v_idempotency_key text:=p_command->>'idempotency_key';
  v_run public.ediel_test_runs%rowtype;
  v_snapshot public.ediel_configuration_snapshots%rowtype;
  v_attempt_id uuid;
  v_message_id uuid;
  v_message_ids uuid[]:=array[]::uuid[];
  v_evidence jsonb:=coalesce(p_command->'evidence','{}'::jsonb);
  v_evidence_digest text;
  v_existing jsonb;
  v_result jsonb;
  v_event_id uuid;
begin
  if v_company_id is null or v_run_id is null or nullif(v_test_case_key,'') is null
     or nullif(btrim(v_idempotency_key),'') is null then
    raise exception 'company_run_case_and_idempotency_required';
  end if;

  select result_payload into v_existing from public.canonical_command_results
  where company_id=v_company_id and command_type='ediel.test.evidence.record' and idempotency_key=v_idempotency_key;
  if found then return v_existing; end if;

  select * into v_run from public.ediel_test_runs
  where id=v_run_id and company_id=v_company_id for update;
  if not found then raise exception 'tenant_scoped_test_run_not_found'; end if;
  if lower(coalesce(v_run.environment,'test'))<>'test' then raise exception 'production_run_cannot_be_test_evidence'; end if;
  if upper(v_run.test_case_code)<>v_test_case_key then raise exception 'test_case_does_not_match_run'; end if;
  if nullif(p_command->>'package_key','') is not null
     and v_run.setup_package is not null
     and v_run.setup_package is distinct from p_command->>'package_key' then
    raise exception 'test_package_does_not_match_run';
  end if;
  if nullif(p_command->>'message_family','') is not null
     and v_run.message_family is not null
     and upper(v_run.message_family) is distinct from upper(p_command->>'message_family') then
    raise exception 'message_family_does_not_match_run';
  end if;
  if v_run.configuration_snapshot_id is null then raise exception 'test_run_configuration_snapshot_required'; end if;
  select * into v_snapshot from public.ediel_configuration_snapshots
  where id=v_run.configuration_snapshot_id and company_id=v_company_id;
  if not found then raise exception 'test_run_snapshot_not_found_for_tenant'; end if;
  if coalesce(v_run.is_stale,false) then raise exception 'stale_test_run_cannot_pass'; end if;

  select coalesce(array_agg(value::uuid),array[]::uuid[]) into v_message_ids
  from jsonb_array_elements_text(coalesce(p_command->'message_ids','[]'::jsonb));
  if cardinality(v_message_ids)=0 then raise exception 'machine_pass_requires_evidence_messages'; end if;

  if exists(
    select 1 from unnest(v_message_ids) ids(id)
    left join public.ediel_messages m on m.id=ids.id and m.company_id=v_company_id
    left join public.ediel_test_run_messages trm
      on trm.company_id=v_company_id and trm.test_run_id=v_run_id and trm.ediel_message_id=ids.id
    where m.id is null or trm.id is null or lower(coalesce(m.environment,''))<>'test' or coalesce(m.test_flag,0)<>1
       or m.created_at<coalesce(v_run.started_at,v_run.created_at)
  ) then raise exception 'invalid_unattached_or_cross_tenant_test_evidence_message'; end if;

  v_evidence_digest:=encode(digest(convert_to(v_evidence::text||array_to_string(v_message_ids,','),'utf8'),'sha256'),'hex');

  insert into public.actor_test_attempts(
    company_id,test_run_id,test_case_key,status,machine_verified,
    configuration_snapshot_id,configuration_hash,rulebook_version,engine_version,
    started_at,completed_at,evidence_digest,created_by
  ) values (
    v_company_id,v_run_id,v_test_case_key,'passed',true,
    v_snapshot.id,v_snapshot.configuration_hash,coalesce(v_run.rulebook_version,'unknown'),
    v_run.engine_version,coalesce(v_run.started_at,v_run.created_at),now(),v_evidence_digest,v_actor_user_id
  ) returning id into v_attempt_id;

  foreach v_message_id in array v_message_ids loop
    insert into public.actor_test_attempt_evidence(company_id,attempt_id,ediel_message_id,evidence_role)
    values(v_company_id,v_attempt_id,v_message_id,'machine_evidence');
  end loop;

  perform set_config('gridex.machine_evidence_rpc','on',true);
  insert into public.actor_test_results(
    company_id,test_key,test_name,test_id,package_key,message_family,message_code,direction,
    status,latest_run_at,passed_at,failure_reason,portal_status,raw_payload,
    ediel_test_run_id,contrl_message_id,aperak_message_id,utilts_err_message_id,
    evidence,configuration_snapshot_id,configuration_hash,is_stale,stale_reason,
    created_by,updated_by,created_at,updated_at
  ) values (
    v_company_id,v_test_case_key,p_command->>'test_name',p_command->>'test_id',p_command->>'package_key',
    p_command->>'message_family',p_command->>'message_code',p_command->>'direction',
    'passed',now(),now(),null,p_command->>'portal_status',p_command->>'raw_payload',
    v_run_id,nullif(p_command->>'contrl_message_id','')::uuid,
    nullif(p_command->>'aperak_message_id','')::uuid,
    nullif(p_command->>'utilts_err_message_id','')::uuid,
    v_evidence,v_snapshot.id,v_snapshot.configuration_hash,false,null,
    v_actor_user_id,v_actor_user_id,now(),now()
  ) on conflict(company_id,test_key) do update set
    status='passed',latest_run_at=excluded.latest_run_at,passed_at=excluded.passed_at,
    failure_reason=null,portal_status=excluded.portal_status,raw_payload=excluded.raw_payload,
    ediel_test_run_id=excluded.ediel_test_run_id,contrl_message_id=excluded.contrl_message_id,
    aperak_message_id=excluded.aperak_message_id,utilts_err_message_id=excluded.utilts_err_message_id,
    evidence=excluded.evidence,configuration_snapshot_id=excluded.configuration_snapshot_id,
    configuration_hash=excluded.configuration_hash,is_stale=false,stale_reason=null,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  update public.ediel_test_runs set status='passed',completed_at=now(),failure_reason=null,updated_by=v_actor_user_id,updated_at=now()
  where id=v_run_id and company_id=v_company_id;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,idempotency_key,after_state,metadata
  ) values (
    v_company_id,'EDIEL_TEST_ATTEMPT_COMPLETED','actor_test_attempt',v_attempt_id,v_actor_user_id,
    'Maskinverifierad komplett evidenskedja.',v_idempotency_key,
    jsonb_build_object('status','passed','machine_verified',true,'configuration_snapshot_id',v_snapshot.id),v_evidence
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values (
    v_company_id,'EDIEL_TEST_ATTEMPT_COMPLETED','actor_test_attempt',v_attempt_id,v_idempotency_key,
    jsonb_build_object('test_run_id',v_run_id,'test_case_key',v_test_case_key,'status','passed',
      'configuration_snapshot_id',v_snapshot.id,'evidence_digest',v_evidence_digest),v_actor_user_id
  ) returning id into v_event_id;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(v_company_id,v_event_id,'ediel.test.attempt.completed',v_idempotency_key,
    jsonb_build_object('attempt_id',v_attempt_id,'test_run_id',v_run_id,'status','passed'));

  v_result:=jsonb_build_object('attempt_id',v_attempt_id,'status','passed','machine_verified',true,
    'configuration_snapshot_id',v_snapshot.id,'evidence_digest',v_evidence_digest);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company_id,'ediel.test.evidence.record',v_idempotency_key,p_command,v_result,v_actor_user_id);
  return v_result;
end;
$$;

revoke all on function public.canonical_record_actor_test_evidence(jsonb) from public,anon,authenticated;
grant execute on function public.canonical_record_actor_test_evidence(jsonb) to service_role;

create or replace function public.canonical_request_actor_test_attestation(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid:=(p_command->>'company_id')::uuid;
  v_run_id uuid:=(p_command->>'test_run_id')::uuid;
  v_actor_user_id uuid:=nullif(p_command->>'actor_user_id','')::uuid;
  v_test_case_key text:=upper(p_command->>'test_case_key');
  v_reason text:=nullif(btrim(p_command->>'reason'),'');
  v_evidence_reference text:=nullif(btrim(p_command->>'evidence_reference'),'');
  v_idempotency_key text:=p_command->>'idempotency_key';
  v_run public.ediel_test_runs%rowtype;
  v_attestation_id uuid;
  v_event_id uuid;
  v_existing jsonb;
  v_result jsonb;
begin
  if v_company_id is null or v_run_id is null or v_actor_user_id is null
     or nullif(v_test_case_key,'') is null or v_reason is null or v_evidence_reference is null
     or nullif(btrim(v_idempotency_key),'') is null then
    raise exception 'manual_attestation_request_fields_required';
  end if;

  select result_payload into v_existing from public.canonical_command_results
  where company_id=v_company_id and command_type='ediel.test.attestation.request' and idempotency_key=v_idempotency_key;
  if found then return v_existing; end if;

  select * into v_run from public.ediel_test_runs
  where id=v_run_id and company_id=v_company_id for update;
  if not found then raise exception 'tenant_scoped_test_run_not_found'; end if;
  if upper(v_run.test_case_code)<>v_test_case_key then raise exception 'test_case_does_not_match_run'; end if;
  if lower(coalesce(v_run.environment,''))<>'test' then raise exception 'manual_attestation_requires_test_run'; end if;
  if v_run.configuration_snapshot_id is null or coalesce(v_run.is_stale,false) then
    raise exception 'manual_attestation_requires_current_snapshot';
  end if;

  insert into public.actor_test_manual_attestations(
    company_id,test_run_id,test_case_key,reason,evidence_reference,requested_by,requested_at,status
  ) values (
    v_company_id,v_run_id,v_test_case_key,v_reason,v_evidence_reference,v_actor_user_id,now(),'requested'
  ) returning id into v_attestation_id;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,idempotency_key,after_state
  ) values (
    v_company_id,'EDIEL_TEST_MANUAL_ATTESTATION_REQUESTED','actor_test_attestation',v_attestation_id,
    v_actor_user_id,v_reason,v_idempotency_key,
    jsonb_build_object('status','requested','test_run_id',v_run_id,'test_case_key',v_test_case_key,'evidence_reference',v_evidence_reference)
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values (
    v_company_id,'EDIEL_TEST_MANUAL_ATTESTATION_REQUESTED','actor_test_attestation',v_attestation_id,
    v_idempotency_key,jsonb_build_object('test_run_id',v_run_id,'test_case_key',v_test_case_key),v_actor_user_id
  ) returning id into v_event_id;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(v_company_id,v_event_id,'ediel.test.attestation.requested',v_idempotency_key,
    jsonb_build_object('attestation_id',v_attestation_id,'test_run_id',v_run_id));

  v_result:=jsonb_build_object('attestation_id',v_attestation_id,'status','requested','test_run_id',v_run_id);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company_id,'ediel.test.attestation.request',v_idempotency_key,p_command,v_result,v_actor_user_id);
  return v_result;
end;
$$;

revoke all on function public.canonical_request_actor_test_attestation(jsonb) from public,anon,authenticated;
grant execute on function public.canonical_request_actor_test_attestation(jsonb) to service_role;

create or replace function public.canonical_approve_actor_test_attestation(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid:=(p_command->>'company_id')::uuid;
  v_attestation_id uuid:=(p_command->>'attestation_id')::uuid;
  v_actor_user_id uuid:=nullif(p_command->>'actor_user_id','')::uuid;
  v_decision_reason text:=nullif(btrim(p_command->>'decision_reason'),'');
  v_idempotency_key text:=p_command->>'idempotency_key';
  v_attestation public.actor_test_manual_attestations%rowtype;
  v_run public.ediel_test_runs%rowtype;
  v_snapshot public.ediel_configuration_snapshots%rowtype;
  v_attempt_id uuid;
  v_event_id uuid;
  v_digest text;
  v_existing jsonb;
  v_result jsonb;
begin
  if v_company_id is null or v_attestation_id is null or v_actor_user_id is null
     or v_decision_reason is null or nullif(btrim(v_idempotency_key),'') is null then
    raise exception 'manual_attestation_approval_fields_required';
  end if;

  select result_payload into v_existing from public.canonical_command_results
  where company_id=v_company_id and command_type='ediel.test.attestation.approve' and idempotency_key=v_idempotency_key;
  if found then return v_existing; end if;

  select * into v_attestation from public.actor_test_manual_attestations
  where id=v_attestation_id and company_id=v_company_id for update;
  if not found then raise exception 'tenant_scoped_attestation_not_found'; end if;
  if v_attestation.status<>'requested' then raise exception 'attestation_is_not_pending'; end if;
  if v_attestation.requested_by=v_actor_user_id then raise exception 'attestation_requires_separate_approver'; end if;

  select * into v_run from public.ediel_test_runs
  where id=v_attestation.test_run_id and company_id=v_company_id for update;
  if not found then raise exception 'tenant_scoped_test_run_not_found'; end if;
  if v_run.configuration_snapshot_id is null or coalesce(v_run.is_stale,false) then
    raise exception 'stale_test_run_cannot_be_manually_attested';
  end if;
  select * into v_snapshot from public.ediel_configuration_snapshots
  where id=v_run.configuration_snapshot_id and company_id=v_company_id;
  if not found then raise exception 'test_run_snapshot_not_found_for_tenant'; end if;

  v_digest:=encode(digest(convert_to(v_attestation.reason||'|'||v_attestation.evidence_reference||'|'||v_decision_reason,'utf8'),'sha256'),'hex');
  insert into public.actor_test_attempts(
    company_id,test_run_id,test_case_key,status,machine_verified,
    configuration_snapshot_id,configuration_hash,rulebook_version,engine_version,
    started_at,completed_at,evidence_digest,failure_details,created_by
  ) values (
    v_company_id,v_run.id,v_attestation.test_case_key,'manual_verified',false,
    v_snapshot.id,v_snapshot.configuration_hash,coalesce(v_run.rulebook_version,'unknown'),v_run.engine_version,
    coalesce(v_run.started_at,v_run.created_at),now(),v_digest,
    jsonb_build_object('reason',v_attestation.reason,'evidence_reference',v_attestation.evidence_reference,'decision_reason',v_decision_reason),
    v_actor_user_id
  ) returning id into v_attempt_id;

  update public.actor_test_manual_attestations
  set attempt_id=v_attempt_id,approved_by=v_actor_user_id,approved_at=now(),status='approved',decision_reason=v_decision_reason
  where id=v_attestation_id and company_id=v_company_id;

  perform set_config('gridex.manual_attestation_rpc','on',true);
  insert into public.actor_test_results(
    company_id,test_key,status,latest_run_at,passed_at,failure_reason,ediel_test_run_id,evidence,
    configuration_snapshot_id,configuration_hash,is_stale,stale_reason,created_by,updated_by,created_at,updated_at
  ) values (
    v_company_id,v_attestation.test_case_key,'manual_verified',now(),null,null,v_run.id,
    jsonb_build_object('manual_attestation_id',v_attestation_id,'attempt_id',v_attempt_id,'reason',v_attestation.reason,
      'evidence_reference',v_attestation.evidence_reference,'approved_by',v_actor_user_id,'decision_reason',v_decision_reason),
    v_snapshot.id,v_snapshot.configuration_hash,false,null,v_actor_user_id,v_actor_user_id,now(),now()
  ) on conflict(company_id,test_key) do update set
    status='manual_verified',latest_run_at=excluded.latest_run_at,passed_at=null,failure_reason=null,
    ediel_test_run_id=excluded.ediel_test_run_id,evidence=excluded.evidence,
    configuration_snapshot_id=excluded.configuration_snapshot_id,configuration_hash=excluded.configuration_hash,
    is_stale=false,stale_reason=null,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,idempotency_key,after_state
  ) values (
    v_company_id,'EDIEL_TEST_MANUALLY_ATTESTED','actor_test_attempt',v_attempt_id,
    v_actor_user_id,v_decision_reason,v_idempotency_key,
    jsonb_build_object('status','manual_verified','test_run_id',v_run.id,'attestation_id',v_attestation_id,
      'configuration_snapshot_id',v_snapshot.id)
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values (
    v_company_id,'EDIEL_TEST_MANUALLY_ATTESTED','actor_test_attempt',v_attempt_id,v_idempotency_key,
    jsonb_build_object('test_run_id',v_run.id,'test_case_key',v_attestation.test_case_key,
      'attestation_id',v_attestation_id,'configuration_snapshot_id',v_snapshot.id),v_actor_user_id
  ) returning id into v_event_id;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(v_company_id,v_event_id,'ediel.test.manually_attested',v_idempotency_key,
    jsonb_build_object('attempt_id',v_attempt_id,'attestation_id',v_attestation_id,'test_run_id',v_run.id));

  v_result:=jsonb_build_object('attempt_id',v_attempt_id,'attestation_id',v_attestation_id,
    'status','manual_verified','configuration_snapshot_id',v_snapshot.id);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company_id,'ediel.test.attestation.approve',v_idempotency_key,p_command,v_result,v_actor_user_id);
  return v_result;
end;
$$;

revoke all on function public.canonical_approve_actor_test_attestation(jsonb) from public,anon,authenticated;
grant execute on function public.canonical_approve_actor_test_attestation(jsonb) to service_role;

commit;
