-- Regression for production defect:
-- canonical_provision_company failed with canonical_request_hash_mismatch after
-- the v3 wrapper normalized request_payload without rebinding request_hash.
--
-- Runs only against the ephemeral clean-replay database and rolls back all
-- fixture data.

begin;

do $regression$
declare
  v_actor uuid := '10000000-0000-4000-8000-000000000001'::uuid;
  v_key text := 'regression:tenant-provision:request-hash';
  v_command jsonb;
  v_changed jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_company_id uuid;
  v_expected_hash text;
  v_count bigint;
  v_mismatch_rejected boolean := false;
begin
  insert into auth.users(
    id,
    aud,
    role,
    email,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data
  ) values (
    v_actor,
    'authenticated',
    'authenticated',
    'canonical-provision-hash-regression@example.invalid',
    now(),
    '{}'::jsonb,
    '{}'::jsonb
  );

  insert into public.user_profiles(id,email,user_status,auth_email_confirmed_at)
  values(
    v_actor,
    'canonical-provision-hash-regression@example.invalid',
    'active',
    now()
  )
  on conflict(id) do update
  set email=excluded.email,
      user_status='active',
      auth_email_confirmed_at=excluded.auth_email_confirmed_at;

  insert into public.admin_users(user_id,role,is_active)
  values(v_actor,'super_admin',true);

  v_command := jsonb_build_object(
    'company_id', null,
    'name', 'Canonical Provision Hash Regression AB',
    'slug', 'canonical-provision-hash-regression',
    'organization_number', '559900-0006',
    'billing_reference', 'regression',
    'customer_number_prefix', 'cp',
    'company_status', 'pending',
    'idempotency_key', v_key,
    'actor_user_id', v_actor
  );

  v_expected_hash := public.canonical_json_sha256(v_command - 'actor_user_id');

  v_first := public.canonical_provision_company(v_command);
  v_company_id := nullif(v_first->>'company_id','')::uuid;

  if v_company_id is null then
    raise exception 'regression_company_id_missing';
  end if;

  if not exists(
    select 1
    from public.companies
    where id=v_company_id
      and slug='canonical-provision-hash-regression'
      and org_number='559900-0006'
      and customer_number_prefix='CP'
  ) then
    raise exception 'regression_company_persistence_mismatch';
  end if;

  select count(*) into v_count
  from public.canonical_provisioning_requests
  where idempotency_key=v_key
    and company_id=v_company_id;
  if v_count <> 1 then
    raise exception 'regression_provisioning_request_count:%',v_count;
  end if;

  if not exists(
    select 1
    from public.canonical_provisioning_requests
    where idempotency_key=v_key
      and request_payload=(v_command - 'actor_user_id')
      and request_hash=v_expected_hash
      and request_hash=public.canonical_json_sha256(request_payload)
      and result_payload is not null
      and completed_at is not null
  ) then
    raise exception 'regression_provisioning_request_hash_binding_failed';
  end if;

  select count(*) into v_count
  from public.canonical_command_results
  where company_id=v_company_id
    and command_type='tenant.provision'
    and idempotency_key=v_key;
  if v_count <> 1 then
    raise exception 'regression_command_result_count:%',v_count;
  end if;

  if not exists(
    select 1
    from public.canonical_command_results
    where company_id=v_company_id
      and command_type='tenant.provision'
      and idempotency_key=v_key
      and request_payload=(v_command - 'actor_user_id')
      and request_hash=v_expected_hash
      and request_hash=public.canonical_json_sha256(request_payload)
  ) then
    raise exception 'regression_command_result_hash_binding_failed';
  end if;

  v_replay := public.canonical_provision_company(v_command);
  if nullif(v_replay->>'company_id','')::uuid is distinct from v_company_id then
    raise exception 'regression_replay_company_changed';
  end if;

  select count(*) into v_count
  from public.companies
  where slug='canonical-provision-hash-regression';
  if v_count <> 1 then
    raise exception 'regression_replay_created_duplicate_company:%',v_count;
  end if;

  select count(*) into v_count
  from public.canonical_command_results
  where company_id=v_company_id
    and command_type='tenant.provision'
    and idempotency_key=v_key;
  if v_count <> 1 then
    raise exception 'regression_replay_created_duplicate_command_result:%',v_count;
  end if;

  v_changed := jsonb_set(v_command,'{name}','"Changed Payload Must Fail"'::jsonb);
  begin
    perform public.canonical_provision_company(v_changed);
  exception
    when others then
      if sqlerrm = 'idempotency_key_payload_mismatch' then
        v_mismatch_rejected := true;
      else
        raise;
      end if;
  end;

  if not v_mismatch_rejected then
    raise exception 'regression_changed_payload_was_not_rejected';
  end if;
end;
$regression$;

rollback;
