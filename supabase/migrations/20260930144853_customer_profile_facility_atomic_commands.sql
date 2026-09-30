-- Canonical preference/site-address mutations. CLI absent in implementation
-- environment; filename was captured from actual UTC. No worker runs here.
begin;
set local lock_timeout='10s';

alter table public.customers add column profile_revision bigint not null default 0 check(profile_revision>=0);
alter table public.customers
  add column legal_profile_revision bigint not null default 0 check(legal_profile_revision>=0),
  add column lifecycle_revision bigint not null default 0 check(lifecycle_revision>=0);
-- The pinned canonical foundation does not replay the 8-digit legacy
-- move-out migration. Provision its nullable customer fields before any
-- revision trigger can evaluate NEW/OLD during a later migration backfill.
-- Existing live lifecycle values and column definitions remain intact.
alter table public.customers
  add column if not exists moved_out_at date,
  add column if not exists lifecycle_closed_at timestamptz,
  add column if not exists lifecycle_closed_by uuid references auth.users(id) on delete set null,
  add column if not exists lifecycle_status_reason text;
alter table public.customer_sites add column address_revision bigint not null default 0 check(address_revision>=0);
create index customer_portal_profile_completion_command_idx on public.customer_portal_completions
  (company_id,api_client_id,customer_id,idempotency_key)
  where completion_type='profile_update' and idempotency_key is not null;

-- Revisions cover every existing writer, including imports and the reused
-- address commit RPC. Callers cannot reset/increment these counters manually.
create function private.gridex_profile_revision_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if tg_op='INSERT' then new.profile_revision:=0;
  else new.profile_revision:=old.profile_revision+case when
    new.preferred_language is distinct from old.preferred_language or
    new.metadata->'portal_timezone' is distinct from old.metadata->'portal_timezone' then 1 else 0 end;
  end if;
  return new;
end;
$function$;
create trigger gridex_customer_profile_revision before insert or update on public.customers
  for each row execute function private.gridex_profile_revision_v1();
create function private.gridex_address_revision_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if tg_op='INSERT' then new.address_revision:=0;
  else new.address_revision:=old.address_revision+case when
    row(new.street,new.postal_code,new.city,new.country,new.care_of,new.apartment_number,
      new.address_hash,new.address_normalized,new.address_source,new.address_source_reference,
      new.address_verified_at,new.address_verification_method,new.address_status,new.address_quality_status)
    is distinct from
    row(old.street,old.postal_code,old.city,old.country,old.care_of,old.apartment_number,
      old.address_hash,old.address_normalized,old.address_source,old.address_source_reference,
      old.address_verified_at,old.address_verification_method,old.address_status,old.address_quality_status)
    then 1 else 0 end;
  end if;
  return new;
end;
$function$;
create trigger gridex_customer_site_address_revision before insert or update on public.customer_sites
  for each row execute function private.gridex_address_revision_v1();
revoke all on function private.gridex_profile_revision_v1(),private.gridex_address_revision_v1()
  from public,anon,authenticated,service_role;

-- auth.sessions is not exposed to service_role; narrowly privileged locking
-- is kept in private and never grants broad auth schema/table access.
create function private.gridex_profile_session_active_v1(p_user uuid,p_session uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $function$
begin
  if not private.gridex_contact_actor_active_v1(p_user) then return false; end if;
  perform 1 from public.user_profiles p where p.id=p_user and p.user_status='active' for share;
  if not found then return false; end if;
  perform 1 from auth.sessions s where s.id=p_session and s.user_id=p_user
    and (s.not_after is null or s.not_after>clock_timestamp()) for share;
  return found;
end;
$function$;
revoke all on function private.gridex_profile_session_active_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.gridex_profile_session_active_v1(uuid,uuid) to service_role;

-- All authority rows are already locked by authorize. Recheck clock-based
-- expiry after later resource, claim, unique-index or audit waits as well.
create function private.gridex_profile_current_clock_v1(p_context jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if current_user<>'service_role' then raise exception 'profile_service_required' using errcode='42501'; end if;
  if p_context->>'mode'='ops' then
    if not private.gridex_profile_session_active_v1((p_context->>'actorUserId')::uuid,(p_context->>'sessionId')::uuid) then
      raise exception 'profile_actor_forbidden' using errcode='42501'; end if;
  elsif p_context->>'mode'='api' then
    perform 1 from public.integration_api_clients c where c.id=(p_context->>'clientId')::uuid
      and c.company_id=(p_context->>'companyId')::uuid and c.status='active'
      and c.revoked_at is null and c.deleted_at is null and (c.expires_at is null or c.expires_at>clock_timestamp());
    if not found then raise exception 'profile_delegation_forbidden' using errcode='42501'; end if;
  else raise exception 'invalid_profile_command' using errcode='22023'; end if;
end;
$function$;
revoke all on function private.gridex_profile_current_clock_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.gridex_profile_current_clock_v1(jsonb) to service_role;

-- Stabilize every mutable input used by the existing company permission
-- engine. A session/membership lock alone does not serialize a direct grant,
-- role, role-permission or platform-authority revocation with this command.
-- Acquire the same ordered row locks before both fresh writes and replay;
-- the canonical permission engine remains responsible for the decision.
create function private.gridex_profile_authority_lock_v1(p_user uuid,p_company uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if current_user<>'service_role' then raise exception 'profile_service_required' using errcode='42501'; end if;
  perform 1 from public.admin_users a where a.user_id=p_user order by a.id for share;
  perform 1 from public.user_roles r where r.user_id=p_user
    and (r.company_id=p_company or r.company_id is null) order by r.id for share;
  perform 1 from public.user_permissions u where u.user_id=p_user
    and (u.company_id=p_company or u.company_id is null) order by u.id for share;
  perform 1 from public.roles r where r.id in (select u.role_id from public.user_roles u
    where u.user_id=p_user and (u.company_id=p_company or u.company_id is null)) order by r.id for share;
  perform 1 from public.role_permissions r where r.role_id in (select u.role_id from public.user_roles u
    where u.user_id=p_user and (u.company_id=p_company or u.company_id is null)) order by r.id for share;
  perform 1 from public.permissions p where p.id in (
    select u.permission_id from public.user_permissions u where u.user_id=p_user
      and (u.company_id=p_company or u.company_id is null)
    union select r.permission_id from public.role_permissions r join public.user_roles u on u.role_id=r.role_id
      where u.user_id=p_user and (u.company_id=p_company or u.company_id is null)
  ) order by p.id for share;
end;
$function$;
revoke all on function private.gridex_profile_authority_lock_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.gridex_profile_authority_lock_v1(uuid,uuid) to service_role;

-- Legal identity and lifecycle use an explicit customer permission, separate
-- from contact support. Preserve canonical onboarding writers while advancing
-- revisions for every writer; a manually supplied revision is never trusted.
create function private.gridex_customer_legal_lifecycle_revision_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if tg_op='INSERT' then
    new.legal_profile_revision:=0; new.lifecycle_revision:=0;
  else
    new.legal_profile_revision:=old.legal_profile_revision+case when
      row(new.customer_type,new.first_name,new.last_name,new.full_name,new.name,
        new.company_name,new.personal_number,new.org_number,new.apartment_number)
      is distinct from
      row(old.customer_type,old.first_name,old.last_name,old.full_name,old.name,
        old.company_name,old.personal_number,old.org_number,old.apartment_number) then 1 else 0 end;
    new.lifecycle_revision:=old.lifecycle_revision+case when
      row(new.status,new.moved_out_at,new.lifecycle_closed_at,new.lifecycle_closed_by,new.lifecycle_status_reason)
      is distinct from
      row(old.status,old.moved_out_at,old.lifecycle_closed_at,old.lifecycle_closed_by,old.lifecycle_status_reason) then 1 else 0 end;
  end if;
  return new;
end;
$function$;
create trigger gridex_customer_legal_lifecycle_revision before insert or update on public.customers
  for each row execute function private.gridex_customer_legal_lifecycle_revision_v1();
revoke all on function private.gridex_customer_legal_lifecycle_revision_v1() from public,anon,authenticated,service_role;

create function private.gridex_customer_ops_actor_allowed_v1(p_actor uuid,p_session uuid,p_company uuid,p_permission text)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if current_user<>'service_role' then raise exception 'customer_ops_service_required' using errcode='42501'; end if;
  if p_actor is null or p_session is null or p_company is null
    or p_permission is distinct from 'customers.write'
    or not private.gridex_profile_session_active_v1(p_actor,p_session) then return false; end if;
  perform 1 from public.company_memberships m where m.company_id=p_company and m.user_id=p_actor
    and m.is_active and m.status='active' for share;
  if not found then return false; end if;
  perform private.gridex_profile_authority_lock_v1(p_actor,p_company);
  -- A wall-clock expiry can elapse while a grant lock is waiting. Check the
  -- already locked session again immediately before the permission decision.
  return private.gridex_profile_session_active_v1(p_actor,p_session)
    and coalesce(public.gridex_actor_has_company_permission(p_actor,p_company,p_permission),false);
end;
$function$;
revoke all on function private.gridex_customer_ops_actor_allowed_v1(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.gridex_customer_ops_actor_allowed_v1(uuid,uuid,uuid,text) to service_role;

create function public.gridex_change_customer_legal_profile_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_company uuid; v_customer_id uuid; v_actor uuid; v_session uuid; v_reason text; v_key text; v_namespace text;
  v_expected bigint; v_changes jsonb; v_request jsonb; v_result jsonb; v_changed boolean; v_event uuid;
  v_customer public.customers%rowtype; v_existing public.canonical_command_results%rowtype;
  v_type text; v_first text; v_last text; v_company_name text; v_personal text; v_org text; v_apartment text; v_name text;
begin
  if current_user<>'service_role' then raise exception 'legal_profile_service_required' using errcode='42501'; end if;
  if p_command is null or jsonb_typeof(p_command)<>'object' then
    raise exception 'invalid_legal_profile_command' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_command) k(key) where key not in
      ('companyId','customerId','actorUserId','sessionId','reason','idempotencyKey','expectedRevision','changes'))
    or exists(select 1 from jsonb_each(p_command) e(key,value) where key in
      ('companyId','customerId','actorUserId','sessionId','reason','idempotencyKey') and jsonb_typeof(value)<>'string')
    or coalesce(p_command->>'companyId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'customerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'actorUserId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'sessionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(length(btrim(p_command->>'reason')),0) not between 1 and 200
    or coalesce(p_command->>'idempotencyKey','') !~ '^[A-Za-z0-9._:+~-]{8,200}$'
    or jsonb_typeof(p_command->'expectedRevision') is distinct from 'number'
    or coalesce(p_command->>'expectedRevision','') !~ '^[0-9]{1,16}$'
    or (p_command->>'expectedRevision')::numeric>9007199254740991
    or jsonb_typeof(p_command->'changes') is distinct from 'object' or p_command->'changes'='{}'::jsonb
  then raise exception 'invalid_legal_profile_command' using errcode='22023'; end if;
  v_changes:=p_command->'changes';
  if exists(select 1 from jsonb_each(v_changes) e(key,value) where
      key not in ('customer_type','first_name','last_name','company_name','personal_number','org_number','apartment_number')
      or (key='customer_type' and (jsonb_typeof(value)<>'string' or value#>>'{}' not in ('private','business','association')))
      or (key<>'customer_type' and (jsonb_typeof(value) not in ('string','null') or
        (value<>'null'::jsonb and (length(btrim(value#>>'{}'))<1 or length(btrim(value#>>'{}'))>
          case key when 'first_name' then 120 when 'last_name' then 120 when 'company_name' then 240 else 50 end)))))
    or not (v_changes ? 'customer_type') then
    raise exception 'invalid_legal_profile_field' using errcode='22023'; end if;
  v_company:=(p_command->>'companyId')::uuid; v_customer_id:=(p_command->>'customerId')::uuid;
  v_actor:=(p_command->>'actorUserId')::uuid; v_session:=(p_command->>'sessionId')::uuid;
  v_expected:=(p_command->>'expectedRevision')::bigint; v_key:=p_command->>'idempotencyKey'; v_reason:=btrim(p_command->>'reason');
  select * into v_customer from public.customers c where c.id=v_customer_id and c.company_id=v_company for update;
  if not found or v_customer.status='archived' or v_customer.archived_at is not null then
    raise exception 'legal_profile_customer_unavailable' using errcode='42501'; end if;
  perform 1 from public.companies c where c.id=v_company and c.is_active and c.status='active' for share;
  if not found then raise exception 'legal_profile_tenant_unavailable' using errcode='42501'; end if;
  if not private.gridex_customer_ops_actor_allowed_v1(v_actor,v_session,v_company,'customers.write') then
    raise exception 'legal_profile_actor_forbidden' using errcode='42501'; end if;
  v_namespace:=encode(extensions.digest(concat_ws(':','customer.legal.profile.v1',v_customer_id::text,v_actor::text,v_key),'sha256'),'hex');
  v_request:=jsonb_build_object('companyId',v_company,'customerId',v_customer_id,'actorId',v_actor,
    'expectedRevision',v_expected,'changesHash',public.canonical_json_sha256(v_changes));
  select * into v_existing from public.canonical_command_results where company_id=v_company
    and command_type='customer.legal.profile.change.v1' and idempotency_key=v_namespace for update;
  if found then
    if v_existing.request_payload is distinct from v_request then
      raise exception 'legal_profile_idempotency_conflict' using errcode='P0001'; end if;
    if not private.gridex_profile_session_active_v1(v_actor,v_session) then
      raise exception 'legal_profile_actor_forbidden' using errcode='42501'; end if;
    return v_existing.result_payload||jsonb_build_object('replayed',true);
  end if;
  if v_customer.legal_profile_revision<>v_expected then
    raise exception 'legal_profile_revision_conflict' using errcode='P0001'; end if;
  v_type:=v_changes->>'customer_type';
  v_first:=case when v_changes ? 'first_name' then btrim(v_changes->>'first_name') else v_customer.first_name end;
  v_last:=case when v_changes ? 'last_name' then btrim(v_changes->>'last_name') else v_customer.last_name end;
  v_company_name:=case when v_changes ? 'company_name' then btrim(v_changes->>'company_name') else v_customer.company_name end;
  v_personal:=case when v_changes ? 'personal_number' then btrim(v_changes->>'personal_number') else v_customer.personal_number end;
  v_org:=case when v_changes ? 'org_number' then btrim(v_changes->>'org_number') else v_customer.org_number end;
  v_apartment:=case when v_changes ? 'apartment_number' then btrim(v_changes->>'apartment_number') else v_customer.apartment_number end;
  if v_type='private' then
    if nullif(btrim(v_first),'') is null or nullif(btrim(v_last),'') is null then
      raise exception 'legal_profile_private_name_required' using errcode='22023'; end if;
    if nullif(btrim(v_org),'') is not null or nullif(btrim(v_company_name),'') is not null then
      raise exception 'invalid_legal_profile_field' using errcode='22023'; end if;
    v_name:=concat_ws(' ',v_first,v_last);
  else
    if nullif(btrim(v_company_name),'') is null or nullif(btrim(v_org),'') is null then
      raise exception 'legal_profile_business_identity_required' using errcode='22023'; end if;
    if nullif(btrim(v_personal),'') is not null then raise exception 'invalid_legal_profile_field' using errcode='22023'; end if;
    v_name:=v_company_name;
  end if;
  v_changed:=row(v_type,v_first,v_last,v_name,v_name,v_company_name,v_personal,v_org,v_apartment)
    is distinct from row(v_customer.customer_type,v_customer.first_name,v_customer.last_name,v_customer.full_name,
      v_customer.name,v_customer.company_name,v_customer.personal_number,v_customer.org_number,v_customer.apartment_number);
  if v_changed then
    update public.customers set customer_type=v_type,first_name=v_first,last_name=v_last,full_name=v_name,name=v_name,
      company_name=v_company_name,personal_number=v_personal,org_number=v_org,apartment_number=v_apartment,
      updated_at=clock_timestamp(),updated_by=v_actor where id=v_customer_id and company_id=v_company returning * into v_customer;
  end if;
  v_result:=jsonb_build_object('companyId',v_company,'customerId',v_customer_id,'revision',v_customer.legal_profile_revision,
    'changed',v_changed,'replayed',false);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company,'customer.legal.profile.change.v1',v_namespace,v_request,v_result,v_actor);
  if v_changed then
    insert into public.canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
    values(v_company,'CUSTOMER_LEGAL_PROFILE_CHANGED','customer',v_customer_id,v_customer.legal_profile_revision,v_namespace,
      jsonb_build_object('customerId',v_customer_id,'revision',v_customer.legal_profile_revision),v_actor) returning id into v_event;
    insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
    values(v_company,v_event,'customer.legal.profile.changed',v_namespace,
      jsonb_build_object('customerId',v_customer_id,'revision',v_customer.legal_profile_revision));
  end if;
  -- Audit is deliberately late so its failure rolls back data/result/intent.
  -- Neither historical signed/issued snapshots nor contact/login/billing data
  -- is rewritten; logs/results retain hashes/revisions rather than identity.
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,
    reason,idempotency_key,before_state,after_state,metadata)
  values(v_company,'CUSTOMER_LEGAL_PROFILE_COMMAND','customer',v_customer_id,v_customer.legal_profile_revision,v_actor,v_reason,
    v_namespace,jsonb_build_object('revision',v_expected),jsonb_build_object('revision',v_customer.legal_profile_revision,'changed',v_changed),
    jsonb_build_object('changesHash',v_request->>'changesHash','changed',v_changed));
  if not private.gridex_profile_session_active_v1(v_actor,v_session) then
    raise exception 'legal_profile_actor_forbidden' using errcode='42501'; end if;
  return v_result;
end;
$function$;
revoke all on function public.gridex_change_customer_legal_profile_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_change_customer_legal_profile_v1(jsonb) to service_role;

create function public.gridex_close_customer_lifecycle_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_company uuid; v_customer_id uuid; v_actor uuid; v_session uuid; v_reason text; v_key text; v_namespace text;
  v_expected bigint; v_mode text; v_date date; v_follow_up boolean; v_now timestamptz; v_status text;
  v_customer public.customers%rowtype; v_existing public.canonical_command_results%rowtype;
  v_contract public.customer_contracts%rowtype; v_id uuid; v_event uuid;
  v_sites uuid[]:=array[]::uuid[]; v_points uuid[]:=array[]::uuid[]; v_switches uuid[]:=array[]::uuid[];
  v_contracts uuid[]:=array[]::uuid[]; v_site_count integer:=0; v_point_count integer:=0; v_task_count integer:=0;
  v_metadata jsonb; v_request jsonb; v_result jsonb; v_event_type text; v_note text;
begin
  if current_user<>'service_role' then raise exception 'lifecycle_service_required' using errcode='42501'; end if;
  if p_command is null or jsonb_typeof(p_command)<>'object' then
    raise exception 'invalid_lifecycle_command' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_command) k(key) where key not in
      ('companyId','customerId','actorUserId','sessionId','reason','idempotencyKey','expectedRevision','mode','moveOutDate','createFollowUpTask'))
    or exists(select 1 from jsonb_each(p_command) e(key,value) where key in
      ('companyId','customerId','actorUserId','sessionId','reason','idempotencyKey','mode','moveOutDate') and jsonb_typeof(value)<>'string')
    or coalesce(p_command->>'companyId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'customerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'actorUserId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'sessionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(length(btrim(p_command->>'reason')),0) not between 1 and 200
    or coalesce(p_command->>'idempotencyKey','') !~ '^[A-Za-z0-9._:+~-]{8,200}$'
    or jsonb_typeof(p_command->'expectedRevision') is distinct from 'number'
    or coalesce(p_command->>'expectedRevision','') !~ '^[0-9]{1,16}$'
    or (p_command->>'expectedRevision')::numeric>9007199254740991
    or coalesce(p_command->>'mode','') not in ('move_out','terminate')
    or coalesce(p_command->>'moveOutDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_command->'createFollowUpTask') is distinct from 'boolean'
  then raise exception 'invalid_lifecycle_command' using errcode='22023'; end if;
  begin v_date:=(p_command->>'moveOutDate')::date;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'invalid_lifecycle_command' using errcode='22023'; end;
  v_company:=(p_command->>'companyId')::uuid; v_customer_id:=(p_command->>'customerId')::uuid;
  v_actor:=(p_command->>'actorUserId')::uuid; v_session:=(p_command->>'sessionId')::uuid;
  v_expected:=(p_command->>'expectedRevision')::bigint; v_key:=p_command->>'idempotencyKey'; v_reason:=btrim(p_command->>'reason');
  v_mode:=p_command->>'mode'; v_follow_up:=(p_command->>'createFollowUpTask')::boolean;
  select * into v_customer from public.customers c where c.id=v_customer_id and c.company_id=v_company for update;
  if not found or v_customer.status='archived' or v_customer.archived_at is not null then
    raise exception 'lifecycle_customer_unavailable' using errcode='42501'; end if;
  perform 1 from public.companies c where c.id=v_company and c.is_active and c.status='active' for share;
  if not found then raise exception 'lifecycle_tenant_unavailable' using errcode='42501'; end if;
  if not private.gridex_customer_ops_actor_allowed_v1(v_actor,v_session,v_company,'customers.write') then
    raise exception 'lifecycle_actor_forbidden' using errcode='42501'; end if;
  v_namespace:=encode(extensions.digest(concat_ws(':','customer.lifecycle.close.v1',v_customer_id::text,v_actor::text,v_key),'sha256'),'hex');
  v_request:=jsonb_build_object('companyId',v_company,'customerId',v_customer_id,'actorId',v_actor,
    'expectedRevision',v_expected,'mode',v_mode,'moveOutDate',v_date,'createFollowUpTask',v_follow_up,
    'reasonHash',public.canonical_json_sha256(to_jsonb(v_reason)));
  select * into v_existing from public.canonical_command_results where company_id=v_company
    and command_type='customer.lifecycle.close.v1' and idempotency_key=v_namespace for update;
  if found then
    if v_existing.request_payload is distinct from v_request then raise exception 'lifecycle_idempotency_conflict' using errcode='P0001'; end if;
    if not private.gridex_profile_session_active_v1(v_actor,v_session) then
      raise exception 'lifecycle_actor_forbidden' using errcode='42501'; end if;
    return v_existing.result_payload||jsonb_build_object('replayed',true);
  end if;
  if v_customer.lifecycle_revision<>v_expected then raise exception 'lifecycle_revision_conflict' using errcode='P0001'; end if;
  if v_customer.status in ('moved','terminated') or v_customer.lifecycle_closed_at is not null then
    raise exception 'lifecycle_state_conflict' using errcode='P0001'; end if;

  -- Lock customer -> contract -> site, matching billing capture. The reused
  -- contract command takes its advisory lock before its row lock, so take both
  -- in that same order. Stable UUID ordering prevents cross-resource inversions.
  for v_id in select c.id from public.customer_contracts c where c.company_id=v_company and c.customer_id=v_customer_id
    and c.status in ('draft','pending_signature','signature_failed','signed','active') order by c.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||v_id::text,0));
  end loop;
  for v_contract in select c.* from public.customer_contracts c where c.company_id=v_company and c.customer_id=v_customer_id
    and c.status in ('draft','pending_signature','signature_failed','signed','active') order by c.id for update
  loop v_contracts:=array_append(v_contracts,v_contract.id); end loop;
  for v_id in select s.id from public.customer_sites s where s.company_id=v_company and s.customer_id=v_customer_id
    and s.archived_at is null order by s.id for update
  loop v_sites:=array_append(v_sites,v_id); end loop;
  for v_id in select p.id from public.metering_points p where p.company_id=v_company and p.archived_at is null
    and (p.customer_id=v_customer_id or p.site_id=any(v_sites) or p.customer_site_id=any(v_sites)) order by p.id for update
  loop v_points:=array_append(v_points,v_id); end loop;
  if exists(select 1 from public.metering_points p where p.id=any(v_points) and
      ((p.customer_id is not null and p.customer_id<>v_customer_id)
        or (p.site_id is not null and not p.site_id=any(v_sites))
        or (p.customer_site_id is not null and not p.customer_site_id=any(v_sites))))
    or exists(select 1 from public.customer_contracts c where c.id=any(v_contracts) and
      ((c.site_id is not null and not c.site_id=any(v_sites))
        or (c.customer_site_id is not null and not c.customer_site_id=any(v_sites))
        or (c.metering_point_id is not null and not c.metering_point_id=any(v_points)))) then
    raise exception 'lifecycle_resource_conflict' using errcode='P0001'; end if;
  for v_id in select s.id from public.supplier_switch_requests s where s.company_id=v_company and s.customer_id=v_customer_id
    and s.status in ('draft','queued','submitted','accepted') order by s.id for update
  loop v_switches:=array_append(v_switches,v_id); end loop;
  if exists(select 1 from public.supplier_switch_requests s where s.id=any(v_switches) and
      ((s.site_id is not null and not s.site_id=any(v_sites))
        or (s.customer_site_id is not null and not s.customer_site_id=any(v_sites))
        or (s.metering_point_id is not null and not s.metering_point_id=any(v_points)))) then
    raise exception 'lifecycle_resource_conflict' using errcode='P0001'; end if;
  perform 1 from public.customer_operation_tasks t where t.company_id=v_company and t.customer_id=v_customer_id
    and t.status in ('open','in_progress','blocked') order by t.id for update;
  -- Expiry is a clock condition, not a row mutation. Long graph lock waits
  -- must not extend an expired session's ability to issue a fresh command.
  if not private.gridex_profile_session_active_v1(v_actor,v_session) then
    raise exception 'lifecycle_actor_forbidden' using errcode='42501'; end if;
  v_now:=clock_timestamp(); v_status:=case v_mode when 'terminate' then 'terminated' else 'moved' end;
  v_metadata:=jsonb_build_object('mode',v_mode,'moveOutDate',v_date,'source','admin_customer_card','lifecycleRevision',v_expected+1,
    'retainedData',true,'commandKey',v_namespace);
  update public.customers set status=v_status,moved_out_at=v_date,lifecycle_closed_at=v_now,lifecycle_closed_by=v_actor,
    lifecycle_status_reason=v_reason,updated_at=v_now,updated_by=v_actor where id=v_customer_id and company_id=v_company returning * into v_customer;
  update public.customer_sites set status='closed',move_out_date=v_date,closed_at=coalesce(closed_at,v_now),closed_reason=v_reason,
    updated_at=v_now,updated_by=v_actor where id=any(v_sites) and company_id=v_company and customer_id=v_customer_id and status<>'closed';
  get diagnostics v_site_count=row_count;
  update public.metering_points set status='closed',end_date=v_date,closed_at=coalesce(closed_at,v_now),closed_reason=v_reason,
    updated_at=v_now,updated_by=v_actor where id=any(v_points) and company_id=v_company and status<>'closed';
  get diagnostics v_point_count=row_count;
  for v_contract in select c.* from public.customer_contracts c where c.id=any(v_contracts) order by c.id
  loop
    v_event_type:=case when v_contract.status in ('signed','active') then 'terminated' else 'cancelled' end;
    perform public.gridex_record_customer_contract_event_v1(v_company,v_contract.id,v_customer_id,v_event_type,v_now,
      case when v_event_type='terminated' then 'Avtalet avslutades via kundens livscykelåtgärd.' else 'Avtalsprocessen avbröts via kundens livscykelåtgärd.' end,
      v_metadata||jsonb_build_object('ends_at',v_date,'termination_notice_date',v_now,'termination_reason',v_mode),
      v_actor,null,v_namespace||':'||v_contract.id::text);
  end loop;
  update public.supplier_switch_requests set status='failed',failed_at=v_now,failure_reason=v_reason,updated_at=v_now,updated_by=v_actor
    where id=any(v_switches) and company_id=v_company and customer_id=v_customer_id;
  -- Cancel existing work before creating required follow-ups. The former
  -- sequential path cancelled its own newly inserted switch follow-up.
  update public.customer_operation_tasks set status='cancelled',resolved_at=v_now,updated_at=v_now,updated_by=v_actor
    where company_id=v_company and customer_id=v_customer_id and status in ('open','in_progress','blocked');
  if cardinality(v_switches)>0 then
    insert into public.customer_operation_tasks(company_id,customer_id,site_id,task_type,status,priority,title,description,metadata,created_by,updated_by)
    values(v_company,v_customer_id,v_sites[1],'supplier_switch_stopped_followup','open','high',
      'Följ upp stoppat leverantörsbyte vid flytt eller avslut',v_reason,v_metadata||jsonb_build_object('activeSwitchIds',v_switches),v_actor,v_actor);
    v_task_count:=v_task_count+1;
    insert into public.platform_usage_events(company_id,actor_user_id,customer_id,entity_type,entity_id,event_key,action_label,source,
      is_billable,billable_quantity,billing_unit,metadata)
    values(v_company,v_actor,v_customer_id,'supplier_switch_request',v_customer_id::text,'switch.cancelled',
      'Leverantörsbyte stoppat vid kundavslut','customer_lifecycle_close',true,cardinality(v_switches),'switch_request',v_metadata);
  end if;
  if v_follow_up then
    insert into public.customer_operation_tasks(company_id,customer_id,site_id,task_type,status,priority,title,description,metadata,created_by,updated_by)
    values(v_company,v_customer_id,v_sites[1],'move_out_confirmation_pending','open','high','Följ upp utflytt och slutunderlag',
      'Bekräfta utflytt eller avslut och säkerställ slutliga mätvärden och faktureringsunderlag.',v_metadata,v_actor,v_actor);
    v_task_count:=v_task_count+1;
  end if;
  v_note:=concat_ws(E'\n',case v_mode when 'terminate' then 'Avslut registrerat.' else 'Utflytt registrerad.' end,
    'Avsluts-/utflyttsdatum: '||v_date::text||'.','Orsak/notering: '||v_reason||'.',
    'Kund, historik, fullmakter, mätvärden och faktureringsunderlag sparas för spårbarhet.');
  insert into public.customer_internal_notes(company_id,customer_id,body,created_by,updated_by)
    values(v_company,v_customer_id,v_note,v_actor,v_actor);
  v_result:=jsonb_build_object('companyId',v_company,'customerId',v_customer_id,'revision',v_customer.lifecycle_revision,'changed',true,'replayed',false,
    'affectedSiteCount',v_site_count,'affectedMeteringPointCount',v_point_count,'affectedContractCount',cardinality(v_contracts),
    'cancelledSwitchCount',cardinality(v_switches),'followUpTaskCount',v_task_count);
  insert into public.customer_lifecycle_events(company_id,customer_id,event_type,event_status,effective_date,reason,payload,created_by)
    values(v_company,v_customer_id,v_mode,'completed',v_date,v_reason,v_metadata||v_result,v_actor);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
    values(v_company,'customer.lifecycle.close.v1',v_namespace,v_request,v_result,v_actor);
  insert into public.canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
    values(v_company,'CUSTOMER_LIFECYCLE_CLOSED','customer',v_customer_id,v_customer.lifecycle_revision,v_namespace,
      v_result||jsonb_build_object('mode',v_mode,'moveOutDate',v_date),v_actor) returning id into v_event;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload) values
    (v_company,v_event,'customer.lifecycle.closed',v_namespace,v_result||jsonb_build_object('mode',v_mode,'moveOutDate',v_date)),
    (v_company,v_event,'customer.lifecycle.confirmation.requested',v_namespace,
      jsonb_build_object('customerId',v_customer_id,'revision',v_customer.lifecycle_revision,'mode',v_mode,'moveOutDate',v_date,
        'templateKey','move_out_confirmation'));
  -- Durable intent only: this transaction never calls a transport. A late
  -- journal/result/outbox/audit fault aborts the whole closure, including all
  -- canonical contract events and their existing webhook intents.
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,
    reason,idempotency_key,before_state,after_state,metadata)
  values(v_company,'CUSTOMER_LIFECYCLE_COMMAND','customer',v_customer_id,v_customer.lifecycle_revision,v_actor,v_reason,v_namespace,
    jsonb_build_object('revision',v_expected),v_result,jsonb_build_object('mode',v_mode,'moveOutDate',v_date,'retainedData',true));
  if not private.gridex_profile_session_active_v1(v_actor,v_session) then
    raise exception 'lifecycle_actor_forbidden' using errcode='42501'; end if;
  return v_result;
end;
$function$;
revoke all on function public.gridex_close_customer_lifecycle_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_close_customer_lifecycle_v1(jsonb) to service_role;

-- Internal authorization for the preference/site commands and the forward
-- contact adapter. This never mutates customer/site business data or claims.
create function private.gridex_profile_command_authorize_v1(p_command jsonb,p_kind text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_company uuid; v_customer uuid; v_actor uuid; v_session uuid; v_client uuid;
  v_subject text; v_mode text; v_reason text; v_key text; v_json text; v_hash text;
  v_payload jsonb; v_request jsonb; v_namespace text;
  v_identity public.customer_portal_identities%rowtype; v_count integer:=0;
  v_scope text:=case when p_kind='billing' then 'customer_billing.write'
    when p_kind in ('preferences','contact') then 'customer_contact.write' else 'customer_facility_data.write' end;
begin
  if current_user<>'service_role' then raise exception 'profile_service_required' using errcode='42501'; end if;
  if p_kind not in ('preferences','facility','contact','billing') or p_command is null or jsonb_typeof(p_command)<>'object' then
    raise exception 'invalid_profile_command' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_command) k(key) where key not in
      ('companyId','customerId','mode','actorUserId','sessionId','clientId','subject','reason','idempotencyKey','requestJson','candidate'))
    or (p_kind<>'facility' and p_command ? 'candidate')
    or coalesce(p_command->>'companyId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'customerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'idempotencyKey','') !~ '^[A-Za-z0-9._:+~-]{8,200}$'
    or jsonb_typeof(p_command->'requestJson') is distinct from 'string'
    or octet_length(p_command->>'requestJson')>256000
    or coalesce(p_command->>'mode','') not in ('api','ops')
  then raise exception 'invalid_profile_command' using errcode='22023'; end if;
  v_company:=(p_command->>'companyId')::uuid; v_customer:=(p_command->>'customerId')::uuid;
  v_actor:=nullif(p_command->>'actorUserId','')::uuid; v_session:=nullif(p_command->>'sessionId','')::uuid;
  v_client:=nullif(p_command->>'clientId','')::uuid; v_subject:=nullif(p_command->>'subject','');
  v_mode:=p_command->>'mode'; v_reason:=nullif(btrim(p_command->>'reason'),'');
  v_key:=p_command->>'idempotencyKey'; v_json:=p_command->>'requestJson';
  begin v_payload:=v_json::jsonb;
  exception when invalid_text_representation then raise exception 'invalid_profile_command' using errcode='22023'; end;
  if jsonb_typeof(v_payload)<>'object' then raise exception 'invalid_profile_command' using errcode='22023'; end if;
  -- requestJson is produced by the private service module's exact legacy
  -- canonicalJson. Hash these compact bytes, never PostgreSQL JSON text.
  v_hash:=encode(extensions.digest(v_json,'sha256'),'hex');
  perform 1 from public.customers c where c.id=v_customer and c.company_id=v_company
    and c.status<>'archived' and c.archived_at is null for update;
  if not found then raise exception 'profile_customer_unavailable' using errcode='42501'; end if;
  perform 1 from public.companies c where c.id=v_company and c.is_active and c.status='active' for share;
  if not found then raise exception 'profile_tenant_unavailable' using errcode='42501'; end if;
  if v_mode='ops' then
    if v_actor is null or v_session is null or v_client is not null or v_subject is not null
      or v_reason is null or length(v_reason)>200 or not private.gridex_profile_session_active_v1(v_actor,v_session)
    then raise exception 'profile_actor_forbidden' using errcode='42501'; end if;
    perform 1 from public.company_memberships m where m.company_id=v_company and m.user_id=v_actor
      and m.is_active and m.status='active' for share;
    if not found then raise exception 'profile_actor_forbidden' using errcode='42501'; end if;
    perform private.gridex_profile_authority_lock_v1(v_actor,v_company);
    if not private.gridex_profile_session_active_v1(v_actor,v_session)
      or not coalesce(public.gridex_actor_has_company_permission(v_actor,v_company,'masterdata.write'),false)
    then raise exception 'profile_actor_forbidden' using errcode='42501'; end if;
  else
    if v_actor is not null or v_session is not null or v_reason is not null
      or v_client is null or v_subject is null or length(v_subject)>255
    then raise exception 'profile_delegation_forbidden' using errcode='42501'; end if;
    perform 1 from public.integration_api_clients c where c.id=v_client and c.company_id=v_company
      and c.status='active' and c.revoked_at is null and c.deleted_at is null
      and (c.expires_at is null or c.expires_at>clock_timestamp())
      and c.scopes && case when p_kind='billing' then array['customer_billing.write','*']::text[]
        else array[v_scope,'customer_portal.write','*']::text[] end for share;
    if not found then raise exception 'profile_delegation_forbidden' using errcode='42501'; end if;
    perform 1 from public.customer_portal_accounts a where a.company_id=v_company and a.customer_id=v_customer
      and a.status='active' and a.is_active and a.role='owner' and (a.portal_user_id::text=v_subject or
        (a.portal_user_id is null and (a.user_id::text=v_subject or a.external_account_id=v_subject))) for share;
    if not found then raise exception 'profile_delegation_forbidden' using errcode='42501'; end if;
    for v_identity in select i.* from public.customer_portal_identities i where i.company_id=v_company and i.customer_id=v_customer
      and (i.auth_user_id::text=v_subject or i.customer_portal_user_id::text=v_subject or i.external_account_id=v_subject) order by i.id for share
    loop
      v_count:=v_count+1;
      if v_identity.status<>'active' or v_count>1 then raise exception 'profile_delegation_forbidden' using errcode='42501'; end if;
    end loop;
    -- Relationship locks may have waited past the client's wall-clock expiry.
    -- Recheck the already locked client after every delegation lock, before
    -- either completed replay or a new command claim can be authorized.
    perform 1 from public.integration_api_clients c where c.id=v_client and c.company_id=v_company
      and c.status='active' and c.revoked_at is null and c.deleted_at is null
      and (c.expires_at is null or c.expires_at>clock_timestamp())
      and c.scopes && case when p_kind='billing' then array['customer_billing.write','*']::text[]
        else array[v_scope,'customer_portal.write','*']::text[] end;
    if not found then raise exception 'profile_delegation_forbidden' using errcode='42501'; end if;
  end if;
  v_request:=jsonb_build_object('customerId',v_customer,'mode',v_mode,'actorId',v_actor,
    'clientId',v_client,'compactHash',v_hash);
  v_namespace:=encode(extensions.digest(concat_ws(':','customer.profile',p_kind,v_mode,v_customer::text,
    coalesce(v_client::text,v_actor::text),v_key),'sha256'),'hex');
  return jsonb_build_object('companyId',v_company,'customerId',v_customer,'actorUserId',v_actor,'sessionId',v_session,
    'clientId',v_client,'mode',v_mode,'reason',v_reason,'key',v_key,
    'namespace',v_namespace,'hash',v_hash,'payload',v_payload,'request',v_request);
end;
$function$;
revoke all on function private.gridex_profile_command_authorize_v1(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function private.gridex_profile_command_authorize_v1(jsonb,text) to service_role;

create function private.gridex_profile_command_begin_v1(p_command jsonb,p_kind text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_context jsonb; v_company uuid; v_customer uuid; v_actor uuid; v_client uuid; v_mode text;
  v_key text; v_hash text; v_namespace text; v_request jsonb; v_claim uuid;
  v_existing public.customer_portal_write_idempotency%rowtype;
  v_ops public.canonical_command_results%rowtype;
  v_route constant text:='/api/v1/customer/profile-update';
begin
  v_context:=private.gridex_profile_command_authorize_v1(p_command,p_kind);
  v_company:=(v_context->>'companyId')::uuid; v_customer:=(v_context->>'customerId')::uuid;
  v_actor:=(v_context->>'actorUserId')::uuid; v_client:=(v_context->>'clientId')::uuid;
  v_mode:=v_context->>'mode'; v_key:=v_context->>'key'; v_hash:=v_context->>'hash';
  v_namespace:=v_context->>'namespace'; v_request:=v_context->'request';
  if v_mode='api' then
    -- Check completed legacy rows before requiring a newly introduced revision.
    select * into v_existing from public.customer_portal_write_idempotency where company_id=v_company
      and api_client_id=v_client and customer_id=v_customer and route=v_route and idempotency_key=v_key for update;
    if not found then
      -- Old canonical contact/billing commands stored a completion without
      -- this route claim. Unknown prior effects must not be re-executed as a
      -- different mutation category, nor discovered through a late failure.
      perform 1 from public.customer_portal_completions c where c.company_id=v_company
        and c.api_client_id=v_client and c.customer_id=v_customer and c.completion_type='profile_update'
        and c.idempotency_key=v_key for update;
      if found then raise exception 'idempotency_conflict' using errcode='P0001'; end if;
      insert into public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,idempotency_key,request_hash,status)
      values(v_company,v_client,v_customer,v_route,v_key,v_hash,'processing') on conflict do nothing returning id into v_claim;
      if v_claim is null then
        select * into v_existing from public.customer_portal_write_idempotency where company_id=v_company
          and api_client_id=v_client and customer_id=v_customer and route=v_route and idempotency_key=v_key for update;
      end if;
    end if;
    if v_existing.id is not null then
      if v_existing.request_hash is distinct from v_hash then raise exception 'idempotency_conflict' using errcode='P0001'; end if;
      if v_existing.status='completed' then
        perform private.gridex_profile_current_clock_v1(v_context);
        return jsonb_build_object('replayResult',jsonb_build_object(
        'statusCode',coalesce(v_existing.response_status,200),'body',v_existing.response_body,'replayed',true));
      elsif v_existing.status='failed' then raise exception 'idempotency_previous_attempt_failed' using errcode='P0001';
      else raise exception 'idempotency_in_progress' using errcode='P0001'; end if;
    end if;
    if v_claim is null then raise exception 'idempotency_in_progress' using errcode='P0001'; end if;
  else
    select * into v_ops from public.canonical_command_results where company_id=v_company
      and command_type='customer.profile.'||p_kind||'.v1' and idempotency_key=v_namespace for update;
    if found then
      if v_ops.request_payload is distinct from v_request then raise exception 'idempotency_conflict' using errcode='P0001'; end if;
      perform private.gridex_profile_current_clock_v1(v_context);
      return jsonb_build_object('replayResult',v_ops.result_payload||jsonb_build_object('replayed',true));
    end if;
    v_claim:=gen_random_uuid();
  end if;
  perform private.gridex_profile_current_clock_v1(v_context);
  return v_context||jsonb_build_object('claimId',v_claim);
end;
$function$;
revoke all on function private.gridex_profile_command_begin_v1(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function private.gridex_profile_command_begin_v1(jsonb,text) to service_role;

create function private.gridex_profile_command_finish_v1(p_context jsonb,p_kind text,p_data jsonb,
  p_revision bigint,p_before jsonb,p_changed boolean)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_company uuid:=(p_context->>'companyId')::uuid; v_customer uuid:=(p_context->>'customerId')::uuid;
  v_actor uuid:=(p_context->>'actorUserId')::uuid; v_client uuid:=(p_context->>'clientId')::uuid;
  v_claim uuid:=(p_context->>'claimId')::uuid; v_site uuid:=nullif(p_context->>'siteId','')::uuid;
  v_completion public.customer_portal_completions%rowtype; v_body jsonb; v_result jsonb;
  v_event uuid; v_complete uuid; v_key text:='profile.'||p_kind||':'||v_claim::text;
begin
  if current_user<>'service_role' or p_kind not in ('preferences','facility') then
    raise exception 'profile_service_required' using errcode='42501'; end if;
  if p_context->>'mode'='api' then
    insert into public.customer_portal_completions(company_id,customer_id,api_client_id,site_id,
      completion_type,status,submitted_payload,result_payload,idempotency_key,request_hash)
    values(v_company,v_customer,v_client,v_site,'profile_update',p_data->>'status',
      p_context->'payload',p_data,p_context->>'key',p_context->>'hash') returning * into v_completion;
    p_data:=p_data||jsonb_build_object('completion_reference',v_completion.completion_reference,'created_at',v_completion.created_at);
    if p_data->>'status'='submitted' then
      insert into public.customer_cases(company_id,customer_id,site_id,case_type,status,priority,title,
        description,reason_category,next_action,source,metadata)
      values(v_company,v_customer,v_site,'technical_blocker','action_required','normal','Kundens anläggningsuppgift behöver granskas',
        'Adresskompletteringen kunde inte tillämpas automatiskt. Granska den separata kompletteringen.',
        'portal_completion','Granska anläggningsadressen.','customer_portal_api',
        jsonb_build_object('completionId',v_completion.id,'completionType','profile_update'))
      returning id into v_complete;
      update public.customer_portal_completions set linked_case_id=v_complete where id=v_completion.id and company_id=v_company;
    end if;
  end if;
  v_body:=jsonb_build_object('data',p_data);
  v_result:=jsonb_build_object('statusCode',200,'body',v_body,'replayed',false);
  if p_context->>'mode'='api' then
    update public.customer_portal_write_idempotency set status='completed',response_status=200,response_body=v_body,
      completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=v_claim and company_id=v_company and api_client_id=v_client and customer_id=v_customer
        and route='/api/v1/customer/profile-update' and idempotency_key=p_context->>'key'
        and request_hash=p_context->>'hash' and status='processing' returning id into v_complete;
    if v_complete is null then raise exception 'profile_completion_failed' using errcode='P0001'; end if;
  end if;
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,
    actor_user_id,reason,idempotency_key,before_state,after_state,metadata)
  values(v_company,case p_kind when 'preferences' then 'CUSTOMER_PROFILE_PREFERENCES_COMMAND' else 'CUSTOMER_FACILITY_PROFILE_COMMAND' end,
    case p_kind when 'preferences' then 'customer' else 'customer_site' end,coalesce(v_site,v_customer),p_revision,
    v_actor,coalesce(p_context->>'reason','delegated_customer'),v_key,p_before,
    jsonb_build_object('revision',p_revision,'changed',p_changed),jsonb_build_object('clientId',v_client,
      'customerId',v_customer,'claimId',v_claim,'requestHash',p_context->>'hash','mode',p_context->>'mode'));
  if p_changed then
    insert into public.canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
    values(v_company,case p_kind when 'preferences' then 'CUSTOMER_PROFILE_PREFERENCES_CHANGED' else 'CUSTOMER_FACILITY_PROFILE_CHANGED' end,
      case p_kind when 'preferences' then 'customer' else 'customer_site' end,coalesce(v_site,v_customer),p_revision,v_key,
      jsonb_build_object('customerId',v_customer,'siteId',v_site,'revision',p_revision),v_actor) returning id into v_event;
    insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
    values(v_company,v_event,case p_kind when 'preferences' then 'customer.profile.preferences.changed' else 'customer.facility.profile.changed' end,
      v_key,jsonb_build_object('customerId',v_customer,'siteId',v_site,'revision',p_revision));
  end if;
  if p_context->>'mode'='ops' then
    insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
    values(v_company,'customer.profile.'||p_kind||'.v1',p_context->>'namespace',p_context->'request',v_result,v_actor);
  end if;
  perform private.gridex_profile_current_clock_v1(p_context);
  return v_result;
end;
$function$;
revoke all on function private.gridex_profile_command_finish_v1(jsonb,text,jsonb,bigint,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function private.gridex_profile_command_finish_v1(jsonb,text,jsonb,bigint,jsonb,boolean) to service_role;

create function public.gridex_change_customer_profile_preferences_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_context jsonb; v_payload jsonb; v_profile jsonb; v_customer public.customers%rowtype;
  v_company uuid; v_customer_id uuid; v_expected bigint; v_language text; v_timezone text; v_changed boolean;
begin
  v_context:=private.gridex_profile_command_begin_v1(p_command,'preferences');
  if v_context ? 'replayResult' then return v_context->'replayResult'; end if;
  v_payload:=v_context->'payload'; v_profile:=v_payload->'profile';
  if exists(select 1 from jsonb_object_keys(v_payload) k(key) where key not in ('profile','expected_profile_revision','metadata'))
    or jsonb_typeof(v_profile) is distinct from 'object' or v_profile='{}'::jsonb
  then raise exception 'invalid_profile_preferences' using errcode='22023'; end if;
  if v_payload ? 'metadata' then raise exception 'profile_metadata_not_supported' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(v_profile) e(key,value) where key not in ('language_code','timezone') or jsonb_typeof(value)<>'string')
    or (v_profile ? 'language_code' and coalesce(v_profile->>'language_code','') !~ '^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$')
    or (v_profile ? 'timezone' and not exists(select 1 from pg_catalog.pg_timezone_names where name=v_profile->>'timezone'))
  then raise exception 'invalid_profile_preferences' using errcode='22023'; end if;
  if jsonb_typeof(v_payload->'expected_profile_revision') is distinct from 'number'
    or coalesce(v_payload->>'expected_profile_revision','') !~ '^[0-9]{1,16}$'
    or (v_payload->>'expected_profile_revision')::numeric>9007199254740991 then
    raise exception 'profile_revision_required' using errcode='22023'; end if;
  v_expected:=(v_payload->>'expected_profile_revision')::bigint;
  v_company:=(v_context->>'companyId')::uuid; v_customer_id:=(v_context->>'customerId')::uuid;
  select * into v_customer from public.customers where id=v_customer_id and company_id=v_company for update;
  if v_customer.profile_revision<>v_expected then raise exception 'profile_revision_conflict' using errcode='P0001'; end if;
  if v_profile ? 'timezone' and v_customer.metadata is not null and jsonb_typeof(v_customer.metadata)<>'object'
  then raise exception 'invalid_profile_preferences' using errcode='22023'; end if;
  v_language:=case when v_profile ? 'language_code' then v_profile->>'language_code' else v_customer.preferred_language end;
  v_timezone:=case when v_profile ? 'timezone' then v_profile->>'timezone' else v_customer.metadata->>'portal_timezone' end;
  v_changed:=v_language is distinct from v_customer.preferred_language or v_timezone is distinct from v_customer.metadata->>'portal_timezone';
  if v_changed then
    update public.customers set preferred_language=v_language,
      metadata=case when v_profile ? 'timezone' then coalesce(metadata,'{}'::jsonb)||jsonb_build_object('portal_timezone',v_timezone) else metadata end,
      updated_at=clock_timestamp(),updated_by=(v_context->>'actorUserId')::uuid
      where id=v_customer_id and company_id=v_company returning * into v_customer;
  end if;
  return private.gridex_profile_command_finish_v1(v_context,'preferences',jsonb_build_object('status','accepted',
    'profile_updated',v_changed,'profile_revision',v_customer.profile_revision,'facility_updated',false,'address_result',null),
    v_customer.profile_revision,jsonb_build_object('revision',v_expected),v_changed);
end;
$function$;

create function public.gridex_change_customer_facility_profile_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_context jsonb; v_payload jsonb; v_facility jsonb; v_address jsonb; v_candidate jsonb;
  v_company uuid; v_customer uuid; v_actor uuid; v_site public.customer_sites%rowtype;
  v_expected bigint; v_source text; v_rank integer; v_current_rank integer; v_status text;
  v_hash text; v_normalized text; v_reason text; v_changed boolean:=false;
  v_candidate_snapshot jsonb; v_job uuid; v_operation uuid; v_trace uuid; v_snapshot jsonb;
begin
  -- Current resource policy applies to historical results too. Authenticate
  -- before this neutral lookup, then lock the exact live customer/site link
  -- before the shared claim helper can return a completed result. Replay does
  -- not require today's candidate or a newly introduced address revision.
  v_context:=private.gridex_profile_command_authorize_v1(p_command,'facility');
  v_facility:=v_context#>'{payload,facility_data}';
  if jsonb_typeof(v_facility) is distinct from 'object' or
    jsonb_typeof(v_facility->'facility_reference') is distinct from 'string' or
    coalesce(length(v_facility->>'facility_reference'),0) not between 1 and 120 then
    raise exception 'invalid_facility_command' using errcode='22023'; end if;
  v_company:=(v_context->>'companyId')::uuid; v_customer:=(v_context->>'customerId')::uuid;
  select * into v_site from public.customer_sites s where s.company_id=v_company and s.customer_id=v_customer
    and s.facility_reference=v_facility->>'facility_reference' and s.is_active and s.archived_at is null for update;
  if not found then raise exception 'facility_resource_not_found' using errcode='P0002'; end if;
  v_context:=private.gridex_profile_command_begin_v1(p_command,'facility');
  if v_context ? 'replayResult' then return v_context->'replayResult'; end if;
  v_payload:=v_context->'payload'; v_facility:=v_payload->'facility_data';
  if exists(select 1 from jsonb_object_keys(v_payload) k(key) where key not in ('facility_data','metadata'))
    or jsonb_typeof(v_facility) is distinct from 'object' then
    raise exception 'invalid_facility_command' using errcode='22023'; end if;
  if v_payload ? 'metadata' then raise exception 'profile_metadata_not_supported' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(v_facility) k(key) where key not in ('facility_reference','address','external_request_id','expected_address_revision'))
    or coalesce(length(v_facility->>'facility_reference'),0) not between 1 and 120
    or jsonb_typeof(v_facility->'address') is distinct from 'object' or v_facility->'address'='{}'::jsonb
  then raise exception 'invalid_facility_command' using errcode='22023'; end if;
  v_address:=v_facility->'address';
  if exists(select 1 from jsonb_each(v_address) e(key,value) where key not in ('street','postal_code','city','country','care_of','apartment_number')
      or jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}'))<1
      or length(value#>>'{}')>case key when 'street' then 300 when 'postal_code' then 20 when 'city' then 120 when 'country' then 2 when 'care_of' then 200 else 50 end)
    or (v_facility ? 'external_request_id' and (jsonb_typeof(v_facility->'external_request_id')<>'string' or length(v_facility->>'external_request_id') not between 1 and 200))
  then raise exception 'invalid_facility_command' using errcode='22023'; end if;
  if jsonb_typeof(v_facility->'expected_address_revision') is distinct from 'number'
    or coalesce(v_facility->>'expected_address_revision','') !~ '^[0-9]{1,16}$'
    or (v_facility->>'expected_address_revision')::numeric>9007199254740991 then
    raise exception 'facility_address_revision_required' using errcode='22023'; end if;
  v_expected:=(v_facility->>'expected_address_revision')::bigint;
  v_company:=(v_context->>'companyId')::uuid; v_customer:=(v_context->>'customerId')::uuid; v_actor:=(v_context->>'actorUserId')::uuid;
  if v_site.address_revision<>v_expected then raise exception 'facility_address_revision_conflict' using errcode='P0001'; end if;
  v_candidate:=p_command->'candidate';
  if v_candidate is null or jsonb_typeof(v_candidate)<>'object' or
    v_candidate->>'siteId' is distinct from v_site.id::text or
    v_candidate->>'snapshotRevision' is distinct from v_expected::text then
    raise exception 'facility_address_revision_conflict' using errcode='P0001'; end if;
  if exists(select 1 from jsonb_object_keys(v_candidate) k(key) where key not in
      ('siteId','snapshotRevision','street','postal_code','city','country','care_of','apartment_number','normalized','address_hash','complete'))
    or jsonb_typeof(v_candidate->'complete') is distinct from 'boolean'
    or exists(select 1 from jsonb_each(v_candidate) e(key,value) where key in
      ('street','postal_code','city','country','care_of','apartment_number','normalized','address_hash') and jsonb_typeof(value) not in ('string','null'))
    or coalesce(length(v_candidate->>'care_of'),0)>200 or coalesce(length(v_candidate->>'apartment_number'),0)>50
  then raise exception 'facility_candidate_invalid' using errcode='22023'; end if;
  v_hash:=nullif(v_candidate->>'address_hash',''); v_normalized:=nullif(v_candidate->>'normalized','');
  if (v_candidate->>'complete')::boolean is distinct from
      (coalesce(length(v_candidate->>'street'),0)>0 and coalesce(v_candidate->>'postal_code','') ~ '^[0-9]{5}$'
        and coalesce(length(v_candidate->>'city'),0)>0 and v_candidate->>'country'='SE')
    or (not (v_candidate->>'complete')::boolean and (v_hash is not null or v_normalized is not null))
  then raise exception 'facility_candidate_invalid' using errcode='22023'; end if;
  if (v_candidate->>'complete')::boolean and (v_hash is null or v_hash !~ '^[a-f0-9]{64}$'
      or v_normalized is null or v_hash<>encode(extensions.digest(v_normalized,'sha256'),'hex')
      or coalesce(length(v_candidate->>'street'),0) not between 1 and 300
      or coalesce(v_candidate->>'postal_code','') !~ '^[0-9]{5}$'
      or coalesce(length(v_candidate->>'city'),0) not between 1 and 120 or v_candidate->>'country' is distinct from 'SE')
  then raise exception 'facility_candidate_invalid' using errcode='22023'; end if;
  v_source:=case v_context->>'mode' when 'ops' then 'manual_intake' else 'customer_portal' end;
  v_rank:=case v_source when 'manual_intake' then 40 else 20 end;
  v_current_rank:=case v_site.address_source when 'grid_owner_response' then 70 when 'superadmin' then 60
    when 'tenant_api' then 50 when 'manual_intake' then 40 when 'website' then 30 when 'customer_portal' then 20 else 10 end;
  v_candidate_snapshot:=(v_candidate-'siteId'-'snapshotRevision'-'complete'-'normalized')||jsonb_build_object('source',v_source,
    'source_reference',v_facility->>'external_request_id');
  if not (v_candidate->>'complete')::boolean then
    v_status:='incomplete'; v_reason:='missing_site_address_fields';
    -- Keep an established canonical address/provenance. An incomplete
    -- customer candidate is review evidence, never a downgrade of that data.
    update public.customer_sites set
      address_status=case when address_hash is null then 'incomplete' else address_status end,
      address_quality_status=case when address_hash is null then 'incomplete' else address_quality_status end,
      address_quality_warnings=case when address_hash is null then '["site_address_requires_street_postal_code_city"]'::jsonb else address_quality_warnings end,
      address_received_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_site.id and company_id=v_company;
    insert into public.customer_site_address_history(company_id,customer_id,customer_site_id,address_hash,source,source_reference,actor_user_id,snapshot)
    values(v_company,v_customer,v_site.id,null,v_source,v_facility->>'external_request_id',v_actor,v_candidate_snapshot);
  elsif v_site.address_hash=v_hash and row(v_site.care_of,v_site.apartment_number) is not distinct from
      row(v_candidate->>'care_of',v_candidate->>'apartment_number') then
    v_status:='unchanged';
    -- Keep verified provenance and first verification time on an unchanged
    -- lower-ranked customer submission; do not downgrade the canonical source.
    update public.customer_sites set address_received_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=v_site.id and company_id=v_company;
  elsif v_site.address_hash is not null and (v_site.address_verified_at is not null or v_site.address_verification_method='grid_owner_response')
      and v_rank<v_current_rank then
    v_status:='conflict'; v_reason:='verified_address_conflict';
    insert into public.customer_site_address_conflicts(company_id,customer_id,customer_site_id,status,existing_address,candidate_address,
      candidate_source,candidate_source_reference,dedupe_key)
    values(v_company,v_customer,v_site.id,'open',jsonb_build_object('address_hash',v_site.address_hash,'source',v_site.address_source),
      v_candidate_snapshot,v_source,v_facility->>'external_request_id',encode(extensions.digest(v_company::text||':'||v_site.id::text||':'||v_source||':'||v_hash,'sha256'),'hex'))
      on conflict do nothing;
  else
    v_status:='updated';
    perform public.gridex_commit_customer_site_address(v_company,v_customer,v_site.id,v_candidate->>'street',v_candidate->>'postal_code',
      v_candidate->>'city',v_candidate->>'country',v_candidate->>'care_of',v_candidate->>'apartment_number',v_normalized,v_hash,
      v_source,v_facility->>'external_request_id',jsonb_build_object('profile_command',true),v_actor);
  end if;
  select * into v_site from public.customer_sites where id=v_site.id and company_id=v_company and customer_id=v_customer;
  v_changed:=v_site.address_revision<>v_expected;
  v_context:=v_context||jsonb_build_object('siteId',v_site.id);
  if v_status in ('updated','unchanged') then
    -- Reuse the existing worker and facility gate. Delivery happens later;
    -- the persisted job/snapshot is atomic with address/history/result/audit.
    v_snapshot:=jsonb_build_object('site_id',v_site.id,'address_hash',v_site.address_hash,'grid_owner_id',v_site.grid_owner_id,
      'grid_area_code',v_site.grid_area_code,'route_profile_id',null,'facility_id',v_site.facility_id,'captured_at',clock_timestamp());
    insert into public.customer_operation_jobs(company_id,customer_id,customer_site_id,job_type,status,idempotency_key,payload,
      request_snapshot,priority,created_by)
    values(v_company,v_customer,v_site.id,'request_customer_data','queued','customer-data:'||v_customer::text||':'||v_site.id::text,
      jsonb_build_object('requestedFrom','profile_command','site_snapshot',v_snapshot),v_snapshot,20,v_actor)
      on conflict do nothing returning id,operation_id,trace_id into v_job,v_operation,v_trace;
    if v_job is not null then
      insert into public.customer_operation_request_snapshots(company_id,customer_id,customer_site_id,customer_operation_job_id,
        operation_id,request_kind,site_address_hash,grid_owner_id,grid_area_code,snapshot,trace_id)
      values(v_company,v_customer,v_site.id,v_job,v_operation,'customer_data_request',v_site.address_hash,
        v_site.grid_owner_id,v_site.grid_area_code,v_snapshot||jsonb_build_object('operation_id',v_operation,'trace_id',v_trace),v_trace);
    end if;
  end if;
  return private.gridex_profile_command_finish_v1(v_context,'facility',jsonb_build_object('status',
    case when v_status in ('updated','unchanged') then 'accepted' else 'submitted' end,'profile_updated',false,
    'facility_updated',v_status in ('updated','unchanged'),'address_revision',v_site.address_revision,
    'address_result',jsonb_build_object('status',v_status,'address_hash',v_hash)||case when v_reason is null then '{}'::jsonb else jsonb_build_object('reason',v_reason) end),
    v_site.address_revision,jsonb_build_object('revision',v_expected),v_changed);
end;
$function$;
revoke all on function public.gridex_change_customer_profile_preferences_v1(jsonb),public.gridex_change_customer_facility_profile_v1(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.gridex_change_customer_profile_preferences_v1(jsonb),public.gridex_change_customer_facility_profile_v1(jsonb) to service_role;
commit;
