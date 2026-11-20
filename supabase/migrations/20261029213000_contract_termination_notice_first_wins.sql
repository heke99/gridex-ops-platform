-- Finding 20261029-3f1a8ab1/claude-track2/015: termination notices.
-- Forward-only replacement of the 20260727165000 command with identical
-- signature, grants and body except the termination_notice_received rules:
--   1. the first valid receipt wins; a later receipt with another date is
--      rejected (termination_notice_already_recorded) and a repeat of the
--      stored date is idempotent (existing event returned, no duplicate);
--   2. correction only through metadata override=true plus a non-empty
--      override_reason, audited with previous and new notice date/ended_at;
--   3. a receipt before coalesce(actual_start_date, starts_at) or before
--      signed_at::date is rejected (termination_notice_before_contract_start);
--   4. terminated/cancelled keep a recorded notice date silently (status and
--      ended_at still change); only the audited override replaces it;
--   5. receipt dates are Europe/Stockholm calendar dates; an override that
--      moves the date of a contract with ended_at requires p_derived_ends_at;
--   6. a BEFORE UPDATE trigger blocks changing/clearing a recorded notice
--      date outside the command (transaction-local writer marker).

begin;

create or replace function public.gridex_record_customer_contract_event_v1(
  p_company_id uuid,
  p_customer_contract_id uuid,
  p_customer_id uuid,
  p_event_type text,
  p_happened_at timestamptz default now(),
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_derived_ends_at timestamptz default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_contract public.customer_contracts%rowtype;
  v_event public.customer_contract_events%rowtype;
  v_previous_status text;
  v_new_status text;
  v_domain_event_id uuid;
  v_notice_date date := (p_happened_at at time zone 'Europe/Stockholm')::date;
  v_notice_override boolean := false;
  v_notice_override_reason text;
  v_notice_audit jsonb;
  v_previous_notice_date date;
  v_previous_ended_at timestamptz;
  v_idempotency_key text := coalesce(
    nullif(btrim(p_idempotency_key), ''),
    encode(digest(
      concat_ws(
        ':',
        p_company_id,
        p_customer_contract_id,
        p_event_type,
        p_happened_at,
        coalesce(p_note, '')
      ),
      'sha256'
    ), 'hex')
  );
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'customer_contract_event_service_role_required';
  end if;
  if p_company_id is null
     or p_customer_contract_id is null
     or p_customer_id is null
     or p_event_type not in (
       'created', 'signature_requested', 'signed', 'activated', 'updated',
       'termination_notice_received', 'terminated', 'cancelled', 'note'
     ) then
    raise exception using
      errcode = '22023',
      message = 'customer_contract_event_payload_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_company_id::text || ':' || p_customer_contract_id::text, 0)
  );
  select *
  into v_contract
  from public.customer_contracts contract
  where contract.id = p_customer_contract_id
    and contract.company_id = p_company_id
    and contract.customer_id = p_customer_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'customer_contract_not_found_for_tenant';
  end if;

  select *
  into v_event
  from public.customer_contract_events event
  where event.company_id = p_company_id
    and event.customer_contract_id = p_customer_contract_id
    and event.metadata->>'idempotency_key' = v_idempotency_key
  order by event.created_at
  limit 1;
  if found then
    return jsonb_build_object(
      'event', to_jsonb(v_event),
      'contract_status', v_contract.status,
      'existing', true
    );
  end if;

  if p_event_type in ('termination_notice_received', 'terminated', 'cancelled') then
    v_notice_override := coalesce(p_metadata->>'override', '') = 'true';
    v_notice_override_reason := nullif(btrim(coalesce(p_metadata->>'override_reason', '')), '');
    if v_notice_override and v_notice_override_reason is null then
      raise exception using
        errcode = '22023',
        message = 'termination_notice_override_reason_required';
    end if;
  end if;
  if p_event_type = 'termination_notice_received' then
    if v_notice_date < coalesce(v_contract.actual_start_date, v_contract.starts_at)
       or v_notice_date < (v_contract.signed_at at time zone 'Europe/Stockholm')::date then
      raise exception using
        errcode = '23514',
        message = 'termination_notice_before_contract_start';
    end if;
    if v_notice_override
       and v_contract.termination_notice_date is distinct from v_notice_date
       and v_contract.ended_at is not null
       and p_derived_ends_at is null then
      -- Never keep an end derived from the replaced notice date.
      raise exception using
        errcode = '22023',
        message = 'termination_notice_override_ends_at_required';
    end if;
    if v_contract.termination_notice_date is not null and not v_notice_override then
      if v_contract.termination_notice_date <> v_notice_date then
        raise exception using
          errcode = '23514',
          message = 'termination_notice_already_recorded';
      end if;
      select *
      into v_event
      from public.customer_contract_events event
      where event.company_id = p_company_id
        and event.customer_contract_id = p_customer_contract_id
        and event.event_type = 'termination_notice_received'
        and (event.happened_at at time zone 'Europe/Stockholm')::date = v_notice_date
      order by event.created_at
      limit 1;
      if found then
        return jsonb_build_object(
          'event', to_jsonb(v_event),
          'contract_status', v_contract.status,
          'existing', true
        );
      end if;
    end if;
  end if;

  v_previous_status := v_contract.status;
  v_new_status := v_contract.status;

  if p_event_type = 'signed' then
    -- Only the canonical signature finalizer may transition a contract to
    -- signed. This event merely records that already-committed evidence.
    if v_contract.status <> 'signed'
       or v_contract.signed_at is null
       or v_contract.locked_at is null
       or nullif(v_contract.signature_snapshot_sha256, '') is null
       or v_contract.contract_publication_version_id is null
       or v_contract.contract_product_version_id is null
       or v_contract.legal_bundle_version_id is null
       or v_contract.contract_price_snapshot_id is null then
      raise exception using
        errcode = '23514',
        message = 'signed_event_requires_canonical_signature_evidence';
    end if;
  elsif p_event_type = 'activated' then
    -- Supply activation is a larger atomic graph and must use its dedicated
    -- command, which also writes the supply period and switch confirmation.
    raise exception using
      errcode = '23514',
      message = 'use_gridex_activate_customer_supply_v1';
  elsif p_event_type in ('terminated', 'cancelled') then
    v_new_status := case
      when p_event_type = 'terminated' then 'terminated'
      else 'cancelled'
    end;
    v_previous_notice_date := v_contract.termination_notice_date;
    v_previous_ended_at := v_contract.ended_at;
    perform set_config('gridex.contract_event_writer', 'on', true);
    update public.customer_contracts
    set status = v_new_status,
        ended_at = coalesce(
          nullif(p_metadata->>'ended_at', '')::timestamptz,
          nullif(p_metadata->>'ends_at', '')::timestamptz,
          p_happened_at,
          ended_at
        ),
        -- Lifecycle close, supply end and archive always pass today's date;
        -- a recorded notice is kept silently unless explicitly overridden.
        termination_notice_date = case
          when v_notice_override then coalesce(
            (nullif(p_metadata->>'termination_notice_date', '')::timestamptz
              at time zone 'Europe/Stockholm')::date,
            termination_notice_date
          )
          else coalesce(
            termination_notice_date,
            (nullif(p_metadata->>'termination_notice_date', '')::timestamptz
              at time zone 'Europe/Stockholm')::date
          )
        end,
        termination_reason = coalesce(
          nullif(p_metadata->>'termination_reason', ''),
          termination_reason
        ),
        withdrawal_requested_at = coalesce(
          nullif(p_metadata->>'withdrawal_requested_at', '')::timestamptz,
          withdrawal_requested_at
        ),
        rejected_reason = coalesce(
          nullif(p_metadata->>'rejected_reason', ''),
          rejected_reason
        ),
        status_reason_code = coalesce(
          nullif(p_metadata->>'reason_code', ''),
          status_reason_code,
          p_event_type
        ),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'status_reason_code',
            nullif(p_metadata->>'reason_code', '')
          ),
        updated_by = p_actor_user_id,
        updated_at = now()
    where id = p_customer_contract_id
      and company_id = p_company_id
    returning termination_notice_date, ended_at
    into v_contract.termination_notice_date, v_contract.ended_at;
    perform set_config('gridex.contract_event_writer', '', true);
    if v_notice_override
       and v_contract.termination_notice_date is distinct from v_previous_notice_date then
      v_notice_audit := jsonb_build_object(
        'reason', v_notice_override_reason,
        'previous_termination_notice_date', v_previous_notice_date,
        'previous_ended_at', v_previous_ended_at,
        'new_termination_notice_date', v_contract.termination_notice_date,
        'new_ended_at', v_contract.ended_at
      );
    end if;
  elsif p_event_type = 'termination_notice_received' then
    v_previous_notice_date := v_contract.termination_notice_date;
    v_previous_ended_at := v_contract.ended_at;
    perform set_config('gridex.contract_event_writer', 'on', true);
    update public.customer_contracts
    set termination_notice_date = v_notice_date,
        ended_at = coalesce(p_derived_ends_at, ended_at),
        updated_by = p_actor_user_id,
        updated_at = now()
    where id = p_customer_contract_id
      and company_id = p_company_id
    returning termination_notice_date, ended_at
    into v_contract.termination_notice_date, v_contract.ended_at;
    perform set_config('gridex.contract_event_writer', '', true);
    if v_notice_override then
      v_notice_audit := jsonb_build_object(
        'reason', v_notice_override_reason,
        'previous_termination_notice_date', v_previous_notice_date,
        'previous_ended_at', v_previous_ended_at,
        'new_termination_notice_date', v_contract.termination_notice_date,
        'new_ended_at', v_contract.ended_at
      );
    end if;
  end if;

  insert into public.customer_contract_events(
    company_id,
    customer_contract_id,
    customer_id,
    event_type,
    happened_at,
    note,
    metadata,
    actor_user_id
  ) values (
    p_company_id,
    p_customer_contract_id,
    p_customer_id,
    p_event_type,
    p_happened_at,
    p_note,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object('idempotency_key', v_idempotency_key)
      || case
        when v_notice_audit is null then '{}'::jsonb
        else jsonb_build_object('termination_notice_override', v_notice_audit)
      end,
    p_actor_user_id
  )
  returning * into v_event;

  insert into public.domain_events(
    company_id,
    event_type,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    source,
    idempotency_key,
    payload
  ) values (
    p_company_id,
    'contract.event.recorded',
    'customer_contract',
    p_customer_contract_id,
    p_actor_user_id,
    'gridex_record_customer_contract_event_v1',
    'customer-contract-event:' || v_idempotency_key,
    jsonb_build_object(
      'customer_contract_event_id', v_event.id,
      'customer_id', p_customer_id,
      'event_type', p_event_type,
      'previous_status', v_previous_status,
      'new_status', v_new_status
    ) || case
      when v_notice_audit is null then '{}'::jsonb
      else jsonb_build_object('termination_notice_override', v_notice_audit)
    end
  )
  on conflict do nothing
  returning id into v_domain_event_id;

  if v_domain_event_id is not null then
    insert into public.event_outbox(
      company_id,
      domain_event_id,
      destination_type,
      destination_key,
      payload
    ) values (
      p_company_id,
      v_domain_event_id,
      'webhook',
      'contract.event.recorded',
      jsonb_build_object(
        'domain_event_id', v_domain_event_id,
        'customer_contract_id', p_customer_contract_id,
        'event_type', p_event_type
      )
    ) on conflict do nothing;
  end if;

  return jsonb_build_object(
    'event', to_jsonb(v_event),
    'contract_status', v_new_status,
    'existing', false
  );
end
$$;

revoke all on function public.gridex_record_customer_contract_event_v1(
  uuid, uuid, uuid, text, timestamptz, text, jsonb, uuid, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.gridex_record_customer_contract_event_v1(
  uuid, uuid, uuid, text, timestamptz, text, jsonb, uuid, timestamptz, text
) to service_role;

comment on function public.gridex_record_customer_contract_event_v1(
  uuid, uuid, uuid, text, timestamptz, text, jsonb, uuid, timestamptz, text
) is
  'Atomic, tenant-scoped customer-contract event command. Signed events require pre-existing canonical evidence; activation is reserved for the supply activation graph. Termination notices: first valid receipt wins, corrections require an audited override with reason, receipts before contract start or signing are rejected.';

-- Direct table writes (e.g. the customer card update) may set the first
-- notice date, but changing or clearing a recorded date requires the event
-- command above, which enforces override reason and audit.
create or replace function public.gridex_guard_customer_contract_termination_notice_v1()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if old.termination_notice_date is not null
     and new.termination_notice_date is distinct from old.termination_notice_date
     and coalesce(current_setting('gridex.contract_event_writer', true), '') <> 'on' then
    raise exception using
      errcode = '23514',
      message = 'termination_notice_already_recorded';
  end if;
  -- First direct setting: same start/signing check as the command. When
  -- start and signing are both unknown the comparison is null and the first
  -- setting is allowed (nothing to compare against yet).
  if old.termination_notice_date is null
     and new.termination_notice_date is not null
     and coalesce(current_setting('gridex.contract_event_writer', true), '') <> 'on'
     and (new.termination_notice_date < coalesce(new.actual_start_date, new.starts_at)
       or new.termination_notice_date
         < (new.signed_at at time zone 'Europe/Stockholm')::date) then
    raise exception using
      errcode = '23514',
      message = 'termination_notice_before_contract_start';
  end if;
  return new;
end
$$;

revoke all on function public.gridex_guard_customer_contract_termination_notice_v1()
  from public, anon, authenticated;

drop trigger if exists customer_contracts_termination_notice_first_wins
  on public.customer_contracts;
create trigger customer_contracts_termination_notice_first_wins
before update on public.customer_contracts
for each row execute function public.gridex_guard_customer_contract_termination_notice_v1();

commit;
