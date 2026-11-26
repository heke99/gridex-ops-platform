-- A legacy support marker does not qualify an Ediel operational case as a customer support conversation.
create or replace function public.gridex_add_customer_support_message_v1(
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
    and id = p_case_id and metadata->>'support_case' = 'true'
    and source is distinct from 'ediel_inbound_state_machine' for update;
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
