-- Customer support admission and its new object commit in one transaction.
-- The existing API assertion/idempotency owner still authenticates the caller.
-- This private row serializes both commands per tenant/customer. Updating it
-- also forces stale REPEATABLE READ transactions to fail with serialization
-- errors instead of admitting from an old count snapshot. It is not a counter.
create schema if not exists gridex_private;
create table gridex_private.customer_support_quota_guards (
  company_id uuid not null,
  customer_id uuid not null,
  revision bigint not null default 0,
  primary key (company_id, customer_id),
  foreign key (customer_id, company_id) references public.customers(id, company_id) on delete cascade
);
alter table gridex_private.customer_support_quota_guards enable row level security;
revoke all on table gridex_private.customer_support_quota_guards from public, anon, authenticated, service_role;

create function public.gridex_create_customer_support_case_v1(
  p_company_id uuid, p_customer_id uuid, p_api_client_id uuid, p_portal_identity_id uuid,
  p_title text, p_message text, p_category text, p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog
set lock_timeout = '2s'
set statement_timeout = '5s'
as $$
declare
  v_case public.customer_cases%rowtype;
  v_case_id uuid;
  v_now timestamptz;
  v_reused boolean;
  v_reference text;
  v_category text := coalesce(nullif(btrim(p_category), ''), 'support');
  v_next_action text := 'Supportärendet ska triageras inom tenantens ordinarie ärendeflöde.';
  v_assessment jsonb;
  v_payload jsonb;
  v_count integer;
begin
  if p_company_id is null or p_customer_id is null or p_api_client_id is null
    or p_title is null or length(btrim(p_title)) not between 1 and 180
    or p_message is null or length(btrim(p_message)) not between 1 and 8000
    or length(v_category) > 120 or p_idempotency_key is null
    or length(btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'support_customer_command_invalid' using errcode = '22023';
  end if;
  perform 1 from public.customers where id = p_customer_id and company_id = p_company_id
    and merged_into_customer_id is null for key share;
  if not found then raise exception 'support_customer_not_found' using errcode = 'P0002'; end if;
  insert into gridex_private.customer_support_quota_guards(company_id, customer_id)
    values (p_company_id, p_customer_id)
    on conflict (company_id, customer_id) do update
      set revision = gridex_private.customer_support_quota_guards.revision + 1;
  v_now := clock_timestamp();

  -- Same-key replay precedes quota; neither another case nor another audit is
  -- charged. The old unique support key remains the physical dedupe boundary.
  select * into v_case from public.customer_cases
    where company_id = p_company_id and customer_id = p_customer_id
      and metadata->>'support_idempotency_key' = btrim(p_idempotency_key) for update;
  v_reused := found;
  if v_reused then
    if v_case.source is distinct from 'tenant_support_customer_portal'
      or v_case.case_type <> 'other' or v_case.metadata->>'support_case' is distinct from 'true'
      or v_case.metadata->>'opened_by' is distinct from 'customer'
      or v_case.metadata->>'description_visibility' is distinct from 'customer'
      or v_case.billing_blocked or v_case.billing_manual_review or v_case.cancellation_required then
      raise exception 'support_case_replay_scope_mismatch' using errcode = '23505';
    end if;
  else
    select count(*) into v_count from (
      select 1 from public.customer_cases
        where company_id = p_company_id and customer_id = p_customer_id
          and metadata->>'support_case' = 'true' and metadata->>'opened_by' = 'customer'
          and created_at >= v_now - interval '24 hours' limit 50
    ) recent;
    if v_count >= 50 then raise exception 'support_case_quota_exceeded' using errcode = 'P0001'; end if;
    v_case_id := gen_random_uuid();
    v_assessment := jsonb_build_object('isWithdrawal', false, 'withdrawalDeadlineAt', null,
      'withdrawalPossible', false, 'switchCanBeStopped', false, 'cancellationRequired', false,
      'cancellationStatus', 'not_required', 'scenario', 'not_withdrawal', 'nextAction', v_next_action,
      'billingBlocked', false, 'billingManualReview', false, 'breakFeeFlagged', false);
    -- Fixed non-operational 'other' support policy matches the established
    -- shared command. No caller may supply withdrawal/operational flags.
    insert into public.customer_cases(id, company_id, customer_id, case_type, status, priority,
      title, description, reason_category, source, metadata, next_action,
      billing_blocked, billing_manual_review, cancellation_required, cancellation_status,
      withdrawal_possible, switch_can_be_stopped, withdrawal_scenario, break_fee_flagged,
      created_by, updated_by, created_at, updated_at)
    values (v_case_id, p_company_id, p_customer_id, 'other', 'open', 'normal', btrim(p_title), btrim(p_message),
      v_category, 'tenant_support_customer_portal', jsonb_build_object('support_case', true,
        'support_channel', 'customer_portal', 'support_idempotency_key', btrim(p_idempotency_key),
        'description_visibility', 'customer', 'opened_by', 'customer', 'api_client_id', p_api_client_id,
        'portal_identity_id', p_portal_identity_id, 'prodatSentAt', null, 'assessment', v_assessment),
      v_next_action, false, false, false, 'not_required', false, false, 'not_withdrawal', false,
      null, null, v_now, v_now) returning * into v_case;
    insert into public.customer_case_events(company_id, customer_case_id, customer_id, event_type,
      event_status, message, payload, created_by)
    values (p_company_id, v_case.id, p_customer_id, 'created', 'info',
      'Annan orsak registrerat. ' || v_next_action, jsonb_build_object('assessment', v_assessment), null);
    -- Match the old shared command's action, attribution and pre-reference row.
    insert into public.audit_logs(company_id, actor_user_id, entity_type, entity_id, action, new_values, metadata)
    values (p_company_id, null, 'customer_case', v_case.id::text, 'customer_case_registered',
      to_jsonb(v_case), jsonb_build_object('customer_id', p_customer_id));
  end if;

  v_reference := 'support_case_' || substr(translate(rtrim(encode(sha256(convert_to(
    'gridex-public-reference:v1:' || p_company_id::text || ':support_case:' || v_case.id::text,
    'UTF8')), 'base64'), '='), '+/', '-_'), 1, 32);
  if v_case.metadata->>'support_public_reference' is distinct from v_reference then
    update public.customer_cases set metadata = metadata || jsonb_build_object('support_public_reference', v_reference)
      where id = v_case.id and company_id = p_company_id and customer_id = p_customer_id returning * into v_case;
  end if;
  if not exists (select 1 from public.customer_case_events where company_id = p_company_id
    and customer_id = p_customer_id and customer_case_id = v_case.id and event_type = 'support_customer_message') then
    -- Repair only the retained original body, never new replay input or an
    -- unqualified internal case. New commands cannot leave a partial first body.
    if v_case.description is null or length(btrim(v_case.description)) not between 1 and 8000 then
      raise exception 'support_legacy_repair_unavailable' using errcode = 'P0001';
    end if;
    v_payload := jsonb_build_object('visibility', 'customer', 'author_type', 'customer', 'channel', 'customer_portal',
      'api_client_id', v_case.metadata->'api_client_id', 'portal_identity_id', v_case.metadata->'portal_identity_id');
    insert into public.customer_case_events(company_id, customer_case_id, customer_id, event_type,
      event_status, message, payload, created_by, created_at)
    values (p_company_id, v_case.id, p_customer_id, 'support_customer_message', 'info', v_case.description, v_payload, null, v_now);
  end if;
  -- Existing policy: opening a case has the 50/day gate. Its first message
  -- contributes to later hourly counts but opening has no extra 150/hour gate.
  return jsonb_build_object('case', to_jsonb(v_case), 'reused', v_reused);
end;
$$;

create function public.gridex_add_customer_support_message_v1(
  p_company_id uuid, p_customer_id uuid, p_case_id uuid,
  p_api_client_id uuid, p_portal_identity_id uuid, p_message text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog
set lock_timeout = '2s'
set statement_timeout = '5s'
as $$
declare
  v_case public.customer_cases%rowtype;
  v_event public.customer_case_events%rowtype;
  v_now timestamptz;
  v_count integer;
begin
  if p_company_id is null or p_customer_id is null or p_case_id is null or p_api_client_id is null
    or p_message is null or length(btrim(p_message)) not between 1 and 8000 then
    raise exception 'support_customer_command_invalid' using errcode = '22023';
  end if;
  perform 1 from public.customers where id = p_customer_id and company_id = p_company_id
    and merged_into_customer_id is null for key share;
  if not found then raise exception 'support_customer_not_found' using errcode = 'P0002'; end if;
  insert into gridex_private.customer_support_quota_guards(company_id, customer_id)
    values (p_company_id, p_customer_id)
    on conflict (company_id, customer_id) do update
      set revision = gridex_private.customer_support_quota_guards.revision + 1;
  select * into v_case from public.customer_cases where company_id = p_company_id and customer_id = p_customer_id
    and id = p_case_id and metadata->>'support_case' = 'true' for update;
  if not found then raise exception 'support_case_not_found' using errcode = 'P0002'; end if;
  if v_case.status in ('resolved', 'cancelled', 'closed') then
    raise exception 'support_case_closed' using errcode = 'P0001';
  end if;
  v_now := clock_timestamp();
  select count(*) into v_count from (
    select 1 from public.customer_case_events
      where company_id = p_company_id and customer_id = p_customer_id and event_type = 'support_customer_message'
        and created_at >= v_now - interval '1 hour' limit 150
  ) recent;
  if v_count >= 150 then raise exception 'support_message_quota_exceeded' using errcode = 'P0001'; end if;
  insert into public.customer_case_events(company_id, customer_case_id, customer_id, event_type,
    event_status, message, payload, created_by, created_at)
  values (p_company_id, p_case_id, p_customer_id, 'support_customer_message', 'info', btrim(p_message),
    jsonb_build_object('visibility', 'customer', 'author_type', 'customer', 'channel', 'customer_portal',
      'api_client_id', p_api_client_id, 'portal_identity_id', p_portal_identity_id), null, v_now)
  returning * into v_event;
  return to_jsonb(v_event);
end;
$$;
revoke all on function public.gridex_create_customer_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.gridex_add_customer_support_message_v1(uuid,uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.gridex_create_customer_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.gridex_add_customer_support_message_v1(uuid,uuid,uuid,uuid,uuid,text) to service_role;
