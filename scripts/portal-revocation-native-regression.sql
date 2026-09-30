-- Synthetic rows in the local clean-replay database; no persistent fixture.
begin;

insert into public.companies(id, name)
values ('00000000-0000-4000-8000-00000000c001', 'Portal revocation regression');

insert into public.customers(id, company_id, customer_number, name, customer_type)
values ('00000000-0000-4000-8000-00000000c101',
        '00000000-0000-4000-8000-00000000c001', 'PORTAL-C-1',
        'Portal customer', 'private');

-- The real website trigger creates both links in the same transaction.
insert into public.website_customer_applications(
  id, company_id, customer_id, external_customer_id, customer_number, payload
) values (
  '00000000-0000-4000-8000-00000000c201',
  '00000000-0000-4000-8000-00000000c001',
  '00000000-0000-4000-8000-00000000c101',
  'PORTAL-EXT-1', 'PORTAL-C-1',
  '{"auth_user_id":"00000000-0000-4000-8000-00000000c301","customer_portal_user_id":"00000000-0000-4000-8000-00000000c301"}'::jsonb
);

do $check$
begin
  if not exists (
    select 1 from public.customer_portal_identities
    where company_id = '00000000-0000-4000-8000-00000000c001'
      and external_customer_id = 'PORTAL-EXT-1' and status = 'active'
  ) or not exists (
    select 1 from public.customer_portal_accounts
    where company_id = '00000000-0000-4000-8000-00000000c001'
      and portal_user_id = '00000000-0000-4000-8000-00000000c301'
      and status = 'active' and is_active
  ) then
    raise exception 'website trigger did not issue an active linked pair';
  end if;
end
$check$;

-- A tenant pause writes these markers. Ordinary retry, even with the same
-- identity and customer, must fail on the locked old row.
update public.customer_portal_identities
set status = 'disabled',
    metadata = metadata || '{"lifecycle_paused_by_tenant":true,"lifecycle_previous_status":"active","lifecycle_status":"paused"}'::jsonb
where external_customer_id = 'PORTAL-EXT-1'
  and company_id = '00000000-0000-4000-8000-00000000c001';

do $check$
declare v_message text;
begin
  begin
    insert into public.customer_portal_identities(
      company_id, customer_id, provider, external_customer_id, auth_user_id,
      customer_portal_user_id, status, match_strength
    ) values (
      '00000000-0000-4000-8000-00000000c001',
      '00000000-0000-4000-8000-00000000c101', 'gridex_website',
      'PORTAL-EXT-1', '00000000-0000-4000-8000-00000000c301',
      '00000000-0000-4000-8000-00000000c301', 'active', 'strong'
    ) on conflict (company_id, provider, external_customer_id)
      do update set status = excluded.status;
    raise exception 'sync upsert revived a disabled identity';
  exception when check_violation then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'customer_portal_identity_revoked' then raise; end if;
  end;

  begin
    update public.website_customer_applications
    set updated_at = now()
    where id = '00000000-0000-4000-8000-00000000c201';
    raise exception 'website retry revived a disabled identity';
  exception when check_violation then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'customer_portal_identity_revoked' then raise; end if;
  end;

  if not exists (
    select 1 from public.customer_portal_identities
    where external_customer_id = 'PORTAL-EXT-1' and status = 'disabled'
      and metadata->>'lifecycle_previous_status' = 'active'
  ) then
    raise exception 'identity tombstone was changed by a failed retry';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.canonical_transition_tenant_lifecycle(uuid,text,bigint,text,uuid,text)'::regprocedure
      and proconfig @> array['application_name=gridex_portal_lifecycle_resume_v1']
  ) then
    raise exception 'canonical tenant resume is missing its scoped marker';
  end if;
end
$check$;

-- The exact transition made by canonical tenant resume is still possible.
-- Its scoped marker alone cannot change the binding or preserve pause flags.
select set_config('application_name', 'gridex_portal_lifecycle_resume_v1', true);
do $check$
declare v_message text;
begin
  begin
    update public.customer_portal_identities set status = 'active'
    where external_customer_id = 'PORTAL-EXT-1';
    raise exception 'lifecycle marker alone bypassed the transition shape';
  exception when check_violation then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'customer_portal_identity_revoked' then raise; end if;
  end;
end
$check$;

update public.customer_portal_identities
set status = 'active',
    metadata = metadata - 'lifecycle_paused_by_tenant'
                        - 'lifecycle_previous_status' - 'lifecycle_status',
    updated_at = now()
where external_customer_id = 'PORTAL-EXT-1';
select set_config('application_name', 'portal-revocation-native-regression', true);

-- A disabled account with a stale true flag is a real historical state. The
-- original website trigger checked only the flag; its second guard rejects it.
update public.customer_portal_accounts
set status = 'disabled'
where portal_user_id = '00000000-0000-4000-8000-00000000c301';

do $check$
declare v_message text;
begin
  begin
    update public.customer_portal_accounts set status = 'active'
    where portal_user_id = '00000000-0000-4000-8000-00000000c301';
    raise exception 'account retry revived a disabled account';
  exception when check_violation then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'customer_portal_account_revoked' then raise; end if;
  end;

  begin
    update public.website_customer_applications
    set updated_at = now()
    where id = '00000000-0000-4000-8000-00000000c201';
    raise exception 'website retry accepted a disabled account';
  exception when check_violation then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'customer_portal_account_revoked' then raise; end if;
  end;

  if not exists (
    select 1 from public.customer_portal_accounts
    where portal_user_id = '00000000-0000-4000-8000-00000000c301'
      and status = 'disabled' and is_active
  ) then
    raise exception 'disabled account was changed by failed retry';
  end if;

  if has_table_privilege('authenticated', 'public.customer_portal_accounts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.customer_portal_identities', 'INSERT')
     or has_table_privilege('anon', 'public.customer_portal_accounts', 'UPDATE') then
    raise exception 'public Data API role retains a portal write grant';
  end if;
end
$check$;

rollback;
\echo PORTAL_REVOCATION_NATIVE_PASS
