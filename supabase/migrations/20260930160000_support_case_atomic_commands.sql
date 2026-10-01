-- Additive P4 support boundary. Staff text never becomes a customer message
-- implicitly. No email, external delivery or phone verification is activated.
begin;
set local lock_timeout = '10s';

alter table public.customer_cases add column support_revision bigint not null default 0 check (support_revision >= 0);

create table public.customer_support_threads (
  id uuid primary key references public.customer_cases(id) on delete cascade,
  company_id uuid not null,
  customer_id uuid not null,
  public_reference text not null,
  customer_title text check (length(btrim(customer_title)) between 1 and 180),
  created_at timestamptz not null default clock_timestamp(),
  constraint customer_support_threads_case_owner_fk foreign key (id,company_id,customer_id)
    references public.customer_cases(id,company_id,customer_id) on delete cascade,
  constraint customer_support_threads_customer_owner_fk foreign key (customer_id,company_id)
    references public.customers(id,company_id) on delete cascade,
  constraint customer_support_threads_reference_key unique(company_id,public_reference),
  constraint customer_support_threads_owner_key unique(id,company_id,customer_id)
);
create index customer_support_threads_customer_idx on public.customer_support_threads(company_id,customer_id,created_at desc,id desc);

create table public.customer_support_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null,
  customer_case_id uuid not null,
  visibility text not null check (visibility in ('customer','internal')),
  author_kind text not null check (author_kind in ('customer','staff')),
  actor_user_id uuid references auth.users(id) on delete restrict,
  api_client_id uuid references public.integration_api_clients(id) on delete restrict,
  publication_id uuid references public.customer_case_publications(id) on delete restrict,
  channel text not null check (channel in ('ops','phone','portal','api')),
  caller_verification text not null check (caller_verification in ('unverified','not_applicable')),
  body text not null check (length(btrim(body)) between 1 and 8000),
  revision bigint not null check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  constraint customer_support_messages_case_owner_fk foreign key (customer_case_id,company_id,customer_id)
    references public.customer_cases(id,company_id,customer_id) on delete cascade,
  constraint customer_support_messages_customer_owner_fk foreign key (customer_id,company_id)
    references public.customers(id,company_id) on delete cascade,
  constraint customer_support_messages_revision_key unique(company_id,customer_case_id,revision),
  constraint customer_support_messages_attribution_check check (
    (channel='api' and api_client_id is not null and actor_user_id is null and author_kind='customer' and visibility='customer') or
    (channel in ('ops','phone','portal') and actor_user_id is not null and api_client_id is null and
      ((channel in ('ops','phone') and author_kind='staff') or (channel='portal' and author_kind='customer' and visibility='customer')))
  ),
  constraint customer_support_messages_phone_boundary_check check (
    (channel='phone' and caller_verification='unverified' and visibility='internal') or
    (channel<>'phone' and caller_verification='not_applicable')
  )
);
create index customer_support_messages_customer_idx on public.customer_support_messages(company_id,customer_id,customer_case_id,created_at,id);
alter table public.customer_support_threads enable row level security;
alter table public.customer_support_messages enable row level security;
revoke all on public.customer_support_threads,public.customer_support_messages from public,anon,authenticated;
grant select,insert on public.customer_support_threads,public.customer_support_messages to service_role;

insert into public.platform_table_classification(table_name,kind,rationale,null_company_meaning,classified_by)
values ('customer_support_threads','tenant','Explicit customer origin support title and indexed canonical reference; composite customer/case ownership and no client grants.',null,'migration:support_case_atomic_commands'),
  ('customer_support_messages','tenant','Immutable explicit public messages separated from internal notes; composite customer/case ownership and no client grants.',null,'migration:support_case_atomic_commands');

-- A signed but stale JWT is insufficient: the live session must still exist.
-- Only this narrow definer helper reads the protected auth schema.
create function private.gridex_support_session_active_v1(p_user_id uuid,p_session_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $function$
begin
  if not private.gridex_contact_actor_active_v1(p_user_id) then return false; end if;
  perform 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_user_id
    and (s.not_after is null or s.not_after>clock_timestamp()) for share;
  return found;
end
$function$;
revoke all on function private.gridex_support_session_active_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.gridex_support_session_active_v1(uuid,uuid) to service_role;

create function private.gridex_support_actor_v1(p_context jsonb,p_write boolean)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_company uuid := (p_context->>'companyId')::uuid;
  v_customer uuid := (p_context->>'customerId')::uuid;
  v_user uuid := nullif(p_context->>'actorUserId','')::uuid;
  v_client uuid := nullif(p_context->>'clientId','')::uuid;
  v_subject text := nullif(p_context->>'subject','');
  v_mode text := p_context->>'mode';
  v_identity public.customer_portal_identities%rowtype;
  v_identity_count integer := 0;
begin
  if current_user<>'service_role' then return false; end if;
  perform 1 from public.companies c where c.id=v_company and c.is_active and c.status='active' for share;
  if not found then return false; end if;
  perform 1 from public.customers c where c.id=v_customer and c.company_id=v_company
    and c.archived_at is null and c.status<>'archived' for share;
  if not found then return false; end if;
  if v_mode in ('ops','portal') then
    if v_user is null or v_client is not null or v_subject is not null or
      not private.gridex_support_session_active_v1(v_user,nullif(p_context->>'sessionId','')::uuid) then return false; end if;
    if v_mode='ops' then
      perform 1 from public.user_profiles u where u.id=v_user and u.user_status='active' for share;
      if not found then return false; end if;
      perform 1 from public.company_memberships m where m.company_id=v_company and m.user_id=v_user
        and m.is_active and m.status='active' for share;
      if not found then return false; end if;
      perform private.gridex_profile_authority_lock_v1(v_user,v_company);
      return private.gridex_support_session_active_v1(v_user,nullif(p_context->>'sessionId','')::uuid)
        and coalesce(public.gridex_actor_has_company_permission(v_user,v_company,
        case when p_write then 'cases.write' else 'cases.read' end),false);
    end if;
    perform 1 from public.customer_portal_accounts a where a.company_id=v_company and a.customer_id=v_customer
      and a.user_id=v_user and a.is_active and a.status='active' and (not p_write or a.role='owner') for share;
    return found and private.gridex_support_session_active_v1(v_user,nullif(p_context->>'sessionId','')::uuid);
  elsif v_mode='api' then
    if v_user is not null or p_context->>'sessionId' is not null or v_client is null or v_subject is null or length(v_subject)>255 then return false; end if;
    perform 1 from public.integration_api_clients c where c.id=v_client and c.company_id=v_company
      and c.status='active' and c.revoked_at is null and c.deleted_at is null
      and (c.expires_at is null or c.expires_at>clock_timestamp())
      and c.scopes && array[case when p_write then 'customer_cases.write' else 'customer_cases.read' end,'*']::text[] for share;
    if not found then return false; end if;
    -- Signature, issuer and exact action are verified by the server adapter.
    -- This additional relationship lock is required again before replay.
    perform 1 from public.customer_portal_accounts a where a.company_id=v_company and a.customer_id=v_customer
      and a.is_active and a.status='active'
      and (not p_write or a.role='owner')
      and (a.portal_user_id::text=v_subject or (a.portal_user_id is null and
        (a.user_id::text=v_subject or a.external_account_id=v_subject))) for share;
    if not found then return false; end if;
    for v_identity in select i.* from public.customer_portal_identities i
      where i.company_id=v_company and i.customer_id=v_customer and
        (i.auth_user_id::text=v_subject or i.customer_portal_user_id::text=v_subject or i.external_account_id=v_subject)
      order by i.id for share
    loop
      v_identity_count:=v_identity_count+1;
      if v_identity.status is distinct from 'active' or v_identity_count>1 then return false; end if;
    end loop;
    -- Client expiry may elapse while the account/identity locks wait.
    perform 1 from public.integration_api_clients c where c.id=v_client and c.company_id=v_company
      and c.status='active' and c.revoked_at is null and c.deleted_at is null
      and (c.expires_at is null or c.expires_at>clock_timestamp()) for share;
    return found;
  end if;
  return false;
end
$function$;
revoke all on function private.gridex_support_actor_v1(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function private.gridex_support_actor_v1(jsonb,boolean) to service_role;

-- Downstream resource locks can wait after the authority check. Recheck the
-- already locked session/client wall clock at the actual replay/write boundary.
create function private.gridex_support_clock_active_v1(p_context jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $f$
begin
  if current_user<>'service_role' then return false; end if;
  if p_context->>'mode' in ('ops','portal') then
    return private.gridex_support_session_active_v1((p_context->>'actorUserId')::uuid,(p_context->>'sessionId')::uuid);
  elsif p_context->>'mode'='api' then
    perform 1 from public.integration_api_clients c where c.id=(p_context->>'clientId')::uuid
      and c.company_id=(p_context->>'companyId')::uuid and c.status='active' and c.revoked_at is null and c.deleted_at is null
      and (c.expires_at is null or c.expires_at>clock_timestamp()) for share;
    return found;
  end if;
  return false;
end $f$;
revoke all on function private.gridex_support_clock_active_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.gridex_support_clock_active_v1(jsonb) to service_role;

create function private.gridex_support_customer_status_v1(p_internal text,p_published text)
returns text language sql immutable security invoker set search_path=pg_catalog as $f$
  select coalesce(p_published,case when p_internal='cancelled' then 'closed' when p_internal in ('resolved','closed') then p_internal else 'open' end)
$f$;
revoke all on function private.gridex_support_customer_status_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function private.gridex_support_customer_status_v1(text,text) to service_role;

-- Legacy creation stored a key in case metadata before separately completing
-- other writes. Its presence is not proof of an atomic completed command.
create index customer_cases_support_legacy_key_idx on public.customer_cases
  (company_id,customer_id,(metadata->>'support_idempotency_key'))
  where metadata ? 'support_idempotency_key' and
    (metadata->>'support_case'='true' or source like 'tenant\_support\_%' escape '\');

create function public.gridex_support_case_command_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_company uuid := nullif(p_command->>'companyId','')::uuid;
  v_customer uuid := nullif(p_command->>'customerId','')::uuid;
  v_case_id uuid := nullif(p_command->>'caseId','')::uuid;
  v_case_reference text := nullif(p_command->>'caseReference','');
  v_site uuid := nullif(p_command->>'siteId','')::uuid;
  v_point uuid := nullif(p_command->>'meteringPointId','')::uuid;
  v_actor uuid := nullif(p_command->>'actorUserId','')::uuid;
  v_client uuid := nullif(p_command->>'clientId','')::uuid;
  v_mode text := p_command->>'mode';
  v_channel text := p_command->>'channel';
  v_op text := p_command->>'operation';
  v_key text := p_command->>'idempotencyKey';
  v_expected bigint := (p_command->>'expectedRevision')::bigint;
  v_payload jsonb := p_command->'payload';
  v_case public.customer_cases%rowtype;
  v_prior public.canonical_command_results%rowtype;
  v_request jsonb;
  v_scoped_key text;
  v_result jsonb;
  v_message uuid;
  v_event uuid;
  v_public boolean;
  v_reference text;
  v_customer_status text;
begin
  if current_user<>'service_role' then raise exception 'support_service_required' using errcode='42501'; end if;
  if p_command is null or jsonb_typeof(p_command)<>'object' or exists(select 1 from jsonb_object_keys(p_command) k(key)
      where key not in ('companyId','customerId','caseId','caseReference','siteId','meteringPointId','actorUserId','sessionId','clientId','subject','mode','channel','operation','expectedRevision','idempotencyKey','payload'))
    or v_company is null or v_customer is null or v_expected is null or v_expected<0
    or v_key is null or v_key !~ '^[A-Za-z0-9._:+~-]{8,200}$'
    or v_mode is null or v_mode not in ('ops','portal','api') or v_channel is null or
      (v_channel is distinct from v_mode and not (v_mode='ops' and v_channel='phone' and v_op in ('create','internal_note')))
    or v_op is null or v_op not in ('create','customer_message','internal_note','status')
    or (v_case_reference is not null and v_case_reference !~ '^case_[A-Za-z0-9_-]{32}$')
    or (v_op='create' and (v_case_id is not null or v_case_reference is not null or v_expected<>0))
    or (v_op<>'create' and ((v_case_id is null)=(v_case_reference is null)))
    or ((v_site is not null or v_point is not null) and (v_mode<>'ops' or v_op<>'create'))
    or v_payload is null or jsonb_typeof(v_payload)<>'object'
    or (v_mode<>'ops' and (v_op in ('internal_note','status') or v_payload ? 'priority' or v_payload ? 'category'))
    or exists(select 1 from jsonb_each(v_payload) e(key,value) where jsonb_typeof(value)<>'string')
    or exists(select 1 from jsonb_object_keys(v_payload) k(key) where
      (v_op='create' and key not in ('title','body','priority','category')) or
      (v_op in ('customer_message','internal_note') and key<>'body') or (v_op='status' and key<>'status'))
    or (v_op='create' and (v_payload->>'title' is null or length(btrim(v_payload->>'title')) not between 1 and 180))
    or (v_op<>'status' and (v_payload->>'body' is null or length(btrim(v_payload->>'body')) not between 1 and 8000))
    or (v_payload ? 'priority' and v_payload->>'priority' not in ('low','normal','high','urgent'))
    or (v_payload ? 'category' and length(btrim(v_payload->>'category')) not between 1 and 120)
    or (v_op='status' and (v_payload->>'status' is null or v_payload->>'status' not in ('open','action_required','awaiting_external_response','manual_follow_up','resolved','closed')))
  then raise exception 'invalid_support_command' using errcode='22023'; end if;

  -- Customer lock serializes creation, retry and all case commands. Consistent
  -- ordering with contact/profile commands also protects relationship changes.
  perform 1 from public.customers where id=v_customer and company_id=v_company for update;
  if not found then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
  if not private.gridex_support_actor_v1(p_command,true) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  -- Optional OPS resource associations are authoritative only after all graph
  -- predicates are satisfied in this transaction. Client roles cannot supply
  -- these identifiers through the customer API adapters.
  if v_site is not null then
    perform 1 from public.customer_sites s where s.id=v_site and s.company_id=v_company and s.customer_id=v_customer for share;
    if not found then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
  end if;
  if v_point is not null then
    perform 1 from public.metering_points m where m.id=v_point and m.company_id=v_company and m.customer_id=v_customer
      and (v_site is null or m.customer_site_id=v_site) for share;
    if not found then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
  end if;
  if v_case_reference is not null then
    select t.id into v_case_id from public.customer_support_threads t where
      t.company_id=v_company and t.customer_id=v_customer and t.public_reference=v_case_reference;
    if not found then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
  end if;
  if v_op<>'create' then
    -- Resource publication is current policy, including completed replay.
    -- The case lock also serializes the existing publish/revoke RPCs.
    select * into v_case from public.customer_cases where id=v_case_id and company_id=v_company and customer_id=v_customer for update;
    if not found or not (v_case.metadata->>'support_case'='true' or v_case.source like 'tenant\_support\_%' escape '\') then
      raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
    if (v_mode<>'ops' or v_op='customer_message') and not exists(select 1 from public.customer_support_threads t
      where t.id=v_case_id and t.company_id=v_company and t.customer_id=v_customer and t.customer_title is not null) then
      perform 1 from public.customer_case_publications p where p.company_id=v_company and p.customer_id=v_customer
        and p.customer_case_id=v_case_id and p.revoked_at is null for share;
      if not found then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
    end if;
  end if;
  if not private.gridex_support_clock_active_v1(p_command) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  v_scoped_key:=public.canonical_json_sha256(jsonb_build_object('customer',v_customer,'mode',v_mode,
    'actor',v_actor,'client',v_client,'subject',p_command->>'subject','operation',v_op,'key',v_key));
  v_request:=jsonb_build_object('customerId',v_customer,'caseId',v_case_id,'mode',v_mode,'operation',v_op,
    'channel',v_channel,
    'siteId',v_site,'meteringPointId',v_point,
    'actorUserId',v_actor,'clientId',v_client,'subjectHash',public.canonical_json_sha256(coalesce(p_command->'subject','null'::jsonb)),
    'expectedRevision',v_expected,'payloadHash',public.canonical_json_sha256(v_payload));
  select * into v_prior from public.canonical_command_results where company_id=v_company
    and command_type='customer.support.command.v1' and idempotency_key=v_scoped_key;
  if found then
    if v_prior.request_hash<>public.canonical_json_sha256(v_request) then raise exception 'support_idempotency_conflict' using errcode='23505'; end if;
    return v_prior.result_payload||jsonb_build_object('replayed',true);
  end if;
  if v_op='create' then
    if exists(select 1 from public.customer_cases c where c.company_id=v_company and c.customer_id=v_customer
      and c.metadata ? 'support_idempotency_key' and c.metadata->>'support_idempotency_key'=v_key
      and (c.metadata->>'support_case'='true' or c.source like 'tenant\_support\_%' escape '\')) then
      raise exception 'support_legacy_idempotency_requires_review' using errcode='23505';
    end if;
    insert into public.customer_cases(company_id,customer_id,site_id,metering_point_id,case_type,status,priority,title,description,reason_category,source,metadata,created_by,updated_by,support_revision)
    values(v_company,v_customer,v_site,v_point,'other','open',coalesce(v_payload->>'priority','normal'),btrim(v_payload->>'title'),
      case when v_mode='ops' then btrim(v_payload->>'body') else null end,coalesce(v_payload->>'category','support'),'tenant_support_'||v_mode,
      jsonb_build_object('support_case',true,'support_channel',v_channel),v_actor,v_actor,1) returning * into v_case;
    v_case_id:=v_case.id;
  else
    -- Expected user conflicts must not use 40001: PostgREST retries it as a
    -- transient serialization failure rather than returning the conflict.
    if v_case.support_revision<>v_expected then raise exception 'support_revision_conflict' using errcode='PT409'; end if;
    if v_op<>'internal_note' and v_case.status in ('closed','cancelled') then raise exception 'support_case_closed' using errcode='P0001'; end if;
    if v_op='customer_message' and exists(select 1 from public.customer_case_publications p where p.company_id=v_company
      and p.customer_id=v_customer and p.customer_case_id=v_case_id and p.revoked_at is null and p.public_status='closed') then
      raise exception 'support_case_closed' using errcode='P0001'; end if;
    if v_op='status' then
      if (v_case.status='resolved' and v_payload->>'status' not in ('open','closed')) or
        (v_case.status<>'resolved' and v_payload->>'status'='closed') or
        v_case.status in ('billing_blocked','cancelled','closed') then
        raise exception 'support_status_transition_forbidden' using errcode='P0001'; end if;
    end if;
    update public.customer_cases set support_revision=support_revision+1,updated_at=clock_timestamp(),updated_by=v_actor,
      status=case when v_op='status' then v_payload->>'status' else status end,
      resolved_at=case when v_op='status' and v_payload->>'status'='resolved' then clock_timestamp() else resolved_at end,
      closed_at=case when v_op='status' and v_payload->>'status'='closed' then clock_timestamp() else closed_at end
    where id=v_case_id and company_id=v_company and customer_id=v_customer returning * into v_case;
  end if;
  -- Stable exact derivation matches publicReference('case',companyId,id).
  v_reference:='case_'||substr(translate(rtrim(encode(extensions.digest(convert_to('gridex-public-reference:v1:'||v_company::text||':case:'||v_case_id::text,'UTF8'),'sha256'),'base64'),'='),'+/','-_'),1,32);
  insert into public.customer_support_threads(id,company_id,customer_id,public_reference,customer_title)
  values(v_case_id,v_company,v_customer,v_reference,case when v_op='create' and v_mode<>'ops' then btrim(v_payload->>'title') else null end)
  on conflict(id) do nothing;
  v_public:=v_op='customer_message' or (v_op='create' and v_mode<>'ops');
  if v_public and v_mode='ops' and not exists(select 1 from public.customer_support_threads t where t.id=v_case_id and t.customer_title is not null)
    and not exists(select 1 from public.customer_case_publications p where p.company_id=v_company and p.customer_id=v_customer and p.customer_case_id=v_case_id and p.revoked_at is null)
  then raise exception 'support_publication_required' using errcode='22023'; end if;
  if v_op<>'status' then
    insert into public.customer_support_messages(company_id,customer_id,customer_case_id,visibility,author_kind,actor_user_id,api_client_id,channel,caller_verification,body,revision)
    values(v_company,v_customer,v_case_id,case when v_public then 'customer' else 'internal' end,
      case when v_mode='ops' then 'staff' else 'customer' end,v_actor,v_client,v_channel,
      case when v_channel='phone' then 'unverified' else 'not_applicable' end,btrim(v_payload->>'body'),v_case.support_revision)
    returning id into v_message;
  end if;
  select private.gridex_support_customer_status_v1(v_case.status,
    (select p.public_status from public.customer_case_publications p where p.company_id=v_company and p.customer_id=v_customer
      and p.customer_case_id=v_case_id and p.revoked_at is null)) into v_customer_status;
  v_result:=jsonb_build_object('companyId',v_company,'customerId',v_customer,'caseId',v_case_id,'revision',v_case.support_revision,
    'messageId',v_message,'status',v_case.status,'customerStatus',v_customer_status,'replayed',false);
  insert into public.customer_case_events(company_id,customer_id,customer_case_id,event_type,event_status,message,payload,created_by)
  values(v_company,v_customer,v_case_id,'support_'||v_op,'info','Supportåtgärd registrerad.',
    jsonb_build_object('channel',v_channel,'revision',v_case.support_revision,'messageId',v_message,'visibility',case when v_public then 'customer' else 'internal' end,
      'callerVerification',case when v_channel='phone' then 'unverified' else 'not_applicable' end),v_actor);
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,reason,idempotency_key,before_state,after_state,metadata)
  values(v_company,'CUSTOMER_SUPPORT_COMMAND','customer_case',v_case_id,v_case.support_revision,v_actor,'support_'||v_op,v_scoped_key,
    jsonb_build_object('revision',v_expected),jsonb_build_object('revision',v_case.support_revision),
    jsonb_build_object('channel',v_channel,'clientId',v_client,'visibility',case when v_public then 'customer' else 'internal' end,
      'callerVerification',case when v_channel='phone' then 'unverified' else 'not_applicable' end));
  if v_public then
    insert into public.canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
    values(v_company,'CUSTOMER_SUPPORT_MESSAGE','customer_case',v_case_id,v_case.support_revision,v_scoped_key,
      jsonb_build_object('customerId',v_customer,'caseId',v_case_id,'messageId',v_message,'revision',v_case.support_revision),v_actor) returning id into v_event;
    insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
    values(v_company,v_event,'customer.support.changed',v_scoped_key,
      jsonb_build_object('customerId',v_customer,'caseId',v_case_id,'messageId',v_message,'revision',v_case.support_revision));
  end if;
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company,'customer.support.command.v1',v_scoped_key,v_request,v_result,v_actor);
  return v_result;
end
$function$;
revoke all on function public.gridex_support_case_command_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_support_case_command_v1(jsonb) to service_role;

-- Backfill only canonical joins; no old staff title, description or note is
-- copied into a customer title or message.
insert into public.customer_support_threads(id,company_id,customer_id,public_reference,created_at)
select c.id,c.company_id,c.customer_id,
  'case_'||substr(translate(rtrim(encode(extensions.digest(convert_to('gridex-public-reference:v1:'||c.company_id::text||':case:'||c.id::text,'UTF8'),'sha256'),'base64'),'='),'+/','-_'),1,32),c.created_at
from public.customer_cases c where c.metadata->>'support_case'='true' or c.source ~ '^tenant_support_';

-- Customer reads never select the internal case text or staff note body.
-- Relation and current client/session are rechecked inside the same RPC.
create function public.gridex_support_case_read_v1(p_context jsonb,p_query jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_company uuid := (p_context->>'companyId')::uuid;
  v_customer uuid := (p_context->>'customerId')::uuid;
  v_reference text := p_query->>'reference';
  v_limit integer := coalesce((p_query->>'limit')::integer,25);
  v_before timestamptz := nullif(p_query->>'before','')::timestamptz;
  v_before_id uuid := nullif(p_query->>'beforeId','')::uuid;
  v_case uuid;
  v_case_row jsonb;
  v_rows jsonb;
begin
  if current_user<>'service_role' then raise exception 'support_service_required' using errcode='42501'; end if;
  if p_context is null or jsonb_typeof(p_context)<>'object' or
    exists(select 1 from jsonb_object_keys(p_context) k(key) where key not in ('companyId','customerId','mode','actorUserId','sessionId','clientId','subject'))
    or p_query is null or jsonb_typeof(p_query)<>'object' or
    exists(select 1 from jsonb_object_keys(p_query) k(key) where key not in ('reference','limit','before','beforeId'))
    or v_limit not between 1 and 101 or (v_before is null)<>(v_before_id is null)
    or (v_reference is not null and v_reference !~ '^case_[A-Za-z0-9_-]{32}$') then
    raise exception 'invalid_support_command' using errcode='22023'; end if;
  if not private.gridex_support_actor_v1(p_context,false) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  if v_reference is not null then
    select t.id into v_case from public.customer_support_threads t
      where t.company_id=v_company and t.customer_id=v_customer and t.public_reference=v_reference
      and (t.customer_title is not null or exists(select 1 from public.customer_case_publications p
        where p.company_id=v_company and p.customer_id=v_customer and p.customer_case_id=t.id and p.revoked_at is null));
    if not found then raise exception 'support_resource_unavailable' using errcode='P0002'; end if;
    select jsonb_build_object('id',t.id,'case_reference',t.public_reference,'revision',c.support_revision,
      'title',coalesce(p.public_title,t.customer_title),'status',private.gridex_support_customer_status_v1(c.status,p.public_status),
      'created_at',t.created_at,'updated_at',c.updated_at) into v_case_row
    from public.customer_support_threads t join public.customer_cases c on c.id=t.id and c.company_id=t.company_id and c.customer_id=t.customer_id
    left join public.customer_case_publications p on p.customer_case_id=t.id and p.company_id=t.company_id and p.customer_id=t.customer_id and p.revoked_at is null
    where t.id=v_case and t.company_id=v_company and t.customer_id=v_customer;
    select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]'::jsonb) into v_rows from (
      select m.id,m.body,m.author_kind,m.channel,m.revision,m.created_at from public.customer_support_messages m
      where m.company_id=v_company and m.customer_id=v_customer and m.customer_case_id=v_case and m.visibility='customer'
      and (m.publication_id is null or exists(select 1 from public.customer_case_publications p where p.id=m.publication_id
        and p.company_id=m.company_id and p.customer_id=m.customer_id and p.customer_case_id=m.customer_case_id and p.revoked_at is null))
      and (v_before is null or (m.created_at,m.id)<(v_before,v_before_id))
      order by m.created_at desc,m.id desc limit v_limit
    ) r;
    if not private.gridex_support_clock_active_v1(p_context) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
    return jsonb_build_object('caseId',v_case,'case',v_case_row,'items',v_rows);
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]'::jsonb) into v_rows from (
    select t.id,t.public_reference as case_reference,c.support_revision as revision,
      coalesce(p.public_title,t.customer_title) as title,
      private.gridex_support_customer_status_v1(c.status,p.public_status) as status,
      t.created_at,c.updated_at
    from public.customer_support_threads t join public.customer_cases c
      on c.id=t.id and c.company_id=t.company_id and c.customer_id=t.customer_id
    left join public.customer_case_publications p on p.customer_case_id=t.id
      and p.company_id=t.company_id and p.customer_id=t.customer_id and p.revoked_at is null
    where t.company_id=v_company and t.customer_id=v_customer and (t.customer_title is not null or p.id is not null)
      and (v_before is null or (t.created_at,t.id)<(v_before,v_before_id))
    order by t.created_at desc,t.id desc limit v_limit
  ) r;
  if not private.gridex_support_clock_active_v1(p_context) then raise exception 'support_actor_forbidden' using errcode='42501'; end if;
  return jsonb_build_object('items',v_rows);
end
$function$;
revoke all on function public.gridex_support_case_read_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_support_case_read_v1(jsonb,jsonb) to service_role;

commit;
