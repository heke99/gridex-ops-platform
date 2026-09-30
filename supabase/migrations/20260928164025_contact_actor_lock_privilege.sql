-- Forward repair: service_role has no row-lock privilege on auth.users.
-- A definer helper holds the auth row lock in the caller's transaction while
-- keeping auth.users grants and the public command's invoker role unchanged.
begin;

create or replace function private.gridex_contact_actor_active_v1(p_actor_user_id uuid)
returns boolean language plpgsql volatile security definer
set search_path = pg_catalog as $helper$
begin
  perform 1 from auth.users u where u.id=p_actor_user_id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
  return found;
end;
$helper$;
revoke all on function private.gridex_contact_actor_active_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.gridex_contact_actor_active_v1(uuid)
  to service_role;

create or replace function public.gridex_change_customer_contact_v1(p_command jsonb)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog as $function$
declare
  v_company_id uuid := nullif(p_command->>'companyId','')::uuid;
  v_customer_id uuid := nullif(p_command->>'customerId','')::uuid;
  v_actor_id uuid := nullif(p_command->>'actorUserId','')::uuid;
  v_client_id uuid := nullif(p_command->>'clientId','')::uuid;
  v_subject text := nullif(p_command->>'subject','');
  v_mode text := p_command->>'mode';
  v_reason text := nullif(btrim(p_command->>'reason'),'');
  v_key text := p_command->>'idempotencyKey';
  v_expected bigint := (p_command->>'expectedRevision')::bigint;
  v_changes jsonb := p_command->'changes';
  v_customer public.customers%rowtype;
  v_primary public.customer_contacts%rowtype;
  v_primary_count integer;
  v_email text;
  v_phone text;
  v_contact_name text;
  v_contact_title text;
  v_selected_contact_id uuid := nullif(p_command->>'contactId','')::uuid;
  v_request jsonb;
  v_existing public.canonical_command_results%rowtype;
  v_result jsonb;
  v_changed boolean;
  v_contact_id uuid;
  v_event_id uuid;
  v_completion public.customer_portal_completions%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception 'contact_service_required' using errcode='42501';
  end if;
  if p_command is null or jsonb_typeof(p_command) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_command) as k(key)
       where k.key not in ('companyId','customerId','contactId','actorUserId','clientId','subject',
         'mode','reason','idempotencyKey','expectedRevision','changes'))
     or v_company_id is null or v_customer_id is null
     or v_mode is null or v_mode not in ('ops','api')
     or v_expected is null or v_expected < 0 or v_key is null
     or v_key !~ '^[A-Za-z0-9._:+~-]{8,200}$'
     or v_changes is null or jsonb_typeof(v_changes) <> 'object' or v_changes = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(v_changes) as k(key)
       where k.key not in ('email','phone','name','title'))
  then raise exception 'invalid_contact_command' using errcode='22023'; end if;

  -- Lock both the resource and the authorization relationship during the
  -- command. The API assertion signature and issuer binding are verified by
  -- the server before this service-only RPC; this DB check is an additional
  -- current-link/revocation boundary and cannot replace that signature check.
  select * into v_customer from public.customers
  where id=v_customer_id and company_id=v_company_id for update;
  if not found or v_customer.status='archived' or v_customer.archived_at is not null then
    raise exception 'contact_customer_unavailable' using errcode='42501';
  end if;
  perform 1 from public.companies c where c.id=v_company_id
    and c.is_active and c.status='active' for share;
  if not found then
    raise exception 'contact_tenant_unavailable' using errcode='42501';
  end if;
  if v_mode='ops' then
    if v_actor_id is null or v_client_id is not null or v_subject is not null
      or v_reason is null or length(v_reason)>200 then
      raise exception 'contact_actor_forbidden' using errcode='42501';
    end if;
    if not private.gridex_contact_actor_active_v1(v_actor_id) then
      raise exception 'contact_actor_forbidden' using errcode='42501';
    end if;
    perform 1 from public.company_memberships m
      where m.company_id=v_company_id and m.user_id=v_actor_id
        and m.is_active and m.status='active' for share;
    if not found or not coalesce(public.gridex_actor_has_company_permission(
        v_actor_id,v_company_id,'masterdata.write'),false) then
      raise exception 'contact_actor_forbidden' using errcode='42501';
    end if;
  else
    if v_actor_id is not null or v_client_id is null or v_subject is null
      or v_selected_contact_id is not null
      or v_changes ? 'name' or v_changes ? 'title'
      or length(v_subject)>255 or v_reason is not null then
      raise exception 'contact_delegation_forbidden' using errcode='42501';
    end if;
    perform 1 from public.integration_api_clients c
      where c.id=v_client_id and c.company_id=v_company_id
        and c.status='active' and c.revoked_at is null and c.deleted_at is null
        and (c.expires_at is null or c.expires_at>clock_timestamp())
        and c.scopes && array['customer_contact.write','customer_portal.write','*']::text[]
      for share;
    if not found then raise exception 'contact_delegation_forbidden' using errcode='42501'; end if;
    perform 1 from public.customer_portal_accounts a
      where a.company_id=v_company_id and a.customer_id=v_customer_id
        and a.status='active' and a.is_active
        and (a.portal_user_id::text=v_subject or a.user_id::text=v_subject
          or a.external_account_id=v_subject) for share;
    if not found then raise exception 'contact_delegation_forbidden' using errcode='42501'; end if;
  end if;

  -- The stored request has only hashes and identifiers, never raw contact
  -- details or an assertion. A collision across customers/actors is a conflict.
  v_request:=jsonb_build_object('companyId',v_company_id,'customerId',v_customer_id,
    'mode',v_mode,'actorId',v_actor_id,'clientId',v_client_id,
    'contactId',v_selected_contact_id,
    'subjectHash',case when v_subject is null then null else public.canonical_json_sha256(to_jsonb(v_subject)) end,
    'expectedRevision',v_expected,'changesHash',public.canonical_json_sha256(v_changes));
  select * into v_existing from public.canonical_command_results
  where company_id=v_company_id and command_type='customer.contact.change.v1'
    and idempotency_key=v_key;
  if found then
    if v_existing.request_hash<>public.canonical_json_sha256(v_request) then
      raise exception 'contact_idempotency_conflict' using errcode='23505';
    end if;
    return v_existing.result_payload||jsonb_build_object('replayed',true);
  end if;
  if v_customer.contact_revision<>v_expected then
    raise exception 'contact_revision_conflict' using errcode='P0001';
  end if;

  if exists (select 1 from jsonb_each(v_changes) as e(key,value)
    where e.value<>'null'::jsonb and jsonb_typeof(e.value)<>'string')
    or exists (select 1 from jsonb_each(v_changes) as e(key,value)
      where e.key='email' and e.value<>'null'::jsonb
        and (length(btrim(e.value#>>'{}')) not between 3 and 320
          or btrim(e.value#>>'{}') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
    or exists (select 1 from jsonb_each(v_changes) as e(key,value)
      where e.key='phone' and e.value<>'null'::jsonb
        and length(btrim(e.value#>>'{}')) not between 1 and 50)
    or exists (select 1 from jsonb_each(v_changes) as e(key,value)
      where e.key='name' and e.value<>'null'::jsonb
        and length(btrim(e.value#>>'{}')) not between 1 and 240)
    or exists (select 1 from jsonb_each(v_changes) as e(key,value)
      where e.key='title' and e.value<>'null'::jsonb
        and length(btrim(e.value#>>'{}')) > 120)
  then raise exception 'invalid_contact_field' using errcode='22023'; end if;

  v_email:=case when v_changes ? 'email' then nullif(lower(btrim(v_changes->>'email')),'') else v_customer.email end;
  v_phone:=case when v_changes ? 'phone' then nullif(btrim(v_changes->>'phone'),'') else v_customer.phone end;
  if v_email is null and v_phone is null then
    raise exception 'contact_method_required' using errcode='22023';
  end if;
  select count(*) into v_primary_count from public.customer_contacts
    where company_id=v_company_id and customer_id=v_customer_id and is_primary;
  if v_primary_count>1 or exists(select 1 from public.customer_contacts
    where customer_id=v_customer_id and is_primary
      and company_id is distinct from v_company_id) then
    raise exception 'ambiguous_primary_contact' using errcode='23514';
  end if;
  select * into v_primary from public.customer_contacts
    where company_id=v_company_id and customer_id=v_customer_id and is_primary for update;
  if v_mode='ops' and v_selected_contact_id is distinct from v_primary.id then
    raise exception 'contact_selection_conflict' using errcode='P0001';
  end if;
  v_contact_name:=case when v_changes ? 'name'
    then nullif(btrim(v_changes->>'name'),'')
    else coalesce(v_primary.name,
      nullif(btrim(concat_ws(' ',v_customer.first_name,v_customer.last_name)),''))
    end;
  v_contact_title:=case when v_changes ? 'title'
    then nullif(btrim(v_changes->>'title'),'')
    else v_primary.title end;
  if v_customer.customer_type in ('business','association') and v_contact_name is null then
    raise exception 'contact_name_required' using errcode='22023';
  end if;
  v_changed:=v_customer.email is distinct from v_email
    or v_customer.phone is distinct from v_phone
    or v_primary.id is null
    or v_primary.email is distinct from v_email
    or v_primary.phone is distinct from v_phone
    or v_primary.name is distinct from v_contact_name
    or v_primary.title is distinct from v_contact_title;

  if v_changed then
    update public.customers set
      email=v_email,phone=v_phone,
      contact_revision=contact_revision+1,updated_at=clock_timestamp(),updated_by=v_actor_id
    where id=v_customer_id and company_id=v_company_id;
    if v_primary.id is null then
      insert into public.customer_contacts(company_id,customer_id,type,is_primary,
        name,title,email,phone,created_by,updated_by)
      values(v_company_id,v_customer_id,'primary',true,v_contact_name,v_contact_title,v_email,v_phone,v_actor_id,v_actor_id)
      returning id into v_contact_id;
    else
      update public.customer_contacts set
        name=v_contact_name,title=v_contact_title,email=v_email,phone=v_phone,
        updated_by=v_actor_id,updated_at=clock_timestamp()
      where id=v_primary.id and company_id=v_company_id and customer_id=v_customer_id;
      v_contact_id:=v_primary.id;
    end if;
  else
    v_contact_id:=v_primary.id;
  end if;

  v_result:=jsonb_build_object('companyId',v_company_id,'customerId',v_customer_id,
    'contactId',v_contact_id,'revision',v_expected+case when v_changed then 1 else 0 end,
    'changed',v_changed,'replayed',false);
  if v_mode='api' then
    insert into public.customer_portal_completions(company_id,customer_id,api_client_id,
      completion_type,status,submitted_payload,result_payload,idempotency_key,request_hash)
    values(v_company_id,v_customer_id,v_client_id,'profile_update','accepted',
      jsonb_build_object('contactFieldsHash',public.canonical_json_sha256(v_changes)),
      v_result,v_key,public.canonical_json_sha256(v_request))
    returning * into v_completion;
    v_result:=v_result||jsonb_build_object('completionReference',v_completion.completion_reference,
      'createdAt',v_completion.created_at);
  end if;
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,
    state_version,actor_user_id,reason,idempotency_key,before_state,after_state,metadata)
  values(v_company_id,'CUSTOMER_CONTACT_COMMAND','customer',v_customer_id,
    (v_result->>'revision')::bigint,v_actor_id,coalesce(v_reason,'delegated_customer'),v_key,
    jsonb_build_object('revision',v_expected),jsonb_build_object('revision',v_result->'revision'),
    jsonb_build_object('mode',v_mode,'clientId',v_client_id,'changed',v_changed));
  if v_changed then
    insert into public.canonical_domain_events(company_id,event_type,aggregate_type,
      aggregate_id,aggregate_version,idempotency_key,payload,created_by)
    values(v_company_id,'CUSTOMER_CONTACT_CHANGED','customer',v_customer_id,
      (v_result->>'revision')::bigint,v_key,
      jsonb_build_object('customerId',v_customer_id,'revision',v_result->'revision'),v_actor_id)
    returning id into v_event_id;
    insert into public.canonical_event_outbox(company_id,domain_event_id,topic,
      idempotency_key,payload)
    values(v_company_id,v_event_id,'customer.contact.changed',v_key,
      jsonb_build_object('customerId',v_customer_id,'revision',v_result->'revision'));
  end if;
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,
    request_payload,result_payload,actor_user_id)
  values(v_company_id,'customer.contact.change.v1',v_key,v_request,v_result,v_actor_id);
  return v_result;
end;
$function$;

-- Preserve the service-only Data API boundary after replacing the function.
revoke all on function public.gridex_change_customer_contact_v1(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.gridex_change_customer_contact_v1(jsonb) to service_role;
commit;
