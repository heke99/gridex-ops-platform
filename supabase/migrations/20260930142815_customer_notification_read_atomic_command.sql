-- Indexed public-reference v1 compatibility and transactional notification reads.
-- CLI unavailable in the implementation environment; filename uses actual UTC.
-- Apply only as a forward migration. No communication/outbox is emitted here.
begin;

-- The generated value covers historical rows and every INSERT/UPDATE producer.
-- Use the same UTF-8 SHA256, base64url and first 32 characters as
-- publicReference('notification', companyId, id). Never accept a caller's value.
alter table public.customer_notifications
  add column notification_reference text generated always as (
    'notification_' || substr(translate(encode(extensions.digest(
      'gridex-public-reference:v1:' || company_id::text || ':notification:' || id::text,
      'sha256'), 'base64'), '+/', '-_'), 1, 32)
  ) stored not null;

create unique index customer_notifications_company_customer_reference_uidx
  on public.customer_notifications(company_id, customer_id, notification_reference);

create or replace function public.gridex_mark_customer_notifications_read_v1(p_command jsonb)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog as $function$
declare
  v_company_id uuid;
  v_customer_id uuid;
  v_client_id uuid;
  v_subject text;
  v_key text;
  v_references text[];
  v_customer public.customers%rowtype;
  v_account public.customer_portal_accounts%rowtype;
  v_identity public.customer_portal_identities%rowtype;
  v_identity_count integer := 0;
  v_existing public.customer_portal_write_idempotency%rowtype;
  v_claim_id uuid;
  v_completed_id uuid;
  v_ids uuid[] := array[]::uuid[];
  v_notification public.customer_notifications%rowtype;
  v_hash text;
  v_compact_payload text;
  v_read_at timestamptz;
  v_updated integer;
  v_body jsonb;
  v_route constant text := '/api/v1/customer/notifications/read';
begin
  if current_user <> 'service_role' then
    raise exception 'notification_service_required' using errcode='42501';
  end if;
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    raise exception 'invalid_notification_command' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_command) as k(key)
    where k.key not in ('companyId','customerId','clientId','subject',
      'idempotencyKey','notificationReferences'))
    or exists(select 1 from jsonb_each(p_command) as e(key,value)
      where e.key <> 'notificationReferences' and jsonb_typeof(e.value)<>'string')
    or coalesce(p_command->>'companyId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'customerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command->>'clientId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(length(p_command->>'subject'),0) not between 1 and 255
    or coalesce(p_command->>'idempotencyKey','') !~ '^[A-Za-z0-9._:+~-]{8,200}$'
    or jsonb_typeof(p_command->'notificationReferences') is distinct from 'array'
  then raise exception 'invalid_notification_command' using errcode='22023'; end if;
  if jsonb_array_length(p_command->'notificationReferences') not between 1 and 100
    or exists(select 1 from jsonb_array_elements(p_command->'notificationReferences') as e(value)
      where jsonb_typeof(e.value)<>'string'
        or e.value#>>'{}' !~ '^notification_[A-Za-z0-9_-]{32}$')
  then raise exception 'invalid_notification_command' using errcode='22023'; end if;

  v_company_id:=(p_command->>'companyId')::uuid;
  v_customer_id:=(p_command->>'customerId')::uuid;
  v_client_id:=(p_command->>'clientId')::uuid;
  v_subject:=p_command->>'subject';
  v_key:=p_command->>'idempotencyKey';
  select array_agg(e.value order by e.ordinality) into v_references
    from jsonb_array_elements_text(p_command->'notificationReferences') with ordinality as e(value,ordinality);
  if (select count(distinct ref) from unnest(v_references) as r(ref)) <> cardinality(v_references) then
    raise exception 'invalid_notification_command' using errcode='22023';
  end if;

  -- Same lock order as the canonical contact command. Customer locking also
  -- serializes first-read timestamps and this customer's idempotency claims.
  select * into v_customer from public.customers
    where id=v_customer_id and company_id=v_company_id for update;
  if not found or v_customer.status='archived' or v_customer.archived_at is not null then
    raise exception 'notification_customer_unavailable' using errcode='42501';
  end if;
  perform 1 from public.companies c where c.id=v_company_id
    and c.is_active and c.status='active' for share;
  if not found then
    raise exception 'notification_tenant_unavailable' using errcode='42501';
  end if;
  perform 1 from public.integration_api_clients c
    where c.id=v_client_id and c.company_id=v_company_id
      and c.status='active' and c.revoked_at is null and c.deleted_at is null
      and (c.expires_at is null or c.expires_at>clock_timestamp())
      and c.scopes && array['customer_notifications.write','customer_portal.write','*']::text[]
    for share;
  if not found then
    raise exception 'notification_delegation_forbidden' using errcode='42501';
  end if;
  -- The service adapter has verified the issuer/signature/action. IDs and
  -- "verified" flags from a public request are never accepted as that evidence.
  -- Check the exact current account link again and hold its revocation lock.
  select * into v_account from public.customer_portal_accounts a
    where a.company_id=v_company_id and a.customer_id=v_customer_id
      and a.status='active' and a.is_active and a.role='owner'
      and (a.portal_user_id::text=v_subject
        or (a.portal_user_id is null and (a.user_id::text=v_subject or a.external_account_id=v_subject)))
    order by a.id limit 1 for share;
  if not found then
    raise exception 'notification_delegation_forbidden' using errcode='42501';
  end if;
  -- Matching identity rows are optional in legacy installations, but a revoked
  -- or ambiguous identity must not race the server guard and authorize replay.
  for v_identity in select i.* from public.customer_portal_identities i
    where i.company_id=v_company_id and i.customer_id=v_customer_id
      and (i.auth_user_id::text=v_subject or i.customer_portal_user_id::text=v_subject
        or i.external_account_id=v_subject) order by i.id for share
  loop
    v_identity_count:=v_identity_count+1;
    if v_identity.status <> 'active' or v_identity_count>1 then
      raise exception 'notification_delegation_forbidden' using errcode='42501';
    end if;
  end loop;

  -- strictRequest.ts canonicalJson is compact, with ordered array elements.
  -- Valid references are ASCII without JSON escapes, so this exact construction
  -- preserves every historical hash. jsonb::text adds whitespace and is wrong.
  select '{"notification_references":[' || string_agg('"'||r.ref||'"',',' order by r.ordinality) || ']}'
    into v_compact_payload from unnest(v_references) with ordinality as r(ref,ordinality);
  v_hash:=encode(extensions.digest(v_compact_payload,'sha256'),'hex');

  select * into v_existing from public.customer_portal_write_idempotency
    where company_id=v_company_id and api_client_id=v_client_id
      and customer_id=v_customer_id and route=v_route and idempotency_key=v_key for update;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception 'idempotency_conflict' using errcode='P0001';
    end if;
    if v_existing.status='completed' then
      -- Return exact stored legacy business response, never recompute it.
      return jsonb_build_object('statusCode',coalesce(v_existing.response_status,200),
        'body',v_existing.response_body,'replayed',true);
    elsif v_existing.status='failed' then
      raise exception 'idempotency_previous_attempt_failed' using errcode='P0001';
    else
      -- Old processing/failed rows may have effects from the former split
      -- transaction. Neither a timestamp nor a retry proves rollback.
      raise exception 'idempotency_in_progress' using errcode='P0001';
    end if;
  end if;

  -- Resolve and lock the complete set through the canonical composite index.
  -- Do not mutate any own row when even one requested reference is foreign.
  for v_notification in select n.* from public.customer_notifications n
    where n.company_id=v_company_id and n.customer_id=v_customer_id
      and n.notification_reference=any(v_references) order by n.id for update
  loop
    v_ids:=array_append(v_ids,v_notification.id);
  end loop;
  if cardinality(v_ids)<>cardinality(v_references) then
    raise exception 'notification_reference_not_found' using errcode='P0002';
  end if;

  v_read_at:=clock_timestamp();
  insert into public.customer_portal_write_idempotency(company_id,api_client_id,
    customer_id,route,idempotency_key,request_hash,status,started_at,updated_at)
  values(v_company_id,v_client_id,v_customer_id,v_route,v_key,v_hash,'processing',v_read_at,v_read_at)
    on conflict do nothing
    returning id into v_claim_id;
  if v_claim_id is null then
    -- An in-flight pre-upgrade wrapper may have inserted its claim without
    -- locking the customer. Preserve that row's completed/unsafe semantics
    -- after the unique-index wait instead of silently retrying its mutation.
    select * into v_existing from public.customer_portal_write_idempotency
      where company_id=v_company_id and api_client_id=v_client_id
        and customer_id=v_customer_id and route=v_route and idempotency_key=v_key for update;
    if not found then
      raise exception 'idempotency_in_progress' using errcode='P0001';
    end if;
    if v_existing.request_hash is distinct from v_hash then
      raise exception 'idempotency_conflict' using errcode='P0001';
    elsif v_existing.status='completed' then
      return jsonb_build_object('statusCode',coalesce(v_existing.response_status,200),
        'body',v_existing.response_body,'replayed',true);
    elsif v_existing.status='failed' then
      raise exception 'idempotency_previous_attempt_failed' using errcode='P0001';
    else
      raise exception 'idempotency_in_progress' using errcode='P0001';
    end if;
  end if;

  update public.customer_notifications set status='read',
    read_at=coalesce(read_at,v_read_at),updated_at=v_read_at
    where company_id=v_company_id and customer_id=v_customer_id
      and id=any(v_ids) and status='unread';
  get diagnostics v_updated=row_count;
  v_body:=jsonb_build_object('data',jsonb_build_object('updated_count',v_updated,
    'notification_references',to_jsonb(v_references),
    'read_at',to_char(v_read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));

  update public.customer_portal_write_idempotency set status='completed',
    response_status=200,response_body=v_body,completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=v_claim_id and company_id=v_company_id and api_client_id=v_client_id
      and customer_id=v_customer_id and route=v_route and idempotency_key=v_key
      and request_hash=v_hash and status='processing' returning id into v_completed_id;
  if v_completed_id is null then
    raise exception 'notification_completion_failed' using errcode='P0001';
  end if;
  -- Claim UUID preserves tenant/client/customer/route/key uniqueness even when
  -- different customers or API clients intentionally use the same public key.
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,
    aggregate_id,actor_user_id,reason,idempotency_key,before_state,after_state,metadata)
  values(v_company_id,'CUSTOMER_NOTIFICATIONS_READ_COMMAND','customer',v_customer_id,
    null,'delegated_customer','notification.read.v1:'||v_claim_id::text,
    jsonb_build_object('unreadRequested',v_updated),jsonb_build_object('updatedCount',v_updated),
    jsonb_build_object('clientId',v_client_id,'claimId',v_claim_id,'requestHash',v_hash,
      'subjectHash',encode(extensions.digest(v_subject,'sha256'),'hex'),
      'notificationReferences',to_jsonb(v_references)));
  -- An unhandled late completion/audit failure rolls back every write above.
  -- Mark-read has no external delivery effect and must not enqueue a message.
  return jsonb_build_object('statusCode',200,'body',v_body,'replayed',false);
end;
$function$;

revoke all on function public.gridex_mark_customer_notifications_read_v1(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.gridex_mark_customer_notifications_read_v1(jsonb) to service_role;
commit;
