-- TEN03/07-10/12/14, CALL14, DB01-05: prospective internal ESCO support.
-- No assignments/evidence/grants are seeded or activated. G04 remains owner-held.
-- This is a forward migration. Historical originals, deletion and retention are not inferred.
begin;

alter table public.metering_permission_sites add column if not exists start_at timestamptz, add column if not exists end_at timestamptz;

create unique index if not exists ediel_service_permission_owner_key on public.metering_permissions(company_id,id);
create unique index if not exists ediel_service_customer_owner_key on public.customers(company_id,id);
create unique index if not exists ediel_service_profile_owner_key on public.tenant_ediel_profiles(company_id,id);

create table public.ediel_service_assignments (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 beneficiary_company_id uuid not null references public.companies(id) on delete restrict,
 provider_actor_id uuid not null references public.platform_market_actors(id) on delete restrict,
 actor_profile_id uuid not null,
 customer_id uuid not null,
 dso_actor_id uuid not null references public.platform_market_actors(id) on delete restrict,
 environment text not null check(environment in ('test','production')),
 mode text not null check(mode in ('V','VH')),
 purpose text not null check(length(btrim(purpose))>0),
 object_ids text[] not null check(cardinality(object_ids)>0 and array_position(object_ids,null) is null),
 product_ids text[] not null check(cardinality(product_ids)>0 and array_position(product_ids,null) is null),
 field_sets text[] not null check(cardinality(field_sets)>0 and array_position(field_sets,null) is null),
 data_start timestamptz not null,
 data_end timestamptz,
 valid_from timestamptz not null,
 valid_to timestamptz,
 status text not null default 'held' check(status in ('held','active','revoked','ended')),
 version bigint not null default 1 check(version>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(company_id,id),
 foreign key(company_id,actor_profile_id) references public.tenant_ediel_profiles(company_id,id) on delete restrict,
 foreign key(company_id,customer_id) references public.customers(company_id,id) on delete restrict,
 check(company_id<>beneficiary_company_id),
 check(data_end is null or data_end>data_start),
 check(valid_to is null or valid_to>valid_from)
);
create index ediel_service_assignments_beneficiary_idx on public.ediel_service_assignments(beneficiary_company_id,status);
create index ediel_service_assignments_coordination_idx on public.ediel_service_assignments(company_id,environment,provider_actor_id,customer_id,dso_actor_id,mode,status);

create table public.ediel_service_evidence (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,
 assignment_id uuid not null,
 kind text not null check(kind in ('end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles','transport_mandate')),
 source_reference text not null check(length(btrim(source_reference))>0),
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 source_version text not null check(length(btrim(source_version))>0),
 valid_from timestamptz not null,
 valid_to timestamptz,
 status text not null default 'pending' check(status in ('pending','verified','revoked')),
 approved_by uuid references auth.users(id) on delete restrict,
 approved_at timestamptz,
 approved_assignment_version bigint check(approved_assignment_version>0),
 transport_relation_id uuid references public.tenant_counterparty_relations(id) on delete restrict,
 transport_actor_id uuid references public.platform_market_actors(id) on delete restrict,
 created_at timestamptz not null default now(),
 foreign key(company_id,assignment_id) references public.ediel_service_assignments(company_id,id) on delete restrict,
 check(valid_to is null or valid_to>valid_from),
 check(status<>'verified' or (approved_by is not null and approved_at is not null and approved_assignment_version is not null)),
 check(kind<>'transport_mandate' or (transport_relation_id is not null and transport_actor_id is not null))
);
create index ediel_service_evidence_assignment_idx on public.ediel_service_evidence(company_id,assignment_id,kind,status);

create table public.ediel_assignment_permission_links (
 id uuid primary key default gen_random_uuid(), company_id uuid not null,
 assignment_id uuid not null, permission_id uuid not null,
 created_at timestamptz not null default now(),
 unique(company_id,assignment_id,permission_id),
 unique(company_id,id),
 foreign key(company_id,assignment_id) references public.ediel_service_assignments(company_id,id) on delete restrict,
 foreign key(company_id,permission_id) references public.metering_permissions(company_id,id) on delete restrict
);
create index ediel_assignment_permission_links_permission_idx on public.ediel_assignment_permission_links(company_id,permission_id);

create table public.ediel_data_access_grants (
 id uuid primary key default gen_random_uuid(), company_id uuid not null,
 beneficiary_company_id uuid not null references public.companies(id) on delete restrict,
 assignment_id uuid not null, permission_link_id uuid not null,
 object_ids text[] not null check(cardinality(object_ids)>0 and array_position(object_ids,null) is null),
 product_ids text[] not null check(cardinality(product_ids)>0 and array_position(product_ids,null) is null),
 fields text[] not null check(cardinality(fields)>0 and fields <@ array['reading_at','quantity','unit','quality','qualifier','registration_date','resolution','product_id']::text[] and array_position(fields,null) is null),
 purpose text not null check(length(btrim(purpose))>0),
 data_start timestamptz not null, data_end timestamptz,
 valid_from timestamptz not null, valid_to timestamptz,
 status text not null default 'held' check(status in ('held','active','revoked','expired')),
 version bigint not null default 1 check(version>0), revoked_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(company_id,assignment_id) references public.ediel_service_assignments(company_id,id) on delete restrict,
 foreign key(company_id,permission_link_id) references public.ediel_assignment_permission_links(company_id,id) on delete restrict,
 check(company_id<>beneficiary_company_id), check(data_end is null or data_end>data_start),
 check(valid_to is null or valid_to>valid_from), check(status<>'revoked' or revoked_at is not null)
);
create index ediel_data_access_grants_beneficiary_idx on public.ediel_data_access_grants(beneficiary_company_id,id,status);
create index ediel_data_access_grants_assignment_idx on public.ediel_data_access_grants(company_id,assignment_id);
create index ediel_data_access_grants_link_idx on public.ediel_data_access_grants(company_id,permission_link_id);

create table public.ediel_service_history (
 id bigint generated always as identity primary key, company_id uuid not null references public.companies(id) on delete restrict,
 entity_table text not null, entity_id uuid not null, recorded_at timestamptz not null default now(),
 before_record jsonb, after_record jsonb not null
);
create index ediel_service_history_owner_idx on public.ediel_service_history(company_id,entity_table,entity_id,id);
alter table public.ediel_service_history enable row level security;
alter table public.ediel_service_history force row level security;
revoke all on public.ediel_service_history from public,anon,authenticated,service_role;
grant select,insert on public.ediel_service_history to service_role;
grant usage on sequence public.ediel_service_history_id_seq to service_role;
create function public.ediel_service_history_record_v1() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 insert into public.ediel_service_history(company_id,entity_table,entity_id,before_record,after_record)
 values(new.company_id,tg_table_name,new.id,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end;
$$;
revoke all on function public.ediel_service_history_record_v1() from public,anon,authenticated;
create trigger ediel_assignment_history after insert or update on public.ediel_service_assignments for each row execute function public.ediel_service_history_record_v1();
create trigger ediel_evidence_history after insert or update on public.ediel_service_evidence for each row execute function public.ediel_service_history_record_v1();
create trigger ediel_permission_link_history after insert or update on public.ediel_assignment_permission_links for each row execute function public.ediel_service_history_record_v1();
create trigger ediel_grant_history after insert or update on public.ediel_data_access_grants for each row execute function public.ediel_service_history_record_v1();

-- No beneficiary table reads, writes, RLS bypass or raw archive access is granted.
-- Provider administration is service-only; read RPC enforces beneficiary membership and scope anew.
alter table public.ediel_service_assignments enable row level security;
alter table public.ediel_service_assignments force row level security;
alter table public.ediel_service_evidence enable row level security;
alter table public.ediel_service_evidence force row level security;
alter table public.ediel_assignment_permission_links enable row level security;
alter table public.ediel_assignment_permission_links force row level security;
alter table public.ediel_data_access_grants enable row level security;
alter table public.ediel_data_access_grants force row level security;
revoke all on public.ediel_service_assignments,public.ediel_service_evidence,public.ediel_assignment_permission_links,public.ediel_data_access_grants from public,anon,authenticated,service_role;
grant select,insert,update on public.ediel_service_assignments,public.ediel_service_evidence,public.ediel_assignment_permission_links,public.ediel_data_access_grants to service_role;

create function public.ediel_service_scope_guard_v1() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare a public.ediel_service_assignments%rowtype; l public.ediel_assignment_permission_links%rowtype; p public.metering_permissions%rowtype;
begin
 if tg_table_name='ediel_service_assignments' then
  if tg_op='UPDATE' then
   if (new.company_id,new.beneficiary_company_id,new.provider_actor_id,new.actor_profile_id,new.customer_id,new.dso_actor_id,new.environment,new.mode) is distinct from
      (old.company_id,old.beneficiary_company_id,old.provider_actor_id,old.actor_profile_id,old.customer_id,old.dso_actor_id,old.environment,old.mode) then raise exception 'ediel_assignment_identity_immutable'; end if;
   new.version:=old.version+1; new.updated_at:=now();
  end if;
  return new;
 end if;
 select * into strict a from public.ediel_service_assignments where company_id=new.company_id and id=new.assignment_id for share;
 if tg_table_name='ediel_assignment_permission_links' then
  if tg_op='UPDATE' and (new.company_id,new.assignment_id,new.permission_id) is distinct from (old.company_id,old.assignment_id,old.permission_id) then raise exception 'ediel_permission_link_identity_immutable'; end if;
  select * into strict p from public.metering_permissions where company_id=new.company_id and id=new.permission_id for share;
  if p.customer_id is distinct from a.customer_id then raise exception 'ediel_assignment_permission_customer_mismatch'; end if;
  return new;
 end if;
 select * into strict l from public.ediel_assignment_permission_links where company_id=new.company_id and id=new.permission_link_id for share;
 if l.assignment_id<>a.id or new.beneficiary_company_id<>a.beneficiary_company_id or new.purpose<>a.purpose or
    not(new.object_ids <@ a.object_ids and new.product_ids <@ a.product_ids and new.fields <@ a.field_sets) or
    new.data_start<a.data_start or (a.data_end is not null and (new.data_end is null or new.data_end>a.data_end)) or
    new.valid_from<a.valid_from or (a.valid_to is not null and (new.valid_to is null or new.valid_to>a.valid_to)) then
  raise exception 'ediel_grant_scope_exceeds_assignment';
 end if;
 if tg_op='UPDATE' then
  if (new.company_id,new.beneficiary_company_id,new.assignment_id,new.permission_link_id) is distinct from
     (old.company_id,old.beneficiary_company_id,old.assignment_id,old.permission_link_id) then raise exception 'ediel_grant_identity_immutable'; end if;
  if old.status='revoked' and new.status<>'revoked' then raise exception 'ediel_revoked_grant_requires_new_basis'; end if;
  new.version:=old.version+1; new.updated_at:=now();
 end if;
 return new;
end;
$$;
revoke all on function public.ediel_service_scope_guard_v1() from public,anon,authenticated;
create trigger ediel_assignment_scope_guard before insert or update on public.ediel_service_assignments for each row execute function public.ediel_service_scope_guard_v1();
create trigger ediel_permission_link_scope_guard before insert or update on public.ediel_assignment_permission_links for each row execute function public.ediel_service_scope_guard_v1();
create trigger ediel_grant_scope_guard before insert or update on public.ediel_data_access_grants for each row execute function public.ediel_service_scope_guard_v1();

create function public.ediel_service_assignment_assessment_v1(p_provider_company_id uuid,p_assignment_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare a public.ediel_service_assignments%rowtype; missing text[]:='{}'; k text; t timestamptz:=now(); transport_required boolean;
begin
 select * into a from public.ediel_service_assignments where company_id=p_provider_company_id and id=p_assignment_id for share;
 if not found then return jsonb_build_object('status','held','missing',array['assignment_not_found']); end if;
 if a.status<>'active' or a.valid_from>t or (a.valid_to is not null and a.valid_to<=t) then missing:=array_append(missing,'assignment_not_active'); end if;
 perform 1 from public.tenant_ediel_profiles x where x.id=a.actor_profile_id and x.company_id=a.company_id for share;
 perform 1 from public.tenant_actor_roles r where r.company_id=a.company_id and r.actor_id=a.provider_actor_id and r.environment=a.environment for share;
 perform 1 from public.tenant_actor_identifiers i where i.company_id=a.company_id and i.environment=a.environment for share;
 perform 1 from public.tenant_counterparty_relations r where r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' for share;
 if not exists(select 1 from public.tenant_ediel_profiles x where x.id=a.actor_profile_id and x.company_id=a.company_id and x.environment=a.environment and x.market='electricity' and x.is_enabled and x.valid_from<=t and (x.valid_to is null or x.valid_to>t)) then missing:=array_append(missing,'provider_profile_not_current'); end if;
 if not exists(select 1 from public.tenant_actor_roles r where r.company_id=a.company_id and r.actor_id=a.provider_actor_id and r.environment=a.environment and r.role_code='energy_service_company' and r.valid_from<=t and (r.valid_to is null or r.valid_to>t)) then missing:=array_append(missing,'provider_legal_esco_role_missing'); end if;
 if not exists(select 1 from public.tenant_actor_identifiers i where i.company_id=a.company_id and i.actor_id=a.provider_actor_id and i.environment=a.environment and i.identifier_type='EdielId' and length(btrim(i.identifier_value))>0 and i.valid_from<=t and (i.valid_to is null or i.valid_to>t)) then missing:=array_append(missing,'provider_legal_identity_missing'); end if;
 -- Mirror the shared canonical tenant identity: one current legal actor/Ediel ID.
 if (select count(distinct (i.actor_id,i.identifier_value)) from public.tenant_actor_identifiers i where i.company_id=a.company_id and i.environment=a.environment and i.identifier_type='EdielId' and i.valid_from<=t and (i.valid_to is null or i.valid_to>t))<>1 then missing:=array_append(missing,'provider_legal_identity_ambiguous'); end if;
 select exists(select 1 from public.tenant_counterparty_relations r where r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' and r.is_enabled and r.counterparty_actor_id<>a.provider_actor_id and r.valid_from<=t and (r.valid_to is null or r.valid_to>t)) into transport_required;
 perform 1 from public.ediel_service_evidence e where e.company_id=a.company_id and e.assignment_id=a.id for share;
 foreach k in array array['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'] loop
  if not exists(select 1 from public.ediel_service_evidence e where e.company_id=a.company_id and e.assignment_id=a.id and e.kind=k and e.status='verified' and e.approved_assignment_version=a.version and e.valid_from<=t and (e.valid_to is null or e.valid_to>t) and e.approved_at<=t) then missing:=array_append(missing,k); end if;
 end loop;
 if (select count(*) from public.tenant_counterparty_relations r where r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' and r.is_enabled and r.valid_from<=t and (r.valid_to is null or r.valid_to>t))>1 then missing:=array_append(missing,'provider_transport_relation_ambiguous'); end if;
 if transport_required and not exists(select 1 from public.ediel_service_evidence e join public.tenant_counterparty_relations r on r.id=e.transport_relation_id and r.counterparty_actor_id=e.transport_actor_id and r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' and r.is_enabled and r.valid_from<=t and (r.valid_to is null or r.valid_to>t) where e.company_id=a.company_id and e.assignment_id=a.id and e.kind='transport_mandate' and e.status='verified' and e.approved_assignment_version=a.version and e.valid_from<=t and (e.valid_to is null or e.valid_to>t) and e.approved_at<=t) then missing:=array_append(missing,'transport_mandate'); end if;
 if cardinality(missing)>0 then return jsonb_build_object('status','held','missing',missing); end if;
 return jsonb_build_object('status','authorized','providerCompanyId',a.company_id,'providerActorId',a.provider_actor_id,'beneficiaryCompanyId',a.beneficiary_company_id,'assignmentId',a.id,'assignmentVersion',a.version,'environment',a.environment,'customerId',a.customer_id,'dsoActorId',a.dso_actor_id,'mode',a.mode,'purpose',a.purpose);
end;
$$;
revoke all on function public.ediel_service_assignment_assessment_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ediel_service_assignment_assessment_v1(uuid,uuid) to service_role;

create function public.ediel_coordinate_service_permission_v1(p_provider_company_id uuid,p_assignment_id uuid,p_actor_user_id uuid,p_expected_version bigint,p_command text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare a public.ediel_service_assignments%rowtype; assessment jsonb; permission uuid; sharing integer;
begin
 if not exists(select 1 from public.company_memberships m where m.company_id=p_provider_company_id and m.user_id=p_actor_user_id and coalesce(m.status,'active')='active' and coalesce(m.is_active,true)) or not public.gridex_actor_has_company_permission(p_actor_user_id,p_provider_company_id,'ediel.write') then raise exception 'ediel_service_command_forbidden' using errcode='42501'; end if;
 -- Lock the shared market tuple before any assignment row, avoiding A/B lock inversion.
 select * into strict a from public.ediel_service_assignments where company_id=p_provider_company_id and id=p_assignment_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a.company_id::text||':'||a.environment||':'||a.provider_actor_id::text||':'||a.customer_id::text||':'||a.dso_actor_id::text||':'||a.mode,0));
 select * into strict a from public.ediel_service_assignments where company_id=p_provider_company_id and id=p_assignment_id for update;
 if p_expected_version is null or p_expected_version<1 or a.version is distinct from p_expected_version then raise exception 'ediel_assignment_version_stale'; end if;
 if p_command='end_assignment' then
  update public.ediel_service_assignments set status='ended' where company_id=a.company_id and id=a.id;
  update public.ediel_data_access_grants set status='revoked',revoked_at=coalesce(revoked_at,now()) where company_id=a.company_id and assignment_id=a.id and status<>'revoked';
  select l.permission_id into permission from public.ediel_assignment_permission_links l where l.company_id=a.company_id and l.assignment_id=a.id order by l.created_at desc,l.id desc limit 1;
  select count(*) into sharing from public.ediel_assignment_permission_links l join public.ediel_service_assignments b on b.company_id=l.company_id and b.id=l.assignment_id where l.company_id=a.company_id and l.permission_id=permission and b.id<>a.id and b.status='active' and b.valid_from<=now() and (b.valid_to is null or b.valid_to>now());
  return jsonb_build_object('status',case when permission is not null and sharing=0 then 'market_termination_required' else 'assignment_ended' end,'permissionId',permission);
 elsif p_command is distinct from 'request_access' then raise exception 'ediel_service_command_invalid'; end if;
 assessment:=public.ediel_service_assignment_assessment_v1(a.company_id,a.id);
 if assessment->>'status'<>'authorized' then return assessment||jsonb_build_object('permissionId',null); end if;
 -- Compatibility requires the same market actor, environment, end-user, DSO, purpose, mode and full approved scope.
 select l.permission_id into permission from public.ediel_assignment_permission_links l
 join public.ediel_service_assignments b on b.company_id=l.company_id and b.id=l.assignment_id
 join public.metering_permissions p on p.company_id=l.company_id and p.id=l.permission_id
 where b.company_id=a.company_id and b.environment=a.environment and b.provider_actor_id=a.provider_actor_id and b.customer_id=a.customer_id and b.dso_actor_id=a.dso_actor_id and b.purpose=a.purpose and b.mode=a.mode
 and b.status='active' and b.valid_from<=now() and (b.valid_to is null or b.valid_to>now()) and a.field_sets <@ b.field_sets and public.ediel_service_assignment_assessment_v1(b.company_id,b.id)->>'status'='authorized' and a.object_ids <@ b.object_ids and a.product_ids <@ b.product_ids and a.data_start>=b.data_start and (b.data_end is null or (a.data_end is not null and a.data_end<=b.data_end))
 and p.status in ('draft','z13_ready','z13_sent','waiting_for_customer_approval','approved','partially_approved','z14_received','active')
 order by l.created_at,l.id limit 1;
 if permission is null then
  insert into public.metering_permissions(company_id,customer_id,status,purpose_code,permission_scope,requested_start_date,requested_end_date,metadata)
  values(a.company_id,a.customer_id,'draft',a.purpose,a.mode,(a.data_start at time zone 'Europe/Stockholm')::date,(a.data_end at time zone 'Europe/Stockholm')::date,jsonb_build_object('service_assignment_id',a.id,'provider_actor_id',a.provider_actor_id,'environment',a.environment,'dso_actor_id',a.dso_actor_id,'scope','service_assignment')) returning id into permission;
  insert into public.ediel_assignment_permission_links(company_id,assignment_id,permission_id) values(a.company_id,a.id,permission) on conflict do nothing;
  return jsonb_build_object('status','permission_required','permissionId',permission);
 end if;
 insert into public.ediel_assignment_permission_links(company_id,assignment_id,permission_id) values(a.company_id,a.id,permission) on conflict do nothing;
 return jsonb_build_object('status','reuse_permission','permissionId',permission);
end;
$$;
revoke all on function public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text) to service_role;

create function public.ediel_beneficiary_series_page_v1(p_beneficiary_company_id uuid,p_actor_user_id uuid,p_grant_id uuid,p_expected_grant_version bigint,p_purpose text,p_series_id uuid,p_fields text[],p_start timestamptz,p_end timestamptz,p_limit integer default 100,p_after_at timestamptz default null,p_after_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare g public.ediel_data_access_grants%rowtype; a public.ediel_service_assignments%rowtype; l public.ediel_assignment_permission_links%rowtype; p public.metering_permissions%rowtype; s public.meter_reading_series%rowtype; payload jsonb; next_cursor jsonb;
begin
 if not exists(select 1 from public.company_memberships m where m.company_id=p_beneficiary_company_id and m.user_id=p_actor_user_id and coalesce(m.status,'active')='active' and coalesce(m.is_active,true)) or not public.gridex_actor_has_company_permission(p_actor_user_id,p_beneficiary_company_id,'metering.read') then raise exception 'ediel_beneficiary_forbidden' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_end<=p_start or p_limit is null or p_limit<1 or p_limit>500 or (p_after_at is null)<>(p_after_id is null) or p_fields is null or cardinality(p_fields)=0 or array_position(p_fields,null) is not null then raise exception 'ediel_projection_request_invalid'; end if;
 -- Match the command's assignment-before-grant lock order. Identity is immutable.
 select * into strict g from public.ediel_data_access_grants where id=p_grant_id and beneficiary_company_id=p_beneficiary_company_id;
 select * into strict a from public.ediel_service_assignments where company_id=g.company_id and id=g.assignment_id for share;
 select * into strict g from public.ediel_data_access_grants where id=p_grant_id and beneficiary_company_id=p_beneficiary_company_id for share;
 if p_expected_grant_version is null or p_expected_grant_version<1 or g.version is distinct from p_expected_grant_version or g.status<>'active' or g.revoked_at is not null or g.valid_from>now() or (g.valid_to is not null and g.valid_to<=now()) then raise exception 'ediel_grant_not_current'; end if;
 if g.beneficiary_company_id is distinct from a.beneficiary_company_id or g.purpose is distinct from a.purpose or not(g.object_ids <@ a.object_ids and g.product_ids <@ a.product_ids and g.fields <@ a.field_sets) or g.data_start<a.data_start or (a.data_end is not null and (g.data_end is null or g.data_end>a.data_end)) or g.valid_from<a.valid_from or (a.valid_to is not null and (g.valid_to is null or g.valid_to>a.valid_to)) then raise exception 'ediel_grant_basis_changed'; end if;
 if public.ediel_service_assignment_assessment_v1(a.company_id,a.id)->>'status' is distinct from 'authorized' then raise exception 'ediel_assignment_not_authorized'; end if;
 if p_purpose is null or p_purpose<>g.purpose or not(p_fields <@ g.fields) or p_start<g.data_start or (g.data_end is not null and p_end>g.data_end) then raise exception 'ediel_projection_outside_grant'; end if;
 select * into strict l from public.ediel_assignment_permission_links where company_id=g.company_id and id=g.permission_link_id and assignment_id=g.assignment_id for share;
 select * into strict p from public.metering_permissions where company_id=g.company_id and id=l.permission_id for share;
 if (p.status in ('active','approved','partially_approved')) is not true or p.customer_id is distinct from a.customer_id or p.source_z14_message_id is null and p.inbound_z14_message_id is null then raise exception 'ediel_market_permission_not_approved'; end if;
 select * into strict s from public.meter_reading_series where company_id=g.company_id and id=p_series_id for share;
 if s.message_code is distinct from 'E66' or s.series_kind is distinct from 'actual' or (s.external_metering_point_id=any(g.object_ids)) is not true or (s.product_id=any(g.product_ids)) is not true or s.period_start is null or s.period_end is null or p_start<s.period_start or p_end>s.period_end then raise exception 'ediel_series_outside_grant'; end if;
 if not exists(select 1 from public.ediel_messages origin where origin.id=s.source_ediel_message_id and origin.company_id=g.company_id and origin.environment=a.environment and origin.direction='inbound' and origin.message_family='UTILTS' and origin.message_code='E66' and origin.execution_context_snapshot->>'receiverActorId'=a.provider_actor_id::text and origin.execution_context_snapshot->>'senderActorId'=a.dso_actor_id::text and origin.execution_context_snapshot->>'receiverRole' in ('esco','energy_service_company')) then raise exception 'ediel_series_source_actor_not_qualified'; end if;
 if not exists(select 1 from public.ediel_messages z14 where z14.id=coalesce(p.inbound_z14_message_id,p.source_z14_message_id) and z14.company_id=g.company_id and z14.environment=a.environment and z14.direction='inbound' and z14.message_family='PRODAT' and z14.message_code='Z14') then raise exception 'ediel_permission_source_not_qualified'; end if;
 if not exists(select 1 from public.metering_permission_sites x where x.company_id=g.company_id and x.metering_permission_id=p.id and x.customer_id=a.customer_id and x.facility_id=s.external_metering_point_id and x.status in ('approved','active') and x.metadata->>'source'='inbound_prodat_z14' and x.metadata->>'edielMessageId'=coalesce(p.inbound_z14_message_id,p.source_z14_message_id)::text and x.metadata->>'mode'=case a.mode when 'V' then 'S17' else 'S18' end and x.metadata->>'product'=s.product_id and x.start_at is not null and p_start>=x.start_at and (x.end_at is null or p_end<=x.end_at)) then raise exception 'ediel_permission_object_not_approved'; end if;
 -- Field whitelist is the full projection: raw_transaction/metadata/raw EML are never returned.
 with page as (
  select v.id,v.reading_at,(select jsonb_object_agg(k,value) from jsonb_each(jsonb_build_object('reading_at',v.reading_at,'quantity',v.quantity::text,'unit',v.unit,'quality',v.quality,'qualifier',v.qualifier,'registration_date',s.registration_date,'resolution',s.resolution,'product_id',s.product_id)) as allowed(k,value) where k=any(p_fields)) as projected
  from public.meter_reading_values v where v.company_id=g.company_id and v.series_id=s.id and v.reading_at>=p_start and v.reading_at<p_end and (p_after_at is null or (v.reading_at,v.id)>(p_after_at,p_after_id)) order by v.reading_at,v.id limit p_limit
 ) select coalesce(jsonb_agg(projected order by reading_at,id),'[]'::jsonb),(select jsonb_build_object('readingAt',reading_at,'valueId',id) from page order by reading_at desc,id desc limit 1) into payload,next_cursor from page;
 return jsonb_build_object('grantId',g.id,'grantVersion',g.version,'seriesId',s.id,'rows',payload,'next',case when jsonb_array_length(payload)=p_limit then next_cursor else null end);
end;
$$;
revoke all on function public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid) to service_role;

insert into public.platform_table_classification(table_name,kind,rationale) values
 ('ediel_service_assignments','tenant','Provider owns explicit cross-tenant ESCO assignment; beneficiary has no implicit raw read.'),
 ('ediel_service_evidence','tenant','Scoped prospective owner approvals; no synthetic G04 or historical evidence.'),
 ('ediel_assignment_permission_links','tenant','Provider permission shared through explicit authorized assignment links.'),
 ('ediel_service_history','tenant','Immutable prospective assignment/evidence/grant changes, no inferred retention interval.'),
 ('ediel_data_access_grants','tenant','Owner grants; service RPC alone returns current scoped beneficiary projection.')
on conflict(table_name) do nothing;
commit;
