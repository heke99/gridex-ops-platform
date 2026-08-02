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
from public.ediel_test_runs r,
     public.ediel_messages m
where trm.test_run_id=r.id
  and m.id=trm.ediel_message_id
  and r.company_id is not null
  and m.company_id=r.company_id
  and trm.company_id is null;

-- Runs without a deterministic tenant remain immutable legacy evidence and are
-- quarantined. They are never assigned to the latest/default company.
insert into public.ediel_tenant_relation_quarantine(
  source_table,source_id,reason_code,source_company_id,related_company_ids,payload
)
select 'ediel_test_runs',r.id,'run_company_unresolved',null,
  array_remove(array[c.company_id,s.company_id],null),
  jsonb_build_object(
    'test_case_code',r.test_case_code,
    'customer_id',r.customer_id,
    'actor_profile_id',r.actor_profile_id,
    'customer_company_id',c.company_id,
    'actor_profile_company_id',s.company_id
  )
from public.ediel_test_runs r
left join public.customers c on c.id=r.customer_id
left join public.ediel_actor_settings s on s.id=r.actor_profile_id
where r.company_id is null
on conflict do nothing;

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
where s.test_run_id=r.id and s.company_id is null and r.company_id is not null
  and (
    s.ediel_message_id is null
    or exists(select 1 from public.ediel_messages m where m.id=s.ediel_message_id and m.company_id=r.company_id)
  );

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
  if not exists(select 1 from pg_constraint where conname='ediel_test_run_steps_company_message_fk_v2') then
    alter table public.ediel_test_run_steps add constraint ediel_test_run_steps_company_message_fk_v2
      foreign key(company_id,ediel_message_id) references public.ediel_messages(company_id,id)
      on delete restrict not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='ediel_test_artifacts_company_run_fk_v2') then
    alter table public.ediel_test_artifacts add constraint ediel_test_artifacts_company_run_fk_v2
      foreign key(company_id,test_run_id) references public.ediel_test_runs(company_id,id)
      on delete cascade not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='ediel_test_artifacts_company_message_fk_v2') then
    alter table public.ediel_test_artifacts add constraint ediel_test_artifacts_company_message_fk_v2
      foreign key(company_id,ediel_message_id) references public.ediel_messages(company_id,id)
      on delete restrict not valid;
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
  test_case_code text not null,
  environment_type public.ediel_environment_type not null,
  actor_role text not null,
  role_code text not null,
  test_suite text not null,
  setup_package text not null,
  message_family text not null,
  message_variant text,
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
  on public.actor_test_attempts(
    company_id,environment_type,actor_role,test_suite,setup_package,
    message_family,test_case_code,message_variant,rulebook_version,
    configuration_snapshot_id,created_at desc
  );

create unique index if not exists actor_test_attempts_company_id_id_uidx
  on public.actor_test_attempts(company_id,id);

create table if not exists public.actor_test_attempt_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  attempt_id uuid not null references public.actor_test_attempts(id) on delete cascade,
  test_run_id uuid not null,
  ediel_message_id uuid not null,
  evidence_role text not null,
  source_message_id uuid,
  correlation_snapshot jsonb not null default '{}'::jsonb,
  transport_status_snapshot text not null,
  message_hash text not null,
  configuration_snapshot_id uuid not null references public.ediel_configuration_snapshots(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint actor_test_attempt_evidence_company_message_fk
    foreign key(company_id,ediel_message_id) references public.ediel_messages(company_id,id) on delete restrict,
  constraint actor_test_attempt_evidence_company_source_message_fk
    foreign key(company_id,source_message_id) references public.ediel_messages(company_id,id) on delete restrict,
  constraint actor_test_attempt_evidence_company_attempt_fk
    foreign key(company_id,attempt_id) references public.actor_test_attempts(company_id,id) on delete cascade,
  constraint actor_test_attempt_evidence_company_run_fk
    foreign key(company_id,test_run_id) references public.ediel_test_runs(company_id,id) on delete restrict,
  constraint actor_test_attempt_evidence_attempt_message_key
    unique(attempt_id,ediel_message_id,evidence_role),
  constraint actor_test_attempt_evidence_role_check check(evidence_role in (
    'source_message','transport_acceptance','positive_contrl','negative_contrl',
    'positive_aperak','negative_aperak','utilts_inbound','utilts_error_outbound',
    'final_portal_aperak','portal_identity'
  ))
);

create table if not exists public.actor_test_manual_attestations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  attempt_id uuid references public.actor_test_attempts(id) on delete restrict,
  test_run_id uuid not null,
  test_case_code text not null,
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
  if tg_op='UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.test_run_id is distinct from old.test_run_id
    or new.test_case_code is distinct from old.test_case_code
    or new.environment_type is distinct from old.environment_type
    or new.actor_role is distinct from old.actor_role
    or new.role_code is distinct from old.role_code
    or new.test_suite is distinct from old.test_suite
    or new.setup_package is distinct from old.setup_package
    or new.message_family is distinct from old.message_family
    or new.message_variant is distinct from old.message_variant
    or new.configuration_snapshot_id is distinct from old.configuration_snapshot_id
    or new.configuration_hash is distinct from old.configuration_hash
    or new.rulebook_version is distinct from old.rulebook_version
  ) then
    raise exception 'actor_test_attempt_identity_is_immutable';
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

create or replace function public.prevent_actor_test_evidence_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'actor_test_evidence_is_immutable';
end;
$$;
drop trigger if exists actor_test_attempt_evidence_immutable on public.actor_test_attempt_evidence;
create trigger actor_test_attempt_evidence_immutable
before update or delete on public.actor_test_attempt_evidence
for each row execute function public.prevent_actor_test_evidence_mutation();

create or replace function public.prevent_terminal_actor_test_attestation_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.status in ('approved','rejected','revoked') then
    raise exception 'terminal_actor_test_attestation_is_immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.company_id is distinct from old.company_id
     or new.test_run_id is distinct from old.test_run_id
     or new.test_case_code is distinct from old.test_case_code
     or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at
     or new.reason is distinct from old.reason
     or new.evidence_reference is distinct from old.evidence_reference then
    raise exception 'actor_test_attestation_identity_is_immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists actor_test_manual_attestations_terminal_immutable on public.actor_test_manual_attestations;
create trigger actor_test_manual_attestations_terminal_immutable
before update or delete on public.actor_test_manual_attestations
for each row execute function public.prevent_terminal_actor_test_attestation_mutation();

create or replace function public.guard_machine_passed_actor_test_result()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.status='passed' and not exists(
    select 1
    from public.actor_test_attempts a
    where a.company_id=new.company_id
      and a.test_run_id=new.ediel_test_run_id
      and a.test_case_code=upper(new.test_key)
      and a.configuration_snapshot_id=new.configuration_snapshot_id
      and a.configuration_hash=new.configuration_hash
      and a.status='passed'
      and a.machine_verified
      and a.evidence_digest is not null
      and exists(
        select 1 from public.actor_test_attempt_evidence e
        where e.company_id=a.company_id and e.attempt_id=a.id
          and e.test_run_id=a.test_run_id
          and e.configuration_snapshot_id=a.configuration_snapshot_id
          and e.evidence_role='source_message'
      )
  ) then
    raise exception 'passed_requires_matching_canonical_machine_evidence';
  end if;
  if new.status='manual_verified' and not exists(
    select 1
    from public.actor_test_attempts a
    join public.actor_test_manual_attestations ma
      on ma.company_id=a.company_id and ma.attempt_id=a.id
    where a.company_id=new.company_id
      and a.test_run_id=new.ediel_test_run_id
      and a.test_case_code=upper(new.test_key)
      and a.configuration_snapshot_id=new.configuration_snapshot_id
      and a.configuration_hash=new.configuration_hash
      and a.status='manual_verified'
      and not a.machine_verified
      and ma.status='approved'
      and ma.requested_by<>ma.approved_by
  ) then
    raise exception 'manual_verified_requires_matching_canonical_attestation';
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
declare v_table text; v_policy text;
begin
  foreach v_table in array array[
    'ediel_test_runs','ediel_test_run_messages','ediel_test_run_steps','ediel_test_artifacts',
    'actor_test_attempts','actor_test_attempt_evidence',
    'actor_test_manual_attestations'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    for v_policy in
      select policyname from pg_policies where schemaname='public' and tablename=v_table
    loop
      execute format('drop policy if exists %I on public.%I',v_policy,v_table);
    end loop;
    execute format('drop policy if exists %I on public.%I',v_table||'_service_role_all_v2',v_table);
    execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',v_table||'_service_role_all_v2',v_table);
    execute format('drop policy if exists %I on public.%I',v_table||'_tenant_read_v2',v_table);
    execute format('create policy %I on public.%I for select to authenticated using(public.gridex_can_read_company(company_id))',v_table||'_tenant_read_v2',v_table);
  end loop;
end $$;

-- Quarantine rows can be tenantless or relate to several tenants. They must
-- never inherit a generic tenant policy that assumes a company_id column.
drop policy if exists ediel_tenant_relation_quarantine_service_role_all_v2
  on public.ediel_tenant_relation_quarantine;
create policy ediel_tenant_relation_quarantine_service_role_all_v2
  on public.ediel_tenant_relation_quarantine
  for all to service_role using(true) with check(true);

revoke all on public.ediel_tenant_relation_quarantine from anon,authenticated;

revoke all on public.ediel_test_runs,public.ediel_test_run_messages,
  public.ediel_test_run_steps,public.ediel_test_artifacts,
  public.actor_test_attempts,public.actor_test_attempt_evidence,
  public.actor_test_manual_attestations from anon,authenticated;

grant all on public.ediel_tenant_relation_quarantine,public.actor_test_attempts,
  public.actor_test_attempt_evidence,public.actor_test_manual_attestations to service_role;
grant select on public.ediel_test_runs,public.ediel_test_run_messages,
  public.ediel_test_run_steps,public.ediel_test_artifacts,
  public.actor_test_attempts,public.actor_test_attempt_evidence,
  public.actor_test_manual_attestations to authenticated;

create or replace view public.actor_test_current_results_v
with (security_invoker=true)
as
select distinct on (
  a.company_id,a.environment_type,a.actor_role,a.test_suite,a.setup_package,
  a.message_family,a.test_case_code,a.message_variant,a.rulebook_version
)
  a.*
from public.actor_test_attempts a
join public.ediel_active_test_configurations c
  on c.company_id=a.company_id
 and c.configuration_snapshot_id=a.configuration_snapshot_id
 and c.status='active'
 and c.environment='test'
 and c.actor_role=a.actor_role
 and c.test_suite=a.test_suite
 and c.message_family=a.message_family
 and c.setup_package=a.setup_package
where a.status<>'superseded'
order by
  a.company_id,a.environment_type,a.actor_role,a.test_suite,a.setup_package,
  a.message_family,a.test_case_code,a.message_variant,a.rulebook_version,
  a.created_at desc,a.id desc;

grant select on public.actor_test_current_results_v to authenticated,service_role;

revoke all on function public.guard_ediel_test_run_message_evidence() from public,anon,authenticated;
revoke all on function public.prevent_terminal_actor_test_attempt_mutation() from public,anon,authenticated;
revoke all on function public.prevent_actor_test_evidence_mutation() from public,anon,authenticated;
revoke all on function public.prevent_terminal_actor_test_attestation_mutation() from public,anon,authenticated;
revoke all on function public.guard_machine_passed_actor_test_result() from public,anon,authenticated;

create or replace function public.gridex_actor_has_company_permission(
  p_actor_user_id uuid,p_company_id uuid,p_permission text
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select p_actor_user_id is not null and p_company_id is not null
  and exists(
    select 1 from auth.users u
    where u.id=p_actor_user_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
  )
  and (
    exists(
      select 1 from public.admin_users au
      where au.user_id=p_actor_user_id
        and coalesce(au.is_active,true)
        and lower(coalesce(au.role,'')) in ('super_admin','superadmin','platform_superadmin')
    )
    or exists(
      select 1
      from public.user_roles ur left join public.roles r on r.id=ur.role_id
      where ur.user_id=p_actor_user_id and ur.company_id is null
        and coalesce(ur.status,'active')='active' and coalesce(ur.is_active,true)
        and lower(coalesce(ur.role,r.key,r.name,'')) in ('super_admin','superadmin','platform_superadmin')
    )
    or (
      exists(
        select 1 from public.company_memberships cm
        join public.companies c on c.id=cm.company_id
        where cm.user_id=p_actor_user_id and cm.company_id=p_company_id
          and coalesce(cm.status,'active')='active' and coalesce(cm.is_active,true)
          and coalesce(c.is_active,true)
          and coalesce(c.status,'active') not in ('archived','suspended','pending_deletion','deleted')
      )
      and public.gridex_has_permission(p_actor_user_id,p_permission)
    )
  )
$$;

revoke all on function public.gridex_actor_has_company_permission(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_actor_has_company_permission(uuid,uuid,text) to service_role;

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
  v_test_case_code text:=upper(coalesce(p_command->>'test_case_code',p_command->>'test_case_key'));
  v_idempotency_key text:=p_command->>'idempotency_key';
  v_run public.ediel_test_runs%rowtype;
  v_snapshot public.ediel_configuration_snapshots%rowtype;
  v_test_case public.ediel_test_cases%rowtype;
  v_source public.ediel_messages%rowtype;
  v_contrl public.ediel_messages%rowtype;
  v_aperak public.ediel_messages%rowtype;
  v_utilts_err public.ediel_messages%rowtype;
  v_final_aperak public.ediel_messages%rowtype;
  v_actor_role text;
  v_expected_direction text;
  v_portal_ediel_id text;
  v_definition_count integer;
  v_source_count integer;
  v_match_count integer;
  v_step_count integer;
  v_attempt_id uuid;
  v_evidence jsonb;
  v_evidence_digest text;
  v_existing jsonb;
  v_result jsonb;
  v_event_id uuid;
begin
  if v_company_id is null or v_run_id is null or v_actor_user_id is null
     or nullif(v_test_case_code,'') is null
     or nullif(btrim(v_idempotency_key),'') is null then
    raise exception 'company_run_case_actor_and_idempotency_required';
  end if;

  if not public.gridex_actor_has_company_permission(
    v_actor_user_id,v_company_id,'ediel_testing.write'
  ) then
    raise exception using errcode='42501',message='ediel_testing_write_permission_denied';
  end if;

  select result_payload into v_existing from public.canonical_command_results
  where company_id=v_company_id and command_type='ediel.test.evidence.record' and idempotency_key=v_idempotency_key;
  if found then return v_existing; end if;

  select * into v_run from public.ediel_test_runs
  where id=v_run_id and company_id=v_company_id for update;
  if not found then raise exception 'tenant_scoped_test_run_not_found'; end if;
  if v_run.environment_type='production'::public.ediel_environment_type
     or lower(coalesce(v_run.environment,''))<>'test' then
    raise exception 'production_or_conflicting_run_cannot_be_test_evidence';
  end if;
  if upper(v_run.test_case_code)<>v_test_case_code then raise exception 'test_case_does_not_match_run'; end if;
  if nullif(btrim(v_run.test_suite),'') is null
     or nullif(btrim(v_run.setup_package),'') is null
     or nullif(btrim(v_run.message_family),'') is null
     or nullif(btrim(v_run.rulebook_version),'') is null then
    raise exception 'test_run_canonical_identity_incomplete';
  end if;

  v_actor_role:=case lower(coalesce(nullif(v_run.actor_role,''),v_run.role_code))
    when 'supplier' then 'supplier'
    when 'esco' then 'energy_service_company'
    when 'energy_service_company' then 'energy_service_company'
    else null
  end;
  if v_actor_role is null then raise exception 'unknown_actor_role_blocks_evidence'; end if;
  if lower(v_run.role_code) not in ('supplier','esco','energy_service_company') then
    raise exception 'unknown_role_code_blocks_evidence';
  end if;

  select count(*) into v_definition_count
  from public.ediel_test_cases tc
  where upper(tc.test_case_code)=v_test_case_code
    and tc.is_active
    and lower(tc.actor_role)=v_actor_role
    and upper(tc.message_family)=upper(v_run.message_family)
    and (
      (v_run.environment_type='agt_test'::public.ediel_environment_type and left(upper(tc.suite_key),4)='AGT_')
      or (v_run.environment_type='tgt_test'::public.ediel_environment_type and left(upper(tc.suite_key),4)='TGT_')
      or v_run.environment_type='bilateral_test'::public.ediel_environment_type
    );
  if v_definition_count<>1 then raise exception 'canonical_test_definition_missing_or_ambiguous'; end if;

  select * into strict v_test_case
  from public.ediel_test_cases tc
  where upper(tc.test_case_code)=v_test_case_code
    and tc.is_active
    and lower(tc.actor_role)=v_actor_role
    and upper(tc.message_family)=upper(v_run.message_family)
    and (
      (v_run.environment_type='agt_test'::public.ediel_environment_type and left(upper(tc.suite_key),4)='AGT_')
      or (v_run.environment_type='tgt_test'::public.ediel_environment_type and left(upper(tc.suite_key),4)='TGT_')
      or v_run.environment_type='bilateral_test'::public.ediel_environment_type
    );

  if v_test_case.rule_version is null
     or v_test_case.rule_version<>v_run.rulebook_version then
    raise exception 'test_definition_rulebook_does_not_match_run';
  end if;
  if v_test_case.subtype is not null
     and upper(coalesce(v_run.message_variant,''))<>upper(v_test_case.subtype) then
    raise exception 'message_variant_does_not_match_test_definition';
  end if;
  if v_run.configuration_snapshot_id is null then raise exception 'test_run_configuration_snapshot_required'; end if;
  select * into v_snapshot from public.ediel_configuration_snapshots
  where id=v_run.configuration_snapshot_id and company_id=v_company_id;
  if not found then raise exception 'test_run_snapshot_not_found_for_tenant'; end if;
  if v_run.configuration_hash is distinct from v_snapshot.configuration_hash then
    raise exception 'test_run_snapshot_hash_mismatch';
  end if;
  if coalesce(v_run.is_stale,false) then raise exception 'stale_test_run_cannot_pass'; end if;

  if not exists(
    select 1 from public.ediel_active_test_configurations c
    where c.company_id=v_company_id and c.environment='test' and c.status='active'
      and c.configuration_snapshot_id=v_snapshot.id
      and c.test_suite=v_run.test_suite
      and lower(c.actor_role)=v_actor_role
      and upper(c.message_family)=upper(v_run.message_family)
      and c.setup_package=v_run.setup_package
  ) then raise exception 'run_snapshot_is_not_current_active_test_configuration'; end if;

  select route->>'receiver_ediel_id' into v_portal_ediel_id
  from jsonb_array_elements(coalesce(v_snapshot.payload->'routes','[]'::jsonb)) route
  where route->>'id'=v_snapshot.primary_test_route_id::text
    and lower(coalesce(route->>'environment','test'))='test'
    and coalesce((route->>'is_active')::boolean,true)
    and coalesce((route->>'is_enabled')::boolean,true)
  limit 1;
  if nullif(btrim(v_snapshot.test_ediel_id),'') is null
     or nullif(btrim(v_portal_ediel_id),'') is null then
    raise exception 'snapshot_test_actor_or_portal_identity_missing';
  end if;

  v_expected_direction:=case lower(v_test_case.direction)
    when 'actor_to_portal' then 'outbound'
    when 'portal_to_actor' then 'inbound'
    when 'inbound' then 'inbound'
    when 'outbound' then 'outbound'
    else null
  end;
  if v_expected_direction is null then raise exception 'unknown_test_direction_blocks_evidence'; end if;
  if upper(v_test_case.message_family)='UTILTS' and v_expected_direction<>'inbound' then
    raise exception 'unsupported_outbound_utilts_definition_requires_canonical_steps';
  end if;

  select count(*) into v_source_count
  from public.ediel_test_run_messages trm
  join public.ediel_messages m
    on m.id=trm.ediel_message_id and m.company_id=trm.company_id
  where trm.company_id=v_company_id and trm.test_run_id=v_run_id
    and m.environment='test' and m.test_flag=1
    and m.created_at>=coalesce(v_run.started_at,v_run.created_at)
    and m.direction=v_expected_direction
    and upper(m.message_family)=upper(v_test_case.message_family)
    and upper(coalesce(m.message_code,''))=upper(v_test_case.message_code)
    and (v_test_case.subtype is null or upper(coalesce(m.message_subtype,''))=upper(v_test_case.subtype))
    and (
      (v_expected_direction='outbound' and m.sender_ediel_id=v_snapshot.test_ediel_id and m.receiver_ediel_id=v_portal_ediel_id)
      or (v_expected_direction='inbound' and m.sender_ediel_id=v_portal_ediel_id and m.receiver_ediel_id=v_snapshot.test_ediel_id)
    );
  if v_source_count<>1 then raise exception 'source_message_missing_or_ambiguous'; end if;

  select m.* into strict v_source
  from public.ediel_test_run_messages trm
  join public.ediel_messages m
    on m.id=trm.ediel_message_id and m.company_id=trm.company_id
  where trm.company_id=v_company_id and trm.test_run_id=v_run_id
    and m.environment='test' and m.test_flag=1
    and m.created_at>=coalesce(v_run.started_at,v_run.created_at)
    and m.direction=v_expected_direction
    and upper(m.message_family)=upper(v_test_case.message_family)
    and upper(coalesce(m.message_code,''))=upper(v_test_case.message_code)
    and (v_test_case.subtype is null or upper(coalesce(m.message_subtype,''))=upper(v_test_case.subtype))
    and (
      (v_expected_direction='outbound' and m.sender_ediel_id=v_snapshot.test_ediel_id and m.receiver_ediel_id=v_portal_ediel_id)
      or (v_expected_direction='inbound' and m.sender_ediel_id=v_portal_ediel_id and m.receiver_ediel_id=v_snapshot.test_ediel_id)
    );
  if v_source.direction='outbound'
     and v_source.status not in ('provider_accepted','sent','delivered','acknowledged') then
    raise exception 'source_message_has_no_strict_transport_acceptance';
  end if;
  if v_test_case_code='UL2' and upper(coalesce(v_source.measurement_resolution,''))<>'KVART' then
    raise exception 'ul2_requires_kvart_resolution';
  end if;
  if v_test_case_code='UL3' and upper(coalesce(v_source.measurement_resolution,''))<>'SCH' then
    raise exception 'ul3_requires_sch_resolution';
  end if;

  select count(*) into v_step_count from public.ediel_test_steps where test_case_id=v_test_case.id;

  select count(*) into v_match_count
  from public.ediel_test_run_messages trm join public.ediel_messages m
    on m.id=trm.ediel_message_id and m.company_id=trm.company_id
  where trm.company_id=v_company_id and trm.test_run_id=v_run_id
    and upper(m.message_family)='CONTRL' and m.related_message_id=v_source.id
    and m.environment='test' and m.test_flag=1
    and (lower(v_test_case.expected_contrl)='not_expected' or m.ack_outcome=lower(v_test_case.expected_contrl))
    and ((v_source.direction='outbound' and m.direction='inbound' and m.sender_ediel_id=v_portal_ediel_id)
      or (v_source.direction='inbound' and m.direction='outbound' and m.receiver_ediel_id=v_portal_ediel_id
        and m.status in ('provider_accepted','sent','delivered','acknowledged')));
  if lower(v_test_case.expected_contrl)='depends' then raise exception 'ambiguous_contrl_definition_blocks_pass'; end if;
  if lower(v_test_case.expected_contrl)='not_expected' then
    if v_match_count<>0 then raise exception 'unexpected_contrl_message'; end if;
  elsif v_match_count<>1 then raise exception 'expected_contrl_missing_or_ambiguous';
  else
    select m.* into strict v_contrl
    from public.ediel_test_run_messages trm join public.ediel_messages m
      on m.id=trm.ediel_message_id and m.company_id=trm.company_id
    where trm.company_id=v_company_id and trm.test_run_id=v_run_id
      and upper(m.message_family)='CONTRL' and m.related_message_id=v_source.id
      and m.environment='test' and m.test_flag=1 and m.ack_outcome=lower(v_test_case.expected_contrl)
      and ((v_source.direction='outbound' and m.direction='inbound' and m.sender_ediel_id=v_portal_ediel_id)
        or (v_source.direction='inbound' and m.direction='outbound' and m.receiver_ediel_id=v_portal_ediel_id
          and m.status in ('provider_accepted','sent','delivered','acknowledged')));
  end if;

  if lower(v_test_case.expected_aperak)='depends' then
    raise exception 'ambiguous_aperak_definition_blocks_pass';
  end if;
  select count(*) into v_match_count
  from public.ediel_test_run_messages trm join public.ediel_messages m
    on m.id=trm.ediel_message_id and m.company_id=trm.company_id
  where trm.company_id=v_company_id and trm.test_run_id=v_run_id
    and upper(m.message_family)='APERAK' and m.related_message_id=v_source.id
    and m.environment='test' and m.test_flag=1
    and (lower(v_test_case.expected_aperak)='not_expected' or m.ack_outcome=lower(v_test_case.expected_aperak))
    and ((v_source.direction='outbound' and m.direction='inbound' and m.sender_ediel_id=v_portal_ediel_id)
      or (v_source.direction='inbound' and m.direction='outbound' and m.receiver_ediel_id=v_portal_ediel_id
        and m.status in ('provider_accepted','sent','delivered','acknowledged')));
  if lower(v_test_case.expected_aperak)='not_expected' then
    if v_match_count<>0 then raise exception 'unexpected_aperak_message'; end if;
  elsif v_match_count<>1 then raise exception 'expected_aperak_missing_or_ambiguous';
  else
    select m.* into strict v_aperak
    from public.ediel_test_run_messages trm join public.ediel_messages m
      on m.id=trm.ediel_message_id and m.company_id=trm.company_id
    where trm.company_id=v_company_id and trm.test_run_id=v_run_id
      and upper(m.message_family)='APERAK' and m.related_message_id=v_source.id
      and m.environment='test' and m.test_flag=1 and m.ack_outcome=lower(v_test_case.expected_aperak)
      and ((v_source.direction='outbound' and m.direction='inbound' and m.sender_ediel_id=v_portal_ediel_id)
        or (v_source.direction='inbound' and m.direction='outbound' and m.receiver_ediel_id=v_portal_ediel_id
          and m.status in ('provider_accepted','sent','delivered','acknowledged')));
  end if;

  if upper(v_test_case.message_family)='UTILTS' then
    if lower(v_test_case.expected_utilts_err) not in ('expected','positive','negative') then
      raise exception 'utilts_full_chain_requires_explicit_utilts_err_definition';
    end if;
    select count(*) into v_match_count
    from public.ediel_test_run_messages trm join public.ediel_messages m
      on m.id=trm.ediel_message_id and m.company_id=trm.company_id
    where trm.company_id=v_company_id and trm.test_run_id=v_run_id
      and upper(m.message_family)='UTILTS_ERR' and m.related_message_id=v_source.id
      and m.direction='outbound' and m.environment='test' and m.test_flag=1
      and m.receiver_ediel_id=v_portal_ediel_id
      and m.status in ('provider_accepted','sent','delivered','acknowledged');
    if v_match_count<>1 then raise exception 'expected_utilts_err_missing_or_ambiguous'; end if;
    select m.* into strict v_utilts_err
    from public.ediel_test_run_messages trm join public.ediel_messages m
      on m.id=trm.ediel_message_id and m.company_id=trm.company_id
    where trm.company_id=v_company_id and trm.test_run_id=v_run_id
      and upper(m.message_family)='UTILTS_ERR' and m.related_message_id=v_source.id
      and m.direction='outbound' and m.environment='test' and m.test_flag=1
      and m.receiver_ediel_id=v_portal_ediel_id
      and m.status in ('provider_accepted','sent','delivered','acknowledged');

    select count(*) into v_match_count
    from public.ediel_test_run_messages trm join public.ediel_messages m
      on m.id=trm.ediel_message_id and m.company_id=trm.company_id
    where trm.company_id=v_company_id and trm.test_run_id=v_run_id
      and upper(m.message_family)='APERAK' and m.related_message_id=v_utilts_err.id
      and m.direction='inbound' and m.environment='test' and m.test_flag=1
      and m.sender_ediel_id=v_portal_ediel_id and m.receiver_ediel_id=v_snapshot.test_ediel_id;
    if v_match_count<>1 then raise exception 'final_portal_aperak_missing_or_ambiguous'; end if;
    select m.* into strict v_final_aperak
    from public.ediel_test_run_messages trm join public.ediel_messages m
      on m.id=trm.ediel_message_id and m.company_id=trm.company_id
    where trm.company_id=v_company_id and trm.test_run_id=v_run_id
      and upper(m.message_family)='APERAK' and m.related_message_id=v_utilts_err.id
      and m.direction='inbound' and m.environment='test' and m.test_flag=1
      and m.sender_ediel_id=v_portal_ediel_id and m.receiver_ediel_id=v_snapshot.test_ediel_id;
  elsif lower(v_test_case.expected_utilts_err)<>'not_expected' then
    raise exception 'non_utilts_case_has_invalid_utilts_err_expectation';
  end if;

  v_evidence:=jsonb_build_object(
    'verification','server_derived',
    'test_case_code',v_test_case_code,
    'test_definition_id',v_test_case.id,
    'expected_step_count',v_step_count,
    'source_message_id',v_source.id,
    'contrl_message_id',v_contrl.id,
    'aperak_message_id',v_aperak.id,
    'utilts_err_message_id',v_utilts_err.id,
    'final_aperak_message_id',v_final_aperak.id,
    'portal_ediel_id',v_portal_ediel_id,
    'configuration_snapshot_id',v_snapshot.id,
    'configuration_hash',v_snapshot.configuration_hash,
    'rulebook_version',v_run.rulebook_version
  );
  v_evidence_digest:=encode(extensions.digest(convert_to(v_evidence::text,'utf8'),'sha256'::text),'hex');

  insert into public.actor_test_attempts(
    company_id,test_run_id,test_case_code,environment_type,actor_role,role_code,
    test_suite,setup_package,message_family,message_variant,status,machine_verified,
    configuration_snapshot_id,configuration_hash,rulebook_version,engine_version,
    started_at,completed_at,evidence_digest,created_by
  ) values (
    v_company_id,v_run_id,v_test_case_code,v_run.environment_type,v_actor_role,v_run.role_code,
    v_run.test_suite,v_run.setup_package,upper(v_run.message_family),v_run.message_variant,'passed',true,
    v_snapshot.id,v_snapshot.configuration_hash,coalesce(v_run.rulebook_version,'unknown'),
    v_run.engine_version,coalesce(v_run.started_at,v_run.created_at),now(),v_evidence_digest,v_actor_user_id
  ) returning id into v_attempt_id;

  insert into public.actor_test_attempt_evidence(
    company_id,attempt_id,test_run_id,ediel_message_id,evidence_role,source_message_id,
    correlation_snapshot,transport_status_snapshot,message_hash,configuration_snapshot_id
  )
  select v_company_id,v_attempt_id,v_run_id,m.id,e.role,v_source.id,
    jsonb_build_object(
      'related_message_id',m.related_message_id,'original_message_id',m.original_message_id,
      'original_transaction_id',m.original_transaction_id,'interchange_reference',m.interchange_reference,
      'message_reference',m.message_reference,'transaction_reference',m.transaction_reference,
      'sender_ediel_id',m.sender_ediel_id,'receiver_ediel_id',m.receiver_ediel_id,'ack_outcome',m.ack_outcome
    ),coalesce(m.status,'unknown'),
    coalesce(m.raw_payload_hash,encode(extensions.digest(convert_to(coalesce(m.raw_payload,''),'utf8'),'sha256'::text),'hex')),
    v_snapshot.id
  from (values
    (v_source.id,'source_message'::text),(v_source.id,'portal_identity'::text),
    (v_source.id,'transport_acceptance'::text),
    (v_contrl.id,case when v_contrl.ack_outcome='negative' then 'negative_contrl' else 'positive_contrl' end),
    (v_aperak.id,case when v_aperak.ack_outcome='negative' then 'negative_aperak' else 'positive_aperak' end),
    (case when upper(v_test_case.message_family)='UTILTS' then v_source.id end,'utilts_inbound'::text),
    (v_utilts_err.id,'utilts_error_outbound'::text),(v_final_aperak.id,'final_portal_aperak'::text)
  ) e(message_id,role)
  join public.ediel_messages m on m.id=e.message_id and m.company_id=v_company_id
  where e.message_id is not null;

  insert into public.actor_test_results(
    company_id,test_key,test_name,test_id,package_key,message_family,message_code,direction,
    status,latest_run_at,passed_at,failure_reason,portal_status,raw_payload,
    ediel_test_run_id,contrl_message_id,aperak_message_id,utilts_err_message_id,
    evidence,configuration_snapshot_id,configuration_hash,is_stale,stale_reason,
    created_by,updated_by,created_at,updated_at
  ) values (
    v_company_id,v_test_case_code,coalesce(v_test_case.name,v_test_case.title),null,v_run.setup_package,
    v_test_case.message_family,v_test_case.message_code,v_test_case.direction,
    'passed',now(),now(),null,'Canonical serververifierad evidenskedja.',null,
    v_run_id,v_contrl.id,v_aperak.id,v_utilts_err.id,
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
    jsonb_build_object('test_run_id',v_run_id,'test_case_code',v_test_case_code,'status','passed',
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
  v_test_case_code text:=upper(coalesce(p_command->>'test_case_code',p_command->>'test_case_key'));
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
     or nullif(v_test_case_code,'') is null or v_reason is null or v_evidence_reference is null
     or nullif(btrim(v_idempotency_key),'') is null then
    raise exception 'manual_attestation_request_fields_required';
  end if;

  if not public.gridex_actor_has_company_permission(
    v_actor_user_id,v_company_id,'ediel_testing.write'
  ) then
    raise exception using errcode='42501',message='ediel_testing_write_permission_denied';
  end if;

  select result_payload into v_existing from public.canonical_command_results
  where company_id=v_company_id and command_type='ediel.test.attestation.request' and idempotency_key=v_idempotency_key;
  if found then return v_existing; end if;

  select * into v_run from public.ediel_test_runs
  where id=v_run_id and company_id=v_company_id for update;
  if not found then raise exception 'tenant_scoped_test_run_not_found'; end if;
  if upper(v_run.test_case_code)<>v_test_case_code then raise exception 'test_case_does_not_match_run'; end if;
  if v_run.environment_type='production'::public.ediel_environment_type
     or lower(coalesce(v_run.environment,''))<>'test' then
    raise exception 'manual_attestation_requires_consistent_test_environment';
  end if;
  if v_run.configuration_snapshot_id is null or coalesce(v_run.is_stale,false) then
    raise exception 'manual_attestation_requires_current_snapshot';
  end if;
  if not exists(
    select 1 from public.ediel_active_test_configurations c
    where c.company_id=v_company_id and c.environment='test' and c.status='active'
      and c.configuration_snapshot_id=v_run.configuration_snapshot_id
      and c.test_suite=v_run.test_suite and c.setup_package=v_run.setup_package
      and upper(c.message_family)=upper(v_run.message_family)
  ) then raise exception 'manual_attestation_requires_current_active_test_configuration'; end if;

  insert into public.actor_test_manual_attestations(
    company_id,test_run_id,test_case_code,reason,evidence_reference,requested_by,requested_at,status
  ) values (
    v_company_id,v_run_id,v_test_case_code,v_reason,v_evidence_reference,v_actor_user_id,now(),'requested'
  ) returning id into v_attestation_id;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,idempotency_key,after_state
  ) values (
    v_company_id,'EDIEL_TEST_MANUAL_ATTESTATION_REQUESTED','actor_test_attestation',v_attestation_id,
    v_actor_user_id,v_reason,v_idempotency_key,
    jsonb_build_object('status','requested','test_run_id',v_run_id,'test_case_code',v_test_case_code,'evidence_reference',v_evidence_reference)
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values (
    v_company_id,'EDIEL_TEST_MANUAL_ATTESTATION_REQUESTED','actor_test_attestation',v_attestation_id,
    v_idempotency_key,jsonb_build_object('test_run_id',v_run_id,'test_case_code',v_test_case_code),v_actor_user_id
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
  v_actor_role text;
begin
  if v_company_id is null or v_attestation_id is null or v_actor_user_id is null
     or v_decision_reason is null or nullif(btrim(v_idempotency_key),'') is null then
    raise exception 'manual_attestation_approval_fields_required';
  end if;

  if not public.gridex_actor_has_company_permission(
    v_actor_user_id,v_company_id,'ediel_testing.attest'
  ) then
    raise exception using errcode='42501',message='ediel_testing_attest_permission_denied';
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
  if v_run.environment_type='production'::public.ediel_environment_type
     or lower(coalesce(v_run.environment,''))<>'test' then
    raise exception 'manual_attestation_requires_consistent_test_environment';
  end if;
  if v_run.configuration_snapshot_id is null or coalesce(v_run.is_stale,false) then
    raise exception 'stale_test_run_cannot_be_manually_attested';
  end if;
  select * into v_snapshot from public.ediel_configuration_snapshots
  where id=v_run.configuration_snapshot_id and company_id=v_company_id;
  if not found then raise exception 'test_run_snapshot_not_found_for_tenant'; end if;

  v_actor_role:=case lower(coalesce(nullif(v_run.actor_role,''),v_run.role_code))
    when 'supplier' then 'supplier'
    when 'esco' then 'energy_service_company'
    when 'energy_service_company' then 'energy_service_company'
    else null
  end;
  if v_actor_role is null
     or nullif(btrim(v_run.test_suite),'') is null
     or nullif(btrim(v_run.setup_package),'') is null
     or nullif(btrim(v_run.message_family),'') is null
     or nullif(btrim(v_run.rulebook_version),'') is null then
    raise exception 'manual_attestation_canonical_identity_incomplete';
  end if;

  v_digest:=encode(extensions.digest(convert_to(v_attestation.reason||'|'||v_attestation.evidence_reference||'|'||v_decision_reason,'utf8'),'sha256'::text),'hex');
  insert into public.actor_test_attempts(
    company_id,test_run_id,test_case_code,environment_type,actor_role,role_code,
    test_suite,setup_package,message_family,message_variant,status,machine_verified,
    configuration_snapshot_id,configuration_hash,rulebook_version,engine_version,
    started_at,completed_at,evidence_digest,failure_details,created_by
  ) values (
    v_company_id,v_run.id,v_attestation.test_case_code,v_run.environment_type,v_actor_role,v_run.role_code,
    v_run.test_suite,v_run.setup_package,upper(v_run.message_family),v_run.message_variant,'manual_verified',false,
    v_snapshot.id,v_snapshot.configuration_hash,coalesce(v_run.rulebook_version,'unknown'),v_run.engine_version,
    coalesce(v_run.started_at,v_run.created_at),now(),v_digest,
    jsonb_build_object('reason',v_attestation.reason,'evidence_reference',v_attestation.evidence_reference,'decision_reason',v_decision_reason),
    v_actor_user_id
  ) returning id into v_attempt_id;

  update public.actor_test_manual_attestations
  set attempt_id=v_attempt_id,approved_by=v_actor_user_id,approved_at=now(),status='approved',decision_reason=v_decision_reason
  where id=v_attestation_id and company_id=v_company_id;

  insert into public.actor_test_results(
    company_id,test_key,status,latest_run_at,passed_at,failure_reason,ediel_test_run_id,evidence,
    configuration_snapshot_id,configuration_hash,is_stale,stale_reason,created_by,updated_by,created_at,updated_at
  ) values (
    v_company_id,v_attestation.test_case_code,'manual_verified',now(),null,null,v_run.id,
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
    jsonb_build_object('test_run_id',v_run.id,'test_case_code',v_attestation.test_case_code,
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
