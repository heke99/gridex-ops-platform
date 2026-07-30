-- Complete the public customer-portal boundary without rewriting any released
-- migration. This forward migration:
--   * repairs the v3 commercial quote/application transaction mismatch,
--   * persists stable external contract/facility/completion references, and
--   * commits move-out case, event, outbox and audit state atomically.

begin;

set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(
  hashtextextended('gridex:customer-portal-api:20260730153000', 0)
);

create or replace function public.gridex_new_public_resource_reference(
  p_prefix text
) returns text
language sql
volatile
set search_path = pg_catalog, public, pg_temp
as $$
  select lower(regexp_replace(coalesce(p_prefix, 'resource'), '[^a-z0-9_]', '_', 'g'))
    || '_' || replace(gen_random_uuid()::text, '-', '');
$$;

revoke all on function public.gridex_new_public_resource_reference(text)
  from public, anon, authenticated;
grant execute on function public.gridex_new_public_resource_reference(text)
  to service_role;

alter table public.customer_contracts
  add column if not exists customer_contract_reference text;

update public.customer_contracts
set customer_contract_reference =
  public.gridex_new_public_resource_reference('contract')
where customer_contract_reference is null
   or btrim(customer_contract_reference) = '';

alter table public.customer_contracts
  alter column customer_contract_reference
    set default public.gridex_new_public_resource_reference('contract'),
  alter column customer_contract_reference set not null;

create unique index if not exists
  customer_contracts_company_public_reference_uidx
  on public.customer_contracts(company_id, customer_contract_reference);

alter table public.customer_sites
  add column if not exists facility_reference text;

update public.customer_sites
set facility_reference =
  public.gridex_new_public_resource_reference('facility')
where facility_reference is null
   or btrim(facility_reference) = '';

alter table public.customer_sites
  alter column facility_reference
    set default public.gridex_new_public_resource_reference('facility'),
  alter column facility_reference set not null;

create unique index if not exists customer_sites_company_public_reference_uidx
  on public.customer_sites(company_id, facility_reference);

alter table public.customer_portal_completions
  add column if not exists completion_reference text,
  add column if not exists api_client_id uuid,
  add column if not exists idempotency_key text,
  add column if not exists request_hash text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customer_portal_completions'::regclass
      and conname = 'customer_portal_completions_api_client_fk'
  ) then
    alter table public.customer_portal_completions
      add constraint customer_portal_completions_api_client_fk
      foreign key (api_client_id)
      references public.integration_api_clients(id)
      on delete set null
      not valid;
  end if;
end
$$;

update public.customer_portal_completions
set completion_reference =
  public.gridex_new_public_resource_reference('move_out')
where completion_reference is null
   or btrim(completion_reference) = '';

alter table public.customer_portal_completions
  alter column completion_reference
    set default public.gridex_new_public_resource_reference('completion'),
  alter column completion_reference set not null;

create unique index if not exists
  customer_portal_completions_company_public_reference_uidx
  on public.customer_portal_completions(company_id, completion_reference);

create unique index if not exists
  customer_portal_completions_move_out_idempotency_uidx
  on public.customer_portal_completions(
    company_id,
    api_client_id,
    customer_id,
    idempotency_key
  )
  where completion_type = 'move_out'
    and idempotency_key is not null;

create or replace function public.gridex_submit_customer_move_out_v1(
  p_command jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_company_id uuid := nullif(p_command->>'company_id', '')::uuid;
  v_customer_id uuid := nullif(p_command->>'customer_id', '')::uuid;
  v_api_client_id uuid := nullif(p_command->>'api_client_id', '')::uuid;
  v_idempotency_key text :=
    nullif(btrim(coalesce(p_command->>'idempotency_key', '')), '');
  v_facility_reference text :=
    nullif(btrim(coalesce(p_command->>'facility_reference', '')), '');
  v_contract_reference text :=
    nullif(btrim(coalesce(
      p_command->>'customer_contract_reference',
      ''
    )), '');
  v_requested_date date :=
    nullif(p_command->>'requested_move_out_date', '')::date;
  v_request_hash text :=
    md5((p_command - 'idempotency_key')::text);
  v_site public.customer_sites%rowtype;
  v_contract public.customer_contracts%rowtype;
  v_existing public.customer_portal_completions%rowtype;
  v_completion public.customer_portal_completions%rowtype;
  v_customer_reference text;
  v_case_id uuid;
  v_event_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'customer_move_out_service_role_required';
  end if;
  if v_company_id is null
     or v_customer_id is null
     or v_api_client_id is null
     or v_idempotency_key is null
     or length(v_idempotency_key) not between 8 and 200
     or v_facility_reference is null
     or v_requested_date is null then
    raise exception using
      errcode = '22023',
      message = 'customer_move_out_command_invalid';
  end if;
  if v_requested_date < current_date
     or v_requested_date > current_date + 730 then
    raise exception using
      errcode = '22023',
      message = 'customer_move_out_date_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_company_id::text || ':' || v_api_client_id::text || ':' ||
      v_customer_id::text || ':' || v_idempotency_key,
    0
  ));

  select coalesce(
    nullif(customer.external_customer_id, ''),
    nullif(customer.customer_number, '')
  )
  into v_customer_reference
  from public.customers customer
  where customer.id = v_customer_id
    and customer.company_id = v_company_id;
  if not found or v_customer_reference is null then
    raise exception using
      errcode = 'P0002',
      message = 'customer_move_out_customer_not_found';
  end if;

  select completion.*
  into v_existing
  from public.customer_portal_completions completion
  where completion.company_id = v_company_id
    and completion.api_client_id = v_api_client_id
    and completion.customer_id = v_customer_id
    and completion.completion_type = 'move_out'
    and completion.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if v_existing.request_hash is distinct from v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'customer_move_out_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'completion_reference', v_existing.completion_reference,
      'customer_reference', v_customer_reference,
      'facility_reference', v_facility_reference,
      'contract_reference', v_contract_reference,
      'requested_move_out_date', v_requested_date,
      'status', v_existing.status,
      'submitted_at', v_existing.created_at,
      'replayed', true
    );
  end if;

  select site.*
  into v_site
  from public.customer_sites site
  where site.company_id = v_company_id
    and site.customer_id = v_customer_id
    and site.facility_reference = v_facility_reference
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'customer_move_out_facility_not_found';
  end if;

  if v_contract_reference is not null then
    select contract.*
    into v_contract
    from public.customer_contracts contract
    where contract.company_id = v_company_id
      and contract.customer_id = v_customer_id
      and contract.customer_contract_reference = v_contract_reference
      and coalesce(contract.customer_site_id, contract.site_id) = v_site.id
    for share;
    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'customer_move_out_contract_not_found';
    end if;
    if v_contract.status not in (
      'signed',
      'active',
      'pending_activation',
      'pending_switch'
    ) then
      raise exception using
        errcode = '23514',
        message = 'customer_move_out_contract_status_invalid';
    end if;
  end if;

  insert into public.customer_portal_completions(
    company_id,
    customer_id,
    site_id,
    completion_type,
    status,
    submitted_payload,
    result_payload,
    api_client_id,
    idempotency_key,
    request_hash
  ) values (
    v_company_id,
    v_customer_id,
    v_site.id,
    'move_out',
    'submitted',
    jsonb_build_object(
      'facility_reference', v_facility_reference,
      'customer_contract_reference', v_contract_reference,
      'requested_move_out_date', v_requested_date,
      'reason', nullif(p_command->>'reason', ''),
      'new_address', coalesce(p_command->'new_address', '{}'::jsonb),
      'contact_details', coalesce(p_command->'contact_details', '{}'::jsonb),
      'metadata', coalesce(p_command->'metadata', '{}'::jsonb)
    ),
    jsonb_build_object(
      'requested_move_out_date', v_requested_date,
      'workflow_status', 'submitted'
    ),
    v_api_client_id,
    v_idempotency_key,
    v_request_hash
  )
  returning * into v_completion;

  insert into public.customer_cases(
    company_id,
    customer_id,
    site_id,
    customer_contract_id,
    case_type,
    status,
    priority,
    title,
    description,
    next_action,
    source,
    metadata
  ) values (
    v_company_id,
    v_customer_id,
    v_site.id,
    v_contract.id,
    'other',
    'open',
    'normal',
    'Utflyttningsanmälan',
    'Kunden har registrerat utflyttning via kundportal-API.',
    'review_move_out_submission',
    'customer_portal_api',
    jsonb_build_object(
      'completion_reference', v_completion.completion_reference,
      'facility_reference', v_facility_reference,
      'requested_move_out_date', v_requested_date
    )
  )
  returning id into v_case_id;

  update public.customer_portal_completions
  set linked_case_id = v_case_id,
      updated_at = now()
  where id = v_completion.id;

  insert into public.domain_events(
    company_id,
    event_type,
    aggregate_type,
    aggregate_id,
    subject_customer_id,
    source,
    idempotency_key,
    payload
  ) values (
    v_company_id,
    'customer.move_out_submitted',
    'customer_move_out',
    v_completion.completion_reference,
    v_customer_id,
    'customer_portal_api',
    'customer-move-out:' || v_company_id::text || ':' ||
      v_api_client_id::text || ':' || v_idempotency_key,
    jsonb_build_object(
      'completion_reference', v_completion.completion_reference,
      'facility_reference', v_facility_reference,
      'customer_contract_reference', v_contract_reference,
      'requested_move_out_date', v_requested_date,
      'status', 'submitted'
    )
  )
  returning id into v_event_id;

  insert into public.event_outbox(
    company_id,
    domain_event_id,
    destination_type,
    destination_key,
    payload
  ) values (
    v_company_id,
    v_event_id,
    'internal',
    'customer.move_out_submitted',
    jsonb_build_object(
      'event_reference', v_event_id,
      'completion_reference', v_completion.completion_reference
    )
  )
  on conflict do nothing;

  insert into public.audit_logs(
    company_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    new_values,
    metadata
  ) values (
    v_company_id,
    null,
    'customer_move_out',
    v_completion.completion_reference,
    'customer.move_out_submitted',
    jsonb_build_object(
      'facility_reference', v_facility_reference,
      'customer_contract_reference', v_contract_reference,
      'requested_move_out_date', v_requested_date,
      'status', 'submitted'
    ),
    jsonb_build_object(
      'api_client_id', v_api_client_id,
      'idempotency_key_hash', md5(v_idempotency_key)
    )
  );

  return jsonb_build_object(
    'completion_reference', v_completion.completion_reference,
    'customer_reference', v_customer_reference,
    'facility_reference', v_facility_reference,
    'contract_reference', v_contract_reference,
    'requested_move_out_date', v_requested_date,
    'status', v_completion.status,
    'submitted_at', v_completion.created_at,
    'replayed', false
  );
end
$$;

revoke all on function public.gridex_submit_customer_move_out_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.gridex_submit_customer_move_out_v1(jsonb)
  to service_role;

comment on function public.gridex_submit_customer_move_out_v1(jsonb) is
  'Tenant/customer-bound move-out submission using stable public references. The case, domain event, outbox and audit record commit atomically and replay by idempotency key.';

-- 20260729200000 introduced v3 commercial quotes, while the wrapper installed
-- by 20260727166000 still rejected every hash version except v2. Patch the
-- active function definition forward so valid v3 quotes can be committed.
create or replace function public.gridex__replace_active_function_text(
  p_signature text,
  p_old text,
  p_new text
) returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_oid regprocedure;
  v_definition text;
begin
  v_oid := to_regprocedure(p_signature);
  if v_oid is null then
    raise exception using
      errcode = '55000',
      message = 'gridex_active_function_missing:' || p_signature;
  end if;
  v_definition := pg_get_functiondef(v_oid);
  if strpos(v_definition, p_old) > 0 then
    execute replace(v_definition, p_old, p_new);
  elsif strpos(v_definition, p_new) = 0 then
    raise exception using
      errcode = '55000',
      message = 'gridex_active_function_unexpected_definition:' || p_signature;
  end if;
end
$$;

revoke all on function public.gridex__replace_active_function_text(
  text,
  text,
  text
) from public, anon, authenticated, service_role;

select public.gridex__replace_active_function_text(
  'public.gridex_onboard_customer_graph(jsonb)',
  $$v_quote.quote_hash_version <> 'v2_full_quote'$$,
  $$v_quote.quote_hash_version not in (
       'v2_full_quote',
       'v3_commercial_selection'
     )$$
);

drop function public.gridex__replace_active_function_text(text, text, text);

comment on function public.gridex_onboard_customer_graph(jsonb) is
  'Canonical website application commit: locks and validates v2/v3 immutable quote identity, commits the customer graph, consumes the quote, and writes audit/events/outbox in one transaction.';

commit;
