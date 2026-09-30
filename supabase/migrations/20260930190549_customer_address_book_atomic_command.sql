-- OPS address-book command. Site/facility addresses retain their independent
-- canonical writers and revisions. Reuses the current profile actor locks.
begin;
set local lock_timeout='10s';

alter table public.customers add column address_book_revision bigint not null default 0
  check(address_book_revision between 0 and 9007199254740991);
comment on column public.customers.address_book_revision is
  'Customer-wide optimistic revision of registered, billing and other address-book rows; facility mirrors are separate.';

create function private.gridex_customer_address_book_fields_v1(p_address public.customer_addresses)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $function$
  select jsonb_build_object('type',(p_address).type,'street_1',(p_address).street_1,'street_2',(p_address).street_2,
    'postal_code',(p_address).postal_code,'city',(p_address).city,'country',(p_address).country,'municipality',(p_address).municipality,
    'moved_in_at',(p_address).moved_in_at,'moved_out_at',(p_address).moved_out_at,'is_active',(p_address).is_active);
$function$;
revoke all on function private.gridex_customer_address_book_fields_v1(public.customer_addresses) from public,anon,authenticated,service_role;
grant execute on function private.gridex_customer_address_book_fields_v1(public.customer_addresses) to service_role;

-- Only the address row trigger allocates a book revision. A direct customer
-- update cannot assign/reset it; a new customer starts with its loaded baseline.
create function private.gridex_customer_address_book_revision_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $function$
begin
  if tg_op='INSERT' then new.address_book_revision:=0;
  elsif not (pg_trigger_depth()=2 and new.address_book_revision=old.address_book_revision+1) then
    new.address_book_revision:=old.address_book_revision;
  end if;
  return new;
end;
$function$;
create trigger gridex_customer_address_book_revision_guard before insert or update on public.customers
  for each row execute function private.gridex_customer_address_book_revision_guard_v1();

-- Ordinary backend table DML has no command context. The private transaction
-- marker is set only after current authorization and removed before returning.
-- Matching ownership, selection and editable-field hash prevents an old writer
-- from converting a facility mirror or borrowing the marker for another row.
create function private.gridex_customer_address_book_write_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $function$
declare v_marker jsonb; v_book boolean;
begin
  if current_user in ('anon','authenticated') then
    raise exception 'address_service_required' using errcode='42501'; end if;
  v_book:=case tg_op when 'INSERT' then new.type<>'facility' when 'DELETE' then old.type<>'facility'
    else old.type<>'facility' or new.type<>'facility' end;
  if current_user='service_role' and v_book then
    if tg_op='DELETE' then raise exception 'address_book_command_required' using errcode='42501'; end if;
    begin v_marker:=nullif(current_setting('gridex.customer_address_book_write_v1',true),'')::jsonb;
    exception when invalid_text_representation then raise exception 'address_book_command_required' using errcode='42501'; end;
    if v_marker is null or v_marker->>'companyId' is distinct from new.company_id::text
      or v_marker->>'customerId' is distinct from new.customer_id::text
      or v_marker->>'addressId' is distinct from new.id::text
      or v_marker->>'changesHash' is distinct from public.canonical_json_sha256(private.gridex_customer_address_book_fields_v1(new))
      or new.type not in ('registered','billing','other')
      or (tg_op='UPDATE' and (old.type not in ('registered','billing','other')
        or row(old.id,old.company_id,old.customer_id) is distinct from row(new.id,new.company_id,new.customer_id)))
    then raise exception 'address_book_command_required' using errcode='42501'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;
create trigger gridex_customer_address_book_write_guard before insert or update or delete on public.customer_addresses
  for each row execute function private.gridex_customer_address_book_write_guard_v1();

-- All trusted maintenance/onboarding writers also advance the revision for
-- changed address-book fields. Facility-to-facility mirror work does not.
create function private.gridex_customer_address_book_revision_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $function$
declare v_old_customer uuid; v_new_customer uuid; v_customer uuid;
begin
  if tg_op<>'INSERT' and old.type<>'facility' then v_old_customer:=old.customer_id; end if;
  if tg_op<>'DELETE' and new.type<>'facility' then v_new_customer:=new.customer_id; end if;
  if tg_op='UPDATE' and row(old.company_id,old.customer_id) is not distinct from row(new.company_id,new.customer_id)
    and private.gridex_customer_address_book_fields_v1(old) is not distinct from private.gridex_customer_address_book_fields_v1(new)
  then return null; end if;
  for v_customer in select distinct id from unnest(array[v_old_customer,v_new_customer]) ids(id) where id is not null order by id
  loop
    update public.customers set address_book_revision=address_book_revision+1 where id=v_customer;
  end loop;
  return null;
end;
$function$;
create trigger gridex_customer_address_book_revision after insert or update or delete on public.customer_addresses
  for each row execute function private.gridex_customer_address_book_revision_v1();
revoke all on function private.gridex_customer_address_book_revision_guard_v1(),
  private.gridex_customer_address_book_write_guard_v1(),private.gridex_customer_address_book_revision_v1()
  from public,anon,authenticated,service_role;

revoke insert,update,delete,truncate on public.customer_addresses from public,anon,authenticated;
revoke truncate on public.customer_addresses from service_role;
-- Column ACLs are independent of table ACLs. Close every existing column as
-- well, without removing the customer-card read permission.
do $block$
declare v_columns text;
begin
  select string_agg(quote_ident(a.attname),',' order by a.attnum) into v_columns from pg_attribute a
    where a.attrelid='public.customer_addresses'::regclass and a.attnum>0 and not a.attisdropped;
  execute 'revoke insert('||v_columns||'),update('||v_columns||') on public.customer_addresses from public,anon,authenticated';
end;
$block$;

create function public.gridex_change_customer_address_book_v1(p_command jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $function$
declare
  v_company uuid; v_customer uuid; v_actor uuid; v_session uuid; v_selected uuid; v_address_id uuid;
  v_expected bigint; v_revision bigint; v_key text; v_reason text; v_namespace text; v_previous_marker text;
  v_changes jsonb; v_request jsonb; v_context jsonb; v_result jsonb; v_before jsonb; v_changed boolean; v_event uuid;
  v_moved_in date; v_moved_out date; v_address public.customer_addresses%rowtype;
  v_existing public.canonical_command_results%rowtype;
begin
  if current_user<>'service_role' then raise exception 'address_service_required' using errcode='42501'; end if;
  if p_command is null or jsonb_typeof(p_command)<>'object' then
    raise exception 'invalid_address_command' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_command) k(key) where key not in
      ('companyId','customerId','addressId','actorUserId','sessionId','reason','idempotencyKey','expectedRevision','changes'))
    or exists(select 1 from jsonb_each(p_command) e(key,value) where key in
      ('companyId','customerId','actorUserId','sessionId','reason','idempotencyKey') and jsonb_typeof(value)<>'string')
    or coalesce(p_command->>'companyId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'customerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'actorUserId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'sessionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (coalesce(p_command->'addressId','null'::jsonb)<>'null'::jsonb and (jsonb_typeof(p_command->'addressId')<>'string'
      or p_command->>'addressId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    or coalesce(length(btrim(p_command->>'reason')),0) not between 1 and 200
    or coalesce(p_command->>'idempotencyKey','') !~ '^[A-Za-z0-9._:+~-]{8,200}$'
    or jsonb_typeof(p_command->'expectedRevision') is distinct from 'number'
    or coalesce(p_command->>'expectedRevision','') !~ '^[0-9]{1,16}$'
    or (p_command->>'expectedRevision')::numeric>9007199254740991
    or jsonb_typeof(p_command->'changes') is distinct from 'object'
  then raise exception 'invalid_address_command' using errcode='22023'; end if;
  v_changes:=p_command->'changes';
  if not (v_changes ?& array['type','street_1','street_2','postal_code','city','country','municipality','moved_in_at','moved_out_at','is_active'])
    or exists(select 1 from jsonb_each(v_changes) e(key,value) where
      key not in ('type','street_1','street_2','postal_code','city','country','municipality','moved_in_at','moved_out_at','is_active')
      or (key='type' and (jsonb_typeof(value)<>'string' or value#>>'{}' not in ('registered','billing','other')))
      or (key='country' and (jsonb_typeof(value)<>'string' or value#>>'{}' !~ '^[A-Z]{2}$'))
      or (key='street_1' and (jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}')) not between 1 and 300))
      or (key='is_active' and jsonb_typeof(value)<>'boolean')
      or (key in ('street_2','postal_code','city','municipality') and (jsonb_typeof(value) not in ('string','null')
        or (value<>'null'::jsonb and (length(btrim(value#>>'{}'))<1 or length(btrim(value#>>'{}'))>
          case key when 'street_2' then 300 when 'postal_code' then 40 else 120 end))))
      or (key in ('moved_in_at','moved_out_at') and (jsonb_typeof(value) not in ('string','null')
        or (value<>'null'::jsonb and value#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))))
  then raise exception 'invalid_customer_address' using errcode='22023'; end if;
  begin
    v_moved_in:=(v_changes->>'moved_in_at')::date; v_moved_out:=(v_changes->>'moved_out_at')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'invalid_customer_address' using errcode='22023';
  end;
  if (v_moved_in is not null and to_char(v_moved_in,'YYYY-MM-DD')<>v_changes->>'moved_in_at')
    or (v_moved_out is not null and to_char(v_moved_out,'YYYY-MM-DD')<>v_changes->>'moved_out_at')
    or v_moved_out<v_moved_in then raise exception 'invalid_customer_address' using errcode='22023'; end if;
  select jsonb_object_agg(e.key,case when e.key in ('street_1','street_2','postal_code','city','municipality')
    and e.value<>'null'::jsonb then to_jsonb(btrim(e.value#>>'{}')) else e.value end) into v_changes from jsonb_each(v_changes) e;
  v_company:=(p_command->>'companyId')::uuid; v_customer:=(p_command->>'customerId')::uuid;
  v_actor:=(p_command->>'actorUserId')::uuid; v_session:=(p_command->>'sessionId')::uuid;
  v_selected:=(p_command->>'addressId')::uuid; v_expected:=(p_command->>'expectedRevision')::bigint;
  v_key:=p_command->>'idempotencyKey'; v_reason:=btrim(p_command->>'reason');
  begin
    -- This shared path locks customer -> tenant -> actual OPS session ->
    -- membership -> current permission inputs. No API delegation is accepted.
    v_context:=private.gridex_profile_command_authorize_v1(jsonb_build_object('companyId',v_company,'customerId',v_customer,
      'mode','ops','actorUserId',v_actor,'sessionId',v_session,'reason',v_reason,'idempotencyKey',v_key,
      'requestJson',(p_command-'sessionId')::text),'contact');
  exception when insufficient_privilege then
    case sqlerrm
      when 'profile_service_required' then raise exception 'address_service_required' using errcode='42501';
      when 'profile_customer_unavailable' then raise exception 'address_customer_unavailable' using errcode='42501';
      when 'profile_tenant_unavailable' then raise exception 'address_tenant_unavailable' using errcode='42501';
      else raise exception 'address_actor_forbidden' using errcode='42501';
    end case;
  end;
  select address_book_revision into v_revision from public.customers where id=v_customer and company_id=v_company;
  if v_selected is not null then
    select * into v_address from public.customer_addresses where id=v_selected and company_id=v_company and customer_id=v_customer
      and type in ('registered','billing','other') for update;
    begin perform private.gridex_profile_current_clock_v1(v_context);
    exception when insufficient_privilege then raise exception 'address_actor_forbidden' using errcode='42501'; end;
    if v_address.id is null then raise exception 'address_book_selection_conflict' using errcode='P0001'; end if;
  end if;
  v_namespace:=encode(extensions.digest(concat_ws(':','customer.address.book.change.v1',v_company::text,v_customer::text,v_actor::text,v_key),'sha256'),'hex');
  v_request:=jsonb_build_object('companyId',v_company,'customerId',v_customer,'addressId',v_selected,'actorId',v_actor,'sessionId',v_session,
    'reason',v_reason,'expectedRevision',v_expected,'changesHash',public.canonical_json_sha256(v_changes));
  select * into v_existing from public.canonical_command_results where company_id=v_company
    and command_type='customer.address.book.change.v1' and idempotency_key=v_namespace for update;
  begin perform private.gridex_profile_current_clock_v1(v_context);
  exception when insufficient_privilege then raise exception 'address_actor_forbidden' using errcode='42501'; end;
  if v_existing.id is not null then
    if v_existing.request_payload is distinct from v_request then
      raise exception 'address_book_idempotency_conflict' using errcode='P0001'; end if;
    v_result:=v_existing.result_payload;
    if coalesce(v_result->>'addressId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or v_result->>'companyId' is distinct from v_company::text or v_result->>'customerId' is distinct from v_customer::text
    then raise exception 'address_book_selection_conflict' using errcode='P0001'; end if;
    select * into v_address from public.customer_addresses where id=(v_result->>'addressId')::uuid
      and company_id=v_company and customer_id=v_customer and type in ('registered','billing','other') for share;
    begin perform private.gridex_profile_current_clock_v1(v_context);
    exception when insufficient_privilege then raise exception 'address_actor_forbidden' using errcode='42501'; end;
    if v_address.id is null then raise exception 'address_book_selection_conflict' using errcode='P0001'; end if;
    if v_result->>'revision' is distinct from v_revision::text
      or private.gridex_customer_address_book_fields_v1(v_address) is distinct from v_changes then
      raise exception 'address_book_revision_conflict' using errcode='P0001'; end if;
    begin perform private.gridex_profile_current_clock_v1(v_context);
    exception when insufficient_privilege then raise exception 'address_actor_forbidden' using errcode='42501'; end;
    return v_result||jsonb_build_object('replayed',true);
  end if;
  if v_revision<>v_expected then raise exception 'address_book_revision_conflict' using errcode='P0001'; end if;
  begin perform private.gridex_profile_current_clock_v1(v_context);
  exception when insufficient_privilege then raise exception 'address_actor_forbidden' using errcode='42501'; end;
  v_before:=case when v_selected is null then null else private.gridex_customer_address_book_fields_v1(v_address) end;
  v_changed:=v_selected is null or v_before is distinct from v_changes;
  v_address_id:=coalesce(v_selected,gen_random_uuid());
  if v_changed then
    v_previous_marker:=current_setting('gridex.customer_address_book_write_v1',true);
    perform set_config('gridex.customer_address_book_write_v1',jsonb_build_object('companyId',v_company,'customerId',v_customer,
      'addressId',v_address_id,'changesHash',v_request->>'changesHash')::text,true);
    if v_selected is null then
      insert into public.customer_addresses(id,company_id,customer_id,type,street_1,street_2,postal_code,city,country,municipality,
        moved_in_at,moved_out_at,is_active,created_by,updated_by)
      values(v_address_id,v_company,v_customer,v_changes->>'type',v_changes->>'street_1',v_changes->>'street_2',v_changes->>'postal_code',
        v_changes->>'city',v_changes->>'country',v_changes->>'municipality',v_moved_in,v_moved_out,(v_changes->>'is_active')::boolean,v_actor,v_actor);
    else
      update public.customer_addresses set type=v_changes->>'type',street_1=v_changes->>'street_1',street_2=v_changes->>'street_2',
        postal_code=v_changes->>'postal_code',city=v_changes->>'city',country=v_changes->>'country',municipality=v_changes->>'municipality',
        moved_in_at=v_moved_in,moved_out_at=v_moved_out,is_active=(v_changes->>'is_active')::boolean,updated_at=clock_timestamp(),updated_by=v_actor
        where id=v_address_id and company_id=v_company and customer_id=v_customer;
    end if;
    perform set_config('gridex.customer_address_book_write_v1',coalesce(v_previous_marker,''),true);
    select address_book_revision into v_revision from public.customers where id=v_customer and company_id=v_company;
  end if;
  v_result:=jsonb_build_object('companyId',v_company,'customerId',v_customer,'addressId',v_address_id,'revision',v_revision,'changed',v_changed,'replayed',false);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company,'customer.address.book.change.v1',v_namespace,v_request,v_result,v_actor);
  if v_changed then
    insert into public.canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
    values(v_company,'CUSTOMER_ADDRESS_BOOK_CHANGED','customer',v_customer,v_revision,v_namespace,
      jsonb_build_object('customerId',v_customer,'addressId',v_address_id,'revision',v_revision),v_actor) returning id into v_event;
    insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
    values(v_company,v_event,'customer.address.book.changed',v_namespace,jsonb_build_object('customerId',v_customer,'addressId',v_address_id,'revision',v_revision));
  end if;
  -- Hashes/revisions retain traceability without copying address PII into
  -- results/audit/outbox. A late failure rolls back every local effect.
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,reason,
    idempotency_key,before_state,after_state,metadata)
  values(v_company,'CUSTOMER_ADDRESS_BOOK_COMMAND','customer',v_customer,v_revision,v_actor,v_reason,v_namespace,
    jsonb_build_object('revision',v_expected,'addressHash',case when v_before is null then null else public.canonical_json_sha256(v_before) end),
    jsonb_build_object('revision',v_revision,'changed',v_changed),jsonb_build_object('addressId',v_address_id,'changesHash',v_request->>'changesHash'));
  begin perform private.gridex_profile_current_clock_v1(v_context);
  exception when insufficient_privilege then raise exception 'address_actor_forbidden' using errcode='42501'; end;
  return v_result;
end;
$function$;
revoke all on function public.gridex_change_customer_address_book_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_change_customer_address_book_v1(jsonb) to service_role;
commit;
