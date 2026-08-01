\set ON_ERROR_STOP on
\pset pager off

-- Dry-run only. Shows deterministic repairs and leaves mismatches untouched.
drop table if exists pg_temp.canonical_multitenant_repair_candidates;
create temporary table canonical_multitenant_repair_candidates (
  table_name text,
  relation_name text,
  row_id text,
  current_company_id uuid,
  inferred_company_id uuid,
  classification text
);

do $$
declare
  r record;
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
      insert into canonical_multitenant_repair_candidates
      select %L, %L, child.id::text, child.company_id, parent.company_id,
             case
               when child.company_id is null and parent.company_id is not null then 'safe_fill_from_parent'
               when child.company_id is distinct from parent.company_id then 'ambiguous_cross_tenant_conflict'
               else 'already_consistent'
             end
        from public.%I child
        join public.%I parent on parent.id = child.%I
       where child.company_id is null
          or child.company_id is distinct from parent.company_id
    $q$, r.child_table, r.child_column || ' -> ' || r.parent_table, r.child_table, r.parent_table, r.child_column);
  end loop;
end;
$$;

select coalesce(c.name, '<unresolved>') as inferred_tenant,
       classification,
       table_name,
       relation_name,
       count(*) as rows
  from canonical_multitenant_repair_candidates r
  left join public.companies c on c.id = r.inferred_company_id
 group by c.name, classification, table_name, relation_name
 order by classification, inferred_tenant, table_name;

select *
  from canonical_multitenant_repair_candidates
 where classification = 'ambiguous_cross_tenant_conflict'
 order by table_name, row_id;
