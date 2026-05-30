-- Gridex DB1 / 03 of 03
-- Kör efter 02. Skapar säkra backfill-functions, RLS-bas, safety views och markerar DB1 som completed.
-- Ingen destruktiv dataoperation och ingen aggressiv merge. Idempotent.

-- 10B. DB1 backfill functions. These are explicit, safe and re-runnable.
-- They do not delete rows and do not merge ambiguous duplicates.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_db1_start_backfill_run(
  p_run_key text,
  p_source_scope text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
begin
  insert into public.backfill_runs (run_key, source_scope, status, started_at, completed_at, summary)
  values (p_run_key, p_source_scope, 'running', now(), null, '{}'::jsonb)
  on conflict (run_key) do update
  set status = 'running',
      source_scope = excluded.source_scope,
      started_at = now(),
      completed_at = null,
      rows_seen = 0,
      rows_inserted = 0,
      rows_updated = 0,
      rows_skipped = 0,
      rows_failed = 0,
      summary = '{}'::jsonb
  returning id into v_run_id;

  return v_run_id;
end;
$$;

create or replace function public.gridex_db1_finish_backfill_run(
  p_run_id uuid,
  p_status text,
  p_summary jsonb default '{}'::jsonb,
  p_rows_seen integer default 0,
  p_rows_inserted integer default 0,
  p_rows_updated integer default 0,
  p_rows_skipped integer default 0,
  p_rows_failed integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.backfill_runs
  set status = coalesce(p_status, 'completed'),
      completed_at = now(),
      rows_seen = coalesce(p_rows_seen, 0),
      rows_inserted = coalesce(p_rows_inserted, 0),
      rows_updated = coalesce(p_rows_updated, 0),
      rows_skipped = coalesce(p_rows_skipped, 0),
      rows_failed = coalesce(p_rows_failed, 0),
      summary = coalesce(p_summary, '{}'::jsonb)
  where id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'status', coalesce(p_status, 'completed'),
    'rows_seen', coalesce(p_rows_seen, 0),
    'rows_inserted', coalesce(p_rows_inserted, 0),
    'rows_updated', coalesce(p_rows_updated, 0),
    'rows_skipped', coalesce(p_rows_skipped, 0),
    'rows_failed', coalesce(p_rows_failed, 0),
    'summary', coalesce(p_summary, '{}'::jsonb)
  );
end;
$$;

create or replace function public.backfill_companies()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_before integer := 0;
  v_after integer := 0;
  v_company_id uuid;
  v_inserted integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_companies', 'companies');
  select count(*) into v_before from public.companies;
  v_company_id := public.gridex_db1_default_company_id();
  select count(*) into v_after from public.companies;
  v_inserted := greatest(v_after - v_before, 0);

  return public.gridex_db1_finish_backfill_run(
    v_run_id,
    'completed',
    jsonb_build_object('default_company_id', v_company_id, 'safe_default_only', true),
    v_after,
    v_inserted,
    0,
    0,
    0
  );
end;
$$;

create or replace function public.backfill_customers()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  r record;
  v_customer_id uuid;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_customers', 'customer_profiles');
  v_company_id := public.gridex_db1_default_company_id();

  if v_company_id is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'ambiguous_company'), 0, 0, 0, 1, 0);
  end if;

  if to_regclass('public.customer_profiles') is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'customer_profiles_missing'), 0, 0, 0, 1, 0);
  end if;

  for r in
    select * from public.customer_profiles
  loop
    v_seen := v_seen + 1;
    v_customer_id := null;
    begin
      select c.id
      into v_customer_id
      from public.customers c
      where c.company_id = v_company_id
        and (
          (r.email is not null and c.normalized_email = public.normalize_email(r.email))
          or (r.contract_customer_ref is not null and c.customer_number = r.contract_customer_ref)
        )
      order by c.created_at nulls last, c.id::text
      limit 1;

      if v_customer_id is null then
        insert into public.customers (
          company_id, customer_type, status, first_name, last_name, full_name, email, phone,
          preferred_language, source, customer_number, metadata, created_at, updated_at
        ) values (
          v_company_id, 'private', 'active', r.first_name, r.last_name,
          coalesce(nullif(r.full_name, ''), nullif(btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), '')),
          r.email, r.phone, coalesce(r.language_code, 'sv'), 'customer_profiles', r.contract_customer_ref,
          jsonb_build_object('source_table', 'customer_profiles', 'source_user_id', r.user_id, 'billing_customer_ref', r.billing_customer_ref, 'external_identity_ref', r.external_identity_ref),
          coalesce(r.created_at, now()), coalesce(r.updated_at, now())
        )
        returning id into v_customer_id;
        v_inserted := v_inserted + 1;
      else
        update public.customers c
        set first_name = coalesce(c.first_name, r.first_name),
            last_name = coalesce(c.last_name, r.last_name),
            full_name = coalesce(c.full_name, r.full_name),
            phone = coalesce(c.phone, r.phone),
            customer_number = coalesce(c.customer_number, r.contract_customer_ref),
            updated_at = now()
        where c.id = v_customer_id;
        v_updated := v_updated + 1;
      end if;

      insert into public.canonical_record_links (company_id, source_table, source_id, canonical_table, canonical_id, source_hash, confidence, status, details)
      values (
        v_company_id,
        'customer_profiles',
        r.user_id::text,
        'customers',
        v_customer_id,
        public.gridex_make_source_hash(to_jsonb(r)),
        'system',
        'active',
        jsonb_build_object('backfill', 'db1_backfill_customers')
      )
      on conflict (source_table, source_id, canonical_table) do update
      set company_id = excluded.company_id,
          canonical_id = excluded.canonical_id,
          source_hash = excluded.source_hash,
          status = 'active',
          details = excluded.details;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
      values (v_run_id, 'customer_profiles', coalesce(r.user_id::text, '<null>'), 'customers', 'failed', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('source_table', 'customer_profiles'), v_seen, v_inserted, v_updated, v_skipped, v_failed);
end;
$$;

create or replace function public.backfill_customer_sites()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  r record;
  v_customer_id uuid;
  v_site_id uuid;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_customer_sites', 'customer_delivery_points');
  v_company_id := public.gridex_db1_default_company_id();

  if v_company_id is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'ambiguous_company'), 0, 0, 0, 1, 0);
  end if;

  if to_regclass('public.customer_delivery_points') is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'customer_delivery_points_missing'), 0, 0, 0, 1, 0);
  end if;

  perform public.backfill_customers();

  for r in select * from public.customer_delivery_points loop
    v_seen := v_seen + 1;
    v_customer_id := null;
    v_site_id := null;
    begin
      select l.canonical_id into v_customer_id
      from public.canonical_record_links l
      where l.source_table = 'customer_profiles'
        and l.canonical_table = 'customers'
        and l.source_id = r.user_id::text
      limit 1;

      if v_customer_id is null then
        v_skipped := v_skipped + 1;
        insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
        values (v_run_id, 'customer_delivery_points', r.id::text, 'customer_sites', 'skipped', 'No canonical customer link for delivery point user_id.', jsonb_build_object('user_id', r.user_id));
        continue;
      end if;

      if r.facility_id is not null then
        select s.id into v_site_id
        from public.customer_sites s
        where s.company_id = v_company_id
          and s.normalized_facility_id = public.normalize_facility_id(r.facility_id)
        order by s.created_at nulls last, s.id::text
        limit 1;
      end if;

      if v_site_id is null then
        insert into public.customer_sites (
          company_id, customer_id, site_name, facility_id, status, price_area_code,
          move_in_date, move_out_date, street, postal_code, city, metadata, created_at, updated_at
        ) values (
          v_company_id, v_customer_id, coalesce(r.nickname, 'Anläggning'), r.facility_id, 'active', r.area_code,
          r.move_in_date, r.move_out_date, r.address, r.postal_code, r.city,
          jsonb_build_object('source_table', 'customer_delivery_points', 'source_id', r.id, 'network_area_ref', r.network_area_ref),
          coalesce(r.created_at, now()), coalesce(r.updated_at, now())
        ) returning id into v_site_id;
        v_inserted := v_inserted + 1;
      else
        update public.customer_sites s
        set customer_id = coalesce(s.customer_id, v_customer_id),
            street = coalesce(s.street, r.address),
            postal_code = coalesce(s.postal_code, r.postal_code),
            city = coalesce(s.city, r.city),
            price_area_code = coalesce(s.price_area_code, r.area_code),
            updated_at = now()
        where s.id = v_site_id;
        v_updated := v_updated + 1;
      end if;

      update public.customer_delivery_points
      set company_id = coalesce(company_id, v_company_id),
          customer_id = coalesce(customer_id, v_customer_id),
          customer_site_id = coalesce(customer_site_id, v_site_id)
      where id = r.id;

      insert into public.canonical_record_links (company_id, source_table, source_id, canonical_table, canonical_id, source_hash, confidence, status, details)
      values (v_company_id, 'customer_delivery_points', r.id::text, 'customer_sites', v_site_id, public.gridex_make_source_hash(to_jsonb(r)), 'system', 'active', jsonb_build_object('backfill', 'db1_backfill_customer_sites'))
      on conflict (source_table, source_id, canonical_table) do update
      set company_id = excluded.company_id,
          canonical_id = excluded.canonical_id,
          source_hash = excluded.source_hash,
          status = 'active',
          details = excluded.details;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
      values (v_run_id, 'customer_delivery_points', coalesce(r.id::text, '<null>'), 'customer_sites', 'failed', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('source_table', 'customer_delivery_points'), v_seen, v_inserted, v_updated, v_skipped, v_failed);
end;
$$;

create or replace function public.backfill_metering_points()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  r record;
  v_customer_id uuid;
  v_site_id uuid;
  v_metering_point_id uuid;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_metering_points', 'customer_delivery_points');
  v_company_id := public.gridex_db1_default_company_id();

  if v_company_id is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'ambiguous_company'), 0, 0, 0, 1, 0);
  end if;

  if to_regclass('public.customer_delivery_points') is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'customer_delivery_points_missing'), 0, 0, 0, 1, 0);
  end if;

  perform public.backfill_customer_sites();

  for r in select * from public.customer_delivery_points loop
    v_seen := v_seen + 1;
    v_customer_id := null;
    v_site_id := null;
    v_metering_point_id := null;
    begin
      if nullif(btrim(coalesce(r.external_metering_ref, '')), '') is null then
        v_skipped := v_skipped + 1;
        insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
        values (v_run_id, 'customer_delivery_points', r.id::text, 'metering_points', 'skipped', 'external_metering_ref is missing; facility_id is not treated as metering_point_id.', jsonb_build_object('facility_id', r.facility_id));
        continue;
      end if;

      select l.canonical_id into v_customer_id
      from public.canonical_record_links l
      where l.source_table = 'customer_profiles'
        and l.canonical_table = 'customers'
        and l.source_id = r.user_id::text
      limit 1;

      select l.canonical_id into v_site_id
      from public.canonical_record_links l
      where l.source_table = 'customer_delivery_points'
        and l.canonical_table = 'customer_sites'
        and l.source_id = r.id::text
      limit 1;

      if v_customer_id is null or v_site_id is null then
        v_skipped := v_skipped + 1;
        insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
        values (v_run_id, 'customer_delivery_points', r.id::text, 'metering_points', 'skipped', 'Missing canonical customer/site link.', jsonb_build_object('customer_id', v_customer_id, 'site_id', v_site_id));
        continue;
      end if;

      select mp.id into v_metering_point_id
      from public.metering_points mp
      where mp.company_id = v_company_id
        and mp.normalized_metering_point_id = public.gridex_normalize_metering_point_id(r.external_metering_ref)
      order by mp.created_at nulls last, mp.id::text
      limit 1;

      if v_metering_point_id is null then
        insert into public.metering_points (
          company_id, customer_id, site_id, metering_point_id, site_facility_id,
          status, price_area_code, start_date, end_date, metadata, created_at, updated_at
        ) values (
          v_company_id, v_customer_id, v_site_id, r.external_metering_ref, r.facility_id,
          'active', r.area_code, r.move_in_date, r.move_out_date,
          jsonb_build_object('source_table', 'customer_delivery_points', 'source_id', r.id, 'network_area_ref', r.network_area_ref),
          coalesce(r.created_at, now()), coalesce(r.updated_at, now())
        ) returning id into v_metering_point_id;
        v_inserted := v_inserted + 1;
      else
        update public.metering_points mp
        set customer_id = coalesce(mp.customer_id, v_customer_id),
            site_id = coalesce(mp.site_id, v_site_id),
            site_facility_id = coalesce(mp.site_facility_id, r.facility_id),
            price_area_code = coalesce(mp.price_area_code, r.area_code),
            updated_at = now()
        where mp.id = v_metering_point_id;
        v_updated := v_updated + 1;
      end if;

      update public.customer_delivery_points
      set metering_point_id = coalesce(metering_point_id, v_metering_point_id)
      where id = r.id;

      insert into public.canonical_record_links (company_id, source_table, source_id, canonical_table, canonical_id, source_hash, confidence, status, details)
      values (v_company_id, 'customer_delivery_points', r.id::text || ':metering_point', 'metering_points', v_metering_point_id, public.gridex_make_source_hash(to_jsonb(r)), 'system', 'active', jsonb_build_object('backfill', 'db1_backfill_metering_points'))
      on conflict (source_table, source_id, canonical_table) do update
      set company_id = excluded.company_id,
          canonical_id = excluded.canonical_id,
          source_hash = excluded.source_hash,
          status = 'active',
          details = excluded.details;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
      values (v_run_id, 'customer_delivery_points', coalesce(r.id::text, '<null>'), 'metering_points', 'failed', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('source_table', 'customer_delivery_points'), v_seen, v_inserted, v_updated, v_skipped, v_failed);
end;
$$;

create or replace function public.backfill_contracts()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  r record;
  v_customer_id uuid;
  v_site_id uuid;
  v_contract_id uuid;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_row_count integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_contracts', 'customer_contracts_contract_agreements');
  v_company_id := public.gridex_db1_default_company_id();

  if v_company_id is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'ambiguous_company'), 0, 0, 0, 1, 0);
  end if;

  perform public.backfill_customers();
  perform public.backfill_customer_sites();
  perform public.backfill_metering_points();

  update public.customer_contracts
  set company_id = v_company_id
  where company_id is null;
  get diagnostics v_row_count = row_count;
  v_updated := v_updated + v_row_count;

  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='customer_contracts' and column_name='user_id') then
    execute $sql$
      update public.customer_contracts cc
      set customer_id = l.canonical_id,
          company_id = coalesce(cc.company_id, l.company_id),
          updated_at = now()
      from public.canonical_record_links l
      where l.source_table = 'customer_profiles'
        and l.canonical_table = 'customers'
        and cc.user_id::text = l.source_id
        and cc.customer_id is null
    $sql$;
    get diagnostics v_row_count = row_count;
    v_updated := v_updated + v_row_count;
  end if;

  if to_regclass('public.contract_agreements') is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('contract_agreements', 'missing', 'customer_contracts_updated', v_updated), v_seen, v_inserted, v_updated, v_skipped, v_failed);
  end if;

  for r in select * from public.contract_agreements loop
    v_seen := v_seen + 1;
    v_customer_id := null;
    v_site_id := null;
    v_contract_id := null;
    begin
      select l.canonical_id into v_contract_id
      from public.canonical_record_links l
      where l.source_table = 'contract_agreements'
        and l.source_id = r.id::text
        and l.canonical_table = 'customer_contracts'
      limit 1;

      if v_contract_id is not null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if r.canonical_customer_id is not null then
        v_customer_id := r.canonical_customer_id;
      end if;

      if v_customer_id is null and r.email is not null then
        select c.id into v_customer_id
        from public.customers c
        where c.company_id = v_company_id
          and c.normalized_email = public.normalize_email(r.email)
        order by c.created_at nulls last, c.id::text
        limit 1;
      end if;

      if v_customer_id is null and r.customer_number is not null then
        select c.id into v_customer_id
        from public.customers c
        where c.company_id = v_company_id
          and c.customer_number = r.customer_number
        order by c.created_at nulls last, c.id::text
        limit 1;
      end if;

      if v_customer_id is null then
        insert into public.customers (
          company_id, customer_type, status, first_name, last_name, personal_number, email, phone,
          source, customer_number, metadata, created_at, updated_at
        ) values (
          v_company_id, 'private', 'active', r.first_name, r.last_name, r.personal_number, r.email, r.phone,
          'contract_agreements', r.customer_number,
          jsonb_build_object('source_table', 'contract_agreements', 'source_id', r.id),
          coalesce(r.created_at, now()), coalesce(r.updated_at, now())
        ) returning id into v_customer_id;
        v_inserted := v_inserted + 1;
      end if;

      if nullif(btrim(coalesce(r.facility_id, '')), '') is not null then
        select s.id into v_site_id
        from public.customer_sites s
        where s.company_id = v_company_id
          and s.normalized_facility_id = public.normalize_facility_id(r.facility_id)
        order by s.created_at nulls last, s.id::text
        limit 1;

        if v_site_id is null then
          insert into public.customer_sites (
            company_id, customer_id, site_name, facility_id, status, street, postal_code, city, move_in_date, metadata, created_at, updated_at
          ) values (
            v_company_id, v_customer_id, 'Anläggning', r.facility_id, 'active', coalesce(r.street, r.address), r.postal_code, r.city, r.move_in_date,
            jsonb_build_object('source_table', 'contract_agreements', 'source_id', r.id),
            coalesce(r.created_at, now()), coalesce(r.updated_at, now())
          ) returning id into v_site_id;
          v_inserted := v_inserted + 1;
        end if;
      end if;

      insert into public.customer_contracts (
        company_id, customer_id, site_id, source_type, status, contract_name,
        campaign_code, contract_version, starts_at, expected_start_at, signed_at,
        invoice_email, billing_street, billing_postal_code, billing_city,
        metadata, created_at, updated_at
      ) values (
        v_company_id, v_customer_id, v_site_id, 'contract_agreement', coalesce(r.status::text, 'draft'), 'Elavtal',
        r.contract_slug, 'v1', r.move_in_date, r.move_in_date, coalesce(r.email_signed_at, r.bankid_completed_at, r.activated_at),
        r.email, coalesce(r.street, r.address), r.postal_code, r.city,
        jsonb_build_object('source_table', 'contract_agreements', 'source_id', r.id, 'agreement_reference', r.agreement_reference),
        coalesce(r.created_at, now()), coalesce(r.updated_at, now())
      ) returning id into v_contract_id;
      v_inserted := v_inserted + 1;

      update public.contract_agreements
      set company_id = coalesce(company_id, v_company_id),
          customer_id = coalesce(customer_id, v_customer_id),
          customer_site_id = coalesce(customer_site_id, v_site_id),
          canonical_customer_id = coalesce(canonical_customer_id, v_customer_id)
      where id = r.id;

      insert into public.canonical_record_links (company_id, source_table, source_id, canonical_table, canonical_id, source_hash, confidence, status, details)
      values (v_company_id, 'contract_agreements', r.id::text, 'customer_contracts', v_contract_id, public.gridex_make_source_hash(to_jsonb(r)), 'system', 'active', jsonb_build_object('backfill', 'db1_backfill_contracts'))
      on conflict (source_table, source_id, canonical_table) do update
      set company_id = excluded.company_id,
          canonical_id = excluded.canonical_id,
          source_hash = excluded.source_hash,
          status = 'active',
          details = excluded.details;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
      values (v_run_id, 'contract_agreements', coalesce(r.id::text, '<null>'), 'customer_contracts', 'failed', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('source_tables', array['customer_contracts','contract_agreements']), v_seen, v_inserted, v_updated, v_skipped, v_failed);
end;
$$;

create or replace function public.backfill_poa_scopes()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  r record;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_row_count integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_poa_scopes', 'powers_of_attorney');
  v_company_id := public.gridex_db1_default_company_id();

  if v_company_id is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'ambiguous_company'), 0, 0, 0, 1, 0);
  end if;

  if to_regclass('public.powers_of_attorney') is null or to_regclass('public.power_of_attorney_scopes') is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'poa_tables_missing'), 0, 0, 0, 1, 0);
  end if;

  update public.powers_of_attorney
  set company_id = v_company_id,
      updated_at = now()
  where company_id is null;
  get diagnostics v_row_count = row_count;
  v_updated := v_updated + v_row_count;

  for r in select * from public.powers_of_attorney loop
    v_seen := v_seen + 1;
    begin
      if exists(select 1 from public.power_of_attorney_scopes s where s.power_of_attorney_id = r.id) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.power_of_attorney_scopes (
        company_id, power_of_attorney_id, customer_id, site_id, metering_point_id,
        scope_type, status, is_active, valid_from, valid_to, metadata, created_at, updated_at
      ) values (
        coalesce(r.company_id, v_company_id), r.id, r.customer_id, r.site_id, r.metering_point_id,
        coalesce(r.scope, 'supplier_switch'), 'active', true, r.valid_from, r.valid_to,
        jsonb_build_object('source_table', 'powers_of_attorney', 'source_id', r.id, 'backfill', 'db1_backfill_poa_scopes'),
        now(), now()
      );
      v_inserted := v_inserted + 1;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
      values (v_run_id, 'powers_of_attorney', coalesce(r.id::text, '<null>'), 'power_of_attorney_scopes', 'failed', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('source_table', 'powers_of_attorney'), v_seen, v_inserted, v_updated, v_skipped, v_failed);
end;
$$;


-- -----------------------------------------------------------------------------
-- 11. RLS foundation for canonical company-scoped tables
-- DB1 intentionally creates read/insert/update policies only. Removal handling stays explicit in later governance flows.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  select_policy text;
  insert_policy text;
  update_policy text;
begin
  foreach t in array array[
    'companies','company_memberships','company_invitations','user_permission_overrides',
    'customers','customer_addresses','customer_contacts','customer_internal_notes','customer_sites','metering_points',
    'customer_contracts','customer_contract_events','powers_of_attorney','customer_authorization_documents',
    'supplier_switch_requests','supplier_switch_events','customer_operation_tasks','communication_routes','grid_owner_data_requests',
    'outbound_requests','outbound_dispatch_events','metering_values','billing_underlays','billing_export_runs','billing_export_run_items','partner_exports',
    'ediel_actor_settings','ediel_route_profiles','ediel_message_rules','ediel_messages','ediel_message_events','ediel_message_validation_issues',
    'ediel_aperak_error_rules','ediel_aperak_error_details','ediel_inbound_cases','ediel_tgt_test_data','audit_logs','customer_documents','customer_invoices',
    'customer_portal_accounts','customer_portal_claims','customer_portal_events','customer_invoice_lines','customer_invoice_documents',
    'backfill_runs','backfill_run_items','canonical_record_links','duplicate_groups','duplicate_group_members'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    select_policy := 'gridex_db1_' || t || '_select';
    insert_policy := 'gridex_db1_' || t || '_insert';
    update_policy := 'gridex_db1_' || t || '_update';
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=select_policy) then
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='company_id') then
        execute format('create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id)))', select_policy, t);
      else
        execute format('create policy %I on public.%I for select using (public.gridex_user_is_platform_admin())', select_policy, t);
      end if;
    end if;

    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=insert_policy) then
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='company_id') then
        execute format('create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_write_company(company_id)))', insert_policy, t);
      else
        execute format('create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin())', insert_policy, t);
      end if;
    end if;

    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=update_policy) then
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='company_id') then
        execute format('create policy %I on public.%I for update using (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id))) with check (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_write_company(company_id)))', update_policy, t);
      else
        execute format('create policy %I on public.%I for update using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())', update_policy, t);
      end if;
    end if;
  end loop;
end $$;

-- Companies need an explicit member-select policy because they do not carry company_id.
do $$
begin
  if to_regclass('public.companies') is not null then
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='companies' and policyname='gridex_db1_companies_member_select') then
      create policy gridex_db1_companies_member_select
        on public.companies
        for select
        using (public.gridex_user_is_platform_admin() or id in (select * from public.gridex_user_company_ids()));
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 12. DB1 reporting/safety views
-- -----------------------------------------------------------------------------
create or replace view public.gridex_db1_schema_gap_v as
with expected(object_type, object_name, required_for) as (
  values
    ('table','companies','tenant'),
    ('table','company_memberships','tenant'),
    ('table','company_invitations','tenant'),
    ('table','customers','customer_core'),
    ('table','customer_addresses','customer_core'),
    ('table','customer_contacts','customer_core'),
    ('table','customer_internal_notes','customer_core'),
    ('table','customer_sites','operations'),
    ('table','metering_points','operations'),
    ('table','powers_of_attorney','authorization'),
    ('table','customer_authorization_documents','authorization'),
    ('table','supplier_switch_requests','supplier_switch'),
    ('table','supplier_switch_events','supplier_switch'),
    ('table','grid_owners','masterdata'),
    ('table','electricity_suppliers','masterdata'),
    ('table','price_areas','masterdata'),
    ('table','price_area_localities','masterdata'),
    ('table','communication_routes','outbound'),
    ('table','grid_owner_data_requests','outbound'),
    ('table','outbound_requests','outbound'),
    ('table','outbound_dispatch_events','outbound'),
    ('table','ediel_actor_settings','ediel'),
    ('table','ediel_route_profiles','ediel'),
    ('table','ediel_message_rules','ediel'),
    ('table','ediel_messages','ediel'),
    ('table','ediel_message_events','ediel'),
    ('table','ediel_message_validation_issues','ediel'),
    ('table','billing_underlays','billing'),
    ('table','billing_export_runs','billing'),
    ('table','billing_export_run_items','billing'),
    ('table','partner_exports','billing'),
    ('table','audit_logs','audit'),
    ('table','backfill_runs','backfill'),
    ('table','canonical_record_links','backfill'),
    ('view','ediel_route_runtime_v','ediel'),
    ('view','ediel_message_ack_state_v','ediel'),
    ('view','ediel_overdue_message_acks_v','ediel'),
    ('view','ediel_duplicate_ack_candidates_v','ediel'),
    ('view','ediel_rule_ambiguities_v','ediel')
)
select
  object_type,
  object_name,
  required_for,
  to_regclass('public.' || object_name) is not null as exists_in_database,
  case when to_regclass('public.' || object_name) is null then 'missing' else 'ok' end as status
from expected
order by required_for, object_type, object_name;

create or replace view public.gridex_db1_tenant_gap_v as
select 'customer_contracts' as table_name, count(*)::bigint as rows_without_company_id from public.customer_contracts where company_id is null
union all select 'customers', count(*) from public.customers where company_id is null
union all select 'customer_sites', count(*) from public.customer_sites where company_id is null
union all select 'metering_points', count(*) from public.metering_points where company_id is null
union all select 'powers_of_attorney', count(*) from public.powers_of_attorney where company_id is null
union all select 'supplier_switch_requests', count(*) from public.supplier_switch_requests where company_id is null
union all select 'ediel_messages', count(*) from public.ediel_messages where company_id is null
union all select 'billing_underlays', count(*) from public.billing_underlays where company_id is null
union all select 'billing_export_runs', count(*) from public.billing_export_runs where company_id is null
union all select 'outbound_requests', count(*) from public.outbound_requests where company_id is null;

create or replace view public.gridex_db1_duplicate_customer_candidates_v as
select company_id, 'email' as match_type, normalized_email as match_key, count(*) as duplicate_count, array_agg(id order by created_at) as customer_ids
from public.customers
where normalized_email is not null
group by company_id, normalized_email
having count(*) > 1
union all
select company_id, 'personal_number', normalized_personal_number, count(*), array_agg(id order by created_at)
from public.customers
where normalized_personal_number is not null
group by company_id, normalized_personal_number
having count(*) > 1
union all
select company_id, 'customer_number', customer_number, count(*), array_agg(id order by created_at)
from public.customers
where customer_number is not null
group by company_id, customer_number
having count(*) > 1;

create or replace view public.gridex_db1_duplicate_site_candidates_v as
select company_id, normalized_facility_id as match_key, count(*) as duplicate_count, array_agg(id order by created_at) as site_ids
from public.customer_sites
where normalized_facility_id is not null
group by company_id, normalized_facility_id
having count(*) > 1;

create or replace view public.gridex_db1_duplicate_metering_point_candidates_v as
select company_id, normalized_metering_point_id as match_key, count(*) as duplicate_count, array_agg(id order by created_at) as metering_point_ids
from public.metering_points
where normalized_metering_point_id is not null
group by company_id, normalized_metering_point_id
having count(*) > 1;

create or replace view public.gridex_db1_rbac_health_v as
select 'user_roles_table' as check_key, (to_regclass('public.user_roles') is not null)::text as result, null::text as details
union all select 'roles_table', (to_regclass('public.roles') is not null)::text, null
union all select 'user_roles_has_role_id', exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='role_id')::text, null
union all select 'user_roles_has_role_text', exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='role')::text, null
union all select 'company_memberships_table', (to_regclass('public.company_memberships') is not null)::text, null
union all select 'rbac_helper_platform_admin_callable', 'true', 'function recreated in DB1';

create or replace view public.gridex_db1_rls_policy_gap_v as
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  exists(select 1 from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as has_policy
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'companies','company_memberships','customers','customer_sites','metering_points','powers_of_attorney','supplier_switch_requests',
    'ediel_messages','billing_export_runs','billing_underlays','outbound_requests','audit_logs'
  )
order by c.relname;

create or replace view public.gridex_db1_storage_gap_v as
with expected(bucket_id) as (
  values ('customer-documents'),('contract-pdfs'),('customer-intake'),('billing-imports'),('billing-exports'),('ediel-files'),('actor-test-evidence')
)
select
  e.bucket_id,
  b.id is not null as exists_in_storage,
  coalesce(b.public, false) as is_public,
  b.file_size_limit,
  b.allowed_mime_types
from expected e
left join storage.buckets b on b.id = e.bucket_id
order by e.bucket_id;

create or replace view public.gridex_db1_backfill_readiness_v as
select 'schema_gap' as check_key, count(*)::bigint as issue_count, 'missing expected tables/views' as description
from public.gridex_db1_schema_gap_v where exists_in_database = false
union all
select 'tenant_gap', coalesce(sum(rows_without_company_id),0)::bigint, 'rows missing company_id'
from public.gridex_db1_tenant_gap_v
union all
select 'duplicate_customers', count(*)::bigint, 'duplicate customer candidates'
from public.gridex_db1_duplicate_customer_candidates_v
union all
select 'duplicate_sites', count(*)::bigint, 'duplicate site candidates'
from public.gridex_db1_duplicate_site_candidates_v
union all
select 'duplicate_metering_points', count(*)::bigint, 'duplicate metering point candidates'
from public.gridex_db1_duplicate_metering_point_candidates_v
union all
select 'storage_gap', count(*)::bigint, 'missing storage buckets'
from public.gridex_db1_storage_gap_v where exists_in_storage = false
union all
select 'rls_policy_gap', count(*)::bigint, 'important tables without RLS/policies'
from public.gridex_db1_rls_policy_gap_v where rls_enabled = false or has_policy = false;

-- -----------------------------------------------------------------------------
-- 13. Minimal safe tenant backfill only when unambiguous
-- -----------------------------------------------------------------------------
do $$
declare
  default_company uuid;
  company_count integer;
  t text;
begin
  select count(*) into company_count from public.companies;

  if company_count = 1 then
    select id
    into default_company
    from public.companies
    order by created_at nulls last, id::text
    limit 1;
  end if;

  if company_count = 1 and default_company is not null then
    foreach t in array array[
      'customer_contracts','contract_agreements','customer_delivery_points','document_ai_extractions',
      'customer_readiness_snapshots','customer_lifecycle_decisions','customer_duplicate_resolution_events','customer_merge_events'
    ] loop
      if to_regclass('public.' || t) is not null
         and exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='company_id') then
        execute format('update public.%I set company_id = $1 where company_id is null', t) using default_company;
      end if;
    end loop;
  else
    perform public.gridex_db1_log_finding(
      'info',
      'minimal_backfill',
      'company_id',
      'Skipped minimal company_id backfill because company count is not exactly one.',
      jsonb_build_object('company_count', company_count)
    );
  end if;
end $$;

update public.gridex_schema_repair_runs
set status = 'completed',
    completed_at = now(),
    summary = jsonb_build_object(
      'phase', 'db1',
      'safe', true,
      'delete_operations', false,
      'aggressive_merge', false,
      'next_step', 'Run DB1 report views, then DB2 controlled backfill.'
    )
where repair_key = 'db1_schema_repair_backfill_foundation_20260522';
