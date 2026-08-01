\set ON_ERROR_STOP on
\pset pager off

-- Read-only inventory. Safe to run before migration or backfill.
drop table if exists pg_temp.canonical_multitenant_findings;
create temporary table canonical_multitenant_findings (
  severity text not null,
  finding_code text not null,
  table_name text,
  relation_name text,
  company_id uuid,
  row_count bigint not null,
  details jsonb not null default '{}'::jsonb
);

do $$
declare
  r record;
  row_count bigint;
begin
  -- Missing tenant IDs on tables that actually expose company_id.
  for r in
    select n.nspname, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('select count(*) from %I.%I where company_id is null', r.nspname, r.relname) into row_count;
    if row_count > 0 then
      insert into canonical_multitenant_findings
      values ('warning', 'missing_company_id', r.relname, null, null, row_count, '{}'::jsonb);
    end if;
  end loop;

  -- Parent-child mismatches in the canonical customer graph.
  for r in
    select * from (values
      ('customer_sites', 'customer_id', 'customers'),
      ('metering_points', 'customer_id', 'customers'),
      ('metering_points', 'site_id', 'customer_sites'),
      ('metering_points', 'customer_site_id', 'customer_sites'),
      ('customer_contracts', 'customer_id', 'customers'),
      ('customer_contracts', 'site_id', 'customer_sites'),
      ('customer_contracts', 'customer_site_id', 'customer_sites'),
      ('customer_contracts', 'metering_point_id', 'metering_points'),
      ('powers_of_attorney', 'customer_id', 'customers'),
      ('powers_of_attorney', 'site_id', 'customer_sites'),
      ('powers_of_attorney', 'contract_id', 'customer_contracts'),
      ('customer_authorization_documents', 'customer_id', 'customers'),
      ('customer_authorization_documents', 'power_of_attorney_id', 'powers_of_attorney'),
      ('customer_legal_acceptances', 'customer_id', 'customers'),
      ('customer_info_requests', 'customer_id', 'customers'),
      ('supplier_switch_requests', 'customer_id', 'customers'),
      ('customer_invoices', 'customer_id', 'customers'),
      ('customer_onboarding_applications', 'onboarding_operation_id', 'customer_onboarding_operations'),
      ('customer_onboarding_applications', 'customer_id', 'customers'),
      ('customer_onboarding_legal_snapshots', 'customer_id', 'customers'),
      ('customer_match_review_cases', 'resolved_customer_id', 'customers'),
      ('domain_events', 'subject_customer_id', 'customers'),
      ('event_outbox', 'domain_event_id', 'domain_events')
    ) as rel(child_table, child_column, parent_table)
  loop
    if to_regclass(format('public.%I', r.child_table)) is null
       or to_regclass(format('public.%I', r.parent_table)) is null
       or not exists (select 1 from pg_attribute where attrelid = to_regclass(format('public.%I', r.child_table)) and attname = r.child_column and not attisdropped)
       or not exists (select 1 from pg_attribute where attrelid = to_regclass(format('public.%I', r.child_table)) and attname = 'company_id' and not attisdropped)
       or not exists (select 1 from pg_attribute where attrelid = to_regclass(format('public.%I', r.parent_table)) and attname = 'company_id' and not attisdropped) then
      continue;
    end if;
    execute format(
      'select count(*) from public.%I child join public.%I parent on parent.id = child.%I where child.%I is not null and child.company_id is distinct from parent.company_id',
      r.child_table, r.parent_table, r.child_column, r.child_column
    ) into row_count;
    if row_count > 0 then
      insert into canonical_multitenant_findings
      values ('critical', 'cross_tenant_parent_child', r.child_table, r.child_column || ' -> ' || r.parent_table, null, row_count, '{}'::jsonb);
    end if;
  end loop;
end;
$$;

-- Tables carrying tenant data without RLS are a release blocker.
insert into canonical_multitenant_findings(severity, finding_code, table_name, row_count, details)
select 'critical', 'tenant_table_without_rls', c.relname, 1,
       jsonb_build_object('rowsecurity', c.relrowsecurity, 'forcerowsecurity', c.relforcerowsecurity)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
   and not c.relrowsecurity;

select coalesce(c.name, '<missing/global>') as tenant,
       f.severity,
       f.finding_code,
       f.table_name,
       f.relation_name,
       f.row_count,
       f.details
  from canonical_multitenant_findings f
  left join public.companies c on c.id = f.company_id
 order by case f.severity when 'critical' then 1 when 'warning' then 2 else 3 end,
          f.table_name,
          f.finding_code;

select severity, finding_code, sum(row_count) as total_rows
  from canonical_multitenant_findings
 group by severity, finding_code
 order by severity, finding_code;
