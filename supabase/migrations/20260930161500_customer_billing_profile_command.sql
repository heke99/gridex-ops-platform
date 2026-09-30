-- Additive billing defaults, explicit overrides and revision-bound snapshots.
-- Existing populated contract fields are copies, not evidence of inheritance.
begin;

alter table public.customers
  add column if not exists invoice_email text,
  add column billing_profile jsonb not null default '{}'::jsonb check (jsonb_typeof(billing_profile)='object'),
  add column billing_profile_revision bigint not null default 0 check (billing_profile_revision>=0);
-- The canonical profile permits an explicit unset country. Its legacy
-- projection must preserve null instead of inventing a Swedish destination.
alter table public.customers alter column billing_country drop not null;
alter table public.customer_contracts
  add column billing_profile_override jsonb not null default '{}'::jsonb check (jsonb_typeof(billing_profile_override)='object'),
  add column billing_profile_override_revision bigint not null default 0 check (billing_profile_override_revision>=0);

-- Preserve an explicit legacy destination. A destination's presence is not a
-- channel choice: leave distributionMethod absent so the resolver keeps the
-- configured tenant method. New customer inserts use this same initializer.
-- No customer.email, portal identity or signed/issued artifact is used/changed.
create function private.gridex_billing_default_from_legacy_v1(p_customer jsonb)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $initial$
  select jsonb_strip_nulls(jsonb_build_object(
    'recipient',coalesce(nullif(btrim(p_customer->>'company_name'),''),nullif(btrim(p_customer->>'full_name'),'')),
    'email',nullif(lower(btrim(p_customer->>'invoice_email')),''),
    'street',nullif(btrim(p_customer->>'billing_street'),''),
    'postalCode',nullif(btrim(p_customer->>'billing_postal_code'),''),
    'city',nullif(btrim(p_customer->>'billing_city'),''),
    'country',nullif(btrim(p_customer->>'billing_country'),'')));
$initial$;
revoke all on function private.gridex_billing_default_from_legacy_v1(jsonb) from public,anon,authenticated;
grant execute on function private.gridex_billing_default_from_legacy_v1(jsonb) to service_role;

update public.customers c set billing_profile=private.gridex_billing_default_from_legacy_v1(to_jsonb(c));
update public.customer_contracts set billing_profile_override=jsonb_strip_nulls(jsonb_build_object(
  'recipient',nullif(btrim(invoice_recipient),''),'email',nullif(lower(btrim(invoice_email)),''),
  'reference',nullif(btrim(invoice_reference),''),'street',nullif(btrim(billing_street),''),
  'postalCode',nullif(btrim(billing_postal_code),''),'city',nullif(btrim(billing_city),''),
  'country',nullif(btrim(billing_country),'')));
comment on column public.customer_contracts.billing_profile_override is
  'Per-field explicit override. Missing key inherits; JSON null clears. Legacy copies stay explicit even if equal to default. Review intent before removing any copied key.';
comment on column public.customers.billing_profile is
  'Explicit billing defaults, independent of contact, login and legal identity. No automatic fallback to customers.email.';

create function private.gridex_billing_profile_fields_valid_v1(p_fields jsonb)
returns boolean language sql immutable security invoker set search_path=pg_catalog as $sql$
  select p_fields is not null and jsonb_typeof(p_fields)='object'
    and not exists(select 1 from jsonb_each(p_fields) e
      where e.key not in ('recipient','distributionMethod','email','reference','street','postalCode','city','country')
        or (e.value<>'null'::jsonb and jsonb_typeof(e.value)<>'string')
        or (e.value<>'null'::jsonb and length(btrim(e.value#>>'{}'))>320)
        or (e.key='email' and e.value<>'null'::jsonb and btrim(e.value#>>'{}') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
        or (e.key='distributionMethod' and e.value<>'null'::jsonb and e.value#>>'{}' not in ('email','paper','e_invoice','direct_debit'))
        or (e.key='country' and e.value<>'null'::jsonb and e.value#>>'{}' !~ '^[A-Z]{2}$'));
$sql$;
revoke all on function private.gridex_billing_profile_fields_valid_v1(jsonb) from public,anon,authenticated;
grant execute on function private.gridex_billing_profile_fields_valid_v1(jsonb) to service_role;

-- New inserts preserve the existing explicit initialization interface. UPDATE
-- callers must use the command; old service writers fail closed, not silently
-- mutate a profile outside its revision/audit/outbox transaction.
create function private.gridex_billing_profile_write_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $guard$
declare v_before jsonb; v_after jsonb;
begin
  if tg_table_name='customers' then
    if tg_op='INSERT' then
      if new.billing_profile='{}'::jsonb then
        new.billing_profile:=private.gridex_billing_default_from_legacy_v1(to_jsonb(new));
      end if;
      new.billing_profile_revision:=0;
    else
      v_before:=jsonb_build_array(old.billing_profile,old.invoice_email,old.billing_street,old.billing_postal_code,old.billing_city,old.billing_country);
      v_after:=jsonb_build_array(new.billing_profile,new.invoice_email,new.billing_street,new.billing_postal_code,new.billing_city,new.billing_country);
      if v_before is distinct from v_after and (current_user<>'service_role'
          or coalesce(current_setting('gridex.billing_profile_command',true),'')<>'on') then
        raise exception 'billing_profile_command_required' using errcode='42501';
      end if;
      new.billing_profile_revision:=old.billing_profile_revision+case when v_before is distinct from v_after then 1 else 0 end;
    end if;
  else
    if tg_op='INSERT' then
      if new.billing_profile_override='{}'::jsonb then
        new.billing_profile_override:=jsonb_strip_nulls(jsonb_build_object(
          'recipient',nullif(btrim(new.invoice_recipient),''),'email',nullif(lower(btrim(new.invoice_email)),''),
          'reference',nullif(btrim(new.invoice_reference),''),'street',nullif(btrim(new.billing_street),''),
          'postalCode',nullif(btrim(new.billing_postal_code),''),'city',nullif(btrim(new.billing_city),''),
          'country',nullif(btrim(new.billing_country),'')));
      end if;
      new.billing_profile_override_revision:=0;
    else
      v_before:=jsonb_build_array(old.billing_profile_override,old.invoice_recipient,old.invoice_email,old.invoice_reference,
        old.billing_street,old.billing_postal_code,old.billing_city,old.billing_country,old.billing_address_same_as_site);
      v_after:=jsonb_build_array(new.billing_profile_override,new.invoice_recipient,new.invoice_email,new.invoice_reference,
        new.billing_street,new.billing_postal_code,new.billing_city,new.billing_country,new.billing_address_same_as_site);
      if v_before is distinct from v_after and (current_user<>'service_role'
          or coalesce(current_setting('gridex.billing_profile_command',true),'')<>'on') then
        raise exception 'billing_profile_command_required' using errcode='42501';
      end if;
      new.billing_profile_override_revision:=old.billing_profile_override_revision+case when v_before is distinct from v_after then 1 else 0 end;
    end if;
  end if;
  return new;
end;
$guard$;
revoke all on function private.gridex_billing_profile_write_guard_v1() from public,anon,authenticated;
create trigger customer_billing_profile_command_guard before insert or update on public.customers
  for each row execute function private.gridex_billing_profile_write_guard_v1();
create trigger contract_billing_profile_command_guard before insert or update on public.customer_contracts
  for each row execute function private.gridex_billing_profile_write_guard_v1();

-- Earlier authority locks stabilize rows, but a unique-index/audit wait can
-- cross a session or client wall-clock expiry. Recheck immediately before
-- returning either a stored result or a newly completed atomic command.
create function private.gridex_billing_profile_current_clock_v1(
  p_mode text,p_actor uuid,p_session uuid,p_client uuid,p_company uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $clock$
begin
  if current_user<>'service_role' then
    raise exception 'billing_profile_service_required' using errcode='42501'; end if;
  if p_mode='ops' then
    if p_actor is null or p_session is null or not private.gridex_support_session_active_v1(p_actor,p_session) then
      raise exception 'billing_profile_actor_forbidden' using errcode='42501'; end if;
  elsif p_mode='api' then
    perform 1 from public.integration_api_clients c where c.id=p_client and c.company_id=p_company
      and c.status='active' and c.revoked_at is null and c.deleted_at is null
      and (c.expires_at is null or c.expires_at>clock_timestamp());
    if not found then raise exception 'billing_profile_delegation_forbidden' using errcode='42501'; end if;
  else
    raise exception 'invalid_billing_profile_command' using errcode='22023';
  end if;
end;
$clock$;
revoke all on function private.gridex_billing_profile_current_clock_v1(text,uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.gridex_billing_profile_current_clock_v1(text,uuid,uuid,uuid,uuid) to service_role;

create function public.gridex_change_customer_billing_profile_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $command$
declare
  v_company uuid:=nullif(p_command->>'companyId','')::uuid;
  v_customer_id uuid:=nullif(p_command->>'customerId','')::uuid;
  v_actor uuid:=nullif(p_command->>'actorUserId','')::uuid;
  v_session uuid:=nullif(p_command->>'sessionId','')::uuid;
  v_client uuid:=nullif(p_command->>'clientId','')::uuid;
  v_subject text:=nullif(p_command->>'subject','');
  v_mode text:=p_command->>'mode';
  v_reason text:=nullif(btrim(p_command->>'reason'),'');
  v_key text:=p_command->>'idempotencyKey';
  v_expected bigint:=(p_command->>'expectedRevision')::bigint;
  v_changes jsonb:=p_command->'changes';
  v_customer public.customers%rowtype;
  v_existing public.canonical_command_results%rowtype;
  v_request jsonb; v_profile jsonb; v_result jsonb; v_changed boolean; v_event uuid;
  v_affected jsonb; v_completion public.customer_portal_completions%rowtype;
  v_identity public.customer_portal_identities%rowtype; v_identity_count integer:=0;
  v_contract_id uuid:=nullif(p_command->>'contractId','')::uuid;
  v_override_expected bigint:=(p_command->>'expectedOverrideRevision')::bigint;
  v_inherit jsonb:=coalesce(p_command->'inheritFields','[]'::jsonb);
  v_contract public.customer_contracts%rowtype;
  v_command_type text:=case when nullif(p_command->>'contractId','') is null then 'customer.billing_profile.change.v1' else 'customer.billing_override.change.v1' end;
  v_state_revision bigint; v_aggregate_type text; v_aggregate_id uuid;
begin
  if current_user<>'service_role' then raise exception 'billing_profile_service_required' using errcode='42501'; end if;
  if p_command is null or jsonb_typeof(p_command)<>'object'
    or exists(select 1 from jsonb_object_keys(p_command) k(key) where k.key not in
      ('companyId','customerId','actorUserId','sessionId','clientId','subject','mode','reason','idempotencyKey','expectedRevision','changes','contractId','expectedOverrideRevision','inheritFields'))
    or v_company is null or v_customer_id is null or v_mode is null or v_mode not in ('ops','api')
    or v_expected is null or v_expected<0 or v_key is null or v_key !~ '^[A-Za-z0-9._:+~-]{8,200}$'
    or v_changes is null or (v_changes='{}'::jsonb and v_inherit='[]'::jsonb)
    or not private.gridex_billing_profile_fields_valid_v1(v_changes)
    or jsonb_typeof(v_inherit)<>'array'
    or exists(select 1 from jsonb_array_elements(v_inherit) e(value) where jsonb_typeof(e.value)<>'string'
      or e.value#>>'{}' not in ('recipient','distributionMethod','email','reference','street','postalCode','city','country')
      or v_changes ? (e.value#>>'{}'))
    or (v_contract_id is null and (v_override_expected is not null or v_inherit<>'[]'::jsonb))
    or (v_contract_id is not null and (v_override_expected is null or v_override_expected<0)) then
    raise exception 'invalid_billing_profile_command' using errcode='22023';
  end if;
  select * into v_customer from public.customers where company_id=v_company and id=v_customer_id for update;
  if not found or v_customer.status='archived' or v_customer.archived_at is not null then
    raise exception 'billing_profile_customer_unavailable' using errcode='42501'; end if;
  perform 1 from public.companies where id=v_company and is_active and status='active' for share;
  if not found then raise exception 'billing_profile_tenant_unavailable' using errcode='42501'; end if;
  if v_mode='ops' then
    if v_actor is null or v_client is not null or v_subject is not null or v_reason is null or length(v_reason)>200
      or not private.gridex_support_session_active_v1(v_actor,v_session) then
      raise exception 'billing_profile_actor_forbidden' using errcode='42501'; end if;
    perform 1 from public.user_profiles where id=v_actor and user_status='active' for share;
    if not found then raise exception 'billing_profile_actor_forbidden' using errcode='42501'; end if;
    perform 1 from public.company_memberships where company_id=v_company and user_id=v_actor and is_active and status='active' for share;
    if not found then raise exception 'billing_profile_actor_forbidden' using errcode='42501'; end if;
    perform private.gridex_profile_authority_lock_v1(v_actor,v_company);
    if not private.gridex_support_session_active_v1(v_actor,v_session)
      or not coalesce(public.gridex_actor_has_company_permission(v_actor,v_company,'masterdata.write'),false) then
      raise exception 'billing_profile_actor_forbidden' using errcode='42501'; end if;
  else
    if v_actor is not null or v_session is not null or v_contract_id is not null or v_client is null or v_subject is null or length(v_subject)>255 or v_reason is not null then
      raise exception 'billing_profile_delegation_forbidden' using errcode='42501'; end if;
    perform 1 from public.integration_api_clients where id=v_client and company_id=v_company and status='active'
      and revoked_at is null and deleted_at is null and (expires_at is null or expires_at>clock_timestamp())
      and scopes && array['customer_billing.write','*']::text[] for share;
    if not found then raise exception 'billing_profile_delegation_forbidden' using errcode='42501'; end if;
    -- Portal contact/read roles are not proof of an economic mandate. Only a
    -- current owner relation is supported until a real delegated mandate exists.
    perform 1 from public.customer_portal_accounts where company_id=v_company and customer_id=v_customer_id
      and status='active' and is_active and role='owner'
      and (portal_user_id::text=v_subject or (portal_user_id is null and (user_id::text=v_subject or external_account_id=v_subject))) for share;
    if not found then raise exception 'billing_profile_delegation_forbidden' using errcode='42501'; end if;
    for v_identity in select * from public.customer_portal_identities where company_id=v_company and customer_id=v_customer_id
      and (auth_user_id::text=v_subject or customer_portal_user_id::text=v_subject or external_account_id=v_subject) order by id for share
    loop
      v_identity_count:=v_identity_count+1;
      if v_identity.status<>'active' or v_identity_count>1 then
        raise exception 'billing_profile_delegation_forbidden' using errcode='42501'; end if;
    end loop;
    -- The clock can advance while customer/identity locks are being acquired.
    perform 1 from public.integration_api_clients where id=v_client and company_id=v_company
      and status='active' and revoked_at is null and deleted_at is null
      and (expires_at is null or expires_at>clock_timestamp())
      and scopes && array['customer_billing.write','*']::text[];
    if not found then raise exception 'billing_profile_delegation_forbidden' using errcode='42501'; end if;
  end if;
  -- Completed commands still require the selected contract's current
  -- customer/tenant ownership. A saved revision is not a present mandate.
  if v_contract_id is not null then
    select * into v_contract from public.customer_contracts where company_id=v_company and customer_id=v_customer_id
      and id=v_contract_id for update;
    if not found then raise exception 'billing_profile_customer_unavailable' using errcode='42501'; end if;
    if not private.gridex_support_session_active_v1(v_actor,v_session) then
      raise exception 'billing_profile_actor_forbidden' using errcode='42501'; end if;
  end if;
  v_request:=jsonb_build_object('companyId',v_company,'customerId',v_customer_id,'mode',v_mode,
    'actorId',v_actor,'clientId',v_client,'subjectHash',case when v_subject is null then null else public.canonical_json_sha256(to_jsonb(v_subject)) end,
    'expectedRevision',v_expected,'contractId',v_contract_id,'expectedOverrideRevision',v_override_expected,
    'inheritHash',public.canonical_json_sha256(v_inherit),'changesHash',public.canonical_json_sha256(v_changes));
  select * into v_existing from public.canonical_command_results where company_id=v_company
    and command_type=v_command_type and idempotency_key=v_key;
  if not found and v_mode='api' and exists(select 1 from public.customer_portal_completions
    where company_id=v_company and api_client_id=v_client and idempotency_key=v_key) then
    -- The profile route supports one contact OR billing command per request.
    -- Reusing a contact completion key is a conflict, not a late false 503.
    raise exception 'billing_profile_idempotency_conflict' using errcode='23505';
  end if;
  if found then
    if v_existing.request_hash<>public.canonical_json_sha256(v_request) then
      raise exception 'billing_profile_idempotency_conflict' using errcode='23505'; end if;
    perform private.gridex_billing_profile_current_clock_v1(v_mode,v_actor,v_session,v_client,v_company);
    return v_existing.result_payload||jsonb_build_object('replayed',true);
  end if;
  if v_customer.billing_profile_revision<>v_expected then
    raise exception 'billing_profile_revision_conflict' using errcode='P0001'; end if;
  select coalesce(jsonb_object_agg(e.key,case when e.value='null'::jsonb then e.value
    when e.key='email' then to_jsonb(lower(btrim(e.value#>>'{}'))) else to_jsonb(btrim(e.value#>>'{}')) end)
    ,'{}'::jsonb) into v_changes from jsonb_each(v_changes) e;
  if v_contract_id is null then
    v_profile:=v_customer.billing_profile||v_changes;
    v_changed:=v_profile is distinct from v_customer.billing_profile;
  -- Stable customer -> contracts lock order also used by snapshot locking.
  perform 1 from public.customer_contracts where company_id=v_company and customer_id=v_customer_id order by id for share;
  if v_mode='ops' and not private.gridex_support_session_active_v1(v_actor,v_session) then
    raise exception 'billing_profile_actor_forbidden' using errcode='42501'; end if;
  if v_mode='api' and not exists(select 1 from public.integration_api_clients where id=v_client
    and company_id=v_company and status='active' and revoked_at is null and deleted_at is null
    and (expires_at is null or expires_at>clock_timestamp())) then
    raise exception 'billing_profile_delegation_forbidden' using errcode='42501'; end if;
  select coalesce(jsonb_agg(c.id order by c.id),'[]'::jsonb) into v_affected
    from public.customer_contracts c where c.company_id=v_company and c.customer_id=v_customer_id
    and exists(select 1 from jsonb_object_keys(v_changes) k(key) where not (c.billing_profile_override ? k.key)
      and (v_customer.billing_profile->k.key) is distinct from (v_profile->k.key));
  if v_changed then
    perform set_config('gridex.billing_profile_command','on',true);
    update public.customers set billing_profile=v_profile,invoice_email=v_profile->>'email',
      billing_street=v_profile->>'street',billing_postal_code=v_profile->>'postalCode',billing_city=v_profile->>'city',billing_country=v_profile->>'country',
      updated_at=clock_timestamp(),updated_by=v_actor where company_id=v_company and id=v_customer_id
      returning * into v_customer;
    perform set_config('gridex.billing_profile_command','off',true);
  end if;
    v_state_revision:=v_customer.billing_profile_revision; v_aggregate_type:='customer'; v_aggregate_id:=v_customer_id;
  else
    if v_contract.billing_profile_override_revision<>v_override_expected then
      raise exception 'billing_profile_revision_conflict' using errcode='P0001'; end if;
    if not private.gridex_support_session_active_v1(v_actor,v_session) then
      raise exception 'billing_profile_actor_forbidden' using errcode='42501'; end if;
    v_profile:=(v_contract.billing_profile_override||v_changes)-array(select jsonb_array_elements_text(v_inherit));
    v_changed:=v_profile is distinct from v_contract.billing_profile_override;
    v_affected:=case when v_changed then jsonb_build_array(v_contract_id) else '[]'::jsonb end;
    if v_changed then
      perform set_config('gridex.billing_profile_command','on',true);
      update public.customer_contracts set billing_profile_override=v_profile,invoice_recipient=v_profile->>'recipient',
        invoice_email=v_profile->>'email',invoice_reference=v_profile->>'reference',billing_street=v_profile->>'street',
        billing_postal_code=v_profile->>'postalCode',billing_city=v_profile->>'city',billing_country=v_profile->>'country',
        updated_at=clock_timestamp(),updated_by=v_actor where company_id=v_company and id=v_contract_id returning * into v_contract;
      perform set_config('gridex.billing_profile_command','off',true);
    end if;
    v_state_revision:=v_contract.billing_profile_override_revision; v_aggregate_type:='customer_contract'; v_aggregate_id:=v_contract_id;
  end if;
  v_result:=jsonb_build_object('companyId',v_company,'customerId',v_customer_id,'revision',v_customer.billing_profile_revision,
    'changed',v_changed,'replayed',false,'affectedContractIds',v_affected);
  if v_contract_id is not null then v_result:=v_result||jsonb_build_object('contractOverrideRevision',v_state_revision); end if;
  if v_mode='api' then
    insert into public.customer_portal_completions(company_id,customer_id,api_client_id,completion_type,status,
      submitted_payload,result_payload,idempotency_key,request_hash)
    values(v_company,v_customer_id,v_client,'profile_update','accepted',
      jsonb_build_object('billingFieldsHash',public.canonical_json_sha256(v_changes)),v_result,v_key,public.canonical_json_sha256(v_request))
      returning * into v_completion;
    v_result:=v_result||jsonb_build_object('completionReference',v_completion.completion_reference,'createdAt',v_completion.created_at);
  end if;
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,
    reason,idempotency_key,before_state,after_state,metadata)
  values(v_company,'CUSTOMER_BILLING_PROFILE_COMMAND',v_aggregate_type,v_aggregate_id,v_state_revision,v_actor,
    coalesce(v_reason,'delegated_customer_billing'),v_key,
    jsonb_build_object('revision',case when v_contract_id is null then v_expected else v_override_expected end),
    jsonb_build_object('revision',v_state_revision),
    jsonb_build_object('mode',v_mode,'clientId',v_client,'changed',v_changed,'affectedContractCount',jsonb_array_length(v_affected)));
  if v_changed then
    insert into public.canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
    values(v_company,'CUSTOMER_BILLING_PROFILE_CHANGED',v_aggregate_type,v_aggregate_id,v_state_revision,v_key,
      jsonb_build_object('customerId',v_customer_id,'revision',v_customer.billing_profile_revision,'contractId',v_contract_id,
        'contractOverrideRevision',case when v_contract_id is not null then v_state_revision end),v_actor) returning id into v_event;
    insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
    values(v_company,v_event,'customer.billing_profile.changed',v_key,
      jsonb_build_object('customerId',v_customer_id,'revision',v_customer.billing_profile_revision,'contractId',v_contract_id,
        'contractOverrideRevision',case when v_contract_id is not null then v_state_revision end));
  end if;
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company,v_command_type,v_key,v_request,v_result,v_actor);
  perform private.gridex_billing_profile_current_clock_v1(v_mode,v_actor,v_session,v_client,v_company);
  return v_result;
end;
$command$;
revoke all on function public.gridex_change_customer_billing_profile_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_change_customer_billing_profile_v1(jsonb) to service_role;

-- Preserve the profile-update route's original compact hash and claim owner.
-- A completed historical result is returned unchanged after current authority;
-- failed or processing claims never get reinterpreted as new billing writes.
create function public.gridex_change_customer_billing_profile_api_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $api$
declare v_context jsonb; v_payload jsonb; v_profile jsonb; v_billing jsonb; v_body jsonb; v_completed uuid;
begin
  if current_user<>'service_role' or p_command->>'mode' is distinct from 'api' then
    raise exception 'billing_profile_service_required' using errcode='42501'; end if;
  v_context:=private.gridex_profile_command_begin_v1(p_command,'billing');
  if v_context ? 'replayResult' then
    -- The shared begin helper returns only replayResult on completed claims;
    -- the command identifiers were already validated/locked by its authorizer.
    perform private.gridex_billing_profile_current_clock_v1('api',null,null,
      (p_command->>'clientId')::uuid,(p_command->>'companyId')::uuid);
    return v_context->'replayResult'; end if;
  v_payload:=v_context->'payload'; v_profile:=v_payload->'profile';
  if exists(select 1 from jsonb_object_keys(v_payload) k(key) where key not in ('profile','expected_billing_revision'))
    or jsonb_typeof(v_profile) is distinct from 'object' or v_profile='{}'::jsonb
    or exists(select 1 from jsonb_each(v_profile) e(key,value) where key<>'invoice_email' or jsonb_typeof(value)<>'string')
    or not (v_profile ? 'invoice_email') then
    raise exception 'invalid_billing_profile_command' using errcode='22023'; end if;
  if jsonb_typeof(v_payload->'expected_billing_revision') is distinct from 'number'
    or coalesce(v_payload->>'expected_billing_revision','') !~ '^[0-9]{1,16}$'
    or (v_payload->>'expected_billing_revision')::numeric>9007199254740991 then
    raise exception 'billing_profile_revision_required' using errcode='22023'; end if;
  v_billing:=public.gridex_change_customer_billing_profile_v1(jsonb_build_object(
    'companyId',v_context->'companyId','customerId',v_context->'customerId','mode','api',
    'clientId',v_context->'clientId','subject',p_command->'subject',
    'expectedRevision',v_payload->'expected_billing_revision','idempotencyKey',v_context->>'namespace',
    'changes',jsonb_build_object('email',v_profile->'invoice_email')));
  v_body:=jsonb_build_object('data',jsonb_build_object('completion_reference',v_billing->'completionReference',
    'status','accepted','created_at',v_billing->'createdAt','profile_updated',v_billing->'changed',
    'billing_revision',v_billing->'revision','affected_contract_count',jsonb_array_length(v_billing->'affectedContractIds'),
    'facility_updated',false,'address_result',null));
  update public.customer_portal_write_idempotency set status='completed',response_status=200,response_body=v_body,
    completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=(v_context->>'claimId')::uuid and company_id=(v_context->>'companyId')::uuid
      and api_client_id=(v_context->>'clientId')::uuid and customer_id=(v_context->>'customerId')::uuid
      and route='/api/v1/customer/profile-update' and idempotency_key=v_context->>'key'
      and request_hash=v_context->>'hash' and status='processing' returning id into v_completed;
  if v_completed is null then raise exception 'billing_profile_completion_failed' using errcode='P0001'; end if;
  perform private.gridex_billing_profile_current_clock_v1('api',null,null,
    (v_context->>'clientId')::uuid,(v_context->>'companyId')::uuid);
  return jsonb_build_object('statusCode',200,'body',v_body,'replayed',false);
end;
$api$;
revoke all on function public.gridex_change_customer_billing_profile_api_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_change_customer_billing_profile_api_v1(jsonb) to service_role;

create function private.gridex_billing_effective_profile_valid_v2(p_profile jsonb)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $valid$
declare v_address jsonb:=p_profile->'address'; v_sources jsonb:=p_profile->'sources'; v_field record;
begin
  if jsonb_typeof(p_profile) is distinct from 'object' or not p_profile ?& array[
    'companyId','customerId','contractId','recipient','distributionMethod','email','reference','address',
    'profileRevision','contractOverrideRevision','sources','blockers']
    or exists(select 1 from jsonb_object_keys(p_profile) k(key) where k.key not in (
      'companyId','customerId','contractId','recipient','distributionMethod','email','reference','address',
      'profileRevision','contractOverrideRevision','sources','blockers')) then return false; end if;
  if jsonb_typeof(p_profile->'companyId') is distinct from 'string'
    or jsonb_typeof(p_profile->'customerId') is distinct from 'string'
    or jsonb_typeof(p_profile->'contractId') is distinct from 'string'
    or jsonb_typeof(p_profile->'recipient') is distinct from 'string' or nullif(btrim(p_profile->>'recipient'),'') is null
    or length(p_profile->>'recipient')>320
    or jsonb_typeof(p_profile->'distributionMethod') is distinct from 'string'
    or p_profile->>'distributionMethod' not in ('email','paper','e_invoice','direct_debit')
    or jsonb_typeof(p_profile->'profileRevision') is distinct from 'number'
    or jsonb_typeof(p_profile->'contractOverrideRevision') is distinct from 'number'
    or (p_profile->>'profileRevision')::numeric<0 or (p_profile->>'profileRevision')::numeric>9007199254740991
    or trunc((p_profile->>'profileRevision')::numeric)<>(p_profile->>'profileRevision')::numeric
    or (p_profile->>'contractOverrideRevision')::numeric<0 or (p_profile->>'contractOverrideRevision')::numeric>9007199254740991
    or trunc((p_profile->>'contractOverrideRevision')::numeric)<>(p_profile->>'contractOverrideRevision')::numeric
    or p_profile->'blockers' is distinct from '[]'::jsonb then return false; end if;
  if jsonb_typeof(v_address) is distinct from 'object' or not v_address ?& array['street','postalCode','city','country']
    or exists(select 1 from jsonb_object_keys(v_address) k(key) where k.key not in ('street','postalCode','city','country'))
    or jsonb_typeof(v_sources) is distinct from 'object' or not v_sources ?& array[
      'recipient','distributionMethod','email','reference','street','postalCode','city','country']
    or exists(select 1 from jsonb_object_keys(v_sources) k(key) where k.key not in (
      'recipient','distributionMethod','email','reference','street','postalCode','city','country')) then return false; end if;
  for v_field in select e.key,e.value from jsonb_each(v_address) e
    union all select e.key,e.value from jsonb_each(p_profile) e where e.key in ('email','reference')
  loop
    if v_field.value<>'null'::jsonb and (jsonb_typeof(v_field.value)<>'string'
      or length(v_field.value#>>'{}')>320) then return false; end if;
  end loop;
  if exists(select 1 from jsonb_each(v_sources) e where jsonb_typeof(e.value)<>'string' or e.value#>>'{}' not in (
    'customer_default','contract_override','legacy_customer_default','legacy_contract_override','tenant_default','site_address','missing'))
    or (p_profile->'email'<>'null'::jsonb and p_profile->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
    or (p_profile->>'distributionMethod'='email' and nullif(btrim(p_profile->>'email'),'') is null)
    or (p_profile->>'distributionMethod'='paper' and (nullif(btrim(v_address->>'street'),'') is null
      or nullif(btrim(v_address->>'postalCode'),'') is null or nullif(btrim(v_address->>'city'),'') is null))
    or (p_profile->>'distributionMethod' in ('e_invoice','direct_debit') and nullif(btrim(p_profile->>'reference'),'') is null)
    then return false; end if;
  return true;
end;
$valid$;
revoke all on function private.gridex_billing_effective_profile_valid_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.gridex_billing_effective_profile_valid_v2(jsonb) to service_role;

create function public.gridex_lock_billing_configuration_v2(p_company_id uuid,p_underlay_id uuid,
  p_expected_profile_revision bigint,p_expected_override_revision bigint,p_snapshot jsonb,p_snapshot_sha256 text,p_snapshot_json text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $lock$
declare v_underlay public.billing_underlays%rowtype; v_customer public.customers%rowtype;
  v_contract public.customer_contracts%rowtype; v_contract_id uuid; v_site public.customer_sites%rowtype;
  v_field text; v_site_value text;
begin
  if current_user<>'service_role' then raise exception 'billing_profile_service_required' using errcode='42501'; end if;
  -- Validate the application's exact compact bytes, never PostgreSQL JSON text.
  if p_snapshot_json is null or octet_length(p_snapshot_json)>256000 or p_snapshot_json::jsonb is distinct from p_snapshot
    or p_snapshot_sha256 is null or p_snapshot_sha256 !~ '^[a-f0-9]{64}$'
    or encode(extensions.digest(p_snapshot_json,'sha256'),'hex') is distinct from p_snapshot_sha256 then
    raise exception 'invalid_billing_configuration_snapshot' using errcode='22023'; end if;
  select * into v_underlay from public.billing_underlays where company_id=p_company_id and id=p_underlay_id;
  if not found then raise exception 'billing_configuration_resource_unavailable' using errcode='42501'; end if;
  v_contract_id:=coalesce(v_underlay.customer_contract_id,v_underlay.contract_id);
  select * into v_customer from public.customers where company_id=p_company_id and id=v_underlay.customer_id for share;
  if not found then raise exception 'billing_configuration_resource_unavailable' using errcode='42501'; end if;
  select * into v_contract from public.customer_contracts where company_id=p_company_id and id=v_contract_id
    and customer_id=v_customer.id for share;
  if not found then raise exception 'billing_configuration_resource_unavailable' using errcode='42501'; end if;
  select * into v_underlay from public.billing_underlays where company_id=p_company_id and id=p_underlay_id
    and customer_id=v_customer.id and coalesce(customer_contract_id,contract_id)=v_contract.id for update;
  if not found then raise exception 'billing_configuration_resource_unavailable' using errcode='42501'; end if;
  if v_underlay.billing_configuration_snapshot_sha256 is not null then
    return v_underlay.billing_configuration_snapshot; -- Immutable original, never live replacement.
  end if;
  if v_customer.billing_profile_revision is distinct from p_expected_profile_revision
    or v_contract.billing_profile_override_revision is distinct from p_expected_override_revision then
    raise exception 'billing_profile_revision_conflict' using errcode='P0001'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or p_snapshot->>'schema'<>'billing_configuration_v2'
    or p_snapshot->>'company_id' is distinct from p_company_id::text
    or p_snapshot->>'customer_id' is distinct from v_customer.id::text
    or p_snapshot->>'contract_id' is distinct from v_contract.id::text
    or p_snapshot#>>'{effective_billing_profile,companyId}' is distinct from p_company_id::text
    or p_snapshot#>>'{effective_billing_profile,customerId}' is distinct from v_customer.id::text
    or p_snapshot#>>'{effective_billing_profile,contractId}' is distinct from v_contract.id::text
    or p_snapshot#>>'{effective_billing_profile,profileRevision}' is distinct from p_expected_profile_revision::text
    or p_snapshot#>>'{effective_billing_profile,contractOverrideRevision}' is distinct from p_expected_override_revision::text
    or not private.gridex_billing_effective_profile_valid_v2(p_snapshot->'effective_billing_profile')
    or p_snapshot_sha256 is null or p_snapshot_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_billing_configuration_snapshot' using errcode='22023'; end if;
  -- The site rule depends on mutable address data outside both profile
  -- revisions. Lock the exact customer-bound site and compare every sourced
  -- field before saving; never mix a prior site read with a later capture.
  if exists(select 1 from jsonb_each_text(p_snapshot#>'{effective_billing_profile,sources}') e where e.value='site_address') then
    select * into v_site from public.customer_sites where company_id=p_company_id and customer_id=v_customer.id
      and id=coalesce(v_contract.customer_site_id,v_contract.site_id) for share;
    if not found or v_contract.billing_address_same_as_site is distinct from true then
      raise exception 'billing_configuration_resource_unavailable' using errcode='42501'; end if;
    foreach v_field in array array['street','postalCode','city'] loop
      if p_snapshot#>>array['effective_billing_profile','sources',v_field]='site_address' then
        v_site_value:=case v_field when 'street' then nullif(btrim(v_site.street),'')
          when 'postalCode' then nullif(btrim(v_site.postal_code),'') else nullif(btrim(v_site.city),'') end;
        if v_site_value is null or p_snapshot#>>array['effective_billing_profile','address',v_field] is distinct from v_site_value then
          raise exception 'billing_profile_revision_conflict' using errcode='P0001'; end if;
      end if;
    end loop;
  end if;
  update public.billing_underlays set billing_configuration_snapshot=p_snapshot,
    billing_configuration_snapshot_sha256=p_snapshot_sha256,billing_configuration_snapshotted_at=clock_timestamp(),updated_at=clock_timestamp()
    where company_id=p_company_id and id=p_underlay_id;
  return p_snapshot;
end;
$lock$;
revoke all on function public.gridex_lock_billing_configuration_v2(uuid,uuid,bigint,bigint,jsonb,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.gridex_lock_billing_configuration_v2(uuid,uuid,bigint,bigint,jsonb,text,text) to service_role;
commit;
