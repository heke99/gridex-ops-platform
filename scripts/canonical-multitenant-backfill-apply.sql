\set ON_ERROR_STOP on
\pset pager off

-- Apply only deterministic null -> verified parent tenant repairs.
-- Non-null mismatches are never moved automatically.
begin;

do $$
declare
  r record;
  repaired bigint;
begin
  for r in
    select * from (values
      ('customer_sites', 'customer_id', 'customers'),
      ('metering_points', 'customer_id', 'customers'),
      ('metering_points', 'site_id', 'customer_sites'),
      ('customer_contracts', 'customer_id', 'customers'),
      ('customer_contracts', 'site_id', 'customer_sites'),
      ('powers_of_attorney', 'customer_id', 'customers'),
      ('customer_authorization_documents', 'customer_id', 'customers'),
      ('customer_authorization_documents', 'power_of_attorney_id', 'powers_of_attorney'),
      ('customer_legal_acceptances', 'customer_id', 'customers'),
      ('customer_info_requests', 'customer_id', 'customers'),
      ('supplier_switch_requests', 'customer_id', 'customers'),
      ('customer_invoices', 'customer_id', 'customers'),
      ('customer_onboarding_applications', 'onboarding_operation_id', 'customer_onboarding_operations'),
      ('customer_onboarding_applications', 'customer_id', 'customers'),
      ('customer_onboarding_legal_snapshots', 'customer_id', 'customers'),
      ('customer_match_review_cases', 'onboarding_operation_id', 'customer_onboarding_operations'),
      ('domain_events', 'subject_customer_id', 'customers'),
      ('event_outbox', 'domain_event_id', 'domain_events')
    ) as rel(child_table, child_column, parent_table)
  loop
    if to_regclass(format('public.%I', r.child_table)) is null
       or to_regclass(format('public.%I', r.parent_table)) is null
       or not exists (select 1 from pg_attribute where attrelid = to_regclass(format('public.%I', r.child_table)) and attname = r.child_column and not attisdropped) then
      continue;
    end if;

    execute format($q$
      with repaired as (
        update public.%I child
           set company_id = parent.company_id
          from public.%I parent
         where child.%I = parent.id
           and child.company_id is null
           and parent.company_id is not null
        returning child.id::text as entity_id, parent.company_id
      )
      insert into public.audit_logs(company_id, actor_user_id, entity_type, entity_id, action, old_values, new_values, metadata)
      select company_id, null, %L, entity_id, 'canonical_multitenant_company_id_backfill',
             jsonb_build_object('company_id', null),
             jsonb_build_object('company_id', company_id),
             jsonb_build_object('source_relation', %L, 'safe_derivation', true)
        from repaired
    $q$, r.child_table, r.parent_table, r.child_column, r.child_table, r.child_column || ' -> ' || r.parent_table);
    get diagnostics repaired = row_count;
    raise notice 'Audited deterministic repairs for %.%: %', r.child_table, r.child_column, repaired;
  end loop;
end;
$$;

-- Correlation IDs are repaired only where the column is UUID and tenant is known.
do $$
declare
  r record;
begin
  for r in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute company_col on company_col.attrelid = c.oid and company_col.attname = 'company_id' and not company_col.attisdropped
      join pg_attribute correlation_col on correlation_col.attrelid = c.oid and correlation_col.attname = 'correlation_id' and not correlation_col.attisdropped
     where n.nspname = 'public'
       and c.relkind = 'r'
       and correlation_col.atttypid = 'uuid'::regtype
  loop
    execute format($q$
      with repaired as (
        update public.%I
           set correlation_id = gen_random_uuid()
         where company_id is not null and correlation_id is null
        returning id::text as entity_id, company_id, correlation_id
      )
      insert into public.audit_logs(company_id, actor_user_id, entity_type, entity_id, action, old_values, new_values, metadata)
      select company_id, null, %L, entity_id, 'canonical_multitenant_correlation_id_backfill',
             jsonb_build_object('correlation_id', null),
             jsonb_build_object('correlation_id', correlation_id),
             jsonb_build_object('safe_derivation', true)
        from repaired
    $q$, r.table_name, r.table_name);
  end loop;
end;
$$;

commit;
